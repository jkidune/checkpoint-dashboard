// Phase 4E isolation proof for routes/fineCashHotfix.js, through the real
// Express server (server.js mount order UNCHANGED: fineCashHotfix is mounted
// before summary), real authenticate, real tenant resolution and real HTTP.
//
// What the hotfix does:
//   * POST/PATCH /api/summary/fines: injects paid_date when status=paid and no
//     paid_date was sent, then - AFTER the response finishes (res.on('finish'))
//     - creates a missing fine_payment Transaction for post-reconciliation
//     paid fines. The tenant models are captured BEFORE the response so the
//     post-response callback still targets the right tenant.
//   * GET /api/summary and GET /api/summary/snapshot: repair eligible missing
//     receipts BEFORE the summary is computed.
//
// Precedence is proven by BEHAVIOR: summary.js's own PATCH handler never
// injects paid_date, so a saved paid_date can only come from the hotfix
// middleware having run first.

const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const {
  startPhase4eTestApp, stopPhase4eTestApp, snapshotModels, assertSnapshotEqual, waitFor, sleep,
} = require('./helpers/phase4eTestApp');
const { getJson, postJson, patchJson } = require('./helpers/httpJson');

let app;

// Every request here goes to a real in-process Express 4 server. If a regression made a route throw
// inside an async handler the request would never be answered, so each test is bounded: it FAILS
// quickly instead of hanging the whole suite.
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);

before(async () => {
  app = await startPhase4eTestApp();
}, { timeout: 120000 });

after(async () => {
  await stopPhase4eTestApp();
});

const isoToday = () => new Date().toISOString().slice(0, 10);

async function createAlphaFine(props) {
  const doc = await app.alpha.Fine.create({
    id: await app.alpha.getNextId('fine_id'),
    member_id: app.fx.alpha.members.one.id,
    year: 2026,
    status: 'unpaid',
    ...props,
  });
  return doc.toObject();
}

async function createAlphaReceipt(fine, props = {}) {
  const doc = await app.alpha.Transaction.create({
    id: await app.alpha.getNextId('transaction_id'),
    member_id: fine.member_id,
    amount: fine.amount,
    type: 'fine_payment',
    description: `Fine payment — ${fine.reason}`,
    reference: `fine:${fine.id}`,
    ...props,
  });
  return doc.toObject();
}

const findAlphaReceipt = (fineId) => app.alpha.Transaction.findOne({ type: 'fine_payment', reference: `fine:${fineId}` }).lean();

// ─── paid_date injection + post-response receipt (precedence + async finish) ─

test('PATCH status=paid with NO paid_date: hotfix runs first (paid_date saved) and an ALPHA receipt is created after the response', async () => {
  const fine = await createAlphaFine({ amount: 4500, reason: 'Hotfix precedence fine' });

  // Default-DB poison that matches this fine in EVERY way the sync could match it
  // (canonical reference, member, amount, date, description). It must neither
  // suppress alpha's receipt creation nor be touched.
  const today = isoToday();
  await app.defaultModels.Transaction.create({
    id: 9101, member_id: fine.member_id, amount: 4500, type: 'fine_payment',
    description: 'Fine payment — Hotfix precedence fine', reference: `fine:${fine.id}`, transaction_date: today,
  });
  await app.defaultModels.Fine.create({ id: fine.id, member_id: fine.member_id, amount: 4500, reason: 'DEFAULT SENTINEL same-id paid fine', year: 2026, status: 'paid', paid_date: today });
  const base = await app.baseline();

  const txCounterBefore = await app.alphaCounter('transaction_id');
  assert.equal(await findAlphaReceipt(fine.id), null);

  const { status, body } = await patchJson(app.baseUrl, `/api/summary/fines/${fine.id}`, { status: 'paid' }, app.tokens.admin);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, 'paid');
  assert.ok([today, isoToday()].includes(body.paid_date), `paid_date must be injected as today, got ${body.paid_date}`);

  // The SAVED alpha document carries the injected paid_date (only the hotfix middleware can have set it).
  const saved = await app.alpha.Fine.findOne({ id: fine.id }).lean();
  assert.equal(saved.paid_date, body.paid_date);

  // The receipt is written asynchronously, after the response has finished.
  const receipt = await waitFor(() => findAlphaReceipt(fine.id), { label: 'alpha fine_payment receipt' });
  assert.equal(receipt.amount, 4500);
  assert.equal(receipt.member_id, fine.member_id);
  assert.equal(receipt.transaction_date, body.paid_date);
  assert.equal(receipt.description, 'Fine payment — Hotfix precedence fine');
  // transaction_id comes from ALPHA's sequence (4 -> 5), not the default one (5007+).
  assert.equal(receipt.id, txCounterBefore + 1);
  assert.ok(receipt.id < 5000);
  assert.equal(await app.alphaCounter('transaction_id'), txCounterBefore + 1);
  assert.equal(await app.alpha.Transaction.countDocuments({ reference: `fine:${fine.id}` }), 1);

  // Default DB: the matching sentinel receipt did not suppress alpha's, and nothing was written there.
  await app.assertIsolation(base, 'PATCH paid without paid_date');
});

