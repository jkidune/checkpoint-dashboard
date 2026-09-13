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
let getRulesForFY;

before(async () => {
  app = await startPhase4bTestApp();
  // Required only after startPhase4bTestApp() has set process.env.JWT_SECRET
  // — services/memberLoanEligibility.js and routes/rules.js both pull in
  // middleware/auth.js, which throws at module load if JWT_SECRET is unset
  // (Phase 3's fail-closed hardening).
  ({ computeMemberLoanEligibility, computeMemberLoanEligibilityWithModels } = require('../../services/memberLoanEligibility'));
  ({ getRulesForFY } = require('../../routes/rules'));
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

  // tenant_alpha's known values. total_loan_interest = 5000 (explicitly
  // disbursed:true) + 7000 (historical, no `disbursed` field at all) —
  // pending/cancelled/disbursed:false loans are all excluded (see test 8).
  assert.equal(body.fiscal_year, app.FISCAL_YEAR);
  assert.equal(body.total_contributions, 75000);
  assert.equal(body.total_loan_interest, 12000, 'the realized loan\'s and the historical no-disbursed-field loan\'s interest should both count');
  assert.equal(body.paid_fines, 3500, 'only the paid fine should count');
  assert.equal(body.net_worth, 75000 + 12000 + 3500);
  assert.equal(body.max_eligible, Math.round((75000 + 12000 + 3500) * 0.65));

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

test('8. loan realization semantics unchanged across all four cases: explicit disbursed:true counts, historical no-disbursed-field counts, pending excluded, cancelled excluded, explicit disbursed:false excluded', async () => {
  const result = await computeMemberLoanEligibilityWithModels(app.alpha, app.alphaMember.id, app.FISCAL_YEAR);
  // Alpha has 5 loans total:
  //   1. status active,    disbursed: true          -> realized (interest 5000)
  //   2. status pending                              -> excluded
  //   3. status cancelled                             -> excluded
  //   4. status active,    disbursed: false           -> excluded
  //   5. status active,    NO disbursed field at all  -> realized (interest 7000, historical record)
  assert.equal(result.total_loan_interest, 5000 + 7000);
  assert.equal(result.realized_loan_count, 2);
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

// ── routes/rules.js's existing getRulesForFY(fy) compatibility API ────────
// Phase 4B relocated its DEFAULTS/merge implementation into
// services/fyRules.js, but getRulesForFY(fy) itself — the function
// contributions.js, loans.js, rulesHotfix.js, and loanApprovalAssessment.js
// all still call — must behave exactly as before. These tests exercise the
// real function directly (not via HTTP), against the same disposable
// default DB the rest of this suite already set up.

test('14. getRulesForFY(fy): a default-bound DB override still wins for the fields it supplies', async () => {
  // The default DB's FY2026 sentinel record (created by the test fixture)
  // is exactly a "DB override" from getRulesForFY's point of view.
  const rules = await getRulesForFY(app.FISCAL_YEAR);
  assert.equal(rules.fiscal_year, app.FISCAL_YEAR);
  assert.equal(rules.loan_max_ratio, 9.0);
  assert.equal(rules.loan_interest_rate, 0.99);
  assert.equal(rules.loan_repayment_months, 1);
  assert.equal(rules.contribution_amount, 1);
  // late_fine_enabled: false was set explicitly in the DB record,
  // overriding DEFAULTS[2026]'s late_fine_enabled: true.
  assert.equal(rules.late_fine_enabled, false);
});

test('15. getRulesForFY(fy): falls back to the existing DEFAULTS[2026] contract when no DB record exists for the requested FY', async () => {
  // FY2099 has no DEFAULTS entry and no DB record in the default DB.
  const rules = await getRulesForFY(2099);
  assert.equal(rules.fiscal_year, 2099);
  assert.equal(rules.contribution_amount, 75000);
  assert.equal(rules.loan_interest_rate, 0.12);
  assert.equal(rules.loan_max_ratio, 0.80);
  assert.equal(rules.loan_repayment_months, 6);
  assert.equal(rules.entry_fee, 500000);
});

test('16. getRulesForFY(fy): defaults are spread first, then a partial DB record overrides only the fields it supplies', async () => {
  // Raw driver insert (bypassing the schema, so no schema defaults are
  // filled in) simulating a legacy FyRules record that only ever set
  // loan_max_ratio — exactly the "DB records saved before newer fields
  // existed" scenario the merge order exists to handle.
  await app.defaultModels.FyRules.collection.insertOne({
    fiscal_year: 2025,
    loan_max_ratio: 0.33,
  });

  const rules = await getRulesForFY(2025);
  // The DB value wins where supplied...
  assert.equal(rules.loan_max_ratio, 0.33);
  // ...and DEFAULTS[2025] fills in everything the partial DB record omits.
  assert.equal(rules.contribution_amount, 75000);
  assert.equal(rules.late_fine_enabled, true);
  assert.equal(rules.loan_interest_rate, 0.05);
  assert.equal(rules.entry_fee, 500000);
});
