require('dotenv').config();
const nodemailer = require('nodemailer');

function cleanEnv(value, { compact = false } = {}) {
  let result = String(value || '').trim();
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1).trim();
  }
  if (compact) result = result.replace(/\s+/g, '');
  return result;
}

const SMTP_USER = cleanEnv(process.env.SMTP_USER);
const SMTP_PASS = cleanEnv(process.env.SMTP_PASS, { compact: true });
const SMTP_HOST = cleanEnv(process.env.SMTP_HOST) || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE == null
  ? SMTP_PORT === 465
  : String(process.env.SMTP_SECURE).toLowerCase() !== 'false';
const isConfigured = !!(SMTP_USER && SMTP_PASS);
const FROM = process.env.SMTP_FROM || `"Checkpoint Investment Club" <${SMTP_USER || 'noreply@checkpoint.local'}>`;

let transporter = null;
if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function normalizeMailerError(error) {
  const raw = String(error?.message || error || 'Email delivery failed');
  if (/535|BadCredentials|Username and Password not accepted/i.test(raw)) {
    return new Error(
      'Gmail rejected the SMTP credentials. Confirm SMTP_USER is the same Google account that created the App Password, and set SMTP_PASS to that 16-character App Password (not the normal Google password). If this is a Workspace account, App Passwords must be allowed by the Workspace administrator.'
    );
  }
  if (/534|Application-specific password required/i.test(raw)) {
    return new Error('Google requires an App Password for this SMTP account. Enable 2-Step Verification, create an App Password, and use it as SMTP_PASS.');
  }
  return error instanceof Error ? error : new Error(raw);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
}

function shell(preview, content) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:28px 12px"><tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #e4e4e7"><div style="font-size:17px;font-weight:700">Checkpoint Investment Club</div><div style="font-size:11px;color:#71717a;margin-top:3px">Member communications</div></td></tr>
        <tr><td style="padding:28px">${content}</td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e4e4e7;font-size:11px;color:#71717a">Checkpoint Investment Club · This message contains information about your member account.</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

function button(label, href) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:18px;padding:11px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700">${escapeHtml(label)}</a>`;
}

function money(value) {
  return `TZS ${Number(value || 0).toLocaleString('en-US')}`;
}

async function verifyEmailTransport() {
  if (!isConfigured) {
    return { configured: false, ok: false, provider: 'mock', message: 'SMTP_USER and SMTP_PASS are not configured.' };
  }
  try {
    await transporter.verify();
    return {
      configured: true,
      ok: true,
      provider: SMTP_HOST === 'smtp.gmail.com' ? 'gmail_smtp' : SMTP_HOST,
      user: SMTP_USER,
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
    };
  } catch (error) {
    throw normalizeMailerError(error);
  }
}

async function send(options) {
  if (!isConfigured) {
    console.log(`[member-mailer mock] ${options.subject} -> ${options.to}`);
    return { messageId: `mock-${Date.now()}`, mocked: true };
  }
  try {
    return await transporter.sendMail({ from: FROM, ...options });
  } catch (error) {
    throw normalizeMailerError(error);
  }
}

async function sendTestEmail(to) {
  return send({
    to,
    subject: 'Checkpoint email configuration test',
    text: 'Checkpoint successfully connected to the configured email service.',
    html: shell('Checkpoint email configuration test', '<h1 style="margin:0 0 14px;font-size:22px">Email configuration works</h1><p style="margin:0;color:#52525b;font-size:14px;line-height:1.7">Checkpoint successfully connected to the configured email service. You can now send invitations, reminders and member statements.</p>'),
  });
}

