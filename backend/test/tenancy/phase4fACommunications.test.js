// Phase 4F-A isolation proof for routes/communications.js, through the real
// Express server (server.js), real authenticate, real tenant resolution and
// real HTTP. SMTP is never configured: every message runs through the real
// mock-mode transport (and nodemailer.createTransport throws if anything tried
// to open a real one - see helpers/phase4fATestApp.js). The mail boundary is
// observed with call recorders that delegate to that mock implementation; they
// show WHICH member a mail was prepared for and with which figures, which is
// the evidence that those figures were read from tenant_alpha.
//
// Routes under test (all admin-only):
//   GET  /api/communications/status
//   POST /api/communications/verify-email
//   POST /api/communications/test-email
//   POST /api/communications/members/:id/invite
//   POST /api/communications/members/:id/message
//   POST /api/communications/members/:id/monthly-statement
//   GET  /api/communications/contribution-reminders/preview
//   POST /api/communications/contribution-reminders/send
//
// Poison in the default database (see helpers/phase4fATestApp.js): colliding
// member / user / contribution / loan / repayment / fine / transaction ids;
// default members WITH e-mail where alpha's member 3 has none; default users
// for members 2 and 3; default contributions that would excuse every member for
// June 2026; FY rules of 1 TZS (incl. FY2027, where alpha has no record);
// default reminder logs for members 1 and 2 with alpha's June period key; and a
// default notification carrying EXACTLY the message alpha's reminder writes.

const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const {
  startPhase4fATestApp, stopPhase4fATestApp, callHandlerWithoutTenantModels, requestWithHeaders,
  assertFailedBecauseTenantModelsAreMissing,
} = require('./helpers/phase4fATestApp');
const { getJson, postJson } = require('./helpers/httpJson');

let app;
let globalBaseline;

// Every request goes to a real in-process Express 4 server. Most communications handlers have no
// try/catch, so a regression that threw inside one would leave the request unanswered: each test is
// bounded so it FAILS quickly instead of hanging the whole suite.
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);

before(async () => {
  app = await startPhase4fATestApp();
  globalBaseline = await app.baseline();
}, { timeout: 120000 });

after(async () => {
  await stopPhase4fATestApp();
});

// NOTE (pre-existing, identical on main): the Notification schema declares NO numeric `id` field, so the
// `id` the routes pass to Notification.create() (drawn from the tenant's notification_id counter) is dropped
// by Mongoose strict mode. The counter IS consumed - that is what proves the id sequence is alpha's - but the
// stored notification is identified by its ObjectId `_id`, and the `notification:<id>` period key / source
// entity id the message route writes into the log hold that `_id` (Mongoose's `id` virtual).
const BASE = '/api/communications';
const ADMIN = () => app.tokens.admin;
const logsOf = (filter = {}) => app.alpha.CommunicationLog.find(filter).sort({ _id: 1 }).lean();
const lastAlphaLog = async (filter = {}) => (await logsOf(filter)).at(-1);

// ─── status ─────────────────────────────────────────────────────────────────

test('GET /status returns tenant_alpha\'s communication history only (newest first) and reports mock mode', async () => {
  const before = await app.baseline();
  const { status, body } = await getJson(app.baseUrl, `${BASE}/status`, ADMIN());
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.configured, false);
  assert.equal(body.provider, 'mock');
  assert.equal(body.smtp, null);

  // Exactly alpha's three seeded logs. The default DB holds a log whose created_at is in 2099 (a default-bound
  // /status would list it first) and beta holds one too.
  assert.deepEqual(body.recent.map((r) => r._id), [
    String(app.fx.alpha.logs.maySeededReminder._id),
    String(app.fx.alpha.logs.statement._id),
    String(app.fx.alpha.logs.invitation._id),
  ]);
  assert.doesNotMatch(JSON.stringify(body.recent), /SENTINEL|sentinel\.invalid/);

  await app.assertIsolation(before, 'GET /status');
  assert.deepEqual(await app.changedAlpha(before), [], 'status is read-only');
});

// ─── verify-email / test-email ──────────────────────────────────────────────

test('POST /verify-email reports the mock transport and touches no database', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const { status, body } = await postJson(app.baseUrl, `${BASE}/verify-email`, {}, ADMIN());
  assert.equal(status, 200);
  assert.deepEqual(body, { configured: false, ok: false, provider: 'mock', message: 'SMTP_USER and SMTP_PASS are not configured.' });
  assert.equal(app.mail.calls.length, 0);
  await app.assertIsolation(before, 'verify-email');
  assert.deepEqual(await app.changedAlpha(before), []);
});

