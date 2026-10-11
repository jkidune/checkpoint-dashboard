// Phase 4D isolation proof for /api/loans (loanActivationHotfix.js):
// hotfix mount-precedence, blocked activation, successful activation,
// default-DB transaction poison isolation, and alpha duplicate-transaction
// suppression.

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

// ─── Mount-precedence proof ──────────────────────────────────────────────────

test('26a. hotfix mount-precedence: PATCH pending→active returns approval_assessment in response', async () => {
  // alphaPendingLoan.status === 'pending', body.status === 'active'
  // → loanActivationHotfix.js must intercept before loans.js
  // alphaActivationMember has 8 months contributions, no fines, no active loans → eligible
  const { status, body } = await patchJson(
    app.baseUrl,
    `/api/loans/${app.alphaPendingLoan.id}`,
    { status: 'active' },
    app.adminToken
  );
  // alphaActivationMember is eligible by fixture design — require 200, not optionally 409
  assert.equal(status, 200, `Hotfix activation failed: ${JSON.stringify(body)}`);
  assert.ok(body.approval_assessment, 'hotfix response must include approval_assessment');
  assert.equal(body.approval_assessment.eligible, true,
    `Expected eligible=true but got: ${JSON.stringify(body.approval_assessment.blockers)}`);
  assert.equal(body.status, 'active');
  assert.equal(body.disbursed, true);
  app._pendingLoanActivated = true;
});

test('26b. non-activation PATCH (notes update) falls through to loans.js, no approval_assessment in response', async () => {
  // alphaPendingLoan is now 'active' (from 26a). PATCH it with notes only (no status field).
  // loanActivationHotfix.js only intercepts PATCH when body.status === 'active' for pending loans;
  // it must fall through to loans.js for any other field update.
  const { status, body } = await patchJson(
    app.baseUrl,
    `/api/loans/${app.alphaPendingLoan.id}`,
    { notes: 'non-activation patch test' },
    app.adminToken
  );
  // loans.js handles this; no approval_assessment field
  assert.equal(status, 200, `Non-activation PATCH returned unexpected ${status}: ${JSON.stringify(body)}`);
  assert.ok(!body.approval_assessment, 'non-activation PATCH must not include approval_assessment');
});

// ─── Blocked activation (unpaid fine) ────────────────────────────────────────

test('27. blocked activation: 409, loan remains pending, no alpha disbursement Transaction created', async () => {
  const alphaTxCountBefore = await app.alpha.Transaction.countDocuments();
  const alphaLoanBefore = await app.alpha.Loan.findOne({ id: app.alphaBlockedPendingLoan.id }).lean();
  assert.equal(alphaLoanBefore.status, 'pending');

  const { status, body } = await patchJson(
    app.baseUrl,
    `/api/loans/${app.alphaBlockedPendingLoan.id}`,
    { status: 'active' },
    app.adminToken
  );
  assert.equal(status, 409, `Should be blocked: ${JSON.stringify(body)}`);
  assert.equal(body.approval_blocked, true);
  assert.ok(body.assessment, 'blocked response must include assessment');

  // Loan still pending
  const alphaLoanAfter = await app.alpha.Loan.findOne({ id: app.alphaBlockedPendingLoan.id }).lean();
  assert.equal(alphaLoanAfter.status, 'pending', 'loan must remain pending after blocked activation');

  // No new Transaction created
  const alphaTxCountAfter = await app.alpha.Transaction.countDocuments();
  assert.equal(alphaTxCountAfter, alphaTxCountBefore, 'no new transaction should be created on blocked activation');
});

// ─── Successful activation isolation ──────────────────────────────────────────

test('28. successful activation: loan active+disbursed, one alpha Transaction, default/beta untouched', async () => {
  // Create a fresh member for this test to get a clean pending loan
  const freshMember = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Tenant Alpha Fresh Activation Member',
    email: 'alpha-fresh-activation@example.com',
    status: 'active',
    join_date: `${app.CURRENT_FY}-03-01`,
  });
  for (const mo of [3, 4, 5, 6, 7, 8, 9, 10]) {
    await app.alpha.Contribution.create({
      id: await app.alpha.getNextId('contribution_id'),
      member_id: freshMember.id,
      amount: 75000,
      month: mo,
      year: app.CURRENT_FY,
      status: 'paid',
      paid_date: `${app.CURRENT_FY}-${String(mo).padStart(2, '0')}-05`,
    });
  }
  const freshPendingLoan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: freshMember.id,
    loan_number: 'Loan 1',
    principal: 200000,
    interest_rate: 0.12,
    interest_amount: 24000,
    amount_deposited: 176000,
    issued_date: `${app.CURRENT_FY}-06-01`,
    status: 'pending',
    fiscal_year: app.CURRENT_FY,
    disbursed: false,
  });

  const defaultTxCountBefore = await app.defaultModels.Transaction.countDocuments();
  const defaultLoanBefore = await app.defaultModels.Loan.findOne({ id: freshPendingLoan.id }).lean();

  const { status, body } = await patchJson(
    app.baseUrl,
    `/api/loans/${freshPendingLoan.id}`,
    { status: 'active' },
    app.adminToken
  );
  assert.equal(status, 200, `Activation failed: ${JSON.stringify(body)}`);
  assert.equal(body.status, 'active');
  assert.equal(body.disbursed, true);
  assert.ok(body.approval_assessment, 'must include approval_assessment from hotfix');
  assert.equal(body.approval_assessment.eligible, true);

  // Alpha Transaction created
  const alphaTx = await app.alpha.Transaction.findOne({
    type: 'loan_disbursement',
    member_id: freshMember.id,
  }).lean();
  assert.ok(alphaTx, 'disbursement transaction must be in alpha');
  assert.ok(alphaTx.id < app.DEFAULT_DB_COUNTER_POISON, 'transaction_id must come from alpha counter');

  // Default DB Transaction count unchanged
  const defaultTxCountAfter = await app.defaultModels.Transaction.countDocuments();
  assert.equal(defaultTxCountAfter, defaultTxCountBefore, 'default DB transaction count must not change');

  // Beta untouched
  assert.equal(await app.beta.Loan.countDocuments(), app.betaCountsBefore.loan);
  assert.equal(await app.beta.Transaction.countDocuments(), app.betaCountsBefore.transaction);
});