async function sendAccountInvitation(member, { portalUrl }) {
  const activationUrl = `${portalUrl.replace(/\/$/, '')}/?activate=1`;
  const preview = 'Your Checkpoint member account is ready to activate.';
  const body = `
    <p style="margin:0 0 6px;color:#71717a;font-size:13px">Hello ${escapeHtml(String(member.name || '').split(' ')[0] || 'Member')},</p>
    <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25">Your Checkpoint account is ready</h1>
    <p style="margin:0 0 18px;color:#52525b;font-size:14px;line-height:1.7">Activate your member portal to view your contributions, loan balances and repayments, fines, transactions, investments and club notices.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;padding:8px 16px">
      <tr><td style="padding:7px 0;color:#71717a;font-size:12px">Member</td><td align="right" style="font-size:12px;font-weight:700">${escapeHtml(member.name || '')}</td></tr>
      <tr><td style="padding:7px 0;color:#71717a;font-size:12px">Registered email</td><td align="right" style="font-size:12px;font-weight:700">${escapeHtml(member.email || '')}</td></tr>
    </table>
    ${button('Activate my account', activationUrl)}
    <p style="margin:22px 0 0;color:#71717a;font-size:12px;line-height:1.6">For your security, Checkpoint does not send passwords by email. Use the registered email address or phone number to activate the account and create your own password.</p>`;

  return send({
    to: member.email,
    subject: 'Your Checkpoint account is ready',
    text: `Hello ${member.name},\n\nYour Checkpoint Investment Club account is ready.\nRegistered email: ${member.email}\n\nActivate your account: ${activationUrl}\n\nFor security, no password is sent by email. You will create your own password during activation.\n\nCheckpoint Investment Club`,
    html: shell(preview, body),
  });
}

async function sendContributionReminder(member, context) {
  const { periodLabel, monthlyTarget, paidAmount, outstandingAmount, dueDate, portalUrl } = context;
  const preview = `${periodLabel} contribution reminder — ${money(outstandingAmount)} outstanding.`;
  const body = `
    <p style="margin:0 0 6px;color:#71717a;font-size:13px">Hello ${escapeHtml(String(member.name || '').split(' ')[0] || 'Member')},</p>
    <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25">Contribution reminder</h1>
    <p style="margin:0 0 18px;color:#52525b;font-size:14px;line-height:1.7">Your Checkpoint contribution for <strong>${escapeHtml(periodLabel)}</strong> is not yet fully paid.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;padding:8px 16px">
      <tr><td style="padding:8px 0;color:#71717a;font-size:12px">Monthly contribution</td><td align="right" style="font-size:12px;font-weight:700">${money(monthlyTarget)}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:12px">Paid</td><td align="right" style="font-size:12px;font-weight:700">${money(paidAmount)}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:12px">Outstanding</td><td align="right" style="font-size:12px;font-weight:700;color:#c2410c">${money(outstandingAmount)}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:12px">Due date</td><td align="right" style="font-size:12px;font-weight:700">${escapeHtml(dueDate)}</td></tr>
    </table>
    ${button('View my contributions', `${portalUrl.replace(/\/$/, '')}/contributions`)}
    <p style="margin:20px 0 0;color:#71717a;font-size:12px;line-height:1.6">A late contribution month receives one fine according to the rule for that fiscal year. The same month's fine does not grow again each new month.</p>`;

  return send({
    to: member.email,
    subject: `Checkpoint contribution reminder — ${periodLabel}`,
    text: `Hello ${member.name},\n\n${periodLabel} contribution\nMonthly contribution: ${money(monthlyTarget)}\nPaid: ${money(paidAmount)}\nOutstanding: ${money(outstandingAmount)}\nDue date: ${dueDate}\n\nView your contributions: ${portalUrl.replace(/\/$/, '')}/contributions\n\nCheckpoint Investment Club`,
    html: shell(preview, body),
  });
}

async function sendMemberMessage(member, { subject, message, portalUrl }) {
  const safeSubject = String(subject || 'Checkpoint notification').trim();
  const safeMessage = String(message || '').trim();
  const preview = safeMessage.slice(0, 120) || safeSubject;
  const body = `
    <p style="margin:0 0 6px;color:#71717a;font-size:13px">Hello ${escapeHtml(String(member.name || '').split(' ')[0] || 'Member')},</p>
    <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25">${escapeHtml(safeSubject)}</h1>
    <div style="margin:0;color:#52525b;font-size:14px;line-height:1.75;white-space:pre-line">${escapeHtml(safeMessage)}</div>
    ${portalUrl ? button('Open Checkpoint', portalUrl) : ''}`;

  return send({
    to: member.email,
    subject: safeSubject,
    text: `Hello ${member.name},\n\n${safeMessage}${portalUrl ? `\n\nOpen Checkpoint: ${portalUrl}` : ''}\n\nCheckpoint Investment Club`,
    html: shell(preview, body),
  });
}

