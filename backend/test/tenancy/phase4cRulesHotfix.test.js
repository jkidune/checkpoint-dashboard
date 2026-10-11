// Phase 4C isolation proof for the migrated rulesHotfix.js scan-fines and
// recalculate-fines handlers — the LIVE production path for
// POST /api/rules/:fy/scan-fines and POST /api/rules/:fy/recalculate-fines
// (mounted before routes/rules.js in server.js).
//
// The fixture (helpers/phase4cTestApp.js) pre-fills every FY_MONTHS period
// with a full, on-time, paid contribution for tenant_alpha's scan member
// EXCEPT month 3 (left genuinely missing — the one fine scan-fines must
// generate) and month 4 (also missing, but pre-fined to prove duplicate
// suppression). This makes the scan's output deterministic regardless of
// which day the suite happens to run, since isContributionLate() in
// services/contributionFinePolicy.js always returns false — paid
// contributions can never trigger a fine, only genuinely missing months can.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4cTestApp, stopPhase4cTestApp } = require('./helpers/phase4cTestApp');
const { postJson } = require('./helpers/httpJson');

let app;

before(async () => {
  app = await startPhase4cTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopPhase4cTestApp();
});

test('10, 11, 12 & 13. POST /api/rules/:fy/scan-fines is handled by rulesHotfix and reads/writes tenant_alpha only, with fine_id from tenant_alpha\'s own counter', async () => {
  const defaultFineCountBefore = await app.defaultModels.Fine.countDocuments();
  const defaultCounterBefore = await app.defaultModels.Counter.findById('fine_id').lean();

  const { status, body } = await postJson(app.baseUrl, `/api/rules/${app.CURRENT_FY}/scan-fines`, {}, app.adminToken);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  // Only month 3 is genuinely missing-and-unfined; month 4 is suppressed by
  // the pre-existing fine (see test 15).
  assert.equal(body.generated, 1, `expected exactly 1 generated fine, got ${JSON.stringify(body.details)}`);
  assert.equal(body.details[0].member_id, app.alphaScanMember.id);
  assert.equal(body.details[0].month, 3);
  assert.equal(body.policy, 'one_fine_per_contribution_month');

  const created = await app.alpha.Fine.findOne({ member_id: app.alphaScanMember.id, contribution_month: 3 }).lean();
  assert.ok(created, 'the generated fine must exist in tenant_alpha');
  assert.ok(created.id < app.DEFAULT_DB_COUNTER_POISON, `expected a small tenant_alpha fine id, got ${created.id}`);

  // 14: default DB Fine collection and its counter are untouched.
  const defaultFineCountAfter = await app.defaultModels.Fine.countDocuments();
  assert.equal(defaultFineCountAfter, defaultFineCountBefore);
  const defaultCounterAfter = await app.defaultModels.Counter.findById('fine_id').lean();
  assert.equal(defaultCounterAfter.seq, defaultCounterBefore.seq);
});

test('15. an existing tenant-alpha fine (month 4) prevented duplicate assessment', async () => {
  const month4Fines = await app.alpha.Fine.find({ member_id: app.alphaScanMember.id, contribution_month: 4 }).lean();
  assert.equal(month4Fines.length, 1, 'only the original pre-seeded month-4 fine should exist — no duplicate');
  assert.equal(month4Fines[0].id, app.alphaExistingScanFine.id);
});

test('16. tenant_beta remained untouched by the scan', async () => {
  assert.equal(await app.beta.Fine.countDocuments(), app.betaCountsBefore.fine);
});

test('17, 18 & 19. POST /api/rules/:fy/recalculate-fines corrects only alpha\'s unpaid auto-fine, leaves alpha\'s paid fine and the default DB untouched', async () => {
  const defaultFineCountBefore = await app.defaultModels.Fine.countDocuments();
  const defaultUnpaidSentinelBefore = await app.defaultModels.Fine.findOne({ id: app.sentinelUnpaidFine.id }).lean();
  const defaultPaidSentinelBefore = await app.defaultModels.Fine.findOne({ id: app.sentinelPaidFine.id }).lean();

  const { status, body } = await postJson(app.baseUrl, `/api/rules/${app.CURRENT_FY}/recalculate-fines`, {}, app.adminToken);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.policy, 'one_fine_per_contribution_month');
  // The unpaid "Late contribution 5/..." fine must have been corrected.
  assert.ok(body.updated >= 1, `expected at least 1 corrected fine, got ${body.updated}`);

  const correctedAfter = await app.alpha.Fine.findOne({ id: app.alphaUnpaidAutoFineToCorrect.id }).lean();
  assert.notEqual(correctedAfter.amount, 1, 'the stale amount-of-1 must have been corrected');

  // 18: the paid historical fine (month 6) is immutable and must be byte-for-byte unchanged.
  const paidAfter = await app.alpha.Fine.findOne({ id: app.alphaPaidAutoFine.id }).lean();
  assert.equal(paidAfter.amount, app.alphaPaidAutoFine.amount);
  assert.equal(paidAfter.reason, app.alphaPaidAutoFine.reason);
  assert.equal(paidAfter.status, 'paid');

  // 19: the default DB's paid/unpaid sentinel fines are completely untouched,
  // and no new fines were written to the default DB.
  const defaultUnpaidSentinelAfter = await app.defaultModels.Fine.findOne({ id: app.sentinelUnpaidFine.id }).lean();
  assert.equal(defaultUnpaidSentinelAfter.amount, defaultUnpaidSentinelBefore.amount);
  const defaultPaidSentinelAfter = await app.defaultModels.Fine.findOne({ id: app.sentinelPaidFine.id }).lean();
  assert.equal(defaultPaidSentinelAfter.amount, defaultPaidSentinelBefore.amount);
  const defaultFineCountAfter = await app.defaultModels.Fine.countDocuments();
  assert.equal(defaultFineCountAfter, defaultFineCountBefore);
});

test('20. tenant_beta remained untouched by recalculate-fines', async () => {
  assert.equal(await app.beta.Fine.countDocuments(), app.betaCountsBefore.fine);
});

test('known pre-existing policy inconsistency (documented, not fixed): recalculate-fines\' own scan (buildFineCandidates) generates "Missing contribution ..." fines, but its existingAutoFines correction query only matches "Late contribution ..." — so a hotfix-generated fine is never found/corrected by its own recalculate pass', async () => {
  // This is exactly what happened to the fine scan-fines generated for
  // month 3 in this suite: its reason starts with "Missing contribution",
  // so recalculate-fines could not have corrected it even if its amount
  // were stale. This is a pre-existing inconsistency between the
  // scan/recalculate reason-text conventions — not introduced, and not
  // fixed, by this migration. See docs/tenant-route-migration.md.
  const month3Fine = await app.alpha.Fine.findOne({ member_id: app.alphaScanMember.id, contribution_month: 3 }).lean();
  assert.match(month3Fine.reason, /^Missing contribution/);
});
