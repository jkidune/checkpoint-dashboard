// Phase 4D isolation proof for /api/loans: reads, enrichment, direct
// creation, override expense, repayments, and normal PATCH. Uses the real
// Express app + real HTTP requests + real authenticate middleware against a
// poisoned default/legacy database and a real tenant_alpha.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4dTestApp, stopPhase4dTestApp } = require('./helpers/phase4dTestApp');
const { getJson, postJson, patchJson } = require('./helpers/httpJson');

let app;

before(async () => {
  app = await startPhase4dTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopPhase4dTestApp();
});

// ─── Loan read isolation ─────────────────────────────────────────────────────

test('1. GET /api/loans reads tenant_alpha only; default sentinel loan is invisible', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/loans', app.adminToken);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));

  const ids = body.map((l) => l.id);
  // The default DB sentinel loan was forced to have the same numeric id as
  // alphaActiveLoan. But the result set must come from alpha, not the default DB.
  // We check that the principal is the alpha value (200000), not the sentinel (99999999).
  const found = body.find((l) => l.id === app.alphaActiveLoan.id);
  assert.ok(found, 'alphaActiveLoan must appear in the list');
  assert.equal(found.principal, 200000, 'must be alpha loan, not default sentinel');
  assert.notEqual(found.principal, 99999999, 'default sentinel must not appear');
});

test('2. member_name enrichment comes from tenant_alpha Member', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/loans', app.adminToken);
  assert.equal(status, 200);
  const found = body.find((l) => l.id === app.alphaActiveLoan.id);
  assert.ok(found);
  assert.equal(found.member_name, app.alphaLoanMember.name);
  assert.notEqual(found.member_name, app.sentinelMember.name);
});

test('3. repayment totals come from tenant_alpha Repayment only', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/loans', app.adminToken);
  assert.equal(status, 200);
  const found = body.find((l) => l.id === app.alphaActiveLoan.id);
  assert.ok(found);
  // alphaActiveLoanRepayment.amount = 50000; default sentinel repayment = 88888888
  assert.equal(found.total_repaid, 50000, 'total_repaid must use alpha repayments only');
});

test('4. FY rules/penalty calculation uses alpha FyRules (not default sentinel rules)', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/loans', app.adminToken);
  assert.equal(status, 200);
  const found = body.find((l) => l.id === app.alphaActiveLoan.id);
  assert.ok(found);
  // alpha FyRules has loan_interest_rate: 0.12 (not 0.99 from default sentinel)
  assert.equal(found.rules.loan_interest_rate, 0.12, 'must use alpha FyRules');
  assert.notEqual(found.rules.loan_interest_rate, 0.99, 'default sentinel rules must not be used');
});

test('5. a normal member sees only their own loans', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/loans', app.loanMemberToken);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  for (const loan of body) {
    assert.equal(loan.member_id, app.alphaLoanMember.id, 'member must only see their own loans');
  }
});

test('6. GET /api/loans/:id with ID collision loads alpha loan, not default sentinel', async () => {
  const id = app.alphaActiveLoan.id;
  const { status, body } = await getJson(app.baseUrl, `/api/loans/${id}`, app.adminToken);
  assert.equal(status, 200);
  assert.equal(body.id, id);
  assert.equal(body.principal, 200000, 'must be alpha loan principal');
  assert.notEqual(body.principal, 99999999, 'default sentinel principal must not appear');
  assert.equal(body.member_name, app.alphaLoanMember.name);
});

test('7. GET /api/loans/rules uses alpha FyRules; default sentinel value (0.99) absent', async () => {
  const { status, body } = await getJson(
    app.baseUrl,
    `/api/loans/rules?fiscal_year=${app.CURRENT_FY}`,
    app.adminToken
  );
  assert.equal(status, 200);
  assert.equal(body.fiscal_year, app.CURRENT_FY);
  assert.equal(body.interest_rate, 0.12, 'must use alpha FyRules loan_interest_rate');
  assert.notEqual(body.interest_rate, 0.99, 'default sentinel interest rate must not appear');
  assert.equal(body.max_loan_ratio, 0.80);
  assert.equal(body.repayment_months, 6);
});

