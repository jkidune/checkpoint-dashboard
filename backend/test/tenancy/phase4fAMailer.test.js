// Phase 4F-A isolation proof for routes/mailer.js, through the real Express
// server (server.js), real authenticate, real tenant resolution and real HTTP.
// SMTP is never configured: utils/mailer.js runs in its real mock mode (and
// nodemailer.createTransport throws if anything tried to open a real
// transport - see helpers/phase4fATestApp.js). The mail boundary is observed
// with call recorders that delegate to that mock implementation.
//
// Routes (all admin-only except the retired one):
//   POST /api/mailer/broadcast-reminders   - active members without a paid/partial contribution
//   POST /api/mailer/send-statement        - one PDF to one address (no database)
//   POST /api/mailer/broadcast-statement   - one PDF to every active member with an email
//   POST /api/mailer/broadcast-credentials - RETIRED: server.js answers 410 before this router
//
// server.js mounts the 410 handler for /api/mailer/broadcast-credentials
// BEFORE the mailer router, so the router's own broadcast-credentials handler
// is unreachable through server.js. That precedence is preserved exactly and
// proven here over real HTTP. Because the handler still exists in the file, it
// was migrated too, and its tenant behaviour (account creation with ids from
// the tenant's user_id counter) is proven by mounting the REAL router module
// - real middleware, real tenant resolution - on a bare Express app. That
// second mount exists only inside this test; server.js is untouched.

const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const {
  startPhase4fATestApp, stopPhase4fATestApp, mountRouterInIsolation, callHandlerWithoutTenantModels,
  requestWithHeaders, withCapturedConsoleError, assertFailedBecauseTenantModelsAreMissing,
} = require('./helpers/phase4fATestApp');
const { postJson } = require('./helpers/httpJson');

let app;
let globalBaseline;
let isolatedBase;

const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);

before(async () => {
  app = await startPhase4fATestApp();
  globalBaseline = await app.baseline();
  isolatedBase = await mountRouterInIsolation('/api/mailer', require('../../routes/mailer'));
}, { timeout: 120000 });

after(async () => {
  await stopPhase4fATestApp();
});

const ADMIN = () => app.tokens.admin;
const PDF = Buffer.from('%PDF-1.4 phase4fa test attachment').toString('base64');
const RETIRED = { error: 'Credential broadcast has been retired. Use member account invitations instead.' };

// ─── broadcast-reminders ────────────────────────────────────────────────────

test('POST /mailer/broadcast-reminders targets tenant_alpha\'s unpaid ACTIVE members only (default contributions would excuse the default members)', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const { status, body } = await postJson(app.baseUrl, '/api/mailer/broadcast-reminders', { month: 6, year: 2026 }, ADMIN());
  assert.equal(status, 200, JSON.stringify(body));

  // alpha: m1 (part-paid) and m5 (paid) are "paid"; m2 and m3 are not; m4 is former. m3 has no email.
  assert.equal(body.message, 'Broadcast complete. 1 sent, 1 skipped (no email), 0 failed.');
  assert.deepEqual([body.sent, body.skipped, body.failed, body.mock_mode], [1, 1, 0, true]);
  assert.deepEqual(body.results.map((r) => [r.member, r.email, r.status, r.mocked, r.reason]), [
    ['Alpha Active Two', 'two@alpha.test', 'sent', true, undefined],
    ['Alpha Active Three', undefined, 'skipped', undefined, 'No email address on file'],
  ]);
  assert.match(body.results[0].messageId, /^mock-/);
  assert.doesNotMatch(JSON.stringify(body), /SENTINEL|sentinel\.invalid|BETA/);

  // The mail boundary saw the ALPHA member. (The amount due is the route's fixed 75000 and the deadline the
  // 5th of the following month - unchanged behaviour.)
  assert.deepEqual(app.mail.callsOf('sendDeadlineReminder').map((c) => c.args), [
    [{ name: 'Alpha Active Two', email: 'two@alpha.test' }, { month: 6, year: 2026, amount_due: 75000, deadline: 'Jul 5, 2026' }],
  ]);

  await app.assertIsolation(before, 'broadcast-reminders');
  assert.deepEqual(await app.changedAlpha(before), [], 'broadcast-reminders is read-only');
});

