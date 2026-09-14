// Phase 4C isolation proof for GET /api/contributions/bulk-payment-preview
// and POST /api/contributions/bulk-payment — both handled live by
// contributionsHotfix.js's computeBulkAllocation() (mounted before
// contributions.js). Also covers the partial-fine safety guarantee.
//
// app.alphaBulkMember has NO existing contributions and one pre-existing
// unpaid fine (5000) plus an active loan (principal 200000). Because
// isContributionLate() is deprecated (always returns false — see
// services/contributionFinePolicy.js), bulk allocation NEVER generates a
// new fine from a contribution period; it only ever pays EXISTING unpaid
// fines. This is documented pre-existing behavior, not something this
// migration changed.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4cTestApp, stopPhase4cTestApp } = require('./helpers/phase4cTestApp');
const { getJson, postJson } = require('./helpers/httpJson');

let app;

before(async () => {
  app = await startPhase4cTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopPhase4cTestApp();
});

test('bulk preview isolation: GET /bulk-payment-preview computes exclusively from tenant_alpha and performs no writes', async () => {
  const beforeCounts = {
    contribution: await app.alpha.Contribution.countDocuments(),
    fine: await app.alpha.Fine.countDocuments(),
    transaction: await app.alpha.Transaction.countDocuments(),
    repayment: await app.alpha.Repayment.countDocuments(),
    defaultContribution: await app.defaultModels.Contribution.countDocuments(),
    defaultFine: await app.defaultModels.Fine.countDocuments(),
    defaultTransaction: await app.defaultModels.Transaction.countDocuments(),
    defaultRepayment: await app.defaultModels.Repayment.countDocuments(),
  };

  const { status, body } = await getJson(
    app.baseUrl,
    `/api/contributions/bulk-payment-preview?member_id=${app.alphaBulkMember.id}&total_amount=100000&paid_date=${app.CURRENT_FY}-09-01`,
    app.adminToken
  );
  assert.equal(status, 200);
  assert.equal(body.member_name, 'Tenant Alpha Bulk Member');

  // The obligation amount must reflect alpha's own FY rules (75000), never
  // the default DB's sentinel FY2026 override (contribution_amount: 1).
  assert.ok(body.contributions.length >= 1);
  assert.equal(body.contributions[0].amount, 75000, 'contribution obligation must come from tenant_alpha\'s own FyRules');
  assert.notEqual(body.contributions[0].amount, 1, 'default DB sentinel contribution_amount must not influence the allocation');

  // The active loan's outstanding balance must be alpha's own loan
  // (200000), never the default DB's sentinel loan (50,000,000 principal).
  assert.equal(body.summary.active_loan_outstanding, 200000);
  assert.notEqual(body.summary.active_loan_outstanding, 50000000);

  // The existing unpaid fine queued must be alpha's own (5000), never the
  // default DB's sentinel fines (8888888 / 7777777).
  assert.equal(body.summary.existing_unpaid_fines, 5000);

  // No writes occurred anywhere.
  assert.equal(await app.alpha.Contribution.countDocuments(), beforeCounts.contribution);
  assert.equal(await app.alpha.Fine.countDocuments(), beforeCounts.fine);
  assert.equal(await app.alpha.Transaction.countDocuments(), beforeCounts.transaction);
  assert.equal(await app.alpha.Repayment.countDocuments(), beforeCounts.repayment);
  assert.equal(await app.defaultModels.Contribution.countDocuments(), beforeCounts.defaultContribution);
  assert.equal(await app.defaultModels.Fine.countDocuments(), beforeCounts.defaultFine);
  assert.equal(await app.defaultModels.Transaction.countDocuments(), beforeCounts.defaultTransaction);
  assert.equal(await app.defaultModels.Repayment.countDocuments(), beforeCounts.defaultRepayment);
});