test('POST /test-email writes ONE mocked admin_test log to tenant_alpha only; with no recipient it is a 400 and writes nothing', async () => {
  const none = await app.baseline();
  const noRecipient = await postJson(app.baseUrl, `${BASE}/test-email`, {}, ADMIN());
  assert.equal(noRecipient.status, 400);
  assert.equal(noRecipient.body.error, 'A test recipient email is required');
  await app.assertIsolation(none, 'test-email without recipient');
  assert.deepEqual(await app.changedAlpha(none), []);

  app.mail.reset();
  const before = await app.baseline();
  const { status, body } = await postJson(app.baseUrl, `${BASE}/test-email`, { email: '  Mixed.Case@Alpha.Test ' }, ADMIN());
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { success: true, mocked: true, message: 'Test email prepared in mock mode.' });

  const log = await lastAlphaLog({ type: 'admin_test' });
  assert.equal(log.recipient_email, 'mixed.case@alpha.test', 'trimmed and lower-cased');
  assert.equal(log.status, 'mocked');
  assert.equal(log.member_id, null);
  assert.equal(log.subject, 'Checkpoint email configuration test');
  assert.equal(log.created_by, 'alpha_admin');
  assert.match(log.period_key, /^test:\d+$/);
  assert.match(log.provider_message_id, /^mock-/);
  assert.ok(log.sent_at, 'a mocked send is stamped sent_at');

  assert.deepEqual(app.mail.callsOf('sendTestEmail').map((c) => c.args), [['mixed.case@alpha.test']]);
  await app.assertIsolation(before, 'test-email');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.logs]);
});

test('test-email delivery failure: the FAILED attempt is logged in tenant_alpha only and the route answers 502', async () => {
  const before = await app.baseline();
  app.mail.reset();
  app.mail.failNext('sendTestEmail', new Error('SMTP exploded'));
  const { status, body } = await postJson(app.baseUrl, `${BASE}/test-email`, { email: 'fail@alpha.test' }, ADMIN());
  assert.equal(status, 502);
  assert.deepEqual(body, { error: 'SMTP exploded' });

  const log = await lastAlphaLog({ recipient_email: 'fail@alpha.test' });
  assert.equal(log.status, 'failed');
  assert.equal(log.failure_reason, 'SMTP exploded');
  assert.equal(log.provider_message_id, null);
  assert.equal(log.sent_at, null);
  await app.assertIsolation(before, 'test-email failure');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.logs]);
});

// ─── invite ─────────────────────────────────────────────────────────────────

test('POST /members/:id/invite: alpha member 2 is invited even though the DEFAULT db has a user for member 2; the log is alpha\'s', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const { status, body } = await postJson(app.baseUrl, `${BASE}/members/${app.fx.alpha.members.two.id}/invite`, undefined, ADMIN());
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { success: true, mocked: true, message: 'Invitation previewed in mock mode.' });

  const [call] = app.mail.callsOf('sendAccountInvitation');
  assert.equal(app.mail.callsOf('sendAccountInvitation').length, 1);
  assert.equal(call.args[0].name, 'Alpha Active Two', 'the invitation is prepared for the ALPHA member');
  assert.equal(call.args[0].email, 'two@alpha.test');
  assert.deepEqual(call.args[1], { portalUrl: app.PORTAL_URL });

  const log = await lastAlphaLog({ type: 'account_invitation', member_id: app.fx.alpha.members.two.id });
  assert.equal(log.recipient_email, 'two@alpha.test');
  assert.equal(log.period_key, 'activation');
  assert.equal(log.status, 'mocked');
  assert.equal(log.subject, 'Your Checkpoint account is ready');
  assert.equal(log.created_by, 'alpha_admin');
  await app.assertIsolation(before, 'invite');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.logs]);
});

test('invite guards: alpha member with an alpha user is a 409 (alpha\'s username); no email is a 400 despite a default email; default-only / unknown ids are 404; none write anything', async () => {
  const before = await app.baseline();
  app.mail.reset();

  const existing = await postJson(app.baseUrl, `${BASE}/members/${app.fx.alpha.members.one.id}/invite`, undefined, ADMIN());
  assert.equal(existing.status, 409);
  assert.deepEqual(existing.body, { error: 'This member already has an active portal account', account_status: 'active', username: 'alpha_user_one' });

  // alpha member 3 has no email; DEFAULT member 3 has one - a default-bound lookup would not return this 400.
  const noEmail = await postJson(app.baseUrl, `${BASE}/members/${app.fx.alpha.members.three.id}/invite`, undefined, ADMIN());
  assert.equal(noEmail.status, 400);
  assert.equal(noEmail.body.error, 'This member has no email address on file');

  // 4000 exists ONLY in the default DB; 9999 nowhere.
  for (const id of [app.DEFAULT_MAX_IDS.member_id, 9999]) {
    const missing = await postJson(app.baseUrl, `${BASE}/members/${id}/invite`, undefined, ADMIN());
    assert.equal(missing.status, 404, `member ${id}`);
    assert.equal(missing.body.error, 'Member not found');
  }

  assert.equal(app.mail.calls.length, 0, 'no mail may be prepared on a rejected invite');
  await app.assertIsolation(before, 'invite guards');
  assert.deepEqual(await app.changedAlpha(before), []);
});

test('invite delivery failure: a FAILED invitation is logged in tenant_alpha only and the route answers 500', async () => {
  const before = await app.baseline();
  app.mail.reset();
  app.mail.failNext('sendAccountInvitation', new Error('Invite delivery failed'));
  const { status, body } = await postJson(app.baseUrl, `${BASE}/members/${app.fx.alpha.members.five.id}/invite`, undefined, ADMIN());
  assert.equal(status, 500);
  assert.deepEqual(body, { error: 'Invite delivery failed' });

  const log = await lastAlphaLog({ member_id: app.fx.alpha.members.five.id });
  assert.equal(log.type, 'account_invitation');
  assert.equal(log.status, 'failed');
  assert.equal(log.failure_reason, 'Invite delivery failed');
  assert.equal(log.recipient_email, 'five@alpha.test');
  await app.assertIsolation(before, 'invite failure');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.logs]);
});

