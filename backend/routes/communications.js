const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getRulesForFYWithModel } = require('../services/fyRules');
const {
  isConfigured,
  smtpConfig,
  verifyEmailTransport,
  sendTestEmail,
  sendAccountInvitation,
  sendContributionReminder,
  sendMemberMessage,
  sendMonthlyStatement,
} = require('../utils/memberMailer');

// Phase 4F-A: this route no longer imports the default/legacy model
// registry, the default CommunicationLog, or the default-bound
// getRulesForFY(fy) wrapper. Every database read/write below — including
// the CommunicationLog audit trail that the duplicate-reminder protection
// reads — comes from req.tenantModels, established by `authenticate` from the
// verified JWT's organization_id. There is no fallback to a default/global
// model set — if authenticate succeeded, req.tenantModels is expected to
// exist, and a missing bundle throws (property access on undefined) rather
// than quietly using another database. The helpers that used to close over
// default models (contributionRecipients, logCommunication) now take the
// tenant model bundle as their first argument, FY rules resolve through
// getRulesForFYWithModel(models.FyRules, fy), and notification ids come from
// the SAME tenant's counter (models.getNextId). Email templates and the
// SMTP / mock-mode transport (utils/memberMailer.js) are untouched.

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ALLOWED_NOTIFICATION_TYPES = new Set(['contribution_due', 'loan_due', 'fine_issued', 'fine_overdue', 'custom']);

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

async function contributionRecipients(models, month, year) {
  const fy = getFiscalYear(month, year);
  const rules = await getRulesForFYWithModel(models.FyRules, fy);
  const monthlyTarget = Number(rules.contribution_amount || 0);
  const [members, records] = await Promise.all([
    models.Member.find({ status: 'active' }).lean(),
    models.Contribution.find({ month, year }).lean(),
  ]);

  return members.map((member) => {
    const paidAmount = records
      .filter((record) => record.member_id === member.id)
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    return { member, fy, monthlyTarget, paidAmount, outstandingAmount: Math.max(0, monthlyTarget - paidAmount) };
  }).filter((item) => item.outstandingAmount > 0);
}

async function logCommunication(models, { memberId, email, type, periodKey, subject, status, info, sourceEntityType, sourceEntityId, createdBy, failureReason }) {
  return models.CommunicationLog.create({
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
  const models = req.tenantModels;
  const recent = await models.CommunicationLog.find().sort({ created_at: -1 }).limit(50).lean();
  res.json({
    configured: isConfigured,
    provider: isConfigured ? (smtpConfig.host === 'smtp.gmail.com' ? 'gmail_smtp' : smtpConfig.host) : 'mock',
    smtp: isConfigured ? { user: smtpConfig.user, host: smtpConfig.host, port: smtpConfig.port, secure: smtpConfig.secure } : null,
    recent,
  });
});

router.post('/verify-email', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await verifyEmailTransport();
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error.message, configured: isConfigured, smtp: { user: smtpConfig.user, host: smtpConfig.host, port: smtpConfig.port } });
  }
});

router.post('/test-email', authenticate, requireAdmin, async (req, res) => {
  const models = req.tenantModels;
  const to = String(req.body.email || req.user.email || '').trim().toLowerCase();
  if (!to) return res.status(400).json({ error: 'A test recipient email is required' });
  try {
    await verifyEmailTransport();
    const info = await sendTestEmail(to);
    await logCommunication(models, { memberId: null, email: to, type: 'admin_test', periodKey: `test:${Date.now()}`, subject: 'Checkpoint email configuration test', status: info.mocked ? 'mocked' : 'sent', info, createdBy: req.user.username || req.user.name || 'admin' });
    res.json({ success: true, mocked: !!info.mocked, message: info.mocked ? 'Test email prepared in mock mode.' : `Test email sent to ${to}` });
  } catch (error) {
    await logCommunication(models, { memberId: null, email: to, type: 'admin_test', periodKey: `test:${Date.now()}`, subject: 'Checkpoint email configuration test', status: 'failed', createdBy: req.user.username || req.user.name || 'admin', failureReason: error.message });
    res.status(502).json({ error: error.message });
  }
});

router.post('/members/:id/invite', authenticate, requireAdmin, async (req, res) => {
  const models = req.tenantModels;
  const memberId = parseInt(req.params.id, 10);
  const member = await models.Member.findOne({ id: memberId }).lean();
  if (!member) return res.status(404).json({ error: 'Member not found' });
  if (!member.email) return res.status(400).json({ error: 'This member has no email address on file' });

  const existingUser = await models.User.findOne({ member_id: memberId }).lean();
  if (existingUser) return res.status(409).json({ error: 'This member already has an active portal account', account_status: 'active', username: existingUser.username });

  try {
    const info = await sendAccountInvitation(member, { portalUrl: portalUrl(req) });
    await logCommunication(models, { memberId, email: member.email, type: 'account_invitation', periodKey: 'activation', subject: 'Your Checkpoint account is ready', status: info.mocked ? 'mocked' : 'sent', info, createdBy: req.user.username || req.user.name || 'admin' });
    res.json({ success: true, mocked: !!info.mocked, message: info.mocked ? 'Invitation previewed in mock mode.' : 'Invitation sent.' });
  } catch (error) {
    await logCommunication(models, { memberId, email: member.email, type: 'account_invitation', periodKey: 'activation', subject: 'Your Checkpoint account is ready', status: 'failed', createdBy: req.user.username || req.user.name || 'admin', failureReason: error.message });
    res.status(500).json({ error: error.message || 'Failed to send invitation' });
  }
});

