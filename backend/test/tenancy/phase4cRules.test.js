// Phase 4C isolation proof for the migrated /api/rules routes (GET /,
// GET /:fy, PUT /:fy, DELETE /:fy). Uses the real Express app + real HTTP
// requests through the real authenticate middleware, against a poisoned
// default/legacy database and a real tenant_alpha.
//
// Rules CRUD tests deliberately use arbitrary FYs (2030-2033) that have no
// bearing on the current-date-dependent fine-scan logic exercised by
// phase4cRulesHotfix.test.js, so these tests are pure data-isolation checks.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4cTestApp, stopPhase4cTestApp } = require('./helpers/phase4cTestApp');
const { getJson, putJson, deleteJson } = require('./helpers/httpJson');

let app;
let getRulesForFY;

before(async () => {
  app = await startPhase4cTestApp();
  ({ getRulesForFY } = require('../../routes/rules'));
}, { timeout: 60000 });

after(async () => {
  await stopPhase4cTestApp();
});

test('1 & 2. GET /api/rules reads tenant_alpha FyRules; the default DB sentinel is invisible', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/rules', app.adminToken);
  assert.equal(status, 200);

  const fy2030 = body.find((r) => r.fiscal_year === 2030);
  assert.ok(fy2030);
  assert.equal(fy2030.contribution_amount, 12345);
  assert.equal(fy2030.loan_max_ratio, 0.55);
  assert.equal(fy2030._fromDB, true);

  const fy2026 = body.find((r) => r.fiscal_year === app.CURRENT_FY);
  assert.ok(fy2026);
  assert.equal(fy2026.contribution_amount, 75000, 'FY2026 entry must be alpha\'s own bulk-fixture override');
  assert.equal(fy2026.loan_max_ratio, 0.80);

  // None of the default DB's unmistakable sentinel values may appear anywhere.
  for (const entry of body) {
    assert.notEqual(entry.contribution_amount, 99, 'default DB FY2030 sentinel contribution_amount must not appear');
    assert.notEqual(entry.loan_max_ratio, 9.9, 'default DB FY2030 sentinel loan_max_ratio must not appear');
    assert.notEqual(entry.loan_max_ratio, 9.0, 'default DB FY2026 sentinel loan_max_ratio must not appear');
    assert.notEqual(entry.contribution_amount, 1, 'default DB FY2026 sentinel contribution_amount must not appear');
  }
});

test('3. GET /api/rules/:fy returns tenant_alpha\'s own override', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/rules/2030', app.adminToken);
  assert.equal(status, 200);
  assert.equal(body.fiscal_year, 2030);
  assert.equal(body.contribution_amount, 12345);
  assert.equal(body.late_fine_enabled, true);
  assert.equal(body.loan_interest_rate, 0.11);
  assert.equal(body.loan_max_ratio, 0.55);
  assert.equal(body.loan_repayment_months, 4);
});

test('4. GET /api/rules/:fy falls back to the DEFAULTS[2026] contract when alpha has no override and the FY is unknown', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/rules/2031', app.adminToken);
  assert.equal(status, 200);
  assert.equal(body.fiscal_year, 2031);
  assert.equal(body.contribution_amount, 75000);
  assert.equal(body.loan_interest_rate, 0.12);
  assert.equal(body.loan_max_ratio, 0.80);
  assert.equal(body.loan_repayment_months, 6);
  assert.equal(body.entry_fee, 500000);
});

test('5. PUT /api/rules/:fy writes only tenant_alpha', async () => {
  const { status, body } = await putJson(app.baseUrl, '/api/rules/2032', {
    contribution_amount: 55555,
    late_fine_enabled: true,
    late_fine_type: 'flat',
    late_fine_rate: 0.2,
    late_fine_flat_amount: 4000,
    loan_interest_rate: 0.06,
    loan_max_ratio: 0.5,
    loan_repayment_months: 12,
    overdue_penalty_enabled: true,
    overdue_penalty_rate: 0.07,
    entry_fee: 600000,
  }, app.adminToken);
  assert.equal(status, 200);
  assert.equal(body.contribution_amount, 55555);

  const inAlpha = await app.alpha.FyRules.findOne({ fiscal_year: 2032 }).lean();
  assert.ok(inAlpha);
  assert.equal(inAlpha.contribution_amount, 55555);

  const inDefault = await app.defaultModels.FyRules.findOne({ fiscal_year: 2032 }).lean();
  assert.equal(inDefault, null);

  const inBeta = await app.beta.FyRules.findOne({ fiscal_year: 2032 }).lean();
  assert.equal(inBeta, null);
});

test('6. default DB FyRules records remain unchanged throughout this suite', async () => {
  const fy2026 = await app.defaultModels.FyRules.findOne({ fiscal_year: app.CURRENT_FY }).lean();
  assert.equal(fy2026.contribution_amount, 1);
  assert.equal(fy2026.loan_max_ratio, 9.0);

  const fy2030 = await app.defaultModels.FyRules.findOne({ fiscal_year: 2030 }).lean();
  assert.equal(fy2030.contribution_amount, 99);
  assert.equal(fy2030.loan_max_ratio, 9.9);

  const fy2033 = await app.defaultModels.FyRules.findOne({ fiscal_year: 2033 }).lean();
  assert.ok(fy2033, 'default DB FY2033 sentinel must still exist');
  assert.equal(fy2033.contribution_amount, 88);
});

test('7. tenant_beta remained unaffected by this suite so far', async () => {
  assert.equal(await app.beta.FyRules.countDocuments(), app.betaCountsBefore.fyRules);
});

test('8. DELETE /api/rules/:fy deletes only tenant_alpha\'s override, never the default DB\'s', async () => {
  // Create an alpha-only override at FY2033 first (default DB already has
  // its own, unrelated FY2033 sentinel record from the fixture).
  await putJson(app.baseUrl, '/api/rules/2033', {
    contribution_amount: 40000,
    late_fine_enabled: false,
    late_fine_type: 'percentage',
    late_fine_rate: 0.1,
    late_fine_flat_amount: 3500,
    loan_interest_rate: 0.05,
    loan_max_ratio: null,
    loan_repayment_months: null,
    overdue_penalty_enabled: false,
    overdue_penalty_rate: 0.1,
    entry_fee: 500000,
  }, app.adminToken);
  assert.ok(await app.alpha.FyRules.findOne({ fiscal_year: 2033 }).lean());

  const { status, body } = await deleteJson(app.baseUrl, '/api/rules/2033', app.adminToken);
  assert.equal(status, 200);
  assert.equal(body.ok, true);

  const alphaAfter = await app.alpha.FyRules.findOne({ fiscal_year: 2033 }).lean();
  assert.equal(alphaAfter, null, 'tenant_alpha\'s FY2033 override must be gone');

  const defaultAfter = await app.defaultModels.FyRules.findOne({ fiscal_year: 2033 }).lean();
  assert.ok(defaultAfter, 'default DB\'s unrelated FY2033 sentinel must remain untouched');
  assert.equal(defaultAfter.contribution_amount, 88);
});

test('9. the legacy internal getRulesForFY(fy) compatibility wrapper still reads the default DB, for unmigrated callers', async () => {
  const rules = await getRulesForFY(2030);
  assert.equal(rules.contribution_amount, 99, 'legacy wrapper must resolve the default DB\'s FY2030 sentinel, not tenant_alpha\'s override');
  assert.equal(rules.loan_max_ratio, 9.9);
});