test('broadcast-reminders: when every alpha active member already has a paid/partial contribution the "all paid" answer counts ALPHA\'s members', async () => {
  // Fixture: a paid or partial contribution for November 2025 for each of alpha's four ACTIVE members.
  for (const [key, status] of [['one', 'paid'], ['two', 'partial'], ['three', 'paid'], ['five', 'paid']]) {
    await app.alpha.Contribution.create({
      id: await app.alpha.getNextId('contribution_id'), member_id: app.fx.alpha.members[key].id, amount: 10000, month: 11, year: 2025, status,
    });
  }
  const before = await app.baseline();
  app.mail.reset();
  const { status, body } = await postJson(app.baseUrl, '/api/mailer/broadcast-reminders', { month: 11, year: 2025 }, ADMIN());
  assert.equal(status, 200);
  // Alpha has 4 active members; the default DB has 6 (ids 1-5 and 4000) - a default-bound count would say 6.
  assert.deepEqual(body, { message: 'All 4 members have already paid for Nov 2025. No reminders sent.', sent: 0, skipped: 0, results: [] });
  assert.equal(app.mail.calls.length, 0);
  await app.assertIsolation(before, 'broadcast-reminders all paid');
});

test('broadcast-reminders delivery failure is reported per member and nothing is written anywhere', async () => {
  const before = await app.baseline();
  app.mail.reset();
  app.mail.failNext('sendDeadlineReminder', new Error('Reminder transport failed'));
  const { status, body } = await postJson(app.baseUrl, '/api/mailer/broadcast-reminders', { month: 6, year: 2026 }, ADMIN());
  assert.equal(status, 200);
  assert.equal(body.message, 'Broadcast complete. 0 sent, 1 skipped (no email), 1 failed.');
  assert.deepEqual(body.results[0], { member: 'Alpha Active Two', status: 'failed', reason: 'Reminder transport failed' });
  await app.assertIsolation(before, 'broadcast-reminders failure');
  assert.deepEqual(await app.changedAlpha(before), []);
});

// ─── send-statement (no database) ───────────────────────────────────────────

test('POST /mailer/send-statement validates its input, prepares the mock mail and touches NO database at all', async () => {
  const before = await app.baseline();
  app.mail.reset();

  const noRecipient = await postJson(app.baseUrl, '/api/mailer/send-statement', { base64_pdf: PDF }, ADMIN());
  assert.equal(noRecipient.status, 400);
  assert.deepEqual(noRecipient.body, { error: 'recipient_email is required' });
  const noPdf = await postJson(app.baseUrl, '/api/mailer/send-statement', { recipient_email: 'someone@alpha.test' }, ADMIN());
  assert.equal(noPdf.status, 400);
  assert.deepEqual(noPdf.body, { error: 'base64_pdf is required' });
  assert.equal(app.mail.calls.length, 0);

  const full = await postJson(app.baseUrl, '/api/mailer/send-statement', { recipient_email: 'someone@alpha.test', recipient_name: 'Someone', base64_pdf: PDF, filename: 'x.pdf' }, ADMIN());
  assert.equal(full.status, 200, JSON.stringify(full.body));
  assert.equal(full.body.message, 'Statement sent successfully.');
  assert.equal(full.body.mocked, true);
  assert.equal(full.body.mock_mode, true);
  assert.match(full.body.messageId, /^mock-/);

  const defaults = await postJson(app.baseUrl, '/api/mailer/send-statement', { recipient_email: 'other@alpha.test', base64_pdf: PDF }, ADMIN());
  assert.equal(defaults.status, 200);

  assert.deepEqual(app.mail.callsOf('sendFinancialReport').map((c) => c.args), [
    [{ name: 'Someone', email: 'someone@alpha.test' }, { filename: 'x.pdf', base64: PDF }],
    [{ name: 'Club Member', email: 'other@alpha.test' }, { filename: 'checkpoint-statement.pdf', base64: PDF }],
  ]);
  await app.assertIsolation(before, 'send-statement');
  assert.deepEqual(await app.changedAlpha(before), [], 'send-statement has no database side effects');
});