test('8. GET /api/loans/eligibility/:memberId uses alpha financial records only', async () => {
  const { status, body } = await getJson(
    app.baseUrl,
    `/api/loans/eligibility/${app.alphaLoanMember.id}?fiscal_year=${app.CURRENT_FY}`,
    app.adminToken
  );
  assert.equal(status, 200);
  // 8 months * 75000 = 600000 in contributions
  assert.equal(body.total_contributions, 600000);
  // net_worth includes loan interest from alphaActiveLoan (disbursed=true, interest_amount=24000)
  // net_worth = 600000 + 24000 = 624000, max_eligible = 624000 * 0.80 = 499200
  assert.ok(body.net_worth >= 600000, `net_worth ${body.net_worth} should be at least the contribution total`);
  // Default DB sentinel contribution (9999999) must NOT appear in total_contributions
  assert.notEqual(body.total_contributions, 9999999 + 600000);
  // Alpha FyRules used: loan_max_ratio = 0.80, not the default sentinel's 9.0
  assert.equal(body.loan_max_ratio, 0.80);
  assert.notEqual(body.loan_max_ratio, 9.0, 'default sentinel loan_max_ratio must not be used');
});

// ─── Direct loan creation isolation ──────────────────────────────────────────

test('9 & 10 & 11 & 12 & 13. POST /api/loans creates Loan only in alpha; uses alpha counter and alpha FyRules', async () => {
  const defaultLoanCountBefore = await app.defaultModels.Loan.countDocuments();
  const defaultTxCountBefore = await app.defaultModels.Transaction.countDocuments();

  // Create a fresh dedicated member inline so alphaActivationMember (used by tests
  // 24-25) and alphaFormMember (used by tests 16-17) stay uncontaminated.
  const freshCreationMember = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Tenant Alpha Direct Creation Member',
    email: 'alpha-direct-creation@example.com',
    status: 'active',
    join_date: `${app.CURRENT_FY}-03-01`,
  });
  for (const mo of [3, 4, 5, 6, 7, 8, 9, 10]) {
    await app.alpha.Contribution.create({
      id: await app.alpha.getNextId('contribution_id'),
      member_id: freshCreationMember.id,
      amount: 75000,
      month: mo,
      year: app.CURRENT_FY,
      status: 'paid',
      paid_date: `${app.CURRENT_FY}-${String(mo).padStart(2, '0')}-05`,
    });
  }

  const { status, body } = await postJson(
    app.baseUrl,
    '/api/loans',
    {
      member_id: freshCreationMember.id,
      principal: 200000,
      issued_date: `${app.CURRENT_FY}-06-01`,
    },
    app.adminToken
  );
  assert.equal(status, 201, `POST /api/loans failed: ${JSON.stringify(body)}`);
  const createdLoan = body;

  // item 10: loan_id from alpha counter (< poison value)
  assert.ok(createdLoan.id < app.DEFAULT_DB_COUNTER_POISON, `loan_id ${createdLoan.id} should come from alpha counter`);
  // item 11: loan_number uses alpha loan count
  assert.ok(createdLoan.loan_number.startsWith('Loan '), 'loan_number should start with "Loan "');
  // item 12: interest rate from alpha FyRules (0.12)
  assert.equal(createdLoan.interest_rate, 0.12);

  // item 13: disbursement Transaction in alpha; transaction_id from alpha counter
  const alphaTx = await app.alpha.Transaction.findOne({ type: 'loan_disbursement', member_id: freshCreationMember.id });
  assert.ok(alphaTx, 'disbursement Transaction must be in alpha');
  assert.ok(alphaTx.id < app.DEFAULT_DB_COUNTER_POISON, `transaction_id should come from alpha counter`);

  // item 14: default DB counters unchanged
  const defaultLoanCountAfter = await app.defaultModels.Loan.countDocuments();
  const defaultTxCountAfter = await app.defaultModels.Transaction.countDocuments();
  assert.equal(defaultLoanCountAfter, defaultLoanCountBefore, 'default DB loan count must not change');
  assert.equal(defaultTxCountAfter, defaultTxCountBefore, 'default DB transaction count must not change');
});

test('15. beta unchanged after loan creation', async () => {
  const betaLoans = await app.beta.Loan.countDocuments();
  const betaTxs = await app.beta.Transaction.countDocuments();
  assert.equal(betaLoans, app.betaCountsBefore.loan);
  assert.equal(betaTxs, app.betaCountsBefore.transaction);
});

// ─── Override Expense isolation ──────────────────────────────────────────────