test('PATCH status=paid WITH an explicit paid_date keeps that date and the receipt carries it', async () => {
  const fine = await createAlphaFine({ amount: 3000, reason: 'Hotfix explicit date fine' });
  const base = await app.baseline();

  const { status, body } = await patchJson(app.baseUrl, `/api/summary/fines/${fine.id}`, { status: 'paid', paid_date: '2026-09-18' }, app.tokens.admin);
  assert.equal(status, 200);
  assert.equal(body.paid_date, '2026-09-18');

  const receipt = await waitFor(() => findAlphaReceipt(fine.id), { label: 'alpha receipt' });
  assert.equal(receipt.transaction_date, '2026-09-18');
  assert.equal(receipt.amount, 3000);
  await app.assertIsolation(base, 'PATCH paid with paid_date');
});

test('PATCH that does not mark a fine paid injects no paid_date and creates no receipt', async () => {
  const fine = await createAlphaFine({ amount: 2000, reason: 'Hotfix not-paid fine' });
  const base = await app.baseline();

  const { status, body } = await patchJson(app.baseUrl, `/api/summary/fines/${fine.id}`, { notes: 'still unpaid' }, app.tokens.admin);
  assert.equal(status, 200);
  assert.equal(body.status, 'unpaid');
  assert.equal(body.paid_date, null, 'no paid_date may be injected for a non-paid update');

  // The receipt sync (if it ran at all) must find nothing to create for an unpaid fine.
  await sleep(150);
  assert.equal(await findAlphaReceipt(fine.id), null);
  await app.assertIsolation(base, 'PATCH not paid');
});

test('POST /api/summary/fines with status=paid and no paid_date: fine_id and transaction_id both come from ALPHA counters', async () => {
  const base = await app.baseline();
  const fineCounterBefore = await app.alphaCounter('fine_id');
  const txCounterBefore = await app.alphaCounter('transaction_id');

  const { status, body } = await postJson(
    app.baseUrl,
    '/api/summary/fines',
    { member_id: app.fx.alpha.members.two.id, amount: 6500, reason: 'Hotfix POST paid fine', year: 2026, status: 'paid' },
    app.tokens.admin
  );
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.id, fineCounterBefore + 1);
  assert.ok(body.paid_date, 'hotfix must inject paid_date on a paid POST');

  const receipt = await waitFor(() => findAlphaReceipt(body.id), { label: 'alpha receipt for POSTed paid fine' });
  assert.equal(receipt.amount, 6500);
  assert.equal(receipt.member_id, app.fx.alpha.members.two.id);
  assert.equal(receipt.transaction_date, body.paid_date);
  assert.equal(receipt.id, txCounterBefore + 1);
  assert.equal(await app.alphaCounter('fine_id'), fineCounterBefore + 1);
  assert.equal(await app.alphaCounter('transaction_id'), txCounterBefore + 1);
  await app.assertIsolation(base, 'POST paid fine');
});

// ─── duplicate prevention is alpha-scoped ───────────────────────────────────