// ─── broadcast-statement ────────────────────────────────────────────────────

test('POST /mailer/broadcast-statement mails tenant_alpha\'s active members with an email, skips those without, and ignores default / beta members', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const noPdf = await postJson(app.baseUrl, '/api/mailer/broadcast-statement', {}, ADMIN());
  assert.equal(noPdf.status, 400);
  assert.deepEqual(noPdf.body, { error: 'base64_pdf is required' });

  const { status, body } = await postJson(app.baseUrl, '/api/mailer/broadcast-statement', { base64_pdf: PDF, filename: 'club.pdf' }, ADMIN());
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.message, 'Statement broadcast complete. 3 sent, 1 skipped (no email), 0 failed.');
  assert.deepEqual(body.results.map((r) => [r.member, r.email, r.status]), [
    ['Alpha Active One', 'one@alpha.test', 'sent'],
    ['Alpha Active Two', 'two@alpha.test', 'sent'],
    ['Alpha Active Three', undefined, 'skipped'],
    ['Alpha Active Five', 'five@alpha.test', 'sent'],
  ]);
  assert.doesNotMatch(JSON.stringify(body), /SENTINEL|sentinel\.invalid|BETA/);
  assert.deepEqual(app.mail.callsOf('sendFinancialReport').map((c) => [c.args[0].name, c.args[0].email, c.args[1].filename]), [
    ['Alpha Active One', 'one@alpha.test', 'club.pdf'],
    ['Alpha Active Two', 'two@alpha.test', 'club.pdf'],
    ['Alpha Active Five', 'five@alpha.test', 'club.pdf'],
  ]);
  await app.assertIsolation(before, 'broadcast-statement');
  assert.deepEqual(await app.changedAlpha(before), []);

  // A delivery failure is reported for that member only.
  app.mail.reset();
  app.mail.failNext('sendFinancialReport', new Error('PDF mail failed'));
  const failing = await postJson(app.baseUrl, '/api/mailer/broadcast-statement', { base64_pdf: PDF }, ADMIN());
  assert.equal(failing.body.message, 'Statement broadcast complete. 2 sent, 1 skipped (no email), 1 failed.');
  assert.deepEqual(failing.body.results[0], { member: 'Alpha Active One', status: 'failed', reason: 'PDF mail failed' });
  await app.assertIsolation(before, 'broadcast-statement failure');
});

// ─── broadcast-credentials: retired through server.js ───────────────────────

test('server.js still answers 410 for /api/mailer/broadcast-credentials BEFORE the mailer router (retired precedence), for any caller, and nothing is written or mailed', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const attempts = [
    ['admin', ADMIN()],
    ['no token', undefined],
    ['member', app.tokens.member1],
    ['org_beta admin', app.tokens.betaAdmin],
    ['unknown org', app.tokens.unknownOrgAdmin],
  ];
  for (const [label, token] of attempts) {
    const res = await requestWithHeaders(app.baseUrl, 'POST', '/api/mailer/broadcast-credentials', {
      token, body: { default_password: 'phase4fa-should-never-be-used', new_only: false, status_email: 'nobody@alpha.test' },
    });
    assert.equal(res.status, 410, `${label}`);
    assert.deepEqual(res.body, RETIRED, `${label}`);
  }
  assert.equal(app.mail.calls.length, 0, 'the retired endpoint must not prepare any mail');
  await app.assertIsolation(before, 'retired broadcast-credentials');
  assert.deepEqual(await app.changedAlpha(before), [], 'the retired endpoint must not create accounts');
});

// ─── broadcast-credentials: the (shadowed) handler is tenant-safe ───────────