router.post('/members/:id/message', authenticate, requireAdmin, async (req, res) => {
  const models = req.tenantModels;
  const memberId = parseInt(req.params.id, 10);
  const member = await models.Member.findOne({ id: memberId }).lean();
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const channel = String(req.body.channel || 'in_app');
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  const type = ALLOWED_NOTIFICATION_TYPES.has(req.body.type) ? req.body.type : 'custom';
  const dueDate = req.body.due_date ? String(req.body.due_date) : null;
  const wantsInApp = channel === 'in_app' || channel === 'both';
  const wantsEmail = channel === 'email' || channel === 'both';

  if (!message) return res.status(400).json({ error: 'Message is required' });
  if (!wantsInApp && !wantsEmail) return res.status(400).json({ error: 'Choose in_app, email, or both' });
  if (wantsEmail && !member.email) return res.status(400).json({ error: 'This member has no email address on file' });

  let notification = null;
  if (wantsInApp) {
    notification = await models.Notification.create({ id: await models.getNextId('notification_id'), member_id: memberId, type, message, due_date: dueDate, read: false, created_by: req.user.name || req.user.username || 'admin' });
  }

  let emailResult = null;
  if (wantsEmail) {
    const emailSubject = subject || 'Checkpoint notification';
    try {
      const info = await sendMemberMessage(member, { subject: emailSubject, message, portalUrl: portalUrl(req) });
      const status = info.mocked ? 'mocked' : 'sent';
      await logCommunication(models, { memberId, email: member.email, type: 'member_message', periodKey: notification ? `notification:${notification.id}` : null, subject: emailSubject, status, info, sourceEntityType: notification ? 'notification' : 'member', sourceEntityId: notification ? notification.id : member.id, createdBy: req.user.username || req.user.name || 'admin' });
      emailResult = { status, mocked: !!info.mocked };
    } catch (error) {
      await logCommunication(models, { memberId, email: member.email, type: 'member_message', periodKey: notification ? `notification:${notification.id}` : null, subject: emailSubject, status: 'failed', sourceEntityType: notification ? 'notification' : 'member', sourceEntityId: notification ? notification.id : member.id, createdBy: req.user.username || req.user.name || 'admin', failureReason: error.message });
      return res.status(502).json({ error: error.message || 'Email delivery failed', notification_created: !!notification, notification });
    }
  }

  res.status(201).json({ success: true, notification, email: emailResult });
});

router.post('/members/:id/monthly-statement', authenticate, requireAdmin, async (req, res) => {
  const models = req.tenantModels;
  const memberId = parseInt(req.params.id, 10);
  const member = await models.Member.findOne({ id: memberId }).lean();
  if (!member) return res.status(404).json({ error: 'Member not found' });
  if (!member.email) return res.status(400).json({ error: 'This member has no email address on file' });

  const now = new Date();
  const month = parseInt(req.body.month, 10) || now.getMonth() + 1;
  const year = parseInt(req.body.year, 10) || now.getFullYear();
  const fy = getFiscalYear(month, year);
  const rules = await getRulesForFYWithModel(models.FyRules, fy);
  const [contributions, loans, repayments, fines, transactions] = await Promise.all([
    models.Contribution.find({ member_id: memberId, month, year }).lean(),
    models.Loan.find({ member_id: memberId }).lean(),
    models.Repayment.find().lean(),
    models.Fine.find({ member_id: memberId, status: 'unpaid' }).lean(),
    models.Transaction.find({ member_id: memberId }).sort({ transaction_date: -1, created_at: -1 }).limit(20).lean(),
  ]);
  const contributionPaid = contributions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const unpaidFines = fines.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const memberLoanIds = new Set(loans.map((loan) => loan.id));
  const memberRepayments = repayments.filter((r) => memberLoanIds.has(r.loan_id));
  const totalRepaidByLoan = new Map();
  memberRepayments.forEach((r) => totalRepaidByLoan.set(r.loan_id, (totalRepaidByLoan.get(r.loan_id) || 0) + Number(r.amount || 0)));
  const activeLoanBalance = loans.filter((loan) => loan.status === 'active').reduce((sum, loan) => sum + Math.max(0, Number(loan.principal || 0) - Number(totalRepaidByLoan.get(loan.id) || 0)), 0);
  const repaymentsThisMonth = memberRepayments.filter((r) => {
    const d = new Date(r.repayment_date);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  }).reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const periodLabel = `${MONTH_NAMES[month]} ${year}`;

  try {
    const info = await sendMonthlyStatement(member, {
      periodLabel,
      contributionTarget: Number(rules.contribution_amount || 0),
      contributionPaid,
      unpaidFines,
      activeLoanBalance,
      repaymentsThisMonth,
      recentTransactions: transactions.map((tx) => ({ date: tx.transaction_date, description: tx.description, type: tx.type, amount: tx.amount })),
      portalUrl: portalUrl(req),
    });
    const status = info.mocked ? 'mocked' : 'sent';
    await logCommunication(models, { memberId, email: member.email, type: 'statement', periodKey: `statement:${year}-${String(month).padStart(2, '0')}`, subject: `Checkpoint monthly statement — ${periodLabel}`, status, info, createdBy: req.user.username || req.user.name || 'admin' });
    await models.Notification.create({ id: await models.getNextId('notification_id'), member_id: memberId, type: 'custom', message: `Your ${periodLabel} Checkpoint statement has been prepared and sent to ${member.email}.`, read: false, created_by: req.user.name || req.user.username || 'admin' });
    res.json({ success: true, status, period: periodLabel });
  } catch (error) {
    await logCommunication(models, { memberId, email: member.email, type: 'statement', periodKey: `statement:${year}-${String(month).padStart(2, '0')}`, subject: `Checkpoint monthly statement — ${periodLabel}`, status: 'failed', createdBy: req.user.username || req.user.name || 'admin', failureReason: error.message });
    res.status(502).json({ error: error.message });
  }
});