// ─── member message ─────────────────────────────────────────────────────────

test('POST /members/:id/message (in_app): creates ONE alpha Notification with an id from ALPHA\'s notification counter; no log', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const counterBefore = await app.alphaCounter('notification_id');
  const { status, body } = await postJson(app.baseUrl, `${BASE}/members/${app.fx.alpha.members.two.id}/message`, { message: '  Hello Alpha Two  ' }, ADMIN());
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(body.email, null);

  const n = body.notification;
  assert.equal(n.member_id, app.fx.alpha.members.two.id);
  assert.equal(n.type, 'custom');
  assert.equal(n.message, 'Hello Alpha Two');
  assert.equal(n.due_date, null);
  assert.equal(n.read, false);
  assert.equal(n.created_by, 'Alpha Admin');
  assert.ok(await app.alpha.Notification.findById(n._id).lean(), 'the notification lives in tenant_alpha');

  // The id was drawn from ALPHA's notification_id sequence (one value consumed), not the default (5009) or beta (7009) one.
  assert.equal(await app.alphaCounter('notification_id'), counterBefore + 1);
  assert.equal(await app.defaultCounter('notification_id'), app.DEFAULT_COUNTERS.notification_id);
  assert.equal(await app.betaCounter('notification_id'), app.BETA_COUNTERS.notification_id);
  assert.equal(app.mail.calls.length, 0, 'in_app only: no mail');
  await app.assertIsolation(before, 'message in_app');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.notifications].sort());
});

test('message (email only): writes ONE alpha log keyed to the member, no notification, and prepares the mail for the alpha member', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const counterBefore = await app.alphaCounter('notification_id');
  const { status, body } = await postJson(
    app.baseUrl, `${BASE}/members/${app.fx.alpha.members.one.id}/message`,
    { channel: 'email', subject: 'Hello alpha', message: 'Plain email body' }, ADMIN()
  );
  assert.equal(status, 201, JSON.stringify(body));
  assert.deepEqual(body, { success: true, notification: null, email: { status: 'mocked', mocked: true } });

  const [call] = app.mail.callsOf('sendMemberMessage');
  assert.equal(call.args[0].name, 'Alpha Active One');
  assert.deepEqual(call.args[1], { subject: 'Hello alpha', message: 'Plain email body', portalUrl: app.PORTAL_URL });

  const log = await lastAlphaLog({ type: 'member_message' });
  assert.equal(log.member_id, app.fx.alpha.members.one.id);
  assert.equal(log.recipient_email, 'one@alpha.test');
  assert.equal(log.subject, 'Hello alpha');
  assert.equal(log.period_key, null);
  assert.equal(log.source_entity_type, 'member');
  assert.equal(log.source_entity_id, String(app.fx.alpha.members.one.id));
  assert.equal(log.status, 'mocked');

  assert.equal(await app.alphaCounter('notification_id'), counterBefore, 'no notification, so no id consumed');
  await app.assertIsolation(before, 'message email');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.logs]);
});

test('message (both): one alpha Notification AND one alpha log linked to it; type/due_date honoured; unknown type becomes custom', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const counterBefore = await app.alphaCounter('notification_id');
  const { status, body } = await postJson(
    app.baseUrl, `${BASE}/members/${app.fx.alpha.members.one.id}/message`,
    { channel: 'both', type: 'loan_due', due_date: '2026-07-05', message: 'Loan reminder' }, ADMIN()
  );
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.notification.type, 'loan_due');
  assert.equal(body.notification.due_date, '2026-07-05');
  assert.deepEqual(body.email, { status: 'mocked', mocked: true });
  assert.equal(await app.alphaCounter('notification_id'), counterBefore + 1);
  assert.ok(await app.alpha.Notification.findById(body.notification._id).lean());

  const log = await lastAlphaLog({ type: 'member_message', period_key: `notification:${body.notification._id}` });
  assert.ok(log, 'the log is linked to the notification');
  assert.equal(log.source_entity_type, 'notification');
  assert.equal(log.source_entity_id, String(body.notification._id));
  assert.equal(log.subject, 'Checkpoint notification', 'default subject when none is given');

  const bogus = await postJson(app.baseUrl, `${BASE}/members/${app.fx.alpha.members.two.id}/message`, { type: 'bogus_type', message: 'x' }, ADMIN());
  assert.equal(bogus.status, 201);
  assert.equal(bogus.body.notification.type, 'custom');
  assert.equal(await app.alphaCounter('notification_id'), counterBefore + 2);

  await app.assertIsolation(before, 'message both');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.logs, app.collections.notifications].sort());
});

test('message guards: empty message / bad channel / no email / default-only or unknown member never write; the 404 comes from alpha\'s members', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const msg = (id, body) => postJson(app.baseUrl, `${BASE}/members/${id}/message`, body, ADMIN());

  const empty = await msg(app.fx.alpha.members.one.id, { message: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'Message is required');

  const channel = await msg(app.fx.alpha.members.one.id, { channel: 'sms', message: 'x' });
  assert.equal(channel.status, 400);
  assert.equal(channel.body.error, 'Choose in_app, email, or both');

  // alpha member 3 has no email; DEFAULT member 3 does.
  const noEmail = await msg(app.fx.alpha.members.three.id, { channel: 'email', message: 'x' });
  assert.equal(noEmail.status, 400);
  assert.equal(noEmail.body.error, 'This member has no email address on file');

  for (const id of [app.DEFAULT_MAX_IDS.member_id, 9999]) {
    const missing = await msg(id, { message: 'x' });
    assert.equal(missing.status, 404, `member ${id}`);
  }

  assert.equal(app.mail.calls.length, 0);
  await app.assertIsolation(before, 'message guards');
  assert.deepEqual(await app.changedAlpha(before), []);
});