test('bulk write isolation: POST /bulk-payment writes contribution + fine-payment + loan-repayment only to tenant_alpha, IDs from alpha counters, default DB and beta untouched', async () => {
  const defaultCounters = {
    contribution_id: (await app.defaultModels.Counter.findById('contribution_id').lean()).seq,
    fine_id: (await app.defaultModels.Counter.findById('fine_id').lean()).seq,
    transaction_id: (await app.defaultModels.Counter.findById('transaction_id').lean()).seq,
    repayment_id: (await app.defaultModels.Counter.findById('repayment_id').lean()).seq,
  };
  const defaultCounts = {
    contribution: await app.defaultModels.Contribution.countDocuments(),
    fine: await app.defaultModels.Fine.countDocuments(),
    transaction: await app.defaultModels.Transaction.countDocuments(),
    repayment: await app.defaultModels.Repayment.countDocuments(),
  };

  // total_amount exercises: 1 full contribution (75000) + 1 existing fine
  // payment in full (5000) + a loan-repayment remainder (20000).
  const { status, body } = await postJson(app.baseUrl, '/api/contributions/bulk-payment', {
    member_id: app.alphaBulkMember.id,
    total_amount: 100000,
    paid_date: `${app.CURRENT_FY}-09-01`,
  }, app.adminToken);
  assert.equal(status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.allocation.blocked_by_partial_fine, false);

  // Contribution: alpha-only, correct amount, ID from alpha's counter.
  assert.equal(body.created.contributions.length, 1);
  const createdContribution = body.created.contributions[0];
  assert.equal(createdContribution.amount, 75000);
  assert.ok(createdContribution.id < app.DEFAULT_DB_COUNTER_POISON);
  const inAlphaContribution = await app.alpha.Contribution.findOne({ id: createdContribution.id }).lean();
  assert.ok(inAlphaContribution);

  // Fine: existing alpha fine marked paid, ID unchanged, alpha-only.
  assert.equal(body.created.fines_paid.length, 1);
  assert.equal(body.created.fines_paid[0].fine_id, app.alphaBulkExistingFine.id);
  assert.equal(body.created.fines_paid[0].amount_applied, 5000);
  const alphaFineAfter = await app.alpha.Fine.findOne({ id: app.alphaBulkExistingFine.id }).lean();
  assert.equal(alphaFineAfter.status, 'paid');

  // Loan repayment: alpha-only, correct amount, ID from alpha's counter.
  assert.ok(body.created.loan_repayment);
  assert.equal(body.created.loan_repayment.loan_id, app.alphaBulkLoan.id);
  assert.equal(body.created.loan_repayment.amount, 20000);
  assert.ok(body.created.loan_repayment.id < app.DEFAULT_DB_COUNTER_POISON);
  const inAlphaRepayment = await app.alpha.Repayment.findOne({ id: body.created.loan_repayment.id }).lean();
  assert.ok(inAlphaRepayment);

  // Transactions: at least 3 alpha transactions created (contribution,
  // fine_payment, loan_repayment), all with alpha-range IDs.
  const alphaTxForMember = await app.alpha.Transaction.find({ member_id: app.alphaBulkMember.id }).lean();
  assert.ok(alphaTxForMember.length >= 3);
  for (const tx of alphaTxForMember) {
    assert.ok(tx.id < app.DEFAULT_DB_COUNTER_POISON);
  }
  assert.ok(alphaTxForMember.some((tx) => tx.type === 'contribution'));
  assert.ok(alphaTxForMember.some((tx) => tx.type === 'fine_payment'));
  assert.ok(alphaTxForMember.some((tx) => tx.type === 'loan_repayment'));

  // Default DB: completely untouched, both collections and counters.
  assert.equal(await app.defaultModels.Contribution.countDocuments(), defaultCounts.contribution);
  assert.equal(await app.defaultModels.Fine.countDocuments(), defaultCounts.fine);
  assert.equal(await app.defaultModels.Transaction.countDocuments(), defaultCounts.transaction);
  assert.equal(await app.defaultModels.Repayment.countDocuments(), defaultCounts.repayment);
  assert.equal((await app.defaultModels.Counter.findById('contribution_id').lean()).seq, defaultCounters.contribution_id);
  assert.equal((await app.defaultModels.Counter.findById('fine_id').lean()).seq, defaultCounters.fine_id);
  assert.equal((await app.defaultModels.Counter.findById('transaction_id').lean()).seq, defaultCounters.transaction_id);
  assert.equal((await app.defaultModels.Counter.findById('repayment_id').lean()).seq, defaultCounters.repayment_id);

  const defaultSentinelFineAfter = await app.defaultModels.Fine.findOne({ id: app.sentinelUnpaidFine.id }).lean();
  assert.equal(defaultSentinelFineAfter.status, 'unpaid', 'default DB sentinel fine must remain unpaid and untouched');

  // tenant_beta untouched.
  assert.equal(await app.beta.Contribution.countDocuments(), app.betaCountsBefore.contribution);
  assert.equal(await app.beta.Fine.countDocuments(), app.betaCountsBefore.fine);
  assert.equal(await app.beta.Transaction.countDocuments(), app.betaCountsBefore.transaction);
  assert.equal(await app.beta.Repayment.countDocuments(), app.betaCountsBefore.repayment);
});

test('partial-fine safety: a remainder smaller than the queued fine blocks payment, leaves the fine unpaid, and skips downstream loan/partial-contribution allocation', async () => {
  // total_amount (5000) is deliberately smaller than both a full
  // contribution period (75000) and the member's only fine (10000):
  // no month is ever consumed regardless of "today"'s date, and the fine
  // cannot be paid in full.
  const { status, body } = await getJson(
    app.baseUrl,
    `/api/contributions/bulk-payment-preview?member_id=${app.alphaPartialFineMember.id}&total_amount=5000&paid_date=${app.CURRENT_FY}-09-01`,
    app.adminToken
  );
  assert.equal(status, 200);
  assert.equal(body.blocked_by_partial_fine, true);
  assert.equal(body.contributions.length, 0);
  assert.equal(body.fines_paid.length, 0, 'the fine must NOT be marked as (even partially) paid');
  assert.equal(body.loan_repayment, null, 'no loan repayment should be attempted once blocked by a partial fine');
  assert.equal(body.partial_contribution, null, 'no partial contribution should be attempted once blocked by a partial fine');
  assert.equal(body.unallocated_remainder, 5000, 'the full remainder must be reported as unallocated, not silently consumed');

  // Confirm the underlying fine record itself is untouched (preview made no writes).
  const fineAfter = await app.alpha.Fine.findOne({ id: app.alphaPartialFineExistingFine.id }).lean();
  assert.equal(fineAfter.status, 'unpaid');
  assert.equal(fineAfter.amount, 10000, 'no partial-fine balance was recorded — the schema has no such field, and none should be invented');
});