router.get('/contribution-reminders/preview', authenticate, requireAdmin, async (req, res) => {
  const models = req.tenantModels;
  const now = new Date();
  const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
  const year = parseInt(req.query.year, 10) || now.getFullYear();
  const recipients = await contributionRecipients(models, month, year);
  res.json({ month, year, fiscal_year: getFiscalYear(month, year), due_date: dueDateFor(month, year), recipients: recipients.map(({ member, monthlyTarget, paidAmount, outstandingAmount }) => ({ member_id: member.id, name: member.name, email: member.email, monthly_target: monthlyTarget, paid: paidAmount, outstanding: outstandingAmount, sendable: !!member.email })) });
});

router.post('/contribution-reminders/send', authenticate, requireAdmin, async (req, res) => {
  const models = req.tenantModels;
  const now = new Date();
  const month = parseInt(req.body.month, 10) || now.getMonth() + 1;
  const year = parseInt(req.body.year, 10) || now.getFullYear();
  const force = req.body.force === true;
  const periodKey = `contribution:${year}-${String(month).padStart(2, '0')}`;
  const recipients = await contributionRecipients(models, month, year);
  const results = [];

  for (const item of recipients) {
    const { member, monthlyTarget, paidAmount, outstandingAmount } = item;
    if (!member.email) { results.push({ member_id: member.id, member: member.name, status: 'skipped', reason: 'No email address' }); continue; }
    const alreadySent = await models.CommunicationLog.findOne({ member_id: member.id, type: 'contribution_reminder', period_key: periodKey, status: { $in: ['sent', 'mocked'] } }).lean();
    if (alreadySent && !force) { results.push({ member_id: member.id, member: member.name, status: 'skipped', reason: 'Reminder already sent for this period' }); continue; }

    try {
      const info = await sendContributionReminder(member, { periodLabel: `${MONTH_NAMES[month]} ${year}`, monthlyTarget, paidAmount, outstandingAmount, dueDate: dueDateFor(month, year), portalUrl: portalUrl(req) });
      const status = info.mocked ? 'mocked' : 'sent';
      await logCommunication(models, { memberId: member.id, email: member.email, type: 'contribution_reminder', periodKey, subject: `Checkpoint contribution reminder — ${MONTH_NAMES[month]} ${year}`, status, info, createdBy: req.user.username || req.user.name || 'admin' });
      const stableMessage = `Your ${MONTH_NAMES[month]} ${year} contribution has TZS ${outstandingAmount.toLocaleString('en-US')} outstanding. Due ${dueDateFor(month, year)}.`;
      const existingNotification = await models.Notification.findOne({ member_id: member.id, type: 'contribution_due', message: stableMessage }).lean();
      if (!existingNotification) await models.Notification.create({ id: await models.getNextId('notification_id'), member_id: member.id, type: 'contribution_due', message: stableMessage, due_date: dueDateFor(month, year), read: false, created_by: req.user.name || req.user.username || 'admin' });
      results.push({ member_id: member.id, member: member.name, status, outstanding: outstandingAmount });
    } catch (error) {
      await logCommunication(models, { memberId: member.id, email: member.email, type: 'contribution_reminder', periodKey, subject: `Checkpoint contribution reminder — ${MONTH_NAMES[month]} ${year}`, status: 'failed', failureReason: error.message, createdBy: req.user.username || req.user.name || 'admin' });
      results.push({ member_id: member.id, member: member.name, status: 'failed', reason: error.message });
    }
  }

  res.json({ mock_mode: !isConfigured, month, year, sent: results.filter((item) => item.status === 'sent').length, mocked: results.filter((item) => item.status === 'mocked').length, skipped: results.filter((item) => item.status === 'skipped').length, failed: results.filter((item) => item.status === 'failed').length, results });
});

module.exports = router;