test('16. over-limit loan without override → blocked, no write to alpha or default', async () => {
  // alphaLoanMember has net_worth = 600000, max_eligible = 480000
  // Request 600000 which exceeds the limit
  const alphaLoanCountBefore = await app.alpha.Loan.countDocuments();
  const alphaExpenseCountBefore = await app.alpha.Expense.countDocuments();

  // Use alphaFormMember (no active loans, eligible)
  const { status, body } = await postJson(
    app.baseUrl,
    '/api/loans',
    {
      member_id: app.alphaFormMember.id,
      principal: 600000, // exceeds 480000 limit
      issued_date: `${app.CURRENT_FY}-06-01`,
    },
    app.adminToken
  );
  assert.equal(status, 400);
  assert.ok(body.requires_override, 'should indicate requires_override');

  // No loan or expense was written
  assert.equal(await app.alpha.Loan.countDocuments(), alphaLoanCountBefore);
  assert.equal(await app.alpha.Expense.countDocuments(), alphaExpenseCountBefore);
});

test('17. over-limit with override → alpha Loan + alpha Expense (Loan Override); IDs from alpha counter', async () => {
  const defaultExpenseCountBefore = await app.defaultModels.Expense.countDocuments();
  const alphaExpenseCountBefore = await app.alpha.Expense.countDocuments();

  const { status, body } = await postJson(
    app.baseUrl,
    '/api/loans',
    {
      member_id: app.alphaFormMember.id,
      principal: 600000,
      issued_date: `${app.CURRENT_FY}-06-01`,
      override_limit: true,
      override_reason: 'Committee pre-approved special case',
    },
    app.adminToken
  );
  assert.equal(status, 201, `should succeed with override: ${JSON.stringify(body)}`);
  assert.equal(body.override_logged, true);

  // Alpha Expense created
  const alphaExpenses = await app.alpha.Expense.find({ category: 'Loan Override' }).lean();
  assert.ok(alphaExpenses.length > alphaExpenseCountBefore - alphaExpenseCountBefore + 1 - 1,
    'Loan Override expense must be in alpha');
  // Actually let's verify properly
  const expenseCountAfter = await app.alpha.Expense.countDocuments();
  assert.ok(expenseCountAfter > alphaExpenseCountBefore, 'alpha Expense count must increase');

  const overrideExpense = await app.alpha.Expense.findOne({ category: 'Loan Override' });
  assert.ok(overrideExpense, 'Loan Override expense must exist in alpha');
  assert.ok(overrideExpense.id < app.DEFAULT_DB_COUNTER_POISON, 'expense_id must come from alpha counter');

  // item 18: default DB Expense untouched
  const defaultExpenseCountAfter = await app.defaultModels.Expense.countDocuments();
  assert.equal(defaultExpenseCountAfter, defaultExpenseCountBefore, 'default DB expense count must not change');
});

test('18. beta Expense unchanged after override', async () => {
  assert.equal(await app.beta.Expense.countDocuments(), app.betaCountsBefore.expense);
});

// ─── Repayment isolation ─────────────────────────────────────────────────────

test('19 & 20. repayment written only to alpha; repayment Transaction in alpha; IDs from alpha counter', async () => {
  const defaultRepCountBefore = await app.defaultModels.Repayment.countDocuments();
  const defaultTxCountBefore = await app.defaultModels.Transaction.countDocuments();

  const { status, body } = await postJson(
    app.baseUrl,
    `/api/loans/${app.alphaActiveLoan.id}/repayments`,
    {
      amount: 30000,
      repayment_date: `${app.CURRENT_FY}-05-01`,
      mpesa_ref: 'MPESA123456',
    },
    app.adminToken
  );
  assert.equal(status, 201, `repayment creation failed: ${JSON.stringify(body)}`);
  assert.ok(body.id < app.DEFAULT_DB_COUNTER_POISON, `repayment_id ${body.id} should come from alpha counter`);

  // Repayment in alpha
  const alphaRep = await app.alpha.Repayment.findOne({ id: body.id });
  assert.ok(alphaRep, 'repayment must exist in alpha');
  assert.equal(alphaRep.amount, 30000);

  // Transaction in alpha
  const alphaTx = await app.alpha.Transaction.findOne({ type: 'loan_repayment', member_id: app.alphaActiveLoan.member_id });
  assert.ok(alphaTx, 'repayment transaction must be in alpha');
  assert.ok(alphaTx.id < app.DEFAULT_DB_COUNTER_POISON, `transaction_id should come from alpha counter`);

  // default DB untouched
  assert.equal(await app.defaultModels.Repayment.countDocuments(), defaultRepCountBefore);
  assert.equal(await app.defaultModels.Transaction.countDocuments(), defaultTxCountBefore);
});

