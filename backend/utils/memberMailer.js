require('dotenv').config();
const nodemailer = require('nodemailer');

const isConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
const FROM = process.env.SMTP_FROM || `"Checkpoint Investment Club" <${process.env.SMTP_USER || 'noreply@checkpoint.local'}>`;

let transporter = null;
if (isConfigured) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
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

async function send(options) {
  if (!isConfigured) {
    console.log(`[member-mailer mock] ${options.subject} -> ${options.to}`);
    return { messageId: `mock-${Date.now()}`, mocked: true };
  }
  return transporter.sendMail({ from: FROM, ...options });
}

async function sendAccountInvitation(member, { portalUrl }) {
  const activationUrl = `${portalUrl.replace(/\/$/, '')}/?activate=1`;
  const preview = 'Your Checkpoint member account is ready to activate.';
  const body = `
    <p style="margin:0 0 6px;color:#71717a;font-size:13px">Hello ${escapeHtml(String(member.name || '').split(' ')[0] || 'Member')},</p>
    <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25">Your Checkpoint account is ready</h1>
    <p style="margin:0;color:#52525b;font-size:14px;line-height:1.7">Activate your member portal to view your contributions, loan balances and repayments, fines, transactions, investments and club notices.</p>
    ${button('Activate my account', activationUrl)}
    <p style="margin:22px 0 0;color:#71717a;font-size:12px;line-height:1.6">Use the email address or phone number already registered with the club. You will choose your own username and password. No password is sent by email.</p>`;

  return send({
    to: member.email,
    subject: 'Your Checkpoint account is ready',
    text: `Hello ${member.name},\n\nYour Checkpoint Investment Club member account is ready to activate. Open ${activationUrl} and use the email address or phone number already registered with the club. You will choose your own username and password.\n\nCheckpoint Investment Club`,
    html: shell(preview, body),
  });
}

async function sendContributionReminder(member, context) {
  const { periodLabel, monthlyTarget, paidAmount, outstandingAmount, dueDate, portalUrl } = context;
  const preview = `${periodLabel} contribution reminder — TZS ${Number(outstandingAmount).toLocaleString('en-US')} outstanding.`;
  const body = `
    <p style="margin:0 0 6px;color:#71717a;font-size:13px">Hello ${escapeHtml(String(member.name || '').split(' ')[0] || 'Member')},</p>
    <h1 style="margin:0 0 14px;font-size:23px;line-height:1.25">Contribution reminder</h1>
    <p style="margin:0 0 18px;color:#52525b;font-size:14px;line-height:1.7">Your Checkpoint contribution for <strong>${escapeHtml(periodLabel)}</strong> is not yet fully paid.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;padding:8px 16px">
      <tr><td style="padding:8px 0;color:#71717a;font-size:12px">Monthly contribution</td><td align="right" style="font-size:12px;font-weight:700">TZS ${Number(monthlyTarget).toLocaleString('en-US')}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:12px">Paid</td><td align="right" style="font-size:12px;font-weight:700">TZS ${Number(paidAmount).toLocaleString('en-US')}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:12px">Outstanding</td><td align="right" style="font-size:12px;font-weight:700;color:#c2410c">TZS ${Number(outstandingAmount).toLocaleString('en-US')}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:12px">Due date</td><td align="right" style="font-size:12px;font-weight:700">${escapeHtml(dueDate)}</td></tr>
    </table>
    ${button('View my account', portalUrl)}
    <p style="margin:20px 0 0;color:#71717a;font-size:12px;line-height:1.6">A late contribution month receives one fine according to the rule for that fiscal year. The same month's fine does not grow again each new month.</p>`;

  return send({
    to: member.email,
    subject: `Checkpoint contribution reminder — ${periodLabel}`,
    text: `Hello ${member.name},\n\n${periodLabel} contribution\nMonthly contribution: TZS ${Number(monthlyTarget).toLocaleString('en-US')}\nPaid: TZS ${Number(paidAmount).toLocaleString('en-US')}\nOutstanding: TZS ${Number(outstandingAmount).toLocaleString('en-US')}\nDue date: ${dueDate}\n\nView your account: ${portalUrl}\n\nCheckpoint Investment Club`,
    html: shell(preview, body),
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
  sendAccountInvitation,
  sendContributionReminder,
  sendPasswordReset,
};