test('the shadowed broadcast-credentials handler, mounted in isolation, creates accounts in tenant_alpha only with ids from ALPHA\'s user_id sequence', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const userCounterBefore = await app.alphaCounter('user_id');
  assert.equal(userCounterBefore, 2, 'fixture: alpha has users 1 and 2');
  const password = 'phase4fa-test-password';

  const { status, body } = await postJson(isolatedBase, '/api/mailer/broadcast-credentials', {
    default_password: password, portal_url: app.PORTAL_URL, status_email: 'status@alpha.test',
  }, ADMIN());
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.message, 'Done. 2 accounts created, 3 emails sent, 0 skipped (existing), 0 failed.');
  assert.deepEqual([body.mock_mode, body.sent, body.skipped, body.created, body.failed], [true, 3, 0, 2, 0]);
  // Active alpha members WITH an email, in order: 1 (already has an alpha user), 2 and 5 (accounts created).
  // Member 3 has no email (the default DB's member 3 does), member 4 is former.
  assert.deepEqual(body.results.map((r) => [r.member, r.email, r.accountCreated, r.emailStatus, r.mocked]), [
    ['Alpha Active One', 'one@alpha.test', false, 'sent', true],
    ['Alpha Active Two', 'two@alpha.test', true, 'sent', true],
    ['Alpha Active Five', 'five@alpha.test', true, 'sent', true],
  ]);

  // The accounts live in alpha with ids from alpha's counter (3, 4) - not the default (5006+) or beta (7006+) ones.
  const created = await app.alpha.User.find({ member_id: { $in: [app.fx.alpha.members.two.id, app.fx.alpha.members.five.id] } }).sort({ id: 1 }).lean();
  assert.deepEqual(created.map((u) => [u.id, u.username, u.email, u.member_id, u.role]), [
    [userCounterBefore + 1, 'two', 'two@alpha.test', app.fx.alpha.members.two.id, 'member'],
    [userCounterBefore + 2, 'five', 'five@alpha.test', app.fx.alpha.members.five.id, 'member'],
  ]);
  for (const user of created) {
    assert.notEqual(user.password_hash, password, 'the password is never stored in clear');
    assert.ok(bcrypt.compareSync(password, user.password_hash), 'bcrypt hash of the supplied default_password');
  }
  assert.equal(await app.alphaCounter('user_id'), userCounterBefore + 2);
  // The default DB has users for member_ids 2 and 3 - a default-bound lookup would have called member 2 "already has an account".
  // Existing alpha user 1 had no email: the "patch the missing email" branch ran against alpha.
  assert.equal((await app.alpha.User.findOne({ member_id: app.fx.alpha.members.one.id }).lean()).email, 'one@alpha.test');

  // The welcome mails were prepared for the alpha members, then the admin status report.
  assert.deepEqual(app.mail.callsOf('sendWelcome').map((c) => [c.args[0], c.args[1]]), [
    [{ name: 'Alpha Active One', email: 'one@alpha.test' }, { password, url: app.PORTAL_URL }],
    [{ name: 'Alpha Active Two', email: 'two@alpha.test' }, { password, url: app.PORTAL_URL }],
    [{ name: 'Alpha Active Five', email: 'five@alpha.test' }, { password, url: app.PORTAL_URL }],
  ]);
  const [report] = app.mail.callsOf('sendAdminStatusReport');
  assert.deepEqual(report.args[0], { email: 'status@alpha.test', name: 'Admin' });
  assert.deepEqual([report.args[1].sent, report.args[1].skipped, report.args[1].failed], [3, 0, 0]);

  await app.assertIsolation(before, 'broadcast-credentials (isolated mount)');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.users].sort());
});

