const express = require('express');
const router = express.Router();
const { Member, Contribution, Loan, Repayment, Fine, Notification, getNextId } = require('../db/models');
const { CommunicationLog } = require('../db/communicationModels');
const { getRulesForFY } = require('./rules');
const { isConfigured, sendContributionReminder, sendMemberMessage } = require('../utils/memberMailer');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

function utcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function previousContributionPeriod(now) {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

function contributionDueDate(month, year) {
  return month === 12 ? new Date(Date.UTC(year + 1, 0, 5)) : new Date(Date.UTC(year, month, 5));
}

function reminderPhase(now, due) {
  const days = Math.round((utcDay(now) - utcDay(due)) / 86400000);
  if (days === -2) return 'upcoming';
  if (days === 0) return 'due';
  if (days > 0 && (days === 1 || (days - 1) % 7 === 0)) return 'overdue';
  return null;
}

function portalUrl(req) {
  return process.env.PORTAL_URL || process.env.WEB_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.get('authorization') || '') === `Bearer ${secret}`;
}

async function createNotificationIfNew({ memberId, type, message, dueDate }) {
  const existing = await Notification.findOne({ member_id: memberId, type, message }).lean();
  if (existing) return { notification: existing, created: false };
  const notification = await Notification.create({
    id: await getNextId('notification_id'),
    member_id: memberId,
    type,
    message,
    due_date: dueDate || null,
    read: false,
    created_by: 'system:member-reminders',
  });
  return { notification, created: true };
}

async function alreadyEmailed(memberId, type, periodKey) {
  return CommunicationLog.findOne({
    member_id: memberId,
    type,
    period_key: periodKey,
    status: { $in: ['sent', 'mocked'] },
  }).lean();
}

async function logEmail({ member, type, periodKey, subject, status, info, failureReason }) {
  return CommunicationLog.create({
    member_id: member.id,
    recipient_email: String(member.email || '').trim().toLowerCase(),
    type,
    period_key: periodKey,
    subject,
    status,
    provider_message_id: info?.messageId || null,
    sent_at: status === 'sent' || status === 'mocked' ? new Date() : null,
    failure_reason: failureReason || null,
    created_by: 'vercel-cron',
  });
}

async function scanContributionReminders(req, now, results) {
  const period = previousContributionPeriod(now);
  const due = contributionDueDate(period.month, period.year);
  const phase = reminderPhase(now, due);
  if (!phase) return;

  const fy = getFiscalYear(period.month, period.year);
  const rules = await getRulesForFY(fy);
  const monthlyTarget = Number(rules.contribution_amount || 0);
  const [members, contributions] = await Promise.all([
    Member.find({ status: 'active' }).lean(),
    Contribution.find({ month: period.month, year: period.year }).lean(),
  ]);

  for (const member of members) {
    const paid = contributions.filter((record) => record.member_id === member.id).reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const outstanding = Math.max(0, monthlyTarget - paid);
    if (outstanding <= 0) continue;

    const message = `Your ${MONTH_NAMES[period.month]} ${period.year} contribution has TZS ${outstanding.toLocaleString('en-US')} outstanding. Due ${dateKey(due)}.`;
    const notificationResult = await createNotificationIfNew({ memberId: member.id, type: 'contribution_due', message, dueDate: dateKey(due) });

    if (!member.email) {
      results.push({ category: 'contribution', member_id: member.id, notification: notificationResult.created ? 'created' : 'existing', email: 'skipped', reason: 'No email' });
      continue;
    }

    const periodKey = `contribution:${period.year}-${String(period.month).padStart(2, '0')}:${phase}:${dateKey(now)}`;
    if (await alreadyEmailed(member.id, 'contribution_reminder', periodKey)) {
      results.push({ category: 'contribution', member_id: member.id, notification: notificationResult.created ? 'created' : 'existing', email: 'skipped', reason: 'Already sent today' });
      continue;
    }

    try {
      const info = await sendContributionReminder(member, {
        periodLabel: `${MONTH_NAMES[period.month]} ${period.year}`,
        monthlyTarget,
        paidAmount: paid,
        outstandingAmount: outstanding,
        dueDate: dateKey(due),
        portalUrl: portalUrl(req),
      });
      const status = info.mocked ? 'mocked' : 'sent';
      await logEmail({ member, type: 'contribution_reminder', periodKey, subject: `Checkpoint contribution reminder — ${MONTH_NAMES[period.month]} ${period.year}`, status, info });
      results.push({ category: 'contribution', member_id: member.id, notification: notificationResult.created ? 'created' : 'existing', email: status, outstanding });
    } catch (error) {
      await logEmail({ member, type: 'contribution_reminder', periodKey, subject: `Checkpoint contribution reminder — ${MONTH_NAMES[period.month]} ${period.year}`, status: 'failed', failureReason: error.message });
      results.push({ category: 'contribution', member_id: member.id, notification: notificationResult.created ? 'created' : 'existing', email: 'failed', reason: error.message });
    }
  }
}