// ─── Default-DB transaction poison test ─────────────────────────────────────

test('29. default DB has a matching disbursement Transaction; alpha STILL creates its own', async () => {
  // Create fresh member/loan in alpha
  const freshMember2 = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Tenant Alpha Poison Test Member',
    email: 'alpha-poison-test@example.com',
    status: 'active',
    join_date: `${app.CURRENT_FY}-03-01`,
  });
  // Include months 9 and 10 so no contribution_arrears blocker on Oct 11, 2026
  for (const mo of [3, 4, 5, 6, 7, 8, 9, 10]) {
    await app.alpha.Contribution.create({
      id: await app.alpha.getNextId('contribution_id'),
      member_id: freshMember2.id,
      amount: 75000,
      month: mo,
      year: app.CURRENT_FY,
      status: 'paid',
      paid_date: `${app.CURRENT_FY}-${String(mo).padStart(2, '0')}-05`,
    });
  }
  const poisonPendingLoan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: freshMember2.id,
    loan_number: 'Loan 1',
    principal: 150000,
    interest_rate: 0.12,
    interest_amount: 18000,
    amount_deposited: 132000,
    issued_date: `${app.CURRENT_FY}-07-01`,
    status: 'pending',
    fiscal_year: app.CURRENT_FY,
    disbursed: false,
  });

  // Plant a matching disbursement transaction in the DEFAULT DB (the "poison")
  // — loanActivationHotfix.js must NOT see this as a reason to skip creating
  // the alpha transaction.
  await app.defaultModels.Transaction.create({
    member_id: freshMember2.id,
    amount: 132000,
    type: 'loan_disbursement',
    description: `Loan disbursed — ${freshMember2.name} (Loan 1, FY${app.CURRENT_FY})`,
    transaction_date: `${app.CURRENT_FY}-07-01`,
  });

  const alphaTxCountBefore = await app.alpha.Transaction.countDocuments();

  const { status, body } = await patchJson(
    app.baseUrl,
    `/api/loans/${poisonPendingLoan.id}`,
    { status: 'active' },
    app.adminToken
  );
  assert.equal(status, 200, `Activation failed: ${JSON.stringify(body)}`);

  // Alpha STILL created its own Transaction (the default DB one doesn't interfere)
  const alphaTxCountAfter = await app.alpha.Transaction.countDocuments();
  assert.ok(alphaTxCountAfter > alphaTxCountBefore, 'alpha must have created a new disbursement transaction despite default DB poison');

  const alphaTx = await app.alpha.Transaction.findOne({
    type: 'loan_disbursement',
    member_id: freshMember2.id,
  }).lean();
  assert.ok(alphaTx, 'disbursement transaction must exist in alpha');
});

// ─── Alpha duplicate-transaction suppression ─────────────────────────────────

test('30. existing alpha transaction suppresses duplicate disbursement on re-activation attempt', async () => {
  // Create a loan that already has a disbursement transaction in alpha
  const freshMember3 = await app.alpha.Member.create({
    id: await app.alpha.getNextId('member_id'),
    name: 'Tenant Alpha Dup Suppress Member',
    email: 'alpha-dup-suppress@example.com',
    status: 'active',
    join_date: `${app.CURRENT_FY}-03-01`,
  });
  // Include months 9 and 10 so no contribution_arrears blocker on Oct 11, 2026
  for (const mo of [3, 4, 5, 6, 7, 8, 9, 10]) {
    await app.alpha.Contribution.create({
      id: await app.alpha.getNextId('contribution_id'),
      member_id: freshMember3.id,
      amount: 75000,
      month: mo,
      year: app.CURRENT_FY,
      status: 'paid',
      paid_date: `${app.CURRENT_FY}-${String(mo).padStart(2, '0')}-05`,
    });
  }
  const dupPendingLoan = await app.alpha.Loan.create({
    id: await app.alpha.getNextId('loan_id'),
    member_id: freshMember3.id,
    loan_number: 'Loan 1',
    principal: 150000,
    interest_rate: 0.12,
    interest_amount: 18000,
    amount_deposited: 132000,
    issued_date: `${app.CURRENT_FY}-07-01`,
    status: 'pending',
    fiscal_year: app.CURRENT_FY,
    disbursed: false,
  });

  // Pre-plant a disbursement transaction in ALPHA — hotfix should detect this
  // and skip creating a second one.
  await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: freshMember3.id,
    amount: 132000,
    type: 'loan_disbursement',
    description: `Loan disbursed — ${freshMember3.name} (Loan 1, FY${app.CURRENT_FY})`,
    transaction_date: `${app.CURRENT_FY}-07-01`,
  });

  const alphaTxCountBefore = await app.alpha.Transaction.countDocuments();

  const { status } = await patchJson(
    app.baseUrl,
    `/api/loans/${dupPendingLoan.id}`,
    { status: 'active' },
    app.adminToken
  );
  assert.equal(status, 200);

  // No duplicate transaction should have been created
  const alphaTxCountAfter = await app.alpha.Transaction.countDocuments();
  assert.equal(alphaTxCountAfter, alphaTxCountBefore, 'duplicate disbursement transaction must be suppressed');
});
