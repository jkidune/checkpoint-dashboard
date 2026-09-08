const nodemailer = require('nodemailer');
const { User } = require('../db/models');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAmount(value) {
  return `TZS ${Number(value || 0).toLocaleString('en-US')}`;
}

function configuredRecipients() {
  return String(process.env.ADMIN_ALERT_EMAILS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function adminRecipients() {
  const configured = configuredRecipients();
  const admins = await User.find({ role: 'admin' }).select('email').lean();
  return [...new Set([
    ...configured,
    ...admins.map((row) => row.email).filter(Boolean),
  ])];
}

async function sendFormIntakeAlert(payload = {}) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('[form-intake-email] SMTP not configured; skipping admin email.');
    return { skipped: true, reason: 'smtp_not_configured' };
  }

  const recipients = await adminRecipients();
  if (!recipients.length) {
    console.log('[form-intake-email] No admin email recipient configured.');
    return { skipped: true, reason: 'no_admin_recipient' };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const member = String(payload.memberName || 'A member').trim();
  const type = String(payload.type || 'payment').replace(/_/g, ' ');
  const amount = formatAmount(payload.amount);
  const paymentDate = payload.date || 'Not supplied';
  const reference = payload.mpesaRef || 'Not supplied';
  const months = Array.isArray(payload.months)
    ? payload.months.filter(Boolean).join(', ')
    : '';
  const notes = payload.notes || '';

  const subject = `[Checkpoint] New payment submission — ${member} · ${amount}`;
  const text = [
    'A new Checkpoint payment submission is waiting for admin verification.',
    '',
    `Member: ${member}`,
    `Amount: ${amount}`,
    `Claimed type: ${type}`,
    `Claimed month(s): ${months || '—'}`,
    `Payment date: ${paymentDate}`,
    `Reference: ${reference}`,
    `Member description: ${notes || '—'}`,
    '',
    'Open Checkpoint Dashboard → Form Intake to verify and allocate the receipt.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;background:#f4f4f5;padding:24px;color:#18181b">
      <div style="max-width:620px;margin:auto;background:#fff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden">
        <div style="height:4px;background:#dc2626"></div>
        <div style="padding:24px">
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#dc2626;margin-bottom:8px">Admin action required</div>
          <h2 style="margin:0 0 8px;font-size:20px">New payment submission</h2>
          <p style="margin:0 0 20px;color:#52525b;line-height:1.6">A member has submitted a payment through the Checkpoint form. The cash has <strong>not</strong> been posted to the ledger yet.</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr><td style="padding:9px 0;color:#71717a;border-bottom:1px solid #f4f4f5">Member</td><td style="padding:9px 0;text-align:right;font-weight:700;border-bottom:1px solid #f4f4f5">${escapeHtml(member)}</td></tr>
            <tr><td style="padding:9px 0;color:#71717a;border-bottom:1px solid #f4f4f5">Amount</td><td style="padding:9px 0;text-align:right;font-weight:700;border-bottom:1px solid #f4f4f5">${escapeHtml(amount)}</td></tr>
            <tr><td style="padding:9px 0;color:#71717a;border-bottom:1px solid #f4f4f5">Claimed type</td><td style="padding:9px 0;text-align:right;border-bottom:1px solid #f4f4f5">${escapeHtml(type)}</td></tr>
            <tr><td style="padding:9px 0;color:#71717a;border-bottom:1px solid #f4f4f5">Claimed month(s)</td><td style="padding:9px 0;text-align:right;border-bottom:1px solid #f4f4f5">${escapeHtml(months || '—')}</td></tr>
            <tr><td style="padding:9px 0;color:#71717a;border-bottom:1px solid #f4f4f5">Payment date</td><td style="padding:9px 0;text-align:right;border-bottom:1px solid #f4f4f5">${escapeHtml(paymentDate)}</td></tr>
            <tr><td style="padding:9px 0;color:#71717a">Reference</td><td style="padding:9px 0;text-align:right">${escapeHtml(reference)}</td></tr>
          </table>
          <div style="margin-top:18px;padding:14px;background:#fafafa;border:1px solid #e4e4e7;border-radius:10px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#71717a;margin-bottom:6px">Member description</div>
            <div style="font-size:13px;line-height:1.6">${escapeHtml(notes || 'No additional description provided.')}</div>
          </div>
          <p style="margin:20px 0 0;color:#52525b;font-size:13px;line-height:1.6">Open <strong>Checkpoint Dashboard → Form Intake</strong> to verify the member, reference and allocation before posting.</p>
        </div>
      </div>
    </div>`;

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM
      || `"Checkpoint Investment Club" <${process.env.SMTP_USER}>`,
    to: recipients.join(','),
    subject,
    text,
    html,
  });

  console.log(`[form-intake-email] Alert sent to ${recipients.join(', ')}`);
  return { sent: true, messageId: info.messageId, recipients };
}

module.exports = { sendFormIntakeAlert };
