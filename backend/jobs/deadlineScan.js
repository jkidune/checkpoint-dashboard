const cron = require('node-cron');
const { Member, Contribution, Loan, Fine, Notification, getNextId } = require('../db/models');
const { notifyByEmail } = require('../utils/notifyByEmail');
const { getRulesForFY } = require('../routes/rules');
const { getFiscalYear, getContributionDeadline } = require('../services/contributionFinePolicy');
const { runAutomaticFineIssuance } = require('../services/automaticMissingFineIssuance');

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
async function createIfNew({ member_id, type, message, due_date }) {
  const existing = await Notification.findOne({ member_id, type, message }).lean();
  if (existing) return null;

  const notification = await Notification.create({
    id: await getNextId('notification_id'),
    member_id,
    type,
    message,
    due_date: due_date || null,
    created_by: 'system:deadlineScan',
  });
  await notifyByEmail(notification);
  return notification;
}

// Daily operational scan used by long-lived deployments such as Railway.
// Automatic fine issuance runs first and is idempotent by member + contribution
// period. It fines only periods with NO contribution record after the deadline;
// recorded paid_date values are deliberately ignored for fine eligibility.
async function runDeadlineScan() {
  const today = new Date();
  const todayStr = dateKey(today);
  const created = [];

  const fineIssuance = await runAutomaticFineIssuance({
    now: today,
    portalUrl: process.env.PORTAL_URL || process.env.WEB_ORIGIN || '',
    source: 'system:deadlineScan',
  });

  // Contribution reminder: contributions remain payable through the 5th of the
  // following month. After that deadline, remind on the previous contribution
  // period (not the current calendar month).
  const period = previousContributionPeriod(today);
  const deadline = getContributionDeadline(period.month, period.year);
  if (today > deadline) {
    const fy = getFiscalYear(period.month, period.year);
    const rules = await getRulesForFY(fy);
    const target = Number(rules.contribution_amount || 0);
    const [activeMembers, contributions] = await Promise.all([
      Member.find({ status: 'active' }).lean(),
      Contribution.find({ month: period.month, year: period.year }).lean(),
    ]);

    for (const member of activeMembers) {
      const paid = contributions
        .filter((row) => Number(row.member_id) === Number(member.id))
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const outstanding = Math.max(0, target - paid);
      if (outstanding <= 0) continue;

      const message = `Your ${MONTH_NAMES[period.month]} ${period.year} contribution has TZS ${outstanding.toLocaleString('en-US')} outstanding. Due ${dateKey(deadline)}.`;
      const notification = await createIfNew({
        member_id: member.id,
        type: 'contribution_due',
        message,
        due_date: dateKey(deadline),
      });
      if (notification) created.push(notification);
    }
  }

  // Loans past due_date.
  const overdueLoans = await Loan.find({ status: 'active', due_date: { $ne: null, $lt: todayStr } }).lean();
  for (const loan of overdueLoans) {
    const notification = await createIfNew({
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
  const unpaidFines = await Fine.find({ status: 'unpaid', created_at: { $lte: cutoff } }).lean();
  for (const fine of unpaidFines) {
    const notification = await createIfNew({
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

function startDeadlineScanJob() {
  cron.schedule('0 6 * * *', () => {
    runDeadlineScan().catch((err) => console.error('[deadlineScan] failed:', err));
  });
  console.log('[deadlineScan] daily cron scheduled (06:00 server time)');
}

module.exports = { runDeadlineScan, startDeadlineScanJob };