test('message delivery failure: the in-app notification is kept, the FAILED mail is logged in tenant_alpha only, the route answers 502', async () => {
  const before = await app.baseline();
  app.mail.reset();
  app.mail.failNext('sendMemberMessage', new Error('Mail server down'));
  const counterBefore = await app.alphaCounter('notification_id');
  const { status, body } = await postJson(
    app.baseUrl, `${BASE}/members/${app.fx.alpha.members.two.id}/message`,
    { channel: 'both', subject: 'Will fail', message: 'Delivery failure case' }, ADMIN()
  );
  assert.equal(status, 502);
  assert.equal(body.error, 'Mail server down');
  assert.equal(body.notification_created, true);
  assert.equal(await app.alphaCounter('notification_id'), counterBefore + 1);
  assert.ok(await app.alpha.Notification.findById(body.notification._id).lean(), 'the in-app notification is kept');

  const log = await lastAlphaLog({ period_key: `notification:${body.notification._id}` });
  assert.equal(log.status, 'failed');
  assert.equal(log.failure_reason, 'Mail server down');
  assert.equal(log.source_entity_type, 'notification');
  await app.assertIsolation(before, 'message failure');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.logs, app.collections.notifications].sort());
});

// ─── monthly statement ──────────────────────────────────────────────────────

test('POST /members/:id/monthly-statement is computed from tenant_alpha records only (FY rules, contributions, loans, repayments, fines, transactions)', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const counterBefore = await app.alphaCounter('notification_id');
  const { status, body } = await postJson(
    app.baseUrl, `${BASE}/members/${app.fx.alpha.members.one.id}/monthly-statement`,
    { month: 6, year: 2026 }, ADMIN()
  );
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { success: true, status: 'mocked', period: 'June 2026' });

  const calls = app.mail.callsOf('sendMonthlyStatement');
  assert.equal(calls.length, 1);
  const [member, context] = calls[0].args;
  assert.equal(member.name, 'Alpha Active One');
  assert.deepEqual(context, {
    periodLabel: 'June 2026',
    contributionTarget: 60000,   // alpha FY2026 rule - not 1 (default sentinel), 75000 (DEFAULTS) nor 33333 (beta)
    contributionPaid: 20000,     // alpha June 2026 contribution - not the 9999999 default one
    unpaidFines: 3500,           // alpha unpaid fine - not the 8888888 default one
    activeLoanBalance: 150000,   // 300000 - 100000 - 50000 (alpha) - not influenced by the 88888888 default repayment (same loan_id 1)
    repaymentsThisMonth: 50000,  // alpha repayment dated 2026-06-10
    recentTransactions: [
      { date: '2026-06-10', description: 'Alpha June repayment', type: 'loan_repayment', amount: 50000 },
      { date: '2026-06-05', description: 'Alpha June contribution', type: 'contribution', amount: 20000 },
      { date: '2026-04-10', description: 'Alpha April repayment', type: 'loan_repayment', amount: 100000 },
    ],
    portalUrl: app.PORTAL_URL,
  });

  const log = await lastAlphaLog({ type: 'statement' , period_key: 'statement:2026-06' });
  assert.equal(log.member_id, app.fx.alpha.members.one.id);
  assert.equal(log.recipient_email, 'one@alpha.test');
  assert.equal(log.subject, 'Checkpoint monthly statement — June 2026');
  assert.equal(log.status, 'mocked');

  const notification = await app.alpha.Notification.findOne({ message: 'Your June 2026 Checkpoint statement has been prepared and sent to one@alpha.test.' }).lean();
  assert.ok(notification, 'the in-app confirmation notification is created in alpha');
  assert.equal(await app.alphaCounter('notification_id'), counterBefore + 1);
  assert.equal(notification.member_id, app.fx.alpha.members.one.id);
  assert.equal(notification.type, 'custom');
  assert.equal(notification.created_by, 'Alpha Admin');

  await app.assertIsolation(before, 'monthly statement');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.logs, app.collections.notifications].sort());
});