test('an existing matching ALPHA receipt (canonical reference, or legacy Form Intake style) prevents a duplicate; a later pass is a no-op', async () => {
  // Canonical: reference fine:<id>.
  const canonical = await createAlphaFine({ amount: 2500, reason: 'Hotfix duplicate canonical', member_id: app.fx.alpha.members.two.id });
  await createAlphaReceipt(canonical, { transaction_date: '2026-09-14' });
  // Legacy Form Intake: M-Pesa style reference, matched by member + amount + payment date.
  const legacy = await createAlphaFine({ amount: 1800, reason: 'Hotfix duplicate legacy' });
  await createAlphaReceipt(legacy, { reference: 'MPESA-LEGACY-0001', transaction_date: '2026-09-15' });
  // Positive control: an UNmatched fine that must get a receipt. Its paid_date sorts last, so by the
  // time its receipt exists the sync pass has already evaluated the two matched fines above.
  const control = await createAlphaFine({ amount: 1500, reason: 'Hotfix duplicate control' });
  const base = await app.baseline();

  for (const [fine, paid_date] of [[canonical, '2026-09-14'], [legacy, '2026-09-15'], [control, '2026-09-16']]) {
    const res = await patchJson(app.baseUrl, `/api/summary/fines/${fine.id}`, { status: 'paid', paid_date }, app.tokens.admin);
    assert.equal(res.status, 200);
  }

  await waitFor(() => findAlphaReceipt(control.id), { label: 'control receipt' });
  await sleep(150); // let any slower overlapping pass finish before asserting absence

  assert.equal(await app.alpha.Transaction.countDocuments({ type: 'fine_payment', reference: `fine:${canonical.id}` }), 1, 'canonical receipt must not be duplicated');
  assert.equal(await app.alpha.Transaction.countDocuments({ type: 'fine_payment', reference: `fine:${legacy.id}` }), 0, 'legacy-matched receipt must not get a second, canonical one');
  assert.equal(await app.alpha.Transaction.countDocuments({ type: 'fine_payment', amount: 1800 }), 1);
  assert.equal(await app.alpha.Transaction.countDocuments({ type: 'fine_payment', amount: 2500 }), 1);

  // A further pass, called directly on the alpha models, creates nothing: everything eligible is matched.
  const { syncPaidFineReceipts } = require('../../routes/fineCashHotfix');
  const result = await syncPaidFineReceipts(app.alpha);
  assert.equal(result.created, 0);
  assert.ok(result.matched >= 3, `expected the matched receipts to be counted, got ${JSON.stringify(result)}`);
  await app.assertIsolation(base, 'duplicate prevention');
});

// ─── GET-time repair, before computing ──────────────────────────────────────

test('GET /api/summary repairs an eligible missing ALPHA receipt BEFORE computing the cash position', async () => {
  const fine = await createAlphaFine({ amount: 6000, reason: 'Hotfix summary repair fine', member_id: app.fx.alpha.members.two.id, status: 'paid', paid_date: '2026-09-18' });
  const base = await app.baseline();
  const txCounterBefore = await app.alphaCounter('transaction_id');
  assert.equal(await findAlphaReceipt(fine.id), null, 'precondition: no receipt yet');

  const { status, body } = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);
  assert.equal(status, 200);

  const receipt = await findAlphaReceipt(fine.id);
  assert.ok(receipt, 'GET /api/summary must have created the missing alpha receipt');
  assert.equal(receipt.amount, 6000);
  assert.equal(receipt.member_id, fine.member_id);
  assert.equal(receipt.transaction_date, '2026-09-18');
  assert.equal(receipt.id, txCounterBefore + 1);

  // The summary was computed AFTER the repair: fines_received equals the sum of ALL alpha fine receipts
  // after the cutoff as they stand now (which includes the receipt created by this very request).
  const receipts = await app.alpha.Transaction.find({ type: 'fine_payment', transaction_date: { $gt: app.CUTOFF } }).lean();
  const expectedFinesReceived = receipts.reduce((sum, t) => sum + t.amount, 0);
  assert.ok(receipts.some((t) => t.id === receipt.id));
  assert.equal(body.cash_position.fines_received, expectedFinesReceived);
  await app.assertIsolation(base, 'GET /summary repair');
});

test('GET /api/summary/snapshot repairs an eligible missing ALPHA receipt BEFORE computing', async () => {
  const fine = await createAlphaFine({ amount: 2200, reason: 'Hotfix snapshot repair fine', status: 'paid', paid_date: '2026-09-19' });
  const base = await app.baseline();
  assert.equal(await findAlphaReceipt(fine.id), null, 'precondition: no receipt yet');

  const snapshot = await getJson(app.baseUrl, '/api/summary/snapshot', app.tokens.admin);
  assert.equal(snapshot.status, 200);
  const receipt = await findAlphaReceipt(fine.id);
  assert.ok(receipt, 'GET /api/summary/snapshot must have created the missing alpha receipt');
  assert.equal(receipt.amount, 2200);

  // If the snapshot had been computed BEFORE the repair, a later (repair-free) summary would be 2200 higher.
  const summary = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);
  assert.equal(summary.body.cash_at_bank, snapshot.body.cash_at_bank);
  await app.assertIsolation(base, 'GET /snapshot repair');
});

