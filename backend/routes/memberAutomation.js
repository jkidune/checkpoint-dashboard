const express = require('express');
const router = express.Router();
const { Member, Contribution } = require('../db/models');
const { CommunicationLog } = require('../db/communicationModels');
const { getRulesForFY } = require('./rules');
const { isConfigured, sendContributionReminder } = require('../utils/memberMailer');

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

function dueDate(month, year) {
  return month === 12 ? new Date(Date.UTC(year + 1, 0, 5)) : new Date(Date.UTC(year, month, 5));
}

function reminderPhase(now, due) {
  const days = Math.round((utcDay(now) - utcDay(due)) / 86400000);
  if (days === -2) return 'upcoming';
  if (days === 0) return 'due';
  // First overdue reminder the next day, then weekly thereafter.
  if (days > 0 && (days === 1 || (days - 1) % 7 === 0)) return 'overdue';
  return null;
}

function portalUrl(req) {
  return process.env.PORTAL_URL || process.env.WEB_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.get('authorization') || '';
  return header === `Bearer ${secret}`;
}

router.get('/', async (req, res) => {
  if (!authorized(req)) return res.status(process.env.CRON_SECRET ? 401 : 503).json({ error: process.env.CRON_SECRET ? 'Unauthorized' : 'CRON_SECRET is not configured' });

  try {
    const now = new Date();
    const period = previousContributionPeriod(now);
    const due = dueDate(period.month, period.year);
    const phase = reminderPhase(now, due);

    if (!phase) {
      return res.json({ ok: true, action: 'none', reason: 'No contribution reminder scheduled for today', date: dateKey(now) });
    }

    const fy = getFiscalYear(period.month, period.year);
    const rules = await getRulesForFY(fy);
    const monthlyTarget = Number(rules.contribution_amount || 0);
    const [members, contributions] = await Promise.all([
      Member.find({ status: 'active' }).lean(),
      Contribution.find({ month: period.month, year: period.year }).lean(),
    ]);

    const results = [];
    for (const member of members) {
      const paid = contributions
        .filter((record) => record.member_id === member.id)
        .reduce((sum, record) => sum + Number(record.amount || 0), 0);
      const outstanding = Math.max(0, monthlyTarget - paid);
      if (outstanding <= 0) continue;

      if (!member.email) {
        results.push({ member_id: member.id, status: 'skipped', reason: 'No email' });
        continue;
      }

      const periodKey = `contribution:${period.year}-${String(period.month).padStart(2, '0')}:${phase}:${dateKey(now)}`;
      const duplicate = await CommunicationLog.findOne({
        member_id: member.id,
        type: 'contribution_reminder',
        period_key: periodKey,
        status: { $in: ['sent', 'mocked'] },
      }).lean();
      if (duplicate) {
        results.push({ member_id: member.id, status: 'skipped', reason: 'Already sent today' });
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
        await CommunicationLog.create({
          member_id: member.id,
          recipient_email: member.email.trim().toLowerCase(),
          type: 'contribution_reminder',
          period_key: periodKey,
          subject: `Checkpoint contribution reminder — ${MONTH_NAMES[period.month]} ${period.year}`,
          status,
          provider_message_id: info.messageId || null,
          sent_at: new Date(),
          created_by: 'vercel-cron',
        });
        results.push({ member_id: member.id, status, outstanding });
      } catch (error) {
        await CommunicationLog.create({
          member_id: member.id,
          recipient_email: member.email.trim().toLowerCase(),
          type: 'contribution_reminder',
          period_key: periodKey,
          subject: `Checkpoint contribution reminder — ${MONTH_NAMES[period.month]} ${period.year}`,
          status: 'failed',
          failure_reason: error.message,
          created_by: 'vercel-cron',
        });
        results.push({ member_id: member.id, status: 'failed', reason: error.message });
      }
    }

    res.json({
      ok: true,
      phase,
      period,
      fiscal_year: fy,
      due_date: dateKey(due),
      mock_mode: !isConfigured,
      sent: results.filter((item) => item.status === 'sent').length,
      mocked: results.filter((item) => item.status === 'mocked').length,
      skipped: results.filter((item) => item.status === 'skipped').length,
      failed: results.filter((item) => item.status === 'failed').length,
      results,
    });
  } catch (error) {
    console.error('[member-reminder-cron]', error);
    res.status(500).json({ error: 'Reminder scan failed' });
  }
});

module.exports = router;
