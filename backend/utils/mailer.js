require('dotenv').config();
const nodemailer = require('nodemailer');

// ─── Transport Setup ─────────────────────────────────────────────────────────
const isConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;

if (isConfigured) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  transporter.verify((err) => {
    if (err) {
      console.error('[mailer] ❌  Gmail SMTP connection failed:', err.message);
    } else {
      console.log('[mailer] ✅  Gmail SMTP transport is ready');
    }
  });
} else {
  console.log('[mailer] ⚠️   SMTP_USER / SMTP_PASS not set — running in MOCK mode');
}

const FROM =
  process.env.SMTP_FROM ||
  `"Checkpoint Investment Club" <${process.env.SMTP_USER || 'noreply@checkpoint.local'}>`;

// ─── Core Send / Mock ────────────────────────────────────────────────────────
async function _send(mailOptions) {
  if (!isConfigured) {
    console.log('\n📧  [MOCK EMAIL] ─────────────────────────────────────────────');
    console.log(`    To:      ${mailOptions.to}`);
    console.log(`    Subject: ${mailOptions.subject}`);
    console.log('──────────────────────────────────────────────────────────────\n');
    return { messageId: `mock-${Date.now()}`, mocked: true };
  }
  return transporter.sendMail(mailOptions);
}

// ─── Shared Layout Helpers ───────────────────────────────────────────────────
const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Wraps content in the branded email shell */
function layout(previewText, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="dark light"/>
  <title>Checkpoint Investment Club</title>
  <style>
    /* Reset */
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none}
    body{margin:0;padding:0;background:#060f1e;font-family:'DM Sans',Arial,sans-serif;color:#f1f5f9}
    a{color:#0ea5e9;text-decoration:none}
    a:hover{text-decoration:underline}
  </style>
</head>
<body style="margin:0;padding:0;background:#060f1e;">

  <!-- Preview text (hidden) -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${previewText}&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
         style="background:#060f1e;padding:32px 0;">
    <tr>
      <td align="center">
        <!-- Email card -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
               style="max-width:600px;width:100%;background:#0a1628;border-radius:16px;
                      overflow:hidden;border:1px solid #1e3a5f;">

          <!-- Header bar -->
          <tr>
            <td style="background:linear-gradient(135deg,#0ea5e9 0%,#14b8a6 100%);
                       padding:4px 0;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Logo / Club name -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #1e3a5f;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <!-- Icon badge -->
                    <div style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#14b8a6);
                                width:44px;height:44px;border-radius:12px;text-align:center;
                                line-height:44px;font-size:22px;vertical-align:middle;margin-right:12px;">
                      ◈
                    </div>
                    <span style="vertical-align:middle;font-family:'Sora',Arial,sans-serif;
                                 font-size:20px;font-weight:700;color:#f1f5f9;letter-spacing:-0.02em;">
                      Checkpoint <span style="color:#14b8a6;">Investment Club</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              ${bodyContent}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#060f1e;border-top:1px solid #1e3a5f;
                       padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#64748b;line-height:1.6;">
                This message was sent by Checkpoint Investment Club.<br/>
                It is intended only for club members and is confidential.<br/>
                <span style="color:#1e3a5f;">──────────────────────────</span><br/>
                © ${new Date().getFullYear()} Checkpoint Investment Club
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

/** Pill/badge component */
function badge(text, color = '#0ea5e9', bg = 'rgba(14,165,233,0.12)') {
  return `<span style="display:inline-block;background:${bg};color:${color};
    font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;
    letter-spacing:0.05em;text-transform:uppercase;">${text}</span>`;
}

/** Info row inside a table */
function infoRow(label, value, valueColor = '#f1f5f9') {
  return `
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid #1e3a5f;
               color:#94a3b8;font-size:13px;width:40%;">${label}</td>
    <td style="padding:10px 0;border-bottom:1px solid #1e3a5f;
               color:${valueColor};font-size:13px;font-weight:600;text-align:right;">${value}</td>
  </tr>`;
}

/** CTA button */
function ctaButton(text, href = '#') {
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
    <tr>
      <td style="background:linear-gradient(135deg,#0ea5e9,#14b8a6);border-radius:10px;
                 padding:14px 28px;text-align:center;">
        <a href="${href}" style="color:#ffffff;font-family:'Sora',Arial,sans-serif;
           font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.02em;">
          ${text}
        </a>
      </td>
    </tr>
  </table>`;
}

// ─── Public Functions ────────────────────────────────────────────────────────

/**
 * Send a deadline reminder to a member who hasn't paid this month.
 */
async function sendDeadlineReminder(member, context) {
  const { month, year, amount_due, deadline } = context;
  const monthName = MONTH_NAMES[month];
  const formattedAmount = `TZS ${Number(amount_due).toLocaleString('en-US')}`;

  const previewText = `Your ${monthName} ${year} contribution of ${formattedAmount} is due by ${deadline}.`;

  const body = `
    <!-- Greeting -->
    <p style="margin:0 0 6px;font-size:13px;color:#94a3b8;">Hello,</p>
    <h1 style="margin:0 0 24px;font-family:'Sora',Arial,sans-serif;font-size:24px;
               font-weight:700;color:#f1f5f9;line-height:1.3;">
      Contribution Reminder
    </h1>

    <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.7;">
      Dear <strong style="color:#f1f5f9;">${member.name}</strong>, this is a friendly reminder
      from Checkpoint Investment Club. Your monthly contribution for
      <strong style="color:#0ea5e9;">${monthName} ${year}</strong> is still outstanding.
    </p>

    <!-- Summary table -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="background:#0f172a;border:1px solid #1e3a5f;border-radius:12px;
                  padding:4px 20px;margin-bottom:24px;">
      ${infoRow('Period', `${monthName} ${year}`)}
      ${infoRow('Amount Due', formattedAmount, '#14b8a6')}
      ${infoRow('Deadline', deadline, '#f59e0b')}
      ${infoRow('Status', badge('Unpaid', '#ef4444', 'rgba(239,68,68,0.12)'))}
    </table>

    <!-- Warning box -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);
                  border-left:3px solid #f59e0b;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#f59e0b;
                    text-transform:uppercase;letter-spacing:0.06em;">
            ⚠ FY2026 Constitution Rule
          </p>
          <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
            Contributions paid after the <strong style="color:#f1f5f9;">5th of the following month</strong>
            automatically attract a <strong style="color:#f59e0b;">15% late penalty (Katrina fine)</strong>
            per month late. Please pay on time to avoid compounding fines.
          </p>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">
      If you have already paid, please disregard this message — or contact the club administrator
      with your M-Pesa reference so it can be recorded in the system.
    </p>

    <!-- Divider -->
    <div style="border-top:1px solid #1e3a5f;margin:28px 0;"></div>

    <p style="margin:0;font-size:12px;color:#64748b;">
      Warm regards,<br/>
      <strong style="color:#94a3b8;">Checkpoint Investment Club</strong>
    </p>
  `;

  const text = `Dear ${member.name},\n\nThis is a friendly reminder from Checkpoint Investment Club.\n\nYour ${monthName} ${year} monthly contribution of ${formattedAmount} is due by ${deadline}.\n\nFY2026 Rule: Contributions paid after the 5th of the following month attract a 15% late penalty per month late.\n\nIf you have already paid, please ignore this or contact the administrator with your M-Pesa reference.\n\n– Checkpoint Investment Club`;

  return _send({
    from: FROM,
    to: member.email,
    subject: `[Checkpoint] ${monthName} ${year} Contribution Reminder — Due ${deadline}`,
    text,
    html: layout(previewText, body),
  });
}

/**
 * Send a financial statement PDF to a specific recipient.
 */
async function sendFinancialReport(recipient, attachment) {
  const now = new Date();
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const shortDate  = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const previewText = `Your Checkpoint Investment Club financial statement for ${monthLabel} is attached.`;

  const body = `
    <!-- Greeting -->
    <p style="margin:0 0 6px;font-size:13px;color:#94a3b8;">Hello,</p>
    <h1 style="margin:0 0 24px;font-family:'Sora',Arial,sans-serif;font-size:24px;
               font-weight:700;color:#f1f5f9;line-height:1.3;">
      Financial Statement
    </h1>

    <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.7;">
      Dear <strong style="color:#f1f5f9;">${recipient.name}</strong>, please find attached the
      Checkpoint Investment Club financial statement for
      <strong style="color:#0ea5e9;">${monthLabel}</strong>.
    </p>

    <!-- What's inside box -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="background:#0f172a;border:1px solid #1e3a5f;border-radius:12px;
                  padding:4px 20px;margin-bottom:24px;">
      ${infoRow('Report period', monthLabel)}
      ${infoRow('Generated on', shortDate)}
      ${infoRow('Attachment', `<span style="color:#14b8a6;">📎 ${attachment.filename || 'checkpoint-statement.pdf'}</span>`, '#f1f5f9')}
    </table>

    <!-- Contents list -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="background:rgba(14,165,233,0.06);border:1px solid rgba(14,165,233,0.18);
                  border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#0ea5e9;
                    text-transform:uppercase;letter-spacing:0.06em;">
            This statement includes
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            ${['Total Equity & Capital Structure breakdown',
               'Cumulative Member Contributions',
               'Active Loans & Outstanding Balances'].map(item => `
            <tr>
              <td style="padding:3px 0;font-size:13px;color:#94a3b8;">
                <span style="color:#14b8a6;margin-right:8px;">✓</span>${item}
              </td>
            </tr>`).join('')}
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">
      This document is <strong style="color:#94a3b8;">confidential</strong> and intended
      for club members only. Please do not share or forward it externally.
    </p>

    <!-- Divider -->
    <div style="border-top:1px solid #1e3a5f;margin:28px 0;"></div>

    <p style="margin:0;font-size:12px;color:#64748b;">
      Warm regards,<br/>
      <strong style="color:#94a3b8;">Checkpoint Investment Club</strong>
    </p>
  `;

  const text = `Dear ${recipient.name},\n\nPlease find attached the Checkpoint Investment Club financial statement for ${monthLabel}.\n\nThis document includes:\n- Total Equity & Capital Structure breakdown\n- Cumulative Member Contributions\n- Active Loans & Outstanding Balances\n\nThis document is confidential and intended for club members only.\n\n– Checkpoint Investment Club`;

  return _send({
    from: FROM,
    to: recipient.email,
    subject: `[Checkpoint] Financial Statement — ${monthLabel}`,
    text,
    html: layout(previewText, body),
    attachments: [
      {
        filename: attachment.filename || 'checkpoint-statement.pdf',
        content: Buffer.from(attachment.base64, 'base64'),
        contentType: 'application/pdf',
      },
    ],
  });
}

module.exports = { sendDeadlineReminder, sendFinancialReport, isConfigured };
