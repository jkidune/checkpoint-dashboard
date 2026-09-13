// Phase 4A isolation proof for the migrated /api/transactions routes.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4aTestApp, stopPhase4aTestApp } = require('./helpers/phase4aTestApp');
const { getJson, postJson } = require('./helpers/httpJson');

let app;
let alphaTx;

before(async () => {
  app = await startPhase4aTestApp();
  // A real tenant_alpha transaction tied to the alpha member, for the
  // member-name-enrichment and self-filtering tests below.
  alphaTx = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: app.alphaMember.id,
    amount: 75000,
    type: 'contribution',
    transaction_date: '2026-06-01',
  });
}, { timeout: 60000 });

after(async () => {
  await stopPhase4aTestApp();
});

test('15 & 16. GET /api/transactions reads only tenant_alpha; the default DB sentinel is invisible', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/transactions', app.adminToken);
  assert.equal(status, 200);
  const amounts = body.transactions.map((t) => t.amount);
  assert.ok(amounts.includes(75000));
  assert.ok(!amounts.includes(999999), 'default DB sentinel transaction must not appear');
  const types = body.transactions.map((t) => t.type);
  assert.ok(!types.includes('sentinel'));
});

test('17. member_name enrichment comes from tenant_alpha Member data', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/transactions', app.adminToken);
  assert.equal(status, 200);
  const found = body.transactions.find((t) => t.id === alphaTx.id);
  assert.ok(found);
  assert.equal(found.member_name, 'Tenant Alpha Member');
});

test('18. member users remain restricted to their own member_id', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/transactions', app.memberToken);
  assert.equal(status, 200);
  for (const t of body.transactions) {
    assert.equal(t.member_id, app.alphaMember.id);
  }
  // member_name is not attached for non-admin callers, unchanged from before Phase 4A.
  const found = body.transactions.find((t) => t.id === alphaTx.id);
  assert.equal(found.member_name, undefined);
});

test('19. admin member_id filtering remains unchanged', async () => {
  const { status, body } = await getJson(app.baseUrl, `/api/transactions?member_id=${app.alphaMember.id}`, app.adminToken);
  assert.equal(status, 200);
  assert.ok(body.transactions.every((t) => t.member_id === app.alphaMember.id));
});

test('20, 21, 22 & 23. POST /api/transactions writes only tenant_alpha, allocates from tenant_alpha\'s counter, and leaves the default DB/counter untouched', async () => {
  const defaultTxCountBefore = await app.defaultModels.Transaction.countDocuments();
  const defaultCounterBefore = await app.defaultModels.Counter.findById('transaction_id').lean();

  const { status, body: created } = await postJson(
    app.baseUrl,
    '/api/transactions',
    { member_id: app.alphaMember.id, amount: 12345, type: 'fine_payment', description: 'phase4a test' },
    app.adminToken
  );
  assert.equal(status, 201);
  assert.ok(created.id < app.DEFAULT_DB_COUNTER_POISON, `expected a small tenant_alpha id, got ${created.id}`);

  const inAlpha = await app.alpha.Transaction.findOne({ id: created.id }).lean();
  assert.ok(inAlpha);
  const inDefault = await app.defaultModels.Transaction.findOne({ description: 'phase4a test' }).lean();
  assert.equal(inDefault, null);

  const defaultTxCountAfter = await app.defaultModels.Transaction.countDocuments();
  assert.equal(defaultTxCountAfter, defaultTxCountBefore);

  const defaultCounterAfter = await app.defaultModels.Counter.findById('transaction_id').lean();
  assert.equal(defaultCounterAfter.seq, defaultCounterBefore.seq);
});

test('24. org_beta remained untouched throughout this suite', async () => {
  assert.equal(await app.beta.Transaction.countDocuments(), 0);
});