test('monthly statement for a FY2025 month uses alpha\'s FY2025 rule; a FY with no alpha record falls back to DEFAULTS, never to the default DB\'s 1 TZS rule', async () => {
  app.mail.reset();
  const before = await app.baseline();

  const feb = await postJson(app.baseUrl, `${BASE}/members/${app.fx.alpha.members.one.id}/monthly-statement`, { month: 2, year: 2026 }, ADMIN());
  assert.equal(feb.status, 200);
  assert.equal(feb.body.period, 'February 2026');
  const [, febContext] = app.mail.callsOf('sendMonthlyStatement')[0].args;
  assert.equal(febContext.contributionTarget, 45000, 'alpha FY2025');
  assert.equal(febContext.contributionPaid, 15000, 'alpha Feb 2026 contribution');
  assert.equal(febContext.repaymentsThisMonth, 0);

  // FY2027: alpha has no FY2027 record; the default DB has one (contribution_amount 1) that must NOT be used.
  const fy2027 = await postJson(app.baseUrl, `${BASE}/members/${app.fx.alpha.members.one.id}/monthly-statement`, { month: 6, year: 2027 }, ADMIN());
  assert.equal(fy2027.status, 200);
  const [, fyContext] = app.mail.callsOf('sendMonthlyStatement')[1].args;
  assert.equal(fyContext.contributionTarget, 75000, 'services/fyRules.js DEFAULTS fallback');
  assert.equal(fyContext.contributionPaid, 0);

  await app.assertIsolation(before, 'monthly statement FY variants');
});

test('monthly statement guards: no email (despite a default email) is 400, default-only / unknown member is 404, no write; a delivery failure logs FAILED in alpha and creates no notification', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const stmt = (id, body = { month: 6, year: 2026 }) => postJson(app.baseUrl, `${BASE}/members/${id}/monthly-statement`, body, ADMIN());

  const noEmail = await stmt(app.fx.alpha.members.three.id);
  assert.equal(noEmail.status, 400);
  assert.equal(noEmail.body.error, 'This member has no email address on file');
  for (const id of [app.DEFAULT_MAX_IDS.member_id, 9999]) assert.equal((await stmt(id)).status, 404, `member ${id}`);
  assert.equal(app.mail.calls.length, 0);
  await app.assertIsolation(before, 'statement guards');
  assert.deepEqual(await app.changedAlpha(before), []);

  const notificationsBefore = await app.alpha.Notification.countDocuments();
  const beforeFailure = await app.baseline();
  app.mail.failNext('sendMonthlyStatement', new Error('Statement mail failed'));
  const failed = await stmt(app.fx.alpha.members.two.id, { month: 5, year: 2026 });
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.body, { error: 'Statement mail failed' });
  const log = await lastAlphaLog({ period_key: 'statement:2026-05', status: 'failed' });
  assert.equal(log.failure_reason, 'Statement mail failed');
  assert.equal(log.member_id, app.fx.alpha.members.two.id);
  assert.equal(await app.alpha.Notification.countDocuments(), notificationsBefore, 'no confirmation notification on failure');
  await app.assertIsolation(beforeFailure, 'statement failure');
  assert.deepEqual(await app.changedAlpha(beforeFailure), [app.collections.logs]);
});

// ─── contribution reminder preview ──────────────────────────────────────────

test('GET /contribution-reminders/preview uses alpha FY rules, alpha contributions and alpha members (default contributions would excuse everyone)', async () => {
  const before = await app.baseline();
  const { status, body } = await getJson(app.baseUrl, `${BASE}/contribution-reminders/preview?month=6&year=2026`, ADMIN());
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.month, 6);
  assert.equal(body.year, 2026);
  assert.equal(body.fiscal_year, 2026);
  assert.equal(body.due_date, '2026-07-05');
  // m1 part-paid, m2 nothing, m3 nothing (no email -> not sendable); m5 paid in full and m4 (former) are excluded.
  assert.deepEqual(body.recipients, [
    { member_id: app.fx.alpha.members.one.id, name: 'Alpha Active One', email: 'one@alpha.test', monthly_target: 60000, paid: 20000, outstanding: 40000, sendable: true },
    { member_id: app.fx.alpha.members.two.id, name: 'Alpha Active Two', email: 'two@alpha.test', monthly_target: 60000, paid: 0, outstanding: 60000, sendable: true },
    { member_id: app.fx.alpha.members.three.id, name: 'Alpha Active Three', email: null, monthly_target: 60000, paid: 0, outstanding: 60000, sendable: false },
  ]);
  await app.assertIsolation(before, 'reminder preview');
  assert.deepEqual(await app.changedAlpha(before), [], 'preview is read-only');
});

test('preview for a FY2025 month uses alpha\'s FY2025 rule; December rolls the due date into January; a FY without an alpha record uses DEFAULTS, not the default DB', async () => {
  const feb = await getJson(app.baseUrl, `${BASE}/contribution-reminders/preview?month=2&year=2026`, ADMIN());
  assert.equal(feb.status, 200);
  assert.equal(feb.body.fiscal_year, 2025);
  assert.equal(feb.body.due_date, '2026-03-05');
  assert.deepEqual(feb.body.recipients.map((r) => [r.member_id, r.monthly_target, r.paid, r.outstanding]), [
    [app.fx.alpha.members.one.id, 45000, 15000, 30000],
    [app.fx.alpha.members.two.id, 45000, 0, 45000],
    [app.fx.alpha.members.three.id, 45000, 0, 45000],
    [app.fx.alpha.members.five.id, 45000, 0, 45000],
  ]);

  const dec = await getJson(app.baseUrl, `${BASE}/contribution-reminders/preview?month=12&year=2026`, ADMIN());
  assert.equal(dec.body.fiscal_year, 2026);
  assert.equal(dec.body.due_date, '2027-01-05');

  // Alpha has NO FY2027 document; the default DB has one with contribution_amount 1.
  const fy2027 = await getJson(app.baseUrl, `${BASE}/contribution-reminders/preview?month=6&year=2027`, ADMIN());
  assert.equal(fy2027.body.fiscal_year, 2027);
  assert.ok(fy2027.body.recipients.length > 0);
  assert.ok(fy2027.body.recipients.every((r) => r.monthly_target === 75000), 'DEFAULTS[2026].contribution_amount, never the default DB\'s 1');
});