async function sendMonthlyStatement(member, context) {
  const {
    periodLabel,
    contributionTarget,
    contributionPaid,
    unpaidFines,
    activeLoanBalance,
    repaymentsThisMonth,
    recentTransactions = [],
    portalUrl,
  } = context;
  const contributionOutstanding = Math.max(0, Number(contributionTarget || 0) - Number(contributionPaid || 0));
  const rows = recentTransactions.slice(0, 8).map((tx) => `
    <tr><td style="padding:7px 0;border-top:1px solid #e4e4e7;font-size:11px;color:#52525b">${escapeHtml(tx.date || '')}</td><td style="padding:7px 8px;border-top:1px solid #e4e4e7;font-size:11px">${escapeHtml(tx.description || tx.type || 'Transaction')}</td><td align="right" style="padding:7px 0;border-top:1px solid #e4e4e7;font-size:11px;font-weight:700">${money(tx.amount)}</td></tr>`).join('');
  const body = `
    <p style="margin:0 0 6px;color:#71717a;font-size:13px">Hello ${escapeHtml(String(member.name || '').split(' ')[0] || 'Member')},</p>
    <h1 style="margin:0 0 6px;font-size:23px;line-height:1.25">Your ${escapeHtml(periodLabel)} statement</h1>
    <p style="margin:0 0 18px;color:#71717a;font-size:12px">A concise summary of your Checkpoint account.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;padding:8px 16px">
      <tr><td style="padding:7px 0;color:#71717a;font-size:12px">Monthly contribution</td><td align="right" style="font-size:12px;font-weight:700">${money(contributionTarget)}</td></tr>
      <tr><td style="padding:7px 0;color:#71717a;font-size:12px">Contribution paid</td><td align="right" style="font-size:12px;font-weight:700">${money(contributionPaid)}</td></tr>
      <tr><td style="padding:7px 0;color:#71717a;font-size:12px">Contribution outstanding</td><td align="right" style="font-size:12px;font-weight:700">${money(contributionOutstanding)}</td></tr>
      <tr><td style="padding:7px 0;color:#71717a;font-size:12px">Unpaid fines</td><td align="right" style="font-size:12px;font-weight:700">${money(unpaidFines)}</td></tr>
      <tr><td style="padding:7px 0;color:#71717a;font-size:12px">Active loan balance</td><td align="right" style="font-size:12px;font-weight:700">${money(activeLoanBalance)}</td></tr>
      <tr><td style="padding:7px 0;color:#71717a;font-size:12px">Loan repayments this month</td><td align="right" style="font-size:12px;font-weight:700">${money(repaymentsThisMonth)}</td></tr>
    </table>
    ${rows ? `<h2 style="font-size:14px;margin:24px 0 8px">Recent activity</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>` : ''}
    ${button('Open my Checkpoint account', portalUrl)}`;

  return send({
    to: member.email,
    subject: `Checkpoint monthly statement — ${periodLabel}`,
    text: `Hello ${member.name},\n\n${periodLabel} statement\nContribution target: ${money(contributionTarget)}\nContribution paid: ${money(contributionPaid)}\nContribution outstanding: ${money(contributionOutstanding)}\nUnpaid fines: ${money(unpaidFines)}\nActive loan balance: ${money(activeLoanBalance)}\nLoan repayments this month: ${money(repaymentsThisMonth)}\n\nOpen Checkpoint: ${portalUrl}\n\nCheckpoint Investment Club`,
    html: shell(`${periodLabel} Checkpoint statement`, body),
  });
}

async function sendPasswordReset(recipient, { resetUrl }) {
  const preview = 'Reset your Checkpoint password.';
  const body = `
    <p style="margin:0 0 6px;color:#71717a;font-size:13px">Hello,</p>
    <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25">Reset your password</h1>
    <p style="margin:0;color:#52525b;font-size:14px;line-height:1.7">A password reset was requested for your Checkpoint account. This link expires in 45 minutes and can be used once.</p>
    ${button('Reset password', resetUrl)}
    <p style="margin:20px 0 0;color:#71717a;font-size:12px;line-height:1.6">If you did not request this, you can ignore this email.</p>`;
  return send({
    to: recipient.email,
    subject: 'Reset your Checkpoint password',
    text: `Reset your Checkpoint password using this link: ${resetUrl}\n\nThe link expires in 45 minutes. If you did not request this, ignore this email.`,
    html: shell(preview, body),
  });
}

module.exports = {
  isConfigured,
  smtpConfig: { user: SMTP_USER, host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE },
  verifyEmailTransport,
  sendTestEmail,
  sendAccountInvitation,
  sendContributionReminder,
  sendMemberMessage,
  sendMonthlyStatement,
  sendPasswordReset,
};
