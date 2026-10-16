const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  startPhase4fATestApp,
  stopPhase4fATestApp,
} = require('./helpers/phase4fATestApp');
const { getJson, postJson, patchJson } = require('./helpers/httpJson');

let app;

before(async () => {
  app = await startPhase4fATestApp();

  // Seed auxiliary notification/feed collections in all three databases only
  // after the real server has loaded. snapshots() includes every collection,
  // so any migrated route that reaches default or beta is still detected.
  const defaultForm = require('../../db/formIntakeModels');
  const defaultAdminState = require('../../db/adminNotificationModels');

  await app.alpha.FormIntakeSubmission.create({
    source_id: 'phase4fb1-alpha-intake',
    member_name: 'Alpha Form Intake B1',
    matched_member_id: app.fx.alpha.members.one.id,
    match_status: 'matched',
    amount: 12000,
    payment_date: '2026-10-10',
    type: 'monthly',
    months: ['October 2026'],
    review_status: 'pending',
  });
  await defaultForm.FormIntakeSubmission.create({
    source_id: 'phase4fb1-default-intake',
    member_name: 'DEFAULT FORM INTAKE SENTINEL',
    amount: 999999,
    payment_date: '2026-10-10',
    type: 'monthly',
    review_status: 'pending',
  });
  await app.beta.FormIntakeSubmission.create({
    source_id: 'phase4fb1-beta-intake',
    member_name: 'BETA FORM INTAKE SENTINEL',
    amount: 888888,
    payment_date: '2026-10-10',
    type: 'monthly',
    review_status: 'pending',
  });

  await defaultAdminState.AdminNotificationState.create({
    key: 'default:sentinel:item',
    admin_key: 'default-admin',
    source: 'form_intake',
    source_id: 'default-sentinel',
  });
  await app.beta.AdminNotificationState.create({
    key: 'beta:sentinel:item',
    admin_key: 'beta-admin',
    source: 'form_intake',
    source_id: 'beta-sentinel',
  });

  await app.alpha.Notification.create({
    member_id: app.fx.alpha.members.one.id,
    type: 'custom',
    message: 'ALPHA B1 notification only',
    read: false,
    created_by: 'phase4fb1-test',
  });
});

after(async () => {
  await stopPhase4fATestApp();
});

test('B1 notifications GET reads tenant_alpha only', async () => {
  const beforeDb = await app.snapshots();
  const { status, body } = await getJson(app.baseUrl, '/api/notifications', app.tokens.admin);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.some((row) => row.message === 'ALPHA B1 notification only'));
  assert.ok(!body.some((row) => /DEFAULT|BETA SENTINEL/.test(String(row.message || ''))));
  await app.assertIsolation(beforeDb, 'notifications GET');
});

test('B1 notification POST writes tenant_alpha only', async () => {
  const beforeDb = await app.snapshots();
  const beforeCount = await app.alpha.Notification.countDocuments();
  const { status, body } = await postJson(
    app.baseUrl,
    '/api/notifications',
    {
      member_id: app.fx.alpha.members.two.id,
      type: 'custom',
      message: 'B1 admin-created tenant notification',
    },
    app.tokens.admin,
  );
  assert.equal(status, 201);
  assert.equal(body.member_id, app.fx.alpha.members.two.id);
  assert.equal(await app.alpha.Notification.countDocuments(), beforeCount + 1);
  await app.assertIsolation(beforeDb, 'notification POST');
});

test('B1 admin feed reads tenant FormIntakeSubmission and member data only', async () => {
  const beforeDb = await app.snapshots();
  const { status, body } = await getJson(app.baseUrl, '/api/notifications/admin-feed', app.tokens.admin);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.items));
  const serialized = JSON.stringify(body.items);
  assert.match(serialized, /Alpha Form Intake B1/);
  assert.doesNotMatch(serialized, /DEFAULT FORM INTAKE SENTINEL/);
  assert.doesNotMatch(serialized, /BETA FORM INTAKE SENTINEL/);
  await app.assertIsolation(beforeDb, 'admin feed GET');
});

test('B1 admin feed read-all writes tenant AdminNotificationState only', async () => {
  const beforeDb = await app.snapshots();
  const beforeCount = await app.alpha.AdminNotificationState.countDocuments();
  const { status, body } = await patchJson(
    app.baseUrl,
    '/api/notifications/admin-feed/read-all',
    {},
    app.tokens.admin,
  );
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(await app.alpha.AdminNotificationState.countDocuments() >= beforeCount);
  await app.assertIsolation(beforeDb, 'admin feed read-all');
});

test('B1 attention feed is tenant-scoped', async () => {
  const beforeDb = await app.snapshots();
  const { status, body } = await getJson(app.baseUrl, '/api/notifications/attention', app.tokens.admin);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  const serialized = JSON.stringify(body);
  assert.match(serialized, /Form Intake/);
  assert.doesNotMatch(serialized, /DEFAULT FORM INTAKE SENTINEL|BETA FORM INTAKE SENTINEL/);
  await app.assertIsolation(beforeDb, 'attention GET');
});

test('B1 manual deadline scan stays inside the authenticated tenant', async () => {
  const beforeDb = await app.snapshots();
  const { status, body } = await postJson(
    app.baseUrl,
    '/api/notifications/scan',
    {},
    app.tokens.admin,
  );
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body && typeof body.created === 'number');
  assert.ok(body.fine_issuance && body.fine_issuance.ok === true);
  await app.assertIsolation(beforeDb, 'manual deadline scan');
});

test('B1 registered but runtime-disabled beta token is rejected before notification access', async () => {
  const beforeDb = await app.snapshots();
  const { status } = await getJson(app.baseUrl, '/api/notifications', app.tokens.betaAdmin);
  assert.equal(status, 403);
  await app.assertIsolation(beforeDb, 'beta token rejected');
});