test('default Fines, Transactions and ReconciliationRuns cannot influence the repair', async () => {
  const base = await app.baseline();
  const { paidPre } = app.fx.alpha.fines;

  // (1) Default has paid post-cutoff fines with no/other receipts and an EARLIER cutoff (2026-01-15).
  //     alpha's pre-cutoff paid fine (paid 2026-08-15) must still never get a receipt.
  assert.equal((await getJson(app.baseUrl, '/api/summary', app.tokens.admin)).status, 200);
  assert.equal(await findAlphaReceipt(paidPre.id), null, 'alpha pre-cutoff fine must not be repaired using the default run\'s earlier cutoff');
  assert.equal(await findAlphaReceipt(app.fx.default.onlyFineId), null, 'a default-only fine must not produce an alpha receipt');
  assert.equal(await app.alpha.Transaction.countDocuments({ amount: { $in: [4444444, 6666666, 7777777, 8888888, 9999999] } }), 0);

  // (2) With NO applied alpha run, the default DB's applied runs must not enable the sync at all.
  const run = await app.alpha.ReconciliationRun.findOne({ run_key: app.ALPHA_RUN_KEY });
  const eligible = await createAlphaFine({ amount: 3100, reason: 'Hotfix no-run fine', status: 'paid', paid_date: '2026-09-21' });
  await app.alpha.ReconciliationRun.updateOne({ _id: run._id }, { $set: { status: 'prepared' } });
  try {
    const noRun = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);
    assert.equal(noRun.status, 200);
    assert.equal(noRun.body.reconciliation, null, 'default applied runs must not appear as alpha\'s reconciliation');
    assert.equal(noRun.body.cash_source, 'calculated');
    assert.equal(await findAlphaReceipt(eligible.id), null, 'no applied ALPHA run => no repair, whatever the default DB holds');
  } finally {
    await app.alpha.ReconciliationRun.updateOne({ _id: run._id }, { $set: { status: 'applied' } });
  }

  // (3) Once alpha's own run is applied again the very same fine is repaired.
  const restored = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);
  assert.equal(restored.body.reconciliation.run_key, app.ALPHA_RUN_KEY);
  assert.ok(await findAlphaReceipt(eligible.id), 'repair must resume as soon as alpha has an applied run');

  await app.assertIsolation(base, 'default cannot influence repair');
});

// ─── auth semantics and tenant gate ─────────────────────────────────────────

test('the hotfix routes keep their auth semantics and an org_beta token is rejected before any write or sync', async () => {
  const fine = await createAlphaFine({ amount: 900, reason: 'Hotfix auth fine' });
  const base = await app.baseline();
  const alphaBefore = await snapshotModels(app.alpha);
  const path = `/api/summary/fines/${fine.id}`;
  const create = { member_id: fine.member_id, amount: 900, reason: 'x', year: 2026, status: 'paid' };

  assert.equal((await patchJson(app.baseUrl, path, { status: 'paid' })).status, 401);
  assert.equal((await postJson(app.baseUrl, '/api/summary/fines', create)).status, 401);
  assert.equal((await patchJson(app.baseUrl, path, { status: 'paid' }, app.tokens.member1)).status, 403);
  assert.equal((await postJson(app.baseUrl, '/api/summary/fines', create, app.tokens.member1)).status, 403);
  for (const res of [
    await patchJson(app.baseUrl, path, { status: 'paid' }, app.tokens.betaAdmin),
    await postJson(app.baseUrl, '/api/summary/fines', create, app.tokens.betaAdmin),
    await getJson(app.baseUrl, '/api/summary', app.tokens.betaAdmin),
    await getJson(app.baseUrl, '/api/summary/snapshot', app.tokens.betaAdmin),
  ]) {
    assert.equal(res.status, 403);
    assert.match(res.body.error, /not a permitted runtime tenant/);
  }

  await sleep(150); // a (wrongly) triggered post-response sync would have landed by now
  assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), 'rejected requests must not touch alpha');
  await app.assertIsolation(base, 'rejected requests');
});