// ─── contribution reminder send + duplicate protection ──────────────────────

test('POST /contribution-reminders/send writes alpha logs + alpha notifications only; default reminder logs and the identical default notification do NOT suppress them', async () => {
  // Precondition: the poison is really there - the default DB already holds June reminder logs for members 1 and 2
  // and a notification with EXACTLY the message alpha's reminder writes for member 1.
  assert.equal(await app.defaultModels.CommunicationLog.countDocuments({ type: 'contribution_reminder', period_key: app.PERIOD.periodKey, member_id: { $in: [1, 2] } }), 2);
  assert.equal(await app.defaultModels.Notification.countDocuments({ member_id: 1, type: 'contribution_due', message: 'Your June 2026 contribution has TZS 40,000 outstanding. Due 2026-07-05.' }), 1);
  assert.equal(await app.alpha.CommunicationLog.countDocuments({ type: 'contribution_reminder', period_key: app.PERIOD.periodKey }), 0);

  const before = await app.baseline();
  app.mail.reset();
  const counterBefore = await app.alphaCounter('notification_id');
  const { status, body } = await postJson(app.baseUrl, `${BASE}/contribution-reminders/send`, { month: 6, year: 2026 }, ADMIN());
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, {
    mock_mode: true, month: 6, year: 2026, sent: 0, mocked: 2, skipped: 1, failed: 0,
    results: [
      { member_id: app.fx.alpha.members.one.id, member: 'Alpha Active One', status: 'mocked', outstanding: 40000 },
      { member_id: app.fx.alpha.members.two.id, member: 'Alpha Active Two', status: 'mocked', outstanding: 60000 },
      { member_id: app.fx.alpha.members.three.id, member: 'Alpha Active Three', status: 'skipped', reason: 'No email address' },
    ],
  });

  // The mail boundary saw the ALPHA members with ALPHA figures.
  assert.deepEqual(app.mail.callsOf('sendContributionReminder').map((c) => [c.args[0].name, c.args[1]]), [
    ['Alpha Active One', { periodLabel: 'June 2026', monthlyTarget: 60000, paidAmount: 20000, outstandingAmount: 40000, dueDate: '2026-07-05', portalUrl: app.PORTAL_URL }],
    ['Alpha Active Two', { periodLabel: 'June 2026', monthlyTarget: 60000, paidAmount: 0, outstandingAmount: 60000, dueDate: '2026-07-05', portalUrl: app.PORTAL_URL }],
  ]);

  // Alpha communication records.
  const logs = await logsOf({ type: 'contribution_reminder', period_key: app.PERIOD.periodKey });
  assert.deepEqual(logs.map((l) => [l.member_id, l.recipient_email, l.status, l.subject, l.created_by]), [
    [app.fx.alpha.members.one.id, 'one@alpha.test', 'mocked', 'Checkpoint contribution reminder — June 2026', 'alpha_admin'],
    [app.fx.alpha.members.two.id, 'two@alpha.test', 'mocked', 'Checkpoint contribution reminder — June 2026', 'alpha_admin'],
  ]);

  // Alpha notifications: created despite the identical default one, ids consecutive from ALPHA's counter.
  const notifications = await app.alpha.Notification.find({ type: 'contribution_due' }).sort({ _id: 1 }).lean();
  assert.deepEqual(notifications.map((n) => [n.member_id, n.message, n.due_date, n.read, n.created_by]), [
    [app.fx.alpha.members.one.id, 'Your June 2026 contribution has TZS 40,000 outstanding. Due 2026-07-05.', '2026-07-05', false, 'Alpha Admin'],
    [app.fx.alpha.members.two.id, 'Your June 2026 contribution has TZS 60,000 outstanding. Due 2026-07-05.', '2026-07-05', false, 'Alpha Admin'],
  ]);
  // Two ids consumed from ALPHA's notification_id sequence.
  assert.equal(await app.alphaCounter('notification_id'), counterBefore + 2);

  await app.assertIsolation(before, 'reminder send');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.logs, app.collections.notifications].sort());
});

test('duplicate-reminder protection still works - against ALPHA\'s log: a second send is skipped for members already reminded, writes nothing and prepares no mail', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const { status, body } = await postJson(app.baseUrl, `${BASE}/contribution-reminders/send`, { month: 6, year: 2026 }, ADMIN());
  assert.equal(status, 200);
  assert.deepEqual(body, {
    mock_mode: true, month: 6, year: 2026, sent: 0, mocked: 0, skipped: 3, failed: 0,
    results: [
      { member_id: app.fx.alpha.members.one.id, member: 'Alpha Active One', status: 'skipped', reason: 'Reminder already sent for this period' },
      { member_id: app.fx.alpha.members.two.id, member: 'Alpha Active Two', status: 'skipped', reason: 'Reminder already sent for this period' },
      { member_id: app.fx.alpha.members.three.id, member: 'Alpha Active Three', status: 'skipped', reason: 'No email address' },
    ],
  });
  assert.equal(app.mail.calls.length, 0);
  await app.assertIsolation(before, 'duplicate send');
  assert.deepEqual(await app.changedAlpha(before), [], 'a fully-suppressed send changes nothing');
});

