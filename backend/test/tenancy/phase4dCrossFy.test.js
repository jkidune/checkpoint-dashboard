// Phase 4D cross-FY fiscal-year rules regression test.
//
// REGRESSION: buildAssessmentResult() previously resolved rules for historical
// loans by falling back to the new loan's FY rules when the loan came from a
// different FY — applying incorrect penalty/repayment settings to it.
//
// PROOF: a member with a FY_OLD active loan whose repayments total exactly the
// principal (balance = 0 under FY_OLD rules) must NOT appear as a blocker when
// a new FY_NEW loan is assessed, even when FY_NEW has overdue_penalty_enabled:
// true (which would inflate that loan's balance if the wrong rules were used).
//
// This test FAILS against the pre-fix head (bfb72f07) and PASSES after the fix.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4dTestApp, stopPhase4dTestApp } = require('./helpers/phase4dTestApp');

// Service imports must happen AFTER before() sets JWT_SECRET, because
// loanApprovalAssessment.js → routes/rules.js → middleware/auth.js throws
// if JWT_SECRET is not set at module-load time.
let assessLoanApprovalWithModels;
let assessLoanApproval;

let app;

before(async () => {
  app = await startPhase4dTestApp();
  // Safe to require now — JWT_SECRET was set by startPhase4dTestApp above.
  ({ assessLoanApprovalWithModels, assessLoanApproval } = require('../../services/loanApprovalAssessment'));
}, { timeout: 60000 });

after(async () => {
  await stopPhase4dTestApp();
});

// ─── Fixture FY constants ─────────────────────────────────────────────────────
// Use years far from CURRENT_FY (2026) to avoid any interference with the
// existing fixtures in the shared in-memory MongoDB.
const FY_OLD = 2020; // FY with no penalty
const FY_NEW = 2021; // FY with penalty enabled — wrong if applied to FY_OLD loan

