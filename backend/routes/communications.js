const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { Member, User, Contribution } = require('../db/models');
const { CommunicationLog } = require('../db/communicationModels');
const { getRulesForFY } = require('./rules');
const { isConfigured, sendAccountInvitation, sendContributionReminder } = require('../utils/memberMailer');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getFiscalYear(month, year) {
  return Number(month) >= 3 ? Number(year) : Number(year) - 1;
}

function dueDateFor(month, year) {
  const dueMonth = month === 12 ? 1 : month + 1;
  const dueYear = month === 12 ? year + 1 : year;
  return `${dueYear}-${String(dueMonth).padStart(2, '0')}-05`;
}

function portalUrl(req) {
  return process.env.PORTAL_URL || process.env.WEB_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

async function contributionRecipients(month, year) {
  const fy = getFiscalYear(month, year);
  const rules = await getRulesForFY(fy);
  const monthlyTarget = Number(rules.contribution_amount || 0);
  const [members, records] = await Promise.all([
    Member.find({ status: 'active' }).lean(),
    Contribution.find({ month, year }).lean(),
  ]);

  return members.map((member) => {
    const paidAmount = records
      .filter((record) => record.member_id === member.id)
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    return {
      member,
      fy,
      monthlyTarget,
      paidAmount,
      outstandingAmount: Math.max(0, monthlyTarget - paidAmount),
    };
  }).filter((item) => item.outstandingAmount > 0);
}

async function logCommunication({ memberId, email, type, periodKey, subject, status, info, sourceEntityType, sourceEntityId, createdBy, failureReason }) {
  return CommunicationLog.create({
    member_id: memberId || null,
    recipient_email: String(email || '').trim().toLowerCase(),
    type,
    period_key: periodKey || null,
    subject: subject || null,
    status,
    provider_message_id: info?.messageId || null,
    source_entity_type: sourceEntityType || null,
    source_entity_id: sourceEntityId != null ? String(sourceEntityId) : null,
    sent_at: status === 'sent' || status === 'mocked' ? new Date() : null,
    failure_reason: failureReason || null,
    created_by: createdBy || null,
  });
}

router.get('/status', authenticate, requireAdmin, async (req, res) => {
  const recent = await CommunicationLog.find().sort({ created_at: -1 }).limit(50).lean();
  res.json({ configured: isConfigured, provider: isConfigured ? 'gmail_smtp' : 'mock', recent });
});

router.post('/members/:id/invite', authenticate, requireAdmin, async (req, res) => {
  const memberId = parseInt(req.params.id, 10);
  const member = await Member.findOne({ id: memberId }).lean();
  if (!member) return res.status(404).json({ error: 'Member not found' });
  if (!member.email) return res.status(400).json({ error: 'This member has no email address on file' });

  const existingUser = await User.findOne({ member_id: memberId }).lean();
  if (existingUser) {
    return res.status(409).json({
      error: 'This member already has an active portal account',
      account_status: 'active',
      username: existingUser.username,
    });
  }

  try {
    const info = await sendAccountInvitation(member, { portalUrl: portalUrl(req) });
    await logCommunication({
      memberId,
      email: member.email,
      type: 'account_invitation',
      periodKey: 'activation',
      subject: 'Your Checkpoint account is ready',
      status: info.mocked ? 'mocked' : 'sent',
      info,
      createdBy: req.user.username || req.user.name || 'admin',
    });
    res.json({ success: true, mocked: !!info.mocked, message: info.mocked ? 'Invitation previewed in mock mode.' : 'Invitation sent.' });
  } catch (error) {
    await logCommunication({
      memberId,
      email: member.email,
      type: 'account_invitation',
      periodKey: 'activation',
      subject: 'Your Checkpoint account is ready',
      status: 'failed',
      createdBy: req.user.username || req.user.name || 'admin',
      failureReason: error.message,
    });
    res.status(500).json({ error: error.message || 'Failed to send invitation' });
  }
});

router.get('/contribution-reminders/preview', authenticate, requireAdmin, async (req, res) => {
  const now = new Date();
  const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
  const year = parseInt(req.query.year, 10) || now.getFullYear();
  const recipients = await contributionRecipients(month, year);
  res.json({
    month,
    year,
    fiscal_year: getFiscalYear(month, year),
    due_date: dueDateFor(month, year),
    recipients: recipients.map(({ member, monthlyTarget, paidAmount, outstandingAmount }) => ({
      member_id: member.id,
      name: member.name,
      email: member.email,
      monthly_target: monthlyTarget,
      paid: paidAmount,
      outstanding: outstandingAmount,
      sendable: !!member.email,
    })),
  });
});

router.post('/contribution-reminders/send', authenticate, requireAdmin, async (req, res) => {
  const now = new Date();
  const month = parseInt(req.body.month, 10) || now.getMonth() + 1;
  const year = parseInt(req.body.year, 10) || now.getFullYear();
  const force = req.body.force === true;
  const periodKey = `contribution:${year}-${String(month).padStart(2, '0')}`;
  const recipients = await contributionRecipients(month, year);
  const results = [];

  for (const item of recipients) {
    const { member, monthlyTarget, paidAmount, outstandingAmount } = item;
    if (!member.email) {
      results.push({ member_id: member.id, member: member.name, status: 'skipped', reason: 'No email address' });
      continue;
    }

    const alreadySent = await CommunicationLog.findOne({
      member_id: member.id,
      type: 'contribution_reminder',
      period_key: periodKey,
      status: { $in: ['sent', 'mocked'] },
    }).lean();
    if (alreadySent && !force) {
      results.push({ member_id: member.id, member: member.name, status: 'skipped', reason: 'Reminder already sent for this period' });
      continue;
    }

    try {
      const info = await sendContributionReminder(member, {
        periodLabel: `${MONTH_NAMES[month]} ${year}`,
        monthlyTarget,
        paidAmount,
        outstandingAmount,
        dueDate: dueDateFor(month, year),
        portalUrl: portalUrl(req),
      });
      const status = info.mocked ? 'mocked' : 'sent';
      await logCommunication({
        memberId: member.id,
        email: member.email,
        type: 'contribution_reminder',
        periodKey,
        subject: `Checkpoint contribution reminder — ${MONTH_NAMES[month]} ${year}`,
        status,
        info,
        createdBy: req.user.username || req.user.name || 'admin',
      });
      results.push({ member_id: member.id, member: member.name, status, outstanding: outstandingAmount });
    } catch (error) {
      await logCommunication({
        memberId: member.id,
        email: member.email,
        type: 'contribution_reminder',
        periodKey,
        subject: `Checkpoint contribution reminder — ${MONTH_NAMES[month]} ${year}`,
        status: 'failed',
        failureReason: error.message,
        createdBy: req.user.username || req.user.name || 'admin',
      });
      results.push({ member_id: member.id, member: member.name, status: 'failed', reason: error.message });
    }
  }

  res.json({
    mock_mode: !isConfigured,
    month,
    year,
    sent: results.filter((item) => item.status === 'sent').length,
    mocked: results.filter((item) => item.status === 'mocked').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results,
  });
});

module.exports = router;
