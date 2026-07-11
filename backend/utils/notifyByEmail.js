// Stub: email delivery for Notification records is not wired up yet — the
// Google Forms/email integration is broken post Vercel→Cloudflare migration
// and is being fixed separately. This just logs so notification creation
// (routes/notifications.js, jobs/deadlineScan.js) has a single call site to
// swap over to backend/utils/mailer.js once that work lands.
async function notifyByEmail(notification) {
  console.log(`[notify] (stub, no email sent) member ${notification.member_id} — ${notification.type}: ${notification.message}`);
}

module.exports = { notifyByEmail };
