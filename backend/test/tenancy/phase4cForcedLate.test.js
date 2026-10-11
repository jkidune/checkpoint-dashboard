// Phase 4C forced-late mechanism: closes the two test-hardening gaps left
// open in PR #27.
//
// The forced-late mechanism works by overriding finePolicy.isContributionLate
// to return true BEFORE server.js loads, so that contributionsHotfix.js's
// destructured local isContributionLate() is the overridden function. This
// makes the two hotfix branches (fine-preview and duplicate-fine suppression)
// actually execute, allowing us to assert hotfix-only behavior rather than
// merely observing the no-op path.
//
// IMPORTANT: the override must appear at the TOP level of this file, before
// any require that transitively loads server.js. The before() callback loads
// server.js (via startPhase4cTestApp). By the time before() runs, the
// override is already in place, so contributionsHotfix.js's destructuring:
//
//   const { isContributionLate, ... } = require('../services/contributionFinePolicy')
//
// captures () => true.
//
// Running in a separate process (node --test isolates each file) means this
// override never contaminates other test suites.

// ─── Forced-late mechanism ──────────────────────────────────────────────────
// Require finePolicy FIRST, before server.js is loaded, and pin the override
// onto the module object so contributionsHotfix.js's destructuring sees it.
const finePolicy = require('../../services/contributionFinePolicy');
const _origIsLate = finePolicy.isContributionLate;
finePolicy.isContributionLate = () => true;
// ───────────────────────────────────────────────────────────────────────────

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4cTestApp, stopPhase4cTestApp } = require('./helpers/phase4cTestApp');
const { getJson, postJson } = require('./helpers/httpJson');

let app;

before(async () => {
  // server.js (and contributionsHotfix.js) are loaded for the first time here.
  // finePolicy.isContributionLate is already () => true at this point, so the
  // destructured isContributionLate inside contributionsHotfix.js is () => true.
  app = await startPhase4cTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopPhase4cTestApp();
  // Restore the production function. The process will exit anyway, but this
  // is belt-and-suspenders hygiene.
  finePolicy.isContributionLate = _origIsLate;
});

// ─── GAP 1 — fine-preview hotfix-precedence proof ─────────────────────────
//
// With isContributionLate() forced true and no existing fine for the period,
// contributionsHotfix.js's fine-preview handler must reach the calculateOneTimeFine
// branch and include one_time: true in the response. routes/contributions.js's
// fine-preview handler never includes one_time — only the hotfix version does.
// penalty === 0 alone is NOT sufficient proof (both handlers return it on a
// no-fine path); one_time === true is the definitive hotfix-only witness.
test('GAP 1 — fine-preview returns one_time: true, proving the hotfix handler ran and the late branch was actually entered', async () => {
  // month 10, year CURRENT_FY: no fine exists for alphaContribMember in
  // tenant_alpha for this period (fixture only seeds month 3 for this member).
  // FY = getFiscalYear(10, 2026) = 2026; alpha FY2026 rules have
  // late_fine_enabled: true, late_fine_type: 'percentage', late_fine_rate: 0.15,
  // contribution_amount: 75000.
  const month = 10;
  const year = app.CURRENT_FY;
  const paidDate = `${year}-${String(month).padStart(2, '0')}-20`;

  const { status, body } = await getJson(
    app.baseUrl,
    `/api/contributions/fine-preview?amount=75000&month=${month}&year=${year}&paid_date=${paidDate}&member_id=${app.alphaContribMember.id}`,
    app.adminToken,
  );

  assert.equal(status, 200);

  // one_time: true is the ONLY hotfix-only field in the fine-preview response
  // shape. routes/contributions.js's fine-preview never includes this field —
  // even when it produces penalty > 0. Asserting it proves the hotfix handler
  // ran AND that isContributionLate() returned true (entering the late branch).
  assert.equal(
    body.one_time,
    true,
    'fine-preview must return one_time: true — this field exists only in ' +
    'contributionsHotfix.js\'s response, never in routes/contributions.js, ' +
    'and is only reachable when isContributionLate() returns true',
  );
});

