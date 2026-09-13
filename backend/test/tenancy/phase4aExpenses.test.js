// Phase 4A isolation proof for the migrated /api/expenses routes.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4aTestApp, stopPhase4aTestApp } = require('./helpers/phase4aTestApp');
const { getJson, postJson, patchJson, deleteJson } = require('./helpers/httpJson');

let app;
let alphaExpense;

before(async () => {
  app = await startPhase4aTestApp();
  alphaExpense = await app.alpha.Expense.create({
    id: await app.alpha.getNextId('expense_id'),
    category: 'Admin',
    description: 'Tenant Alpha existing expense',
    amount: 40000,
    expense_date: '2026-06-01',
    fiscal_year: 2026,
  });
}, { timeout: 60000 });

after(async () => {
  await stopPhase4aTestApp();
});

test('25 & 26. GET /api/expenses reads only tenant_alpha; the default DB sentinel is invisible', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/expenses', app.adminToken);
  assert.equal(status, 200);
  const descriptions = body.map((e) => e.description);
  assert.ok(descriptions.includes('Tenant Alpha existing expense'));
  assert.ok(!descriptions.includes('DEFAULT DATABASE SENTINEL EXPENSE'), 'default DB sentinel expense must not appear');
});

test('27. GET /categories is unchanged (tenant-independent, static list)', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/expenses/categories', app.adminToken);
  assert.equal(status, 200);
  assert.deepEqual(body, ['AGM', 'Registration', 'Admin', 'Supplies', 'Loan Override', 'Welfare', 'Other']);
});

test('28 & 29. POST /api/expenses creates only in tenant_alpha, with expense_id from tenant_alpha\'s own counter', async () => {
  const defaultExpenseCountBefore = await app.defaultModels.Expense.countDocuments();

  const { status, body: created } = await postJson(
    app.baseUrl,
    '/api/expenses',
    { category: 'Supplies', description: 'phase4a test expense', amount: 5000, expense_date: '2026-06-15' },
    app.adminToken
  );
  assert.equal(status, 201);
  assert.ok(created.id < app.DEFAULT_DB_COUNTER_POISON, `expected a small tenant_alpha id, got ${created.id}`);

  const inAlpha = await app.alpha.Expense.findOne({ id: created.id }).lean();
  assert.ok(inAlpha);
  const inDefault = await app.defaultModels.Expense.findOne({ description: 'phase4a test expense' }).lean();
  assert.equal(inDefault, null);

  const defaultExpenseCountAfter = await app.defaultModels.Expense.countDocuments();
  assert.equal(defaultExpenseCountAfter, defaultExpenseCountBefore);
});

test('30 & 32. PATCH /api/expenses/:id modifies only tenant_alpha, leaving an identically-numbered default-DB expense untouched', async () => {
  // Confirm the collision this test is designed to catch: tenant_alpha's
  // existing expense and the default DB's sentinel expense are both the
  // first expense created in their own fresh, isolated counter space.
  assert.equal(alphaExpense.id, app.sentinelExpense.id);

  const defaultExpenseBefore = await app.defaultModels.Expense.findOne({ id: app.sentinelExpense.id }).lean();

  const { status, body } = await patchJson(
    app.baseUrl,
    `/api/expenses/${alphaExpense.id}`,
    { description: 'Tenant Alpha updated expense' },
    app.adminToken
  );
  assert.equal(status, 200);
  assert.equal(body.description, 'Tenant Alpha updated expense');

  const alphaAfter = await app.alpha.Expense.findOne({ id: alphaExpense.id }).lean();
  assert.equal(alphaAfter.description, 'Tenant Alpha updated expense');

  const defaultExpenseAfter = await app.defaultModels.Expense.findOne({ id: app.sentinelExpense.id }).lean();
  assert.equal(defaultExpenseAfter.description, defaultExpenseBefore.description);
});

test('31. DELETE /api/expenses/:id deletes only from tenant_alpha', async () => {
  const disposable = await app.alpha.Expense.create({
    id: await app.alpha.getNextId('expense_id'),
    category: 'Other',
    description: 'to be deleted',
    amount: 100,
    expense_date: '2026-06-20',
    fiscal_year: 2026,
  });
  const defaultExpenseCountBefore = await app.defaultModels.Expense.countDocuments();

  const { status } = await deleteJson(app.baseUrl, `/api/expenses/${disposable.id}`, app.adminToken);
  assert.equal(status, 200);

  const stillInAlpha = await app.alpha.Expense.findOne({ id: disposable.id }).lean();
  assert.equal(stillInAlpha, null);

  // The default DB's sentinel expense (and its total count) are unaffected.
  const defaultSentinelAfter = await app.defaultModels.Expense.findOne({ id: app.sentinelExpense.id }).lean();
  assert.ok(defaultSentinelAfter);
  const defaultExpenseCountAfter = await app.defaultModels.Expense.countDocuments();
  assert.equal(defaultExpenseCountAfter, defaultExpenseCountBefore);
});

test('33. org_beta remained untouched throughout this suite', async () => {
  assert.equal(await app.beta.Expense.countDocuments(), 0);
});
