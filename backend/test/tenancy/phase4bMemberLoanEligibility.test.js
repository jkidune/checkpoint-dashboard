// Phase 4B isolation proof for the migrated GET /api/member/loan-eligibility
// route. Uses the real Express app + real HTTP requests through the real
// authenticate middleware — never mocks — against a poisoned default/legacy
// database (financial records AND an FyRules override) and a real
// tenant_alpha, so these tests prove the actual route handler and the
// tenant-explicit service function both read from req.tenantModels, not
// merely that req.tenantModels exists.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4bTestApp, stopPhase4bTestApp } = require('./helpers/phase4bTestApp');
const { getJson } = require('./helpers/httpJson');

let app;
let computeMemberLoanEligibility;
let computeMemberLoanEligibilityWithModels;

before(async () => {
  app = await startPhase4bTestApp();
  // Required only after startPhase4bTestApp() has set process.env.JWT_SECRET
  // — services/memberLoanEligibility.js pulls in routes/rules.js, which
  // pulls in middleware/auth.js, which throws at module load if JWT_SECRET
  // is unset (Phase 3's fail-closed hardening).
  ({ computeMemberLoanEligibility, computeMemberLoanEligibilityWithModels } = require('../../services/memberLoanEligibility'));
}, { timeout: 60000 });

after(async () => {
  await stopPhase4bTestApp();
});

test('1. fixture collision check: default DB sentinel and tenant_alpha member share the same numeric id', () => {
  assert.equal(
    app.sentinelMember.id,
    app.alphaMember.id,
    'fixture must create identical member IDs across default DB and tenant_alpha'
  );
});

test('2, 3 & 4. GET /api/member/loan-eligibility returns ONLY tenant_alpha financial data, never the default DB sentinel', async () => {
  const { status, body } = await getJson(
    app.baseUrl,
    `/api/member/loan-eligibility?fiscal_year=${app.FISCAL_YEAR}`,
    app.memberToken
  );
  assert.equal(status, 200);

  // tenant_alpha's known values.
  assert.equal(body.fiscal_year, app.FISCAL_YEAR);
  assert.equal(body.total_contributions, 75000);
  assert.equal(body.total_loan_interest, 5000, 'only the realized loan\'s interest should count');
  assert.equal(body.paid_fines, 3500, 'only the paid fine should count');
  assert.equal(body.net_worth, 75000 + 5000 + 3500);
  assert.equal(body.max_eligible, Math.round((75000 + 5000 + 3500) * 0.65));

  // None of the default DB's unmistakable sentinel numbers may appear.
  const values = Object.values(body);
  assert.ok(!values.includes(9999999), 'default DB sentinel contribution total must not appear');
  assert.ok(!values.includes(6543210), 'default DB sentinel loan interest must not appear');
  assert.ok(!values.includes(8888888), 'default DB sentinel paid fine must not appear');
});

test('5 & 6. FyRules isolation: loan_max_ratio, interest_rate and repayment_months come from tenant_alpha\'s own FyRules record', async () => {
  const { status, body } = await getJson(
    app.baseUrl,
    `/api/member/loan-eligibility?fiscal_year=${app.FISCAL_YEAR}`,
    app.memberToken
  );
  assert.equal(status, 200);

  // tenant_alpha's FY2026 override — deliberately distinct from both the
  // hardcoded DEFAULTS[2026] (0.80 / 0.12 / 6) and the default DB's
  // sentinel override (9.0 / 0.99 / 1).
  assert.equal(body.loan_max_ratio, 0.65);
  assert.equal(body.interest_rate, 0.09);
  assert.equal(body.repayment_months, 9);
});

test('7. overdue penalty settings are also tenant-bound (checked at the service level, since the route does not surface them in its response)', async () => {
  const alphaResult = await computeMemberLoanEligibilityWithModels(app.alpha, app.alphaMember.id, app.FISCAL_YEAR);
  assert.equal(alphaResult.overdue_penalty_enabled, false);
  assert.equal(alphaResult.overdue_penalty_rate, 0.05);

  const defaultResult = await computeMemberLoanEligibilityWithModels(app.defaultModels, app.sentinelMember.id, app.FISCAL_YEAR);
  assert.equal(defaultResult.overdue_penalty_enabled, false);
  assert.equal(defaultResult.overdue_penalty_rate, 0.01);
  assert.notEqual(alphaResult.overdue_penalty_rate, defaultResult.overdue_penalty_rate);
});