test('broadcast-credentials (isolated mount): new_only skips existing alpha accounts; a repeat run creates nothing; a delivery failure is per member', async () => {
  const before = await app.baseline();
  app.mail.reset();

  const newOnly = await postJson(isolatedBase, '/api/mailer/broadcast-credentials', { new_only: true, default_password: 'phase4fa-test-password' }, ADMIN());
  assert.equal(newOnly.status, 200);
  assert.equal(newOnly.body.message, 'Done. 0 accounts created, 0 emails sent, 3 skipped (existing), 0 failed.');
  assert.deepEqual(newOnly.body.results.map((r) => [r.member, r.emailStatus, r.reason]), [
    ['Alpha Active One', 'skipped', 'Account already exists'],
    ['Alpha Active Two', 'skipped', 'Account already exists'],
    ['Alpha Active Five', 'skipped', 'Account already exists'],
  ]);
  assert.equal(app.mail.calls.length, 0);

  app.mail.failNext('sendWelcome', new Error('Welcome mail failed')); // first member only
  const repeat = await postJson(isolatedBase, '/api/mailer/broadcast-credentials', { default_password: 'phase4fa-test-password' }, ADMIN());
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.message, 'Done. 0 accounts created, 2 emails sent, 0 skipped (existing), 1 failed.');
  assert.deepEqual(repeat.body.results[0], { member: 'Alpha Active One', email: 'one@alpha.test', emailStatus: 'failed', reason: 'Welcome mail failed' });

  await app.assertIsolation(before, 'broadcast-credentials repeat');
  assert.deepEqual(await app.changedAlpha(before), [], 'no accounts or counters change on repeat runs');
});

test('broadcast-credentials (isolated mount): hostile tenant selection is ignored and an org_beta token is rejected with no write', async () => {
  // A fresh alpha member with an email and no account: the only one the run may create an account for.
  const member = await app.alpha.Member.create({ id: await app.alpha.getNextId('member_id'), name: 'Alpha Fresh Six', email: 'fresh.six@alpha.test', status: 'active' });
  const before = await app.baseline();
  app.mail.reset();
  const userCounterBefore = await app.alphaCounter('user_id');

  const hostile = await requestWithHeaders(
    isolatedBase, 'POST', '/api/mailer/broadcast-credentials?organization_id=org_beta&database_name=tenant_beta',
    {
      token: ADMIN(), body: { organization_id: 'org_beta', database_name: 'tenant_beta', new_only: true, default_password: 'phase4fa-test-password' },
      headers: { 'x-tenant-id': 'org_beta', 'x-organization-id': 'org_beta', 'x-database-name': 'tenant_beta' },
    }
  );
  assert.equal(hostile.status, 200, JSON.stringify(hostile.body));
  assert.equal(hostile.body.created, 1);
  const user = await app.alpha.User.findOne({ member_id: member.id }).lean();
  assert.equal(user.id, userCounterBefore + 1);
  assert.equal(user.username, 'fresh.six'.replace(/[^a-z0-9]/gi, ''));
  assert.equal(await app.beta.User.countDocuments({ member_id: member.id }), 0);
  await app.assertIsolation(before, 'hostile broadcast-credentials');

  // Fixture clean-up: the extra member and its new account must not leak into the later tests' expectations.
  await app.alpha.User.deleteOne({ member_id: member.id });
  await app.alpha.Member.deleteOne({ _id: member._id });

  const afterAlpha = await app.baseline();
  for (const token of [app.tokens.betaAdmin, app.tokens.unknownOrgAdmin]) {
    const res = await requestWithHeaders(isolatedBase, 'POST', '/api/mailer/broadcast-credentials', { token, body: { default_password: 'x' } });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /not a permitted runtime tenant/);
  }
  assert.equal(app.mail.callsOf('sendWelcome').length, 1, 'only the permitted run prepared a welcome mail');
  await app.assertIsolation(afterAlpha, 'rejected broadcast-credentials');
  assert.deepEqual(await app.changedAlpha(afterAlpha), []);
});

// ─── no request-selected database or tenant ─────────────────────────────────