test('cross-FY-1: tenant-explicit path: FY_OLD loan fully repaid uses FY_OLD rules (no penalty)', async () => {
  // ── Seed alpha with FY_OLD and FY_NEW rules ──────────────────────────────
  // FY_OLD: no overdue penalty, 12-month repayment
  await app.alpha.FyRules.findOneAndDelete({ fiscal_year: FY_OLD }); // clear any stray
  await app.alpha.FyRules.create({
    fiscal_year: FY_OLD,
    contribution_amount: 50000,
    loan_interest_rate: 0.10,
    loan_max_ratio: 1.0,
    loan_repayment_months: 12,
    overdue_penalty_enabled: false,
    overdue_penalty_rate: 0.05,
  });
  // FY_NEW: overdue penalty ENABLED — if applied to FY_OLD loan the balance explodes
  await app.alpha.FyRules.findOneAndDelete({ fiscal_year: FY_NEW }); // clear any stray
  await app.alpha.FyRules.create({
    fiscal_year: FY_NEW,
    contribution_amount: 55000,
    loan_interest_rate: 0.12,
    loan_max_ratio: 0.80,
    loan_repayment_months: 6,
    overdue_penalty_enabled: true,    // ← the key difference
    overdue_penalty_rate: 0.05,       // would inflate FY_OLD loan if applied
  });

  // ── Seed default DB with poison rules for both FYs ───────────────────────
  // Proves that the tenant-explicit path never touches the default DB.
  await app.defaultModels.FyRules.findOneAndDelete({ fiscal_year: FY_OLD });
  await app.defaultModels.FyRules.create({
    fiscal_year: FY_OLD,
    loan_interest_rate: 0.99, // poison — must never appear in alpha results
    overdue_penalty_enabled: true,
    overdue_penalty_rate: 0.99,
    loan_repayment_months: 1,
  });
  await app.defaultModels.FyRules.findOneAndDelete({ fiscal_year: FY_NEW });
  await app.defaultModels.FyRules.create({
    fiscal_year: FY_NEW,
    loan_interest_rate: 0.99, // poison
    overdue_penalty_enabled: true,
    overdue_penalty_rate: 0.99,
    loan_repayment_months: 1,
  });

  // ── Create an alpha member for this test ─────────────────────────────────
  const crossFyMember = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Tenant Alpha Cross-FY Test Member',
    email: 'alpha-cross-fy@example.com',
    status: 'active',
    join_date: `${FY_NEW}-03-01`, // Joined at start of FY_NEW
  });
  // 8 months FY_NEW contributions (needed for max_eligible / contribution clearance)
  for (const mo of [3, 4, 5, 6, 7, 8, 9, 10]) {
    await app.alpha.Contribution.create({
      id: await app.alpha.getNextId('contribution_id'),
      member_id: crossFyMember.id,
      amount: 55000,
      month: mo,
      year: FY_NEW,
      status: 'paid',
      paid_date: `${FY_NEW}-${String(mo).padStart(2, '0')}-05`,
    });
  }

  // ── Create a FY_OLD active loan with repayments that sum exactly to principal ──
  // Principal = 200000; no penalty under FY_OLD rules → total_owed = 200000
  // → balance = max(0, 200000 - 200000) = 0 with FY_OLD rules
  // → balance would be large if FY_NEW penalty rules were applied instead (regression)
  const fyOldLoan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: crossFyMember.id,
    loan_number: 'Loan 1',
    principal: 200000,
    interest_rate: 0.10,
    interest_amount: 20000,
    amount_deposited: 180000,
    issued_date: `${FY_OLD}-06-01`,   // issued in FY_OLD
    due_date: `${FY_OLD}-06-01`,      // already past due (old loan)
    status: 'active',                  // still active in records
    fiscal_year: FY_OLD,
    disbursed: true,
  });

  // Repayments totaling exactly the principal (200000) — fully paid under FY_OLD rules
  await app.alpha.Repayment.create({
    id: await app.alpha.getNextId('repayment_id'),
    loan_id: fyOldLoan.id,
    amount: 100000,
    repayment_date: `${FY_OLD}-09-01`,
  });
  await app.alpha.Repayment.create({
    id: await app.alpha.getNextId('repayment_id'),
    loan_id: fyOldLoan.id,
    amount: 100000,
    repayment_date: `${FY_OLD}-12-01`,
  });

  // ── Assess a new FY_NEW loan for this member ─────────────────────────────
  const result = await assessLoanApprovalWithModels(app.alpha, {
    memberId: crossFyMember.id,
    principal: 200000,
    loanDate: `${FY_NEW}-06-01`,
    fiscalYear: FY_NEW,
    assessmentDate: new Date(`${FY_NEW}-10-01`),
  });

  // ── Assertions ───────────────────────────────────────────────────────────

  // 1. FY_OLD loan must appear with zero balance (fully repaid under FY_OLD rules)
  const fyOldLoanInResult = result.active_loans.find((l) => Number(l.id) === fyOldLoan.id);
  assert.ok(!fyOldLoanInResult || fyOldLoanInResult.balance === 0,
    `FY_OLD loan must have balance 0 (fully repaid), got: ${JSON.stringify(fyOldLoanInResult)}`);

  // 2. No existing_loan_balance blocker — the FY_OLD loan is fully paid under its own rules
  const blockerCodes = (result.blockers || []).map((b) => b.code);
  assert.ok(!blockerCodes.includes('existing_loan_balance'),
    `FY_OLD fully-repaid loan must NOT create an existing_loan_balance blocker. Blockers: ${JSON.stringify(result.blockers)}`);

  // 3. active_loan_balance must be 0 (no carry-over from FY_OLD loan)
  assert.equal(result.active_loan_balance, 0,
    `active_loan_balance must be 0 because FY_OLD loan is fully repaid. Got: ${result.active_loan_balance}`);

  // 4. Poison rate (0.99) from default DB must not appear anywhere in the result
  assert.notEqual(result.loan_calculation?.interest_rate, 0.99,
    'default DB poison interest rate must not appear in tenant-explicit result');
  if (result.eligibility) {
    assert.notEqual(result.eligibility.interest_rate, 0.99,
      'default DB poison rate must not appear in eligibility');
  }
});