test('8. loan realization semantics unchanged: pending and cancelled loans never contribute interest', async () => {
  const result = await computeMemberLoanEligibilityWithModels(app.alpha, app.alphaMember.id, app.FISCAL_YEAR);
  // Alpha has 3 loans total (1 realized + 1 pending + 1 cancelled) — only
  // the realized one (interest_amount 5000) may count.
  assert.equal(result.total_loan_interest, 5000);
  assert.equal(result.realized_loan_count, 1);
});

test('9. missing member_id still returns 404, unchanged', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/member/loan-eligibility', app.noMemberToken);
  assert.equal(status, 404);
  assert.equal(body.error, 'This account has no linked member record');
});

test('10. tenant_beta remained untouched throughout this suite', async () => {
  assert.equal(await app.beta.Member.countDocuments(), app.betaMemberCountBefore);
  assert.equal(await app.beta.Contribution.countDocuments(), app.betaContributionCountBefore);
  assert.equal(await app.beta.Loan.countDocuments(), app.betaLoanCountBefore);
  assert.equal(await app.beta.Fine.countDocuments(), app.betaFineCountBefore);
  assert.equal(await app.beta.FyRules.countDocuments(), app.betaFyRulesCountBefore);
});

test('11. GET is read-only: no documents were written to the default DB or tenant_alpha', async () => {
  const beforeCounts = {
    defaultMember: await app.defaultModels.Member.countDocuments(),
    defaultContribution: await app.defaultModels.Contribution.countDocuments(),
    defaultLoan: await app.defaultModels.Loan.countDocuments(),
    defaultFine: await app.defaultModels.Fine.countDocuments(),
    defaultFyRules: await app.defaultModels.FyRules.countDocuments(),
    alphaMember: await app.alpha.Member.countDocuments(),
    alphaContribution: await app.alpha.Contribution.countDocuments(),
    alphaLoan: await app.alpha.Loan.countDocuments(),
    alphaFine: await app.alpha.Fine.countDocuments(),
    alphaFyRules: await app.alpha.FyRules.countDocuments(),
  };

  await getJson(app.baseUrl, `/api/member/loan-eligibility?fiscal_year=${app.FISCAL_YEAR}`, app.memberToken);

  assert.equal(await app.defaultModels.Member.countDocuments(), beforeCounts.defaultMember);
  assert.equal(await app.defaultModels.Contribution.countDocuments(), beforeCounts.defaultContribution);
  assert.equal(await app.defaultModels.Loan.countDocuments(), beforeCounts.defaultLoan);
  assert.equal(await app.defaultModels.Fine.countDocuments(), beforeCounts.defaultFine);
  assert.equal(await app.defaultModels.FyRules.countDocuments(), beforeCounts.defaultFyRules);
  assert.equal(await app.alpha.Member.countDocuments(), beforeCounts.alphaMember);
  assert.equal(await app.alpha.Contribution.countDocuments(), beforeCounts.alphaContribution);
  assert.equal(await app.alpha.Loan.countDocuments(), beforeCounts.alphaLoan);
  assert.equal(await app.alpha.Fine.countDocuments(), beforeCounts.alphaFine);
  assert.equal(await app.alpha.FyRules.countDocuments(), beforeCounts.alphaFyRules);
});

test('12. legacy computeMemberLoanEligibility() compatibility wrapper still resolves against the default/legacy connection', async () => {
  const result = await computeMemberLoanEligibility(app.sentinelMember.id, app.FISCAL_YEAR);
  assert.ok(result);
  assert.equal(result.member_id, app.sentinelMember.id);
  // Reflects the DEFAULT DB's sentinel data — proving the legacy wrapper
  // still reads from the default/legacy connection exactly as before.
  assert.equal(result.total_contributions, 9999999);
  assert.equal(result.total_loan_interest, 6543210);
  assert.equal(result.paid_fines, 8888888);
  assert.equal(result.loan_max_ratio, 9.0);
});

test('13. tenant-explicit service function has no default-model fallback: an invalid model bundle throws rather than silently using default models', async () => {
  await assert.rejects(
    () => computeMemberLoanEligibilityWithModels({}, app.alphaMember.id, app.FISCAL_YEAR),
    /Cannot read prop|is not a function|undefined/,
  );
});