test('force:true resends and adds new alpha logs, but the stable notification is not duplicated (the check reads alpha\'s notifications)', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const { status, body } = await postJson(app.baseUrl, `${BASE}/contribution-reminders/send`, { month: 6, year: 2026, force: true }, ADMIN());
  assert.equal(status, 200);
  assert.equal(body.mocked, 2);
  assert.equal(body.skipped, 1);
  assert.equal(app.mail.callsOf('sendContributionReminder').length, 2);
  assert.equal(await app.alpha.CommunicationLog.countDocuments({ type: 'contribution_reminder', period_key: app.PERIOD.periodKey }), 4, '2 original + 2 forced');
  await app.assertIsolation(before, 'forced resend');
  // No notification (and so no counter) change: the stable messages already exist in alpha.
  assert.deepEqual(await app.changedAlpha(before), [app.collections.logs]);

  // `force` must be the boolean true: the string "true" does not bypass the protection.
  const stringForce = await postJson(app.baseUrl, `${BASE}/contribution-reminders/send`, { month: 6, year: 2026, force: 'true' }, ADMIN());
  assert.equal(stringForce.body.mocked, 0);
  assert.equal(stringForce.body.skipped, 3);
});

test('a FY2025 send uses alpha\'s FY2025 rule and a per-period key; failed deliveries do not block a retry (only sent/mocked logs count)', async () => {
  const before = await app.baseline();
  app.mail.reset();
  app.mail.failNext('sendContributionReminder', new Error('Reminder mail failed')); // fails for the FIRST recipient (member 1)
  const counterBefore = await app.alphaCounter('notification_id');
  const first = await postJson(app.baseUrl, `${BASE}/contribution-reminders/send`, { month: 2, year: 2026 }, ADMIN());
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.failed, 1);
  assert.equal(first.body.mocked, 2);   // members 2 and 5
  assert.equal(first.body.skipped, 1);  // member 3: no email
  assert.deepEqual(first.body.results[0], { member_id: app.fx.alpha.members.one.id, member: 'Alpha Active One', status: 'failed', reason: 'Reminder mail failed' });

  const failedLog = await lastAlphaLog({ period_key: 'contribution:2026-02', status: 'failed' });
  assert.equal(failedLog.member_id, app.fx.alpha.members.one.id);
  assert.equal(failedLog.failure_reason, 'Reminder mail failed');
  // Member 1's failure created NO notification; members 2 and 5 got one each, with the FY2025 amount (45,000).
  const febNotifications = await app.alpha.Notification.find({ message: /^Your February 2026 contribution/ }).sort({ _id: 1 }).lean();
  assert.deepEqual(febNotifications.map((n) => [n.member_id, n.message, n.due_date]), [
    [app.fx.alpha.members.two.id, 'Your February 2026 contribution has TZS 45,000 outstanding. Due 2026-03-05.', '2026-03-05'],
    [app.fx.alpha.members.five.id, 'Your February 2026 contribution has TZS 45,000 outstanding. Due 2026-03-05.', '2026-03-05'],
  ]);
  assert.equal(await app.alphaCounter('notification_id'), counterBefore + 2);
  await app.assertIsolation(before, 'FY2025 send with a failure');

  // Retry: member 1 (only a FAILED log) is sent now - 30,000 outstanding (45,000 - 15,000) - while 2 and 5 are skipped.
  app.mail.reset();
  const retry = await postJson(app.baseUrl, `${BASE}/contribution-reminders/send`, { month: 2, year: 2026 }, ADMIN());
  assert.equal(retry.body.mocked, 1);
  assert.equal(retry.body.skipped, 3);
  assert.deepEqual(retry.body.results[0], { member_id: app.fx.alpha.members.one.id, member: 'Alpha Active One', status: 'mocked', outstanding: 30000 });
  assert.ok(await app.alpha.Notification.findOne({ member_id: app.fx.alpha.members.one.id, message: 'Your February 2026 contribution has TZS 30,000 outstanding. Due 2026-03-05.' }));
  await app.assertIsolation(before, 'FY2025 send retry');
});

// ─── no request-selected database or tenant ─────────────────────────────────

test('body / query / header attempts to select org_beta or tenant_beta are ignored on a read and on a write: alpha is always used', async () => {
  const hostile = { organization_id: 'org_beta', database_name: 'tenant_beta', tenant: 'org_beta', slug: 'beta-club' };
  const hostileHeaders = { 'x-tenant-id': 'org_beta', 'x-organization-id': 'org_beta', 'x-database-name': 'tenant_beta' };
  const before = await app.baseline();

  const status = await requestWithHeaders(app.baseUrl, 'GET', `${BASE}/status?organization_id=org_beta&database_name=tenant_beta`, { token: ADMIN(), headers: hostileHeaders });
  assert.equal(status.status, 200);
  assert.doesNotMatch(JSON.stringify(status.body.recent), /SENTINEL|sentinel\.invalid/);

  const preview = await requestWithHeaders(
    app.baseUrl, 'GET', `${BASE}/contribution-reminders/preview?month=6&year=2026&organization_id=org_beta&database_name=tenant_beta`,
    { token: ADMIN(), headers: hostileHeaders }
  );
  assert.equal(preview.status, 200);
  assert.ok(preview.body.recipients.every((r) => r.monthly_target === 60000 && r.name.startsWith('Alpha ')), 'alpha\'s rule and members, not beta\'s 33333');

  const counterBefore = await app.alphaCounter('notification_id');
  const message = await requestWithHeaders(
    app.baseUrl, 'POST', `${BASE}/members/${app.fx.alpha.members.two.id}/message?organization_id=org_beta&database_name=tenant_beta`,
    { token: ADMIN(), body: { ...hostile, message: 'Hostile selection attempt' }, headers: hostileHeaders }
  );
  assert.equal(message.status, 201, JSON.stringify(message.body));
  assert.equal(await app.alphaCounter('notification_id'), counterBefore + 1);
  assert.equal(await app.alpha.Notification.countDocuments({ message: 'Hostile selection attempt' }), 1);

  await app.assertIsolation(before, 'hostile tenant selection');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.notifications].sort());
});