async function scanLoanReminders(req, now, results) {
  const [loans, repayments, members] = await Promise.all([
    Loan.find({ status: 'active', due_date: { $ne: null } }).lean(),
    Repayment.find().lean(),
    Member.find({ status: 'active' }).lean(),
  ]);
  const memberMap = new Map(members.map((member) => [member.id, member]));

  for (const loan of loans) {
    const due = new Date(`${loan.due_date}T00:00:00Z`);
    if (Number.isNaN(due.getTime())) continue;
    const phase = reminderPhase(now, due);
    if (!phase) continue;
    const paid = repayments.filter((item) => item.loan_id === loan.id).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const balance = Math.max(0, Number(loan.principal || 0) - paid);
    if (balance <= 0) continue;
    const member = memberMap.get(loan.member_id);
    if (!member) continue;

    const message = `${loan.loan_number || `Loan #${loan.id}`} has TZS ${balance.toLocaleString('en-US')} outstanding and is ${phase === 'overdue' ? 'overdue' : `due ${loan.due_date}`}.`;
    const notificationResult = await createNotificationIfNew({ memberId: member.id, type: 'loan_due', message, dueDate: loan.due_date });
    if (!member.email) {
      results.push({ category: 'loan', member_id: member.id, loan_id: loan.id, notification: notificationResult.created ? 'created' : 'existing', email: 'skipped', reason: 'No email' });
      continue;
    }

    const periodKey = `loan:${loan.id}:${phase}:${dateKey(now)}`;
    if (await alreadyEmailed(member.id, 'loan_reminder', periodKey)) continue;
    const subject = phase === 'overdue' ? `Checkpoint loan overdue — ${loan.loan_number || `Loan #${loan.id}`}` : `Checkpoint loan reminder — ${loan.loan_number || `Loan #${loan.id}`}`;
    try {
      const info = await sendMemberMessage(member, { subject, message, portalUrl: `${portalUrl(req).replace(/\/$/, '')}/loans` });
      const status = info.mocked ? 'mocked' : 'sent';
      await logEmail({ member, type: 'loan_reminder', periodKey, subject, status, info });
      results.push({ category: 'loan', member_id: member.id, loan_id: loan.id, notification: notificationResult.created ? 'created' : 'existing', email: status, outstanding: balance });
    } catch (error) {
      await logEmail({ member, type: 'loan_reminder', periodKey, subject, status: 'failed', failureReason: error.message });
      results.push({ category: 'loan', member_id: member.id, loan_id: loan.id, notification: notificationResult.created ? 'created' : 'existing', email: 'failed', reason: error.message });
    }
  }
}

async function scanFineReminders(req, now, results) {
  const [fines, members] = await Promise.all([
    Fine.find({ status: 'unpaid' }).lean(),
    Member.find({ status: 'active' }).lean(),
  ]);
  const memberMap = new Map(members.map((member) => [member.id, member]));

  for (const fine of fines) {
    const created = new Date(fine.created_at);
    if (Number.isNaN(created.getTime())) continue;
    const due = new Date(created);
    due.setUTCDate(due.getUTCDate() + 14);
    const phase = reminderPhase(now, due);
    if (!phase || phase === 'upcoming') continue;
    const member = memberMap.get(fine.member_id);
    if (!member) continue;

    const message = `Fine of TZS ${Number(fine.amount || 0).toLocaleString('en-US')} is still unpaid${fine.reason ? ` — ${fine.reason}` : ''}.`;
    const notificationResult = await createNotificationIfNew({ memberId: member.id, type: 'fine_overdue', message, dueDate: dateKey(due) });
    if (!member.email) {
      results.push({ category: 'fine', member_id: member.id, fine_id: fine.id, notification: notificationResult.created ? 'created' : 'existing', email: 'skipped', reason: 'No email' });
      continue;
    }

    const periodKey = `fine:${fine.id}:${phase}:${dateKey(now)}`;
    if (await alreadyEmailed(member.id, 'fine_notice', periodKey)) continue;
    const subject = 'Checkpoint fine reminder';
    try {
      const info = await sendMemberMessage(member, { subject, message, portalUrl: `${portalUrl(req).replace(/\/$/, '')}/contributions` });
      const status = info.mocked ? 'mocked' : 'sent';
      await logEmail({ member, type: 'fine_notice', periodKey, subject, status, info });
      results.push({ category: 'fine', member_id: member.id, fine_id: fine.id, notification: notificationResult.created ? 'created' : 'existing', email: status });
    } catch (error) {
      await logEmail({ member, type: 'fine_notice', periodKey, subject, status: 'failed', failureReason: error.message });
      results.push({ category: 'fine', member_id: member.id, fine_id: fine.id, notification: notificationResult.created ? 'created' : 'existing', email: 'failed', reason: error.message });
    }
  }
}

router.get('/', async (req, res) => {
  if (!authorized(req)) return res.status(process.env.CRON_SECRET ? 401 : 503).json({ error: process.env.CRON_SECRET ? 'Unauthorized' : 'CRON_SECRET is not configured' });

  try {
    const now = new Date();
    const results = [];
    await scanContributionReminders(req, now, results);
    await scanLoanReminders(req, now, results);
    await scanFineReminders(req, now, results);

    res.json({
      ok: true,
      date: dateKey(now),
      mock_mode: !isConfigured,
      total_actions: results.length,
      emails_sent: results.filter((item) => item.email === 'sent').length,
      emails_mocked: results.filter((item) => item.email === 'mocked').length,
      emails_failed: results.filter((item) => item.email === 'failed').length,
      notifications_created: results.filter((item) => item.notification === 'created').length,
      results,
    });
  } catch (error) {
    console.error('[member-reminder-cron]', error);
    res.status(500).json({ error: 'Reminder scan failed' });
  }
});

module.exports = router;
