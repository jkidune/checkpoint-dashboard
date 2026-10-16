const cron = require('node-cron');
const legacyModels = {
  ...require('../db/models'),
  ...require('../db/communicationModels'),
};
const { notifyByEmail } = require('../utils/notifyByEmail');
const { getRulesForFYWithModel } = require('../services/fyRules');
const { getFiscalYear, getContributionDeadline } = require('../services/contributionFinePolicy');
const {
  runAutomaticFineIssuanceWithModels,
} = require('../services/automaticMissingFineIssuance');

const FINE_OVERDUE_DAYS = 14;
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function previousContributionPeriod(now) {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

// Dedup key is member_id + type + message. Messages are stable per obligation,
// so a Railway in-process scan and a serverless cron can safely overlap.
async function createIfNewWithModels(models, { member_id, type, message, due_date }) {
  const existing = await models.Notification.findOne({ member_id, type, message }).lean();
  if (existing) return null;

  const notification = await models.Notification.create({
    id: await models.getNextId('notification_id'),
    member_id,
    type,
    message,
    due_date: due_date || null,
    created_by: 'system:deadlineScan',
  });
  await notifyByEmail(notification);
  return notification;
}

// Model-explicit scan used by authenticated request paths. Every database
// operation is resolved from the caller-supplied tenant bundle. options.now
// exists for deterministic tests/internal callers; no HTTP route accepts a
// client-supplied database or tenant selector.
async function runDeadlineScanWithModels(models, options = {}) {
  const today = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const todayStr = dateKey(today);
  const created = [];

  const fineIssuance = await runAutomaticFineIssuanceWithModels(models, {
    now: today,
    portalUrl: options.portalUrl || process.env.PORTAL_URL || process.env.WEB_ORIGIN || '',
    source: options.source || 'system:deadlineScan',
  });

  // Contribution reminder: contributions remain payable through the 5th of the
  // following month. After that deadline, remind on the previous contribution
  // period (not the current calendar month).
  const period = previousContributionPeriod(today);
  const deadline = getContributionDeadline(period.month, period.year);
  if (today > deadline) {
    const fy = getFiscalYear(period.month, period.year);
    const rules = await getRulesForFYWithModel(models.FyRules, fy);
    const target = Number(rules.contribution_amount || 0);
    const [activeMembers, contributions] = await Promise.all([
      models.Member.find({ status: 'active' }).lean(),
      models.Contribution.find({ month: period.month, year: period.year }).lean(),
    ]);

    for (const member of activeMembers) {
      const paid = contributions
        .filter((row) => Number(row.member_id) === Number(member.id))
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const outstanding = Math.max(0, target - paid);
      if (outstanding <= 0) continue;

      const message = `Your ${MONTH_NAMES[period.month]} ${period.year} contribution has TZS ${outstanding.toLocaleString('en-US')} outstanding. Due ${dateKey(deadline)}.`;
      const notification = await createIfNewWithModels(models, {
        member_id: member.id,
        type: 'contribution_due',
        message,
        due_date: dateKey(deadline),
      });
      if (notification) created.push(notification);
    }
  }

  // Loans past due_date.
  const overdueLoans = await models.Loan.find({
    status: 'active',
    due_date: { $ne: null, $lt: todayStr },
  }).lean();
  for (const loan of overdueLoans) {
    const notification = await createIfNewWithModels(models, {
      member_id: loan.member_id,
      type: 'loan_due',
      message: `${loan.loan_number} is overdue (was due ${loan.due_date}).`,
      due_date: loan.due_date,
    });
    if (notification) created.push(notification);
  }

  // Existing fines unpaid for 14+ days continue to receive the separate overdue
  // reminder. The initial fine-issued notice is handled by automatic fine issuance.
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - FINE_OVERDUE_DAYS);
  const unpaidFines = await models.Fine.find({ status: 'unpaid', created_at: { $lte: cutoff } }).lean();
  for (const fine of unpaidFines) {
    const notification = await createIfNewWithModels(models, {
      member_id: fine.member_id,
      type: 'fine_overdue',
      message: `Fine of TZS ${Number(fine.amount || 0).toLocaleString('en-US')} (${fine.reason}) has been unpaid for over ${FINE_OVERDUE_DAYS} days.`,
    });
    if (notification) created.push(notification);
  }

  console.log(`[deadlineScan] auto missing-month fines ${fineIssuance.fines_created}; other notifications ${created.length} at ${today.toISOString()}`);
  return {
    scanned_at: today.toISOString(),
    fine_issuance: fineIssuance,
    created: created.length,
    notifications: created,
  };
}

// Temporary compatibility wrapper for requestless Phase 4F-B2 paths.
// Authenticated /notifications/scan does NOT use this wrapper. Phase 4F-B2
// will replace requestless default binding with trusted runtime-organization
// resolution, then this wrapper can be retired.
async function runDeadlineScan(options = {}) {
  return runDeadlineScanWithModels(legacyModels, options);
}

function startDeadlineScanJob() {
  cron.schedule('0 6 * * *', () => {
    runDeadlineScan().catch((err) => console.error('[deadlineScan] failed:', err));
  });
  console.log('[deadlineScan] daily cron scheduled (06:00 server time)');
}

module.exports = {
  createIfNewWithModels,
  runDeadlineScanWithModels,
  runDeadlineScan,
  startDeadlineScanJob,
};