test('cross-FY-2: legacy assessLoanApproval path: FY_OLD loan fully repaid uses FY_OLD rules (no penalty)', async () => {
  // This test calls the default-bound assessLoanApproval() function directly against the
  // default/legacy DB — proving that the same cross-FY fix applies to the legacy path.
  // The default DB was given specific FY_OLD / FY_NEW rules (with poison rate 0.99) above;
  // we need distinct, non-poison records for this test.

  // ── Seed default DB with meaningful FY_OLD and FY_NEW rules ──────────────
  // Overwrite the poison we added in test cross-FY-1 with real test-specific values.
  await app.defaultModels.FyRules.findOneAndUpdate(
    { fiscal_year: FY_OLD },
    {
      $set: {
        contribution_amount: 50000,
        loan_interest_rate: 0.10,
        loan_max_ratio: 1.0,
        loan_repayment_months: 12,
        overdue_penalty_enabled: false,   // FY_OLD: no penalty
        overdue_penalty_rate: 0.05,
      }
    },
    { upsert: true }
  );
  await app.defaultModels.FyRules.findOneAndUpdate(
    { fiscal_year: FY_NEW },
    {
      $set: {
        contribution_amount: 55000,
        loan_interest_rate: 0.12,
        loan_max_ratio: 0.80,
        loan_repayment_months: 6,
        overdue_penalty_enabled: true,    // FY_NEW: penalty enabled
        overdue_penalty_rate: 0.05,
      }
    },
    { upsert: true }
  );

  // ── Create a member with a numeric id in the default DB ─────────────────
  // The legacy assessLoanApproval uses Member.findOne({ id: Number(memberId) }), so the
  // member needs a numeric `id`. Use a value above the poison threshold (which only
  // covers IDs generated by the in-test counter, not hand-assigned ones above it).
  const legacyMemberId = app.DEFAULT_DB_COUNTER_POISON + 100; // safe: not from the auto-counter
  await app.defaultModels.Member.create({
    id: legacyMemberId,
    name: 'Default Cross-FY Numeric Member',
    email: 'default-cross-fy-numeric@example.com',
    status: 'active',
    join_date: `${FY_NEW}-03-01`,
  });
  for (const mo of [3, 4, 5, 6, 7, 8, 9, 10]) {
    await app.defaultModels.Contribution.create({
      member_id: legacyMemberId,
      amount: 55000,
      month: mo,
      year: FY_NEW,
      status: 'paid',
      paid_date: `${FY_NEW}-${String(mo).padStart(2, '0')}-05`,
    });
  }
  const legacyLoanId = legacyMemberId + 50; // arbitrary numeric id above poison threshold
  await app.defaultModels.Loan.create({
    id: legacyLoanId,
    member_id: legacyMemberId,
    loan_number: 'Loan 1',
    principal: 200000,
    interest_rate: 0.10,
    interest_amount: 20000,
    amount_deposited: 180000,
    issued_date: `${FY_OLD}-06-01`,
    due_date: `${FY_OLD}-06-01`,
    status: 'active',
    fiscal_year: FY_OLD,
    disbursed: true,
  });
  // loan_id must be numeric (matches Repayment schema)
  await app.defaultModels.Repayment.create({
    loan_id: legacyLoanId,
    amount: 200000,
    repayment_date: `${FY_OLD}-12-01`,
  });

  const result = await assessLoanApproval({
    memberId: legacyMemberId,
    principal: 200000,
    loanDate: `${FY_NEW}-06-01`,
    fiscalYear: FY_NEW,
    assessmentDate: new Date(`${FY_NEW}-10-01`),
  });

  // FY_OLD loan must have zero balance (fully repaid under FY_OLD rules, no penalty)
  const fyOldLoanInResult = result.active_loans.find(
    (l) => l.fiscal_year === FY_OLD || (l.issued_date && String(l.issued_date).includes(String(FY_OLD)))
  );
  assert.ok(!fyOldLoanInResult || fyOldLoanInResult.balance === 0,
    `Legacy path: FY_OLD loan must have balance 0, got: ${JSON.stringify(fyOldLoanInResult)}`);

  // No existing_loan_balance blocker
  const blockerCodes = (result.blockers || []).map((b) => b.code);
  assert.ok(!blockerCodes.includes('existing_loan_balance'),
    `Legacy path: FY_OLD fully-repaid loan must NOT block. Blockers: ${JSON.stringify(result.blockers)}`);

  // active_loan_balance must be 0
  assert.equal(result.active_loan_balance, 0,
    `Legacy path: active_loan_balance must be 0. Got: ${result.active_loan_balance}`);
});

test('cross-FY-3: alpha result contains no default DB poison rate (0.99)', async () => {
  // Verify that the cross-FY test in cross-FY-1 produced no value of 0.99
  // (the default DB poison rate) in any field of the assessment result.
  // This is a belt-and-suspenders check: even if interest_rate/overdue_penalty_rate
  // were somehow sourced from the default DB, we would catch it here.
  const crossFyMember2 = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Tenant Alpha Poison Check Member',
    email: 'alpha-poison-check@example.com',
    status: 'active',
    join_date: `${FY_NEW}-03-01`,
  });
  for (const mo of [3, 4, 5, 6, 7, 8, 9, 10]) {
    await app.alpha.Contribution.create({
      id: await app.alpha.getNextId('contribution_id'),
      member_id: crossFyMember2.id,
      amount: 55000,
      month: mo,
      year: FY_NEW,
      status: 'paid',
      paid_date: `${FY_NEW}-${String(mo).padStart(2, '0')}-05`,
    });
  }

  const result = await assessLoanApprovalWithModels(app.alpha, {
    memberId: crossFyMember2.id,
    principal: 200000,
    loanDate: `${FY_NEW}-06-01`,
    fiscalYear: FY_NEW,
    assessmentDate: new Date(`${FY_NEW}-10-01`),
  });

  // None of these should be 0.99 (the default DB poison rate)
  assert.notEqual(result.loan_calculation?.interest_rate, 0.99,
    'interest_rate must not be default DB poison (0.99)');
  assert.notEqual(result.loan_calculation?.overdue_penalty_rate, 0.99,
    'overdue_penalty_rate must not be default DB poison (0.99)');
  if (result.eligibility) {
    assert.notEqual(result.eligibility.interest_rate, 0.99,
      'eligibility interest_rate must not be default DB poison');
  }
});