// ─── GAP 2 — duplicate-fine suppression branch proof ──────────────────────
//
// With isContributionLate() forced true, the POST /api/contributions handler
// in contributionsHotfix.js reaches the getExistingFine() lookup. When a fine
// already exists for that period, fine remains null and fine_created is null
// in the response. We verify:
//   - fine_created field present (hotfix-only witness)
//   - fine_created === null (getExistingFine returned a record — suppression)
//   - alpha Fine count for the period unchanged
//   - alpha fine_id counter unchanged
//   - existing Fine record unchanged
//   - default DB Fine count unchanged
//   - default DB fine_id counter unchanged
//   - tenant_beta Fine count unchanged
test('GAP 2 — getExistingFine branch entered: fine_created is null, all Fine counters and collections unchanged across all DBs', async () => {
  const month = 12;
  const year = app.CURRENT_FY;
  const memberId = app.alphaContribMember.id;
  const paidDate = `${year}-${String(month).padStart(2, '0')}-20`;

  // Seed an existing Fine in tenant_alpha for this member/period.
  // This is the fine that getExistingFine() must find, suppressing duplication.
  const seededFine = await app.alpha.Fine.create({
    id: await app.alpha.getNextId('fine_id'),
    member_id: memberId,
    amount: 11250,
    reason: `Missing contribution ${month}/${year} — one-time 15% fine (FY${app.CURRENT_FY})`,
    year: app.CURRENT_FY,
    contribution_month: month,
    contribution_year: year,
    status: 'unpaid',
  });

  // Record state AFTER seeding (seeding incremented the fine_id counter once;
  // we assert it does NOT increment again during the POST).
  const alphaFineCountForPeriodBefore = await app.alpha.Fine.countDocuments({
    member_id: memberId,
    contribution_month: month,
    contribution_year: year,
  });
  const alphaFineIdCounterBefore = await app.alpha.Counter.findById('fine_id').lean();
  const existingFineRecord = await app.alpha.Fine.findOne({
    member_id: memberId,
    contribution_month: month,
    contribution_year: year,
  }).lean();

  const defaultFineCountBefore = await app.defaultModels.Fine.countDocuments();
  const defaultFineIdCounterBefore = await app.defaultModels.Counter.findById('fine_id').lean();
  const betaFineCountBefore = await app.beta.Fine.countDocuments();

  // POST the contribution. isContributionLate() is true here, so the hotfix
  // handler enters the getExistingFine() branch. The seeded fine is found, so
  // no new fine is created — fine_created must be null.
  const { status, body } = await postJson(
    app.baseUrl,
    '/api/contributions',
    {
      member_id: memberId,
      amount: 75000,
      month,
      year,
      status: 'paid',
      paid_date: paidDate,
    },
    app.adminToken,
  );

  assert.equal(status, 201);

  // fine_created is a hotfix-only field — its presence alone proves the hotfix
  // handler ran, not routes/contributions.js.
  assert.ok(
    'fine_created' in body,
    'response must include fine_created — this field is only present in contributionsHotfix.js\'s POST / response shape',
  );

  // fine_created === null proves getExistingFine() returned the seeded fine,
  // suppressing duplicate creation.
  assert.equal(
    body.fine_created,
    null,
    'fine_created must be null: getExistingFine() found the pre-seeded fine and suppressed duplicate fine creation',
  );

  // Alpha Fine count for the period must be unchanged (no new fine created).
  const alphaFineCountForPeriodAfter = await app.alpha.Fine.countDocuments({
    member_id: memberId,
    contribution_month: month,
    contribution_year: year,
  });
  assert.equal(
    alphaFineCountForPeriodAfter,
    alphaFineCountForPeriodBefore,
    'alpha Fine count for this period must be unchanged — no duplicate fine was created',
  );

  // Alpha fine_id counter must not have incremented.
  const alphaFineIdCounterAfter = await app.alpha.Counter.findById('fine_id').lean();
  assert.equal(
    alphaFineIdCounterAfter.seq,
    alphaFineIdCounterBefore.seq,
    'alpha fine_id counter must not increment — no new fine was allocated an id',
  );

  // The existing Fine record must be completely unchanged.
  const existingFineAfter = await app.alpha.Fine.findOne({ _id: existingFineRecord._id }).lean();
  assert.ok(existingFineAfter, 'the seeded Fine record must still exist');
  assert.equal(existingFineAfter.id, existingFineRecord.id, 'existing Fine id must not change');
  assert.equal(existingFineAfter.amount, existingFineRecord.amount, 'existing Fine amount must not change');
  assert.equal(existingFineAfter.status, existingFineRecord.status, 'existing Fine status must not change');
  assert.equal(existingFineAfter.reason, existingFineRecord.reason, 'existing Fine reason must not change');

  // Default DB Fine count must be unchanged.
  const defaultFineCountAfter = await app.defaultModels.Fine.countDocuments();
  assert.equal(
    defaultFineCountAfter,
    defaultFineCountBefore,
    'default DB Fine count must be unchanged — no write reached the default DB',
  );

  // Default DB fine_id counter must be unchanged.
  const defaultFineIdCounterAfter = await app.defaultModels.Counter.findById('fine_id').lean();
  assert.equal(
    defaultFineIdCounterAfter.seq,
    defaultFineIdCounterBefore.seq,
    'default DB fine_id counter must be unchanged',
  );

  // tenant_beta Fine count must be unchanged.
  const betaFineCountAfter = await app.beta.Fine.countDocuments();
  assert.equal(
    betaFineCountAfter,
    betaFineCountBefore,
    'tenant_beta Fine count must be unchanged',
  );
});