test('body / query / header attempts to select org_beta or tenant_beta are ignored by the live mailer routes', async () => {
  const before = await app.baseline();
  app.mail.reset();
  const hostile = { organization_id: 'org_beta', database_name: 'tenant_beta', tenant: 'org_beta' };
  const headers = { 'x-tenant-id': 'org_beta', 'x-organization-id': 'org_beta', 'x-database-name': 'tenant_beta' };

  const reminders = await requestWithHeaders(
    app.baseUrl, 'POST', '/api/mailer/broadcast-reminders?organization_id=org_beta&database_name=tenant_beta',
    { token: ADMIN(), body: { ...hostile, month: 6, year: 2026 }, headers }
  );
  assert.equal(reminders.status, 200);
  assert.deepEqual(reminders.body.results.map((r) => r.member), ['Alpha Active Two', 'Alpha Active Three']);

  const statements = await requestWithHeaders(
    app.baseUrl, 'POST', '/api/mailer/broadcast-statement?organization_id=org_beta',
    { token: ADMIN(), body: { ...hostile, base64_pdf: PDF }, headers }
  );
  assert.equal(statements.status, 200);
  assert.ok(statements.body.results.every((r) => r.member.startsWith('Alpha ')));
  assert.doesNotMatch(JSON.stringify([reminders.body, statements.body]), /BETA|SENTINEL/);
  await app.assertIsolation(before, 'hostile mailer selection');
});

// ─── auth semantics and the runtime-tenant gate ─────────────────────────────

test('the live mailer routes keep their auth semantics, and org_beta / unknown-org tokens are rejected before ANY read, write or mail', async () => {
  const before = await app.baseline();
  app.mail.reset();
  for (const path of ['/broadcast-reminders', '/send-statement', '/broadcast-statement']) {
    const call = (token) => requestWithHeaders(app.baseUrl, 'POST', `/api/mailer${path}`, { token, body: { recipient_email: 'x@alpha.test', base64_pdf: PDF, month: 6, year: 2026 } });
    assert.equal((await call(undefined)).status, 401, `${path} without a token`);
    const member = await call(app.tokens.member1);
    assert.equal(member.status, 403, `${path} as a member`);
    assert.equal(member.body.error, 'Admin only');
    for (const token of [app.tokens.betaAdmin, app.tokens.unknownOrgAdmin]) {
      const res = await call(token);
      assert.equal(res.status, 403, `${path} with a non-runtime organization`);
      assert.match(res.body.error, /not a permitted runtime tenant/);
    }
  }
  assert.equal(app.mail.calls.length, 0);
  await app.assertIsolation(before, 'rejected mailer requests');
  assert.deepEqual(await app.changedAlpha(before), []);
});

// ─── missing tenant models: fail loudly, never fall back ────────────────────

test('without req.tenantModels every DB-touching mailer handler fails loudly (500); send-statement has no database dependence', async () => {
  const router = require('../../routes/mailer');
  const before = await app.baseline();
  app.mail.reset();

  for (const [path, body] of [
    ['/broadcast-reminders', { month: 6, year: 2026 }],
    ['/broadcast-statement', { base64_pdf: PDF }],
    ['/broadcast-credentials', { default_password: 'phase4fa-test-password' }],
  ]) {
    // These handlers catch, LOG (console.error) and answer 500 - captured so the expected noise stays out of the report.
    const { result: outcome, logged } = await withCapturedConsoleError(() => callHandlerWithoutTenantModels(router, 'post', path, { body }));
    assertFailedBecauseTenantModelsAreMissing(outcome, logged, `POST ${path}`);
    if (!outcome.threw) {
      assert.equal(outcome.status, 500);
      assert.ok(logged.length > 0, `${path}: the failure must also be logged`);
    }
  }
  assert.equal(app.mail.calls.length, 0, 'nothing may be mailed once the tenant models are missing');

  const noDb = await callHandlerWithoutTenantModels(router, 'post', '/send-statement', { body: { recipient_email: 'x@alpha.test', base64_pdf: PDF } });
  assert.equal(noDb.threw, false);
  assert.equal(noDb.status, 200, 'send-statement never reads a database');

  await app.assertIsolation(before, 'mailer handlers without tenant models');
  assert.deepEqual(await app.changedAlpha(before), []);
});

test('across the whole file the default and beta databases are byte-for-byte what they were at the start', async () => {
  await app.assertIsolation(globalBaseline, 'whole mailer suite');
});