// ─── auth semantics and the runtime-tenant gate ─────────────────────────────

const ROUTES = [
  ['GET', '/status'],
  ['POST', '/verify-email'],
  ['POST', '/test-email'],
  ['POST', '/members/2/invite'],
  ['POST', '/members/2/message'],
  ['POST', '/members/2/monthly-statement'],
  ['GET', '/contribution-reminders/preview?month=6&year=2026'],
  ['POST', '/contribution-reminders/send'],
];

test('every communications route keeps its auth semantics, and org_beta / unknown-org tokens are rejected before ANY read, write or mail', async () => {
  const before = await app.baseline();
  app.mail.reset();
  for (const [method, path] of ROUTES) {
    const call = (token) => requestWithHeaders(app.baseUrl, method, `${BASE}${path}`, { token, body: method === 'POST' ? { email: 'rejected@alpha.test', message: 'x', month: 6, year: 2026 } : undefined });
    assert.equal((await call(undefined)).status, 401, `${method} ${path} without a token`);
    const member = await call(app.tokens.member1);
    assert.equal(member.status, 403, `${method} ${path} as a member`);
    assert.equal(member.body.error, 'Admin only');
    for (const token of [app.tokens.betaAdmin, app.tokens.unknownOrgAdmin]) {
      const res = await call(token);
      assert.equal(res.status, 403, `${method} ${path} with a non-runtime organization`);
      assert.match(res.body.error, /not a permitted runtime tenant/);
    }
  }
  assert.equal(app.mail.calls.length, 0, 'a rejected request must never reach the mail boundary');
  await app.assertIsolation(before, 'rejected communications requests');
  assert.deepEqual(await app.changedAlpha(before), []);
});

// ─── missing tenant models: fail loudly, never fall back ────────────────────

test('without req.tenantModels every DB-touching communications handler throws - there is no fallback to the poisoned, connected default DB', async () => {
  const router = require('../../routes/communications');
  const before = await app.baseline();
  app.mail.reset();
  const handlers = [
    ['get', '/status', {}],
    ['post', '/test-email', { body: { email: 'loud@alpha.test' } }],
    ['post', '/members/:id/invite', { params: { id: '2' } }],
    ['post', '/members/:id/message', { params: { id: '2' }, body: { message: 'loud' } }],
    ['post', '/members/:id/monthly-statement', { params: { id: '2' }, body: { month: 6, year: 2026 } }],
    ['get', '/contribution-reminders/preview', { query: { month: '6', year: '2026' } }],
    ['post', '/contribution-reminders/send', { body: { month: 6, year: 2026 } }],
  ];
  for (const [method, path, overrides] of handlers) {
    const outcome = await callHandlerWithoutTenantModels(router, method, path, overrides);
    assertFailedBecauseTenantModelsAreMissing(outcome, [], `${method.toUpperCase()} ${path}`);
    if (outcome.threw) assert.ok(outcome.error instanceof TypeError, `${path}: ${outcome.error}`);
  }
  await app.assertIsolation(before, 'communications handlers without tenant models');
  assert.deepEqual(await app.changedAlpha(before), []);
});

// ─── limits ─────────────────────────────────────────────────────────────────

test('GET /status keeps its 50-record limit and newest-first order over tenant_alpha\'s log only', async () => {
  const docs = Array.from({ length: 55 }, (_, i) => ({
    member_id: null, recipient_email: `bulk${i}@alpha.test`, type: 'admin_test', period_key: `test:bulk-${i}`,
    subject: `ALPHA bulk log ${String(i).padStart(2, '0')}`, status: 'mocked', created_by: 'alpha_admin',
    created_at: new Date(Date.UTC(2027, 0, 1, 0, 0, i)),
  }));
  await app.alpha.CommunicationLog.insertMany(docs);
  const before = await app.baseline();
  const { status, body } = await getJson(app.baseUrl, `${BASE}/status`, ADMIN());
  assert.equal(status, 200);
  assert.equal(body.recent.length, 50);
  assert.deepEqual(body.recent.map((r) => r.subject), Array.from({ length: 50 }, (_, i) => `ALPHA bulk log ${String(54 - i).padStart(2, '0')}`));
  await app.assertIsolation(before, 'status limit');
});

test('across the whole file the default and beta databases are byte-for-byte what they were at the start', async () => {
  await app.assertIsolation(globalBaseline, 'whole communications suite');
});