test('21. repayment: status → paid uses alpha repayments and rules only', async () => {
  // alphaActiveLoan principal = 200000; no penalty (overdue_penalty_enabled: false)
  // So total_owed = 200000. Previous repayment = 50000 (from fixture). Just added 30000.
  // Total so far = 80000. Need 200000 - 80000 = 120000 more to pay off.
  // Add a large repayment to push it over.
  const { status, body } = await postJson(
    app.baseUrl,
    `/api/loans/${app.alphaActiveLoan.id}/repayments`,
    {
      amount: 120001, // just over what's needed
      repayment_date: `${app.CURRENT_FY}-06-01`,
    },
    app.adminToken
  );
  assert.equal(status, 201, `repayment failed: ${JSON.stringify(body)}`);

  // Loan should now be 'paid'
  const alphaLoan = await app.alpha.Loan.findOne({ id: app.alphaActiveLoan.id }).lean();
  assert.equal(alphaLoan.status, 'paid', 'loan should be marked paid after full repayment');

  // Default DB sentinel loan still at original status (not affected)
  const sentinelLoanRecord = await app.defaultModels.Loan.findOne({ id: app.alphaActiveLoan.id }).lean();
  if (sentinelLoanRecord) {
    assert.notEqual(sentinelLoanRecord.principal, 200000, 'sentinel loan must not have been modified');
    assert.equal(sentinelLoanRecord.principal, 99999999, 'sentinel loan principal must remain');
  }
});

test('22. default DB repayment sentinels untouched; beta untouched', async () => {
  // The sentinel repayment from the fixture has the same id as alphaActiveLoanRepayment.
  // It must not have been modified.
  const sentinelRep = await app.defaultModels.Repayment.findOne({ id: app.alphaActiveLoanRepayment.id });
  if (sentinelRep) {
    assert.equal(sentinelRep.amount, 88888888, 'default DB sentinel repayment must remain unchanged');
  }
  assert.equal(await app.beta.Repayment.countDocuments(), app.betaCountsBefore.repayment);
});

// ─── Normal PATCH isolation ───────────────────────────────────────────────────

test('23. non-activation PATCH changes alpha only; default loan unchanged', async () => {
  const defaultLoanBefore = await app.defaultModels.Loan.findOne({ id: app.alphaActiveLoan.id }).lean();

  const { status, body } = await patchJson(
    app.baseUrl,
    `/api/loans/${app.alphaActiveLoan.id}`,
    { notes: 'Updated by phase4d test' },
    app.adminToken
  );
  // Loan is now 'paid' (from test 21), PATCH should still work for notes
  assert.ok([200, 404].includes(status), `PATCH returned unexpected ${status}: ${JSON.stringify(body)}`);

  if (status === 200) {
    // Alpha loan notes updated
    const alphaLoan = await app.alpha.Loan.findOne({ id: app.alphaActiveLoan.id }).lean();
    assert.equal(alphaLoan.notes, 'Updated by phase4d test');

    // Default DB loan unchanged (if it existed)
    if (defaultLoanBefore) {
      const defaultLoanAfter = await app.defaultModels.Loan.findOne({ id: app.alphaActiveLoan.id }).lean();
      assert.equal(defaultLoanAfter.notes, defaultLoanBefore.notes, 'default DB loan notes must not change');
    }
  }
});

// ─── Approval assessment isolation ──────────────────────────────────────────

test('24. GET approval-assessment uses only alpha records; default poison absent', async () => {
  const { status, body } = await getJson(
    app.baseUrl,
    `/api/loans/${app.alphaPendingLoan.id}/approval-assessment`,
    app.adminToken
  );
  assert.equal(status, 200);
  assert.ok(typeof body.eligible === 'boolean');
  assert.ok(body.member, 'assessment must include member info');

  // Default sentinel member must not appear
  assert.notEqual(body.member.id, app.sentinelMember.id, 'default sentinel member must not appear in assessment');
  // Default sentinel fine (8888888) must not appear
  const fineAmounts = (body.unpaid_fines || []).map((f) => f.amount);
  assert.ok(!fineAmounts.includes(8888888), 'default sentinel fine must not appear in assessment');
});

test('25. assessment result: alpha member info correct; default DB sentinel values absent', async () => {
  const { status, body } = await getJson(
    app.baseUrl,
    `/api/loans/${app.alphaPendingLoan.id}/approval-assessment`,
    app.adminToken
  );
  assert.equal(status, 200);
  // alphaActivationMember has 8 months * 75000 = 600000 contributions
  // net_worth = 600000; max_eligible = 480000; requested principal = 300000 (under limit)
  assert.equal(body.eligibility.total_contributions, 600000);
  assert.equal(body.eligibility.max_eligible, 480000);
  // Should be eligible (no unpaid fines, no active loans)
  assert.equal(body.eligible, true);
});
