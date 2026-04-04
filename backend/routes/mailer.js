const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { Member, Contribution } = require('../db/models');
const bcrypt = require('bcryptjs');
const { User } = require('../db/models');
const { sendDeadlineReminder, sendFinancialReport, sendWelcome, isConfigured } = require('../utils/mailer');

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ─── POST /api/mailer/broadcast-reminders ────────────────────────────────────
// Admin triggers this to email all members who haven't paid this month.
// Body: { month?: number, year?: number }  (defaults to current month/year)
router.post('/broadcast-reminders', authenticate, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const month = parseInt(req.body.month) || (now.getMonth() + 1);
    const year  = parseInt(req.body.year)  || now.getFullYear();
    const AMOUNT_DUE = 75000; // FY2025+ monthly rate

    // Resolve deadline: 5th of the following month
    const dlMonth = month === 12 ? 1 : month + 1;
    const dlYear  = month === 12 ? year + 1 : year;
    const deadline = `${MONTH_NAMES[dlMonth]} 5, ${dlYear}`;

    // All active members
    const allMembers = await Member.find({ status: 'active' });

    // Members who have already paid (any non-unpaid contribution for this period)
    const paidContribs = await Contribution.find({
      month,
      year,
      status: { $in: ['paid', 'partial'] },
    });
    const paidIds = new Set(paidContribs.map((c) => c.member_id));

    const unpaidMembers = allMembers.filter((m) => !paidIds.has(m.id));

    if (unpaidMembers.length === 0) {
      return res.json({
        message: `All ${allMembers.length} members have already paid for ${MONTH_NAMES[month]} ${year}. No reminders sent.`,
        sent: 0,
        skipped: 0,
        results: [],
      });
    }

    // Dispatch emails (sequentially to avoid SMTP rate limits)
    const results = [];
    for (const member of unpaidMembers) {
      if (!member.email) {
        results.push({ member: member.name, status: 'skipped', reason: 'No email address on file' });
        continue;
      }
      try {
        const info = await sendDeadlineReminder(
          { name: member.name, email: member.email },
          { month, year, amount_due: AMOUNT_DUE, deadline },
        );
        results.push({
          member: member.name,
          email: member.email,
          status: 'sent',
          messageId: info.messageId,
          mocked: info.mocked || false,
        });
      } catch (err) {
        results.push({ member: member.name, status: 'failed', reason: err.message });
      }
    }

    const sent    = results.filter((r) => r.status === 'sent').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed  = results.filter((r) => r.status === 'failed').length;

    res.json({
      message: `Broadcast complete. ${sent} sent, ${skipped} skipped (no email), ${failed} failed.`,
      sent,
      skipped,
      failed,
      mock_mode: !isConfigured,
      results,
    });
  } catch (err) {
    console.error('[mailer] broadcast-reminders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/mailer/send-statement ─────────────────────────────────────────
// Send a PDF financial statement to a single recipient.
// Body: { recipient_email, recipient_name, base64_pdf, filename }
router.post('/send-statement', authenticate, requireAdmin, async (req, res) => {
  try {
    const { recipient_email, recipient_name, base64_pdf, filename } = req.body;

    if (!recipient_email) return res.status(400).json({ error: 'recipient_email is required' });
    if (!base64_pdf)      return res.status(400).json({ error: 'base64_pdf is required' });

    // Guard against oversized payloads (8 MB PDF limit)
    const sizeBytes = Buffer.byteLength(base64_pdf, 'base64');
    if (sizeBytes > 8 * 1024 * 1024) {
      return res.status(413).json({ error: 'PDF attachment exceeds the 8 MB limit.' });
    }

    const info = await sendFinancialReport(
      { name: recipient_name || 'Club Member', email: recipient_email },
      { filename: filename || 'checkpoint-statement.pdf', base64: base64_pdf },
    );

    res.json({
      message: 'Statement sent successfully.',
      messageId: info.messageId,
      mocked: info.mocked || false,
      mock_mode: !isConfigured,
    });
  } catch (err) {
    console.error('[mailer] send-statement error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/mailer/broadcast-statement ────────────────────────────────────
// Send a PDF financial statement to ALL active members who have an email.
// Body: { base64_pdf, filename }
router.post('/broadcast-statement', authenticate, requireAdmin, async (req, res) => {
  try {
    const { base64_pdf, filename } = req.body;

    if (!base64_pdf) return res.status(400).json({ error: 'base64_pdf is required' });

    const sizeBytes = Buffer.byteLength(base64_pdf, 'base64');
    if (sizeBytes > 8 * 1024 * 1024) {
      return res.status(413).json({ error: 'PDF attachment exceeds the 8 MB limit.' });
    }

    const allMembers = await Member.find({ status: 'active' });
    const results = [];

    for (const member of allMembers) {
      if (!member.email) {
        results.push({ member: member.name, status: 'skipped', reason: 'No email address on file' });
        continue;
      }
      try {
        const info = await sendFinancialReport(
          { name: member.name, email: member.email },
          { filename: filename || 'checkpoint-statement.pdf', base64: base64_pdf },
        );
        results.push({
          member: member.name,
          email: member.email,
          status: 'sent',
          messageId: info.messageId,
          mocked: info.mocked || false,
        });
      } catch (err) {
        results.push({ member: member.name, status: 'failed', reason: err.message });
      }
    }

    const sent    = results.filter((r) => r.status === 'sent').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed  = results.filter((r) => r.status === 'failed').length;

    res.json({
      message: `Statement broadcast complete. ${sent} sent, ${skipped} skipped (no email), ${failed} failed.`,
      sent,
      skipped,
      failed,
      mock_mode: !isConfigured,
      results,
    });
  } catch (err) {
    console.error('[mailer] broadcast-statement error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/mailer/broadcast-credentials ──────────────────────────────────
// Creates member user accounts (if they don't exist) and emails each member
// their login credentials.
// Body: { portal_url?, default_password? }
router.post('/broadcast-credentials', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      portal_url     = 'https://checkpoint-dashboard-roan.vercel.app',
      default_password = 'checkpoint2025',
    } = req.body;

    const allMembers = await Member.find({ status: 'active', email: { $ne: null } }).lean();
    const results = [];

    for (const member of allMembers) {
      try {
        // Check if a user account already exists for this member
        let user = await User.findOne({ member_id: member.id }).lean();
        let accountCreated = false;

        if (!user) {
          // Create a new user account linked to this member
          const username = member.email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
          const password_hash = bcrypt.hashSync(default_password, 10);

          const newUser = new User({
            username,
            email: member.email.toLowerCase(),
            password_hash,
            member_id: member.id,
            role: 'member',
          });
          await newUser.save();
          accountCreated = true;
        } else if (!user.email) {
          // Account exists but email not set — patch it
          await User.updateOne({ member_id: member.id }, { $set: { email: member.email.toLowerCase() } });
        }

        // Send welcome email
        const info = await sendWelcome(
          { name: member.name, email: member.email },
          { password: default_password, url: portal_url }
        );

        results.push({
          member: member.name,
          email: member.email,
          accountCreated,
          emailStatus: 'sent',
          messageId: info.messageId,
          mocked: info.mocked || false,
        });
      } catch (err) {
        results.push({ member: member.name, email: member.email, emailStatus: 'failed', reason: err.message });
      }
    }

    const sent    = results.filter(r => r.emailStatus === 'sent').length;
    const created = results.filter(r => r.accountCreated).length;
    const failed  = results.filter(r => r.emailStatus === 'failed').length;

    res.json({
      message: `Done. ${created} accounts created, ${sent} emails sent, ${failed} failed.`,
      mock_mode: !isConfigured,
      sent,
      created,
      failed,
      results,
    });
  } catch (err) {
    console.error('[mailer] broadcast-credentials error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
