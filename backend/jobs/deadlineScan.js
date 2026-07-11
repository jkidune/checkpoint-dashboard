const cron = require('node-cron');
const { Member, Contribution, Loan, Fine, Notification, getNextId } = require('../db/models');
const { notifyByEmail } = require('../utils/notifyByEmail');

// ─── Config ───────────────────────────────────────────────────────────────────
const CONTRIBUTION_DUE_DAY = 5;   // day-of-month after which an unpaid current-month contribution is flagged
const FINE_OVERDUE_DAYS    = 14;  // days after a fine is issued before it's flagged overdue

// ─── createIfNew ──────────────────────────────────────────────────────────────
// Dedup key is member_id + type + message (Notification has no dedicated
// period/source field) — messages below are built to be stable per period, so
// re-running the scan on an unchanged member+period is a no-op.
async function createIfNew({ member_id, type, message, due_date }) {
  const existing = await Notification.findOne({ member_id, type, message }).lean();
  if (existing) return null;

  const notification = await Notification.create({
    id:         await getNextId('notification_id'),
    member_id,
    type,
    message,
    due_date:   due_date || null,
    created_by: 'system:deadlineScan',
  });
  await notifyByEmail(notification);
  return notification;
}

// ─── runDeadlineScan ──────────────────────────────────────────────────────────
// Checks: unpaid contributions for the current month past CONTRIBUTION_DUE_DAY,
// loans past due_date, fines unpaid past FINE_OVERDUE_DAYS. Creates a
// Notification per affected member, skipping duplicates. Used by both the
// in-process cron (local/Railway) and POST /api/notifications/scan (Vercel Cron).
async function runDeadlineScan() {
  const today    = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const created  = [];

  // 1) Contributions not yet paid for the current month
  if (today.getDate() > CONTRIBUTION_DUE_DAY) {
    const month = today.getMonth() + 1;
    const year  = today.getFullYear();
    const activeMembers = await Member.find({ status: 'active' }).lean();
    const paid = await Contribution.find({ month, year, status: { $in: ['paid', 'partial'] } }).lean();
    const paidIds = new Set(paid.map(c => c.member_id));

    for (const m of activeMembers) {
      if (paidIds.has(m.id)) continue;
      const n = await createIfNew({
        member_id: m.id,
        type: 'contribution_due',
        message: `Contribution for ${month}/${year} has not been recorded as paid.`,
      });
      if (n) created.push(n);
    }
  }

  // 2) Loans past due_date
  const overdueLoans = await Loan.find({ status: 'active', due_date: { $ne: null, $lt: todayStr } }).lean();
  for (const loan of overdueLoans) {
    const n = await createIfNew({
      member_id: loan.member_id,
      type: 'loan_due',
      message: `${loan.loan_number} is overdue (was due ${loan.due_date}).`,
      due_date: loan.due_date,
    });
    if (n) created.push(n);
  }

  // 3) Fines unpaid past FINE_OVERDUE_DAYS
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - FINE_OVERDUE_DAYS);
  const unpaidFines = await Fine.find({ status: 'unpaid', created_at: { $lte: cutoff } }).lean();
  for (const fine of unpaidFines) {
    const n = await createIfNew({
      member_id: fine.member_id,
      type: 'fine_overdue',
      message: `Fine of TZS ${fine.amount.toLocaleString()} (${fine.reason}) has been unpaid for over ${FINE_OVERDUE_DAYS} days.`,
    });
    if (n) created.push(n);
  }

  console.log(`[deadlineScan] created ${created.length} notification(s) at ${today.toISOString()}`);
  return { scanned_at: today.toISOString(), created: created.length, notifications: created };
}

// ─── startDeadlineScanJob ─────────────────────────────────────────────────────
// In-process daily timer — only valid where the process stays alive (local dev,
// Railway). On Vercel serverless there's no long-lived process for this, so use
// a Vercel Cron trigger hitting POST /api/notifications/scan instead; this
// function must not be called when process.env.VERCEL === '1' (see server.js).
function startDeadlineScanJob() {
  cron.schedule('0 6 * * *', () => {
    runDeadlineScan().catch(err => console.error('[deadlineScan] failed:', err));
  });
  console.log('[deadlineScan] daily cron scheduled (06:00 server time)');
}

module.exports = { runDeadlineScan, startDeadlineScanJob };
