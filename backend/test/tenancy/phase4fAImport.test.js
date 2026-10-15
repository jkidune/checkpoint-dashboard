// Phase 4F-A isolation proof for routes/import.js, through the real Express
// server (server.js), real authenticate, real tenant resolution, real multer
// upload and real HTTP.
//
//   POST /api/import/members        (multipart, field "file")
//   POST /api/import/contributions  -> contributions AND one `contribution` transaction each
//   POST /api/import/loans          -> loans AND one `loan_disbursement` transaction each
//
// Numeric ids: Model.insertMany() never runs the schemas' pre('save')
// auto-increment hook, so the route gives every record an explicit id from the
// request tenant's OWN counters (member_id / contribution_id / loan_id /
// transaction_id). The ids are RESERVED IN BULK - ONE atomic $inc per counter
// and range (reserveIdRange), then assigned locally in CSV order - rather than
// one counter round trip per row. These tests prove those ids come from
// tenant_alpha's sequences - never from the default database's (5000+) or
// beta's (7000+) - that the reservation is exactly one counter operation per
// range however many rows are imported (observed through the connections'
// 'operation-start' events, see helpers/phase4fATestApp.js), and that the ids and
// counter state are identical to what N sequential getNextId() calls produce.
//
// BEHAVIOUR NOTE (pre-existing on main, fixed here by the tenant-correct id
// allocation): the pre-migration route never assigned ids at all, so an import
// of more than one record failed with a duplicate-key error on the unique `id`
// index (E11000 `{ id: null }`) and a single-record import stored a document
// without a numeric id. The "imports of several rows work and carry unique
// alpha ids" test pins the corrected behaviour.

const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const {
  startPhase4fATestApp, stopPhase4fATestApp, callHandlerWithoutTenantModels, uploadCsv, withCapturedConsoleError,
  assertFailedBecauseTenantModelsAreMissing,
} = require('./helpers/phase4fATestApp');
const { postJson } = require('./helpers/httpJson');

let app;
let globalBaseline;

// Every request goes to a real in-process Express 4 server; each test is bounded so a regression
// FAILS quickly instead of hanging the whole suite.
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);

before(async () => {
  app = await startPhase4fATestApp();
  globalBaseline = await app.baseline();
}, { timeout: 120000 });

after(async () => {
  await stopPhase4fATestApp();
});

const ADMIN = () => app.tokens.admin;
const isoToday = () => new Date().toISOString().split('T')[0];
const upload = (type, csv, opts = {}) => uploadCsv(app.baseUrl, type, csv, { token: ADMIN(), ...opts });

async function counters(names) {
  const out = {};
  for (const name of names) out[name] = await app.alphaCounter(name);
  return out;
}

function assertDefaultAndBetaCountersUntouched() {
  return Promise.all([
    ...Object.entries(app.DEFAULT_COUNTERS).map(async ([name, value]) => assert.equal(await app.defaultCounter(name), value, `default ${name}`)),
    ...Object.entries(app.BETA_COUNTERS).map(async ([name, value]) => assert.equal(await app.betaCounter(name), value, `beta ${name}`)),
  ]);
}

// ─── members ────────────────────────────────────────────────────────────────

test('POST /import/members creates the members in tenant_alpha only, with ids from ALPHA\'s member_id sequence and the documented defaults', async () => {
  const before = await app.baseline();
  const c0 = await counters(['member_id', 'contribution_id', 'loan_id', 'transaction_id']);
  assert.equal(c0.member_id, 5, 'fixture: alpha has members 1-5');

  const csv = [
    'name,phone,office,status,entry_fee,join_date',
    'Imported Alpha One,+255711000001,secretary,active,250000,2025-02-01',
    'Imported Alpha Two,,,,,',
    'Imported Alpha Three,+255711000003,,former,,2025-03-01',
  ].join('\n');
  const { status, body } = await upload('members', csv);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { success: true, imported: 3 });

  const imported = await app.alpha.Member.find({ name: /^Imported Alpha / }).sort({ id: 1 }).lean();
  assert.deepEqual(imported.map((m) => [m.id, m.name, m.phone, m.office, m.status, m.entry_fee, m.join_date]), [
    [c0.member_id + 1, 'Imported Alpha One', '+255711000001', 'secretary', 'active', 250000, '2025-02-01'],
    [c0.member_id + 2, 'Imported Alpha Two', null, 'member', 'active', 100000, null],
    [c0.member_id + 3, 'Imported Alpha Three', '+255711000003', 'member', 'former', 100000, '2025-03-01'],
  ]);
  assert.ok(imported.every((m) => m.id < 1000), 'ids are alpha\'s, not the default (5001+) or beta (7001+) ones');

  const c1 = await counters(['member_id', 'contribution_id', 'loan_id', 'transaction_id']);
  assert.deepEqual(c1, { ...c0, member_id: c0.member_id + 3 }, 'only alpha\'s member_id counter moved, by exactly the number of rows');
  await assertDefaultAndBetaCountersUntouched();
  await app.assertIsolation(before, 'members import');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.members].sort());
});

// ─── contributions ──────────────────────────────────────────────────────────

test('POST /import/contributions creates alpha contributions AND alpha `contribution` transactions, ids from alpha\'s contribution_id and transaction_id sequences', async () => {
  const before = await app.baseline();
  const c0 = await counters(['member_id', 'contribution_id', 'loan_id', 'transaction_id']);
  const todayBefore = isoToday();

  const csv = [
    'member_id,amount,month,year,status,paid_date,mpesa_ref,notes',
    '1,50000,7,2026,paid,2026-07-04,MP123,July contribution',
    '2,30000,7,2026,,,,',
  ].join('\n');
  const { status, body } = await upload('contributions', csv);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { success: true, imported: 2 });

  const contributions = await app.alpha.Contribution.find({ month: 7, year: 2026 }).sort({ id: 1 }).lean();
  assert.deepEqual(contributions.map((c) => [c.id, c.member_id, c.amount, c.month, c.year, c.status, c.paid_date, c.mpesa_ref, c.notes]), [
    [c0.contribution_id + 1, 1, 50000, 7, 2026, 'paid', '2026-07-04', 'MP123', 'July contribution'],
    [c0.contribution_id + 2, 2, 30000, 7, 2026, 'paid', null, null, null],
  ]);

  const txs = await app.alpha.Transaction.find({ description: 'Imported contribution' }).sort({ id: 1 }).lean();
  assert.equal(txs.length, 2);
  assert.deepEqual(txs.map((t) => [t.id, t.member_id, t.amount, t.type, t.description]), [
    [c0.transaction_id + 1, 1, 50000, 'contribution', 'Imported contribution'],
    [c0.transaction_id + 2, 2, 30000, 'contribution', 'Imported contribution'],
  ]);
  assert.equal(txs[0].transaction_date, '2026-07-04');
  assert.ok([todayBefore, isoToday()].includes(txs[1].transaction_date), `no paid_date: today, got ${txs[1].transaction_date}`);

  const c1 = await counters(['member_id', 'contribution_id', 'loan_id', 'transaction_id']);
  assert.deepEqual(c1, { ...c0, contribution_id: c0.contribution_id + 2, transaction_id: c0.transaction_id + 2 });
  await assertDefaultAndBetaCountersUntouched();
  await app.assertIsolation(before, 'contributions import');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.contributions, app.collections.counters, app.collections.transactions].sort());
});

// ─── loans ──────────────────────────────────────────────────────────────────

test('POST /import/loans creates alpha loans AND alpha `loan_disbursement` transactions, ids from alpha\'s loan_id and transaction_id sequences', async () => {
  const before = await app.baseline();
  const c0 = await counters(['member_id', 'contribution_id', 'loan_id', 'transaction_id']);
  const todayBefore = isoToday();

  const csv = [
    'member_id,loan_number,principal,issued_date,due_date,status,fiscal_year,notes',
    '1,Imported Loan A,200000,2026-05-01,2026-11-01,active,2026,first loan',
    '2,,100000,,,,,',
  ].join('\n');
  const { status, body } = await upload('loans', csv);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { success: true, imported: 2 });

  const loans = await app.alpha.Loan.find({ id: { $gt: c0.loan_id } }).sort({ id: 1 }).lean();
  assert.equal(loans.length, 2);
  assert.deepEqual(loans.map((l) => [l.id, l.member_id, l.loan_number, l.principal, l.interest_rate, l.interest_amount, l.amount_deposited, l.issued_date, l.due_date, l.status, l.fiscal_year, l.notes]), [
    [c0.loan_id + 1, 1, 'Imported Loan A', 200000, 0.05, 10000, 190000, '2026-05-01', '2026-11-01', 'active', 2026, 'first loan'],
    [c0.loan_id + 2, 2, 'Imported Loan', 100000, 0.05, 5000, 95000, null, null, 'active', new Date().getFullYear(), null],
  ]);

  const txs = await app.alpha.Transaction.find({ description: 'Imported loan disbursement' }).sort({ id: 1 }).lean();
  assert.deepEqual(txs.map((t) => [t.id, t.member_id, t.amount, t.type]), [
    [c0.transaction_id + 1, 1, 200000, 'loan_disbursement'],
    [c0.transaction_id + 2, 2, 100000, 'loan_disbursement'],
  ]);
  assert.equal(txs[0].transaction_date, '2026-05-01');
  assert.ok([todayBefore, isoToday()].includes(txs[1].transaction_date));

  const c1 = await counters(['member_id', 'contribution_id', 'loan_id', 'transaction_id']);
  assert.deepEqual(c1, { ...c0, loan_id: c0.loan_id + 2, transaction_id: c0.transaction_id + 2 });
  await assertDefaultAndBetaCountersUntouched();
  await app.assertIsolation(before, 'loans import');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.loans, app.collections.transactions].sort());
});

// ─── multi-row / repeated imports ───────────────────────────────────────────

test('imports of many rows, and repeated imports, work and carry unique, consecutive alpha ids (no id-less documents)', async () => {
  const before = await app.baseline();
  const c0 = await counters(['member_id']);
  const rows = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${String(i).padStart(2, '0')},,,,,`);
  const first = await upload('members', ['name,phone,office,status,entry_fee,join_date', ...rows('Bulk One', 60)].join('\n'));
  const second = await upload('members', ['name,phone,office,status,entry_fee,join_date', ...rows('Bulk Two', 5)].join('\n'));
  assert.deepEqual(first.body, { success: true, imported: 60 });
  assert.deepEqual(second.body, { success: true, imported: 5 });

  const bulk = await app.alpha.Member.find({ name: /^Bulk (One|Two) / }).sort({ id: 1 }).lean();
  assert.equal(bulk.length, 65);
  assert.deepEqual(bulk.map((m) => m.id), Array.from({ length: 65 }, (_, i) => c0.member_id + 1 + i));
  assert.equal(await app.alpha.Member.countDocuments({ $or: [{ id: null }, { id: { $exists: false } }] }), 0, 'every alpha member has a numeric id');
  assert.equal(await app.alphaCounter('member_id'), c0.member_id + 65);
  await app.assertIsolation(before, 'bulk members import');
});

// ─── bulk id reservation: one atomic $inc per counter range, not one update per row ─

const range = (start, length) => Array.from({ length }, (_, index) => start + index);

async function recordingCounterOps(fn) {
  const recorder = app.recordCounterOperations();
  try {
    await fn();
  } finally {
    recorder.stop();
  }
  return recorder.ops;
}

// The recorder's view of ONE reservation: a single upserting findOneAndUpdate on alpha's counter, $inc by the whole batch
// (the very operation, and options, models.getNextId() uses - only with the batch size instead of 1).
const reservation = (counterName, size) => ({
  db: 'alpha', method: 'findOneAndUpdate', filter: { _id: counterName }, update: { $inc: { seq: size } }, upsert: true, returnDocument: 'after',
});
const summarize = (ops) => ops.map((o) => ({
  db: o.db, method: o.method, filter: o.filter, update: o.update, upsert: o.options && o.options.upsert, returnDocument: o.options && o.options.returnDocument,
}));

const ALL_IMPORT_COUNTERS = ['member_id', 'contribution_id', 'loan_id', 'transaction_id'];

// Puts an alpha counter back exactly as it was: `prior` is its seq, or null when the counter document did not exist.
async function restoreAlphaCounter(name, prior) {
  if (prior === null) await app.alpha.Counter.deleteOne({ _id: name });
  else await app.alpha.Counter.findByIdAndUpdate(name, { $set: { seq: prior } }, { upsert: true });
}

function csvFor(type, size, prefix) {
  const rows = Array.from({ length: size }, (_, i) => {
    const memberId = (i % 5) + 1; // alpha members 1-5
    if (type === 'members') return `${prefix} ${String(i).padStart(2, '0')},,,,,`;
    if (type === 'contributions') return `${memberId},${(i + 1) * 1000},8,2026,paid,2026-08-${String((i % 28) + 1).padStart(2, '0')},${prefix}-${i},`;
    return `${memberId},${prefix} ${i},${(i + 1) * 10000},2026-03-${String((i % 28) + 1).padStart(2, '0')},,,2026,`;
  });
  const header = {
    members: 'name,phone,office,status,entry_fee,join_date',
    contributions: 'member_id,amount,month,year,status,paid_date,mpesa_ref,notes',
    loans: 'member_id,loan_number,principal,issued_date,due_date,status,fiscal_year,notes',
  }[type];
  return [header, ...rows].join('\n');
}

test('a multi-row member import reserves ONE contiguous range with ONE atomic $inc on alpha\'s member_id counter - not one update per row', async () => {
  const N = 40;
  const before = await app.baseline();
  const c0 = await counters(ALL_IMPORT_COUNTERS);

  let response;
  const ops = await recordingCounterOps(async () => { response = await upload('members', csvFor('members', N, 'Reserved Member')); });
  assert.deepEqual(response.body, { success: true, imported: N });

  // ONE counter operation in total, on alpha only: a single upserting findOneAndUpdate with $inc by the whole batch.
  assert.deepEqual(summarize(ops), [reservation('member_id', N)]);

  // The reserved block is contiguous and was assigned in CSV order.
  const imported = await app.alpha.Member.find({ name: /^Reserved Member / }).sort({ id: 1 }).lean();
  assert.deepEqual(imported.map((m) => m.id), range(c0.member_id + 1, N));
  assert.deepEqual(imported.map((m) => m.name), Array.from({ length: N }, (_, i) => `Reserved Member ${String(i).padStart(2, '0')}`));

  assert.deepEqual(await counters(ALL_IMPORT_COUNTERS), { ...c0, member_id: c0.member_id + N }, 'member_id advanced by exactly N, once; nothing else moved');
  await assertDefaultAndBetaCountersUntouched();
  await app.assertIsolation(before, 'bulk members import');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.members].sort());
});

test('a multi-row contribution import reserves ONE contribution_id range and ONE transaction_id range (two $inc operations in total), assigned in CSV order', async () => {
  const N = 25;
  const before = await app.baseline();
  const c0 = await counters(ALL_IMPORT_COUNTERS);

  let response;
  const ops = await recordingCounterOps(async () => { response = await upload('contributions', csvFor('contributions', N, 'RSV')); });
  assert.deepEqual(response.body, { success: true, imported: N });
  assert.deepEqual(summarize(ops), [reservation('contribution_id', N), reservation('transaction_id', N)], 'two reservations, nothing per row');

  const amounts = Array.from({ length: N }, (_, i) => (i + 1) * 1000);
  const members = Array.from({ length: N }, (_, i) => (i % 5) + 1);
  const contributions = await app.alpha.Contribution.find({ id: { $gt: c0.contribution_id } }).sort({ id: 1 }).lean();
  assert.deepEqual(contributions.map((c) => c.id), range(c0.contribution_id + 1, N));
  assert.deepEqual(contributions.map((c) => [c.member_id, c.amount, c.mpesa_ref]), amounts.map((amount, i) => [members[i], amount, `RSV-${i}`]), 'CSV order');

  // The generated transactions got their OWN contiguous transaction_id block, in the same CSV order.
  const txs = await app.alpha.Transaction.find({ id: { $gt: c0.transaction_id } }).sort({ id: 1 }).lean();
  assert.deepEqual(txs.map((t) => t.id), range(c0.transaction_id + 1, N));
  assert.deepEqual(txs.map((t) => [t.member_id, t.amount, t.type, t.description]), amounts.map((amount, i) => [members[i], amount, 'contribution', 'Imported contribution']));

  assert.deepEqual(await counters(ALL_IMPORT_COUNTERS), { ...c0, contribution_id: c0.contribution_id + N, transaction_id: c0.transaction_id + N });
  await assertDefaultAndBetaCountersUntouched();
  await app.assertIsolation(before, 'bulk contributions import');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.contributions, app.collections.counters, app.collections.transactions].sort());
});

test('a multi-row loan import reserves ONE loan_id range and ONE transaction_id range (two $inc operations in total), assigned in CSV order', async () => {
  const N = 18;
  const before = await app.baseline();
  const c0 = await counters(ALL_IMPORT_COUNTERS);

  let response;
  const ops = await recordingCounterOps(async () => { response = await upload('loans', csvFor('loans', N, 'Reserved Loan')); });
  assert.deepEqual(response.body, { success: true, imported: N });
  assert.deepEqual(summarize(ops), [reservation('loan_id', N), reservation('transaction_id', N)], 'two reservations, nothing per row');

  const principals = Array.from({ length: N }, (_, i) => (i + 1) * 10000);
  const members = Array.from({ length: N }, (_, i) => (i % 5) + 1);
  const loans = await app.alpha.Loan.find({ id: { $gt: c0.loan_id } }).sort({ id: 1 }).lean();
  assert.deepEqual(loans.map((l) => l.id), range(c0.loan_id + 1, N));
  assert.deepEqual(loans.map((l) => [l.member_id, l.loan_number, l.principal, l.interest_amount, l.amount_deposited]),
    principals.map((principal, i) => [members[i], `Reserved Loan ${i}`, principal, Math.round(principal * 0.05), principal - Math.round(principal * 0.05)]), 'CSV order');

  const txs = await app.alpha.Transaction.find({ id: { $gt: c0.transaction_id } }).sort({ id: 1 }).lean();
  assert.deepEqual(txs.map((t) => t.id), range(c0.transaction_id + 1, N));
  assert.deepEqual(txs.map((t) => [t.member_id, t.amount, t.type, t.description]), principals.map((principal, i) => [members[i], principal, 'loan_disbursement', 'Imported loan disbursement']));

  assert.deepEqual(await counters(ALL_IMPORT_COUNTERS), { ...c0, loan_id: c0.loan_id + N, transaction_id: c0.transaction_id + N });
  await assertDefaultAndBetaCountersUntouched();
  await app.assertIsolation(before, 'bulk loans import');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters, app.collections.loans, app.collections.transactions].sort());
});

test('the number of counter operations does NOT grow with the number of rows: 1 per counter range for 1, 7 or 60 rows', async () => {
  const before = await app.baseline();
  const expectedCounters = { members: ['member_id'], contributions: ['contribution_id', 'transaction_id'], loans: ['loan_id', 'transaction_id'] };
  for (const type of Object.keys(expectedCounters)) {
    const opCounts = [];
    for (const size of [1, 7, 60]) {
      const ops = await recordingCounterOps(async () => {
        const res = await upload(type, csvFor(type, size, `Scale ${type}`));
        assert.deepEqual(res.body, { success: true, imported: size }, `${type} x ${size}`);
      });
      assert.deepEqual(summarize(ops), expectedCounters[type].map((counterName) => reservation(counterName, size)), `${type} x ${size}`);
      opCounts.push(ops.length);
    }
    assert.deepEqual(opCounts, [opCounts[0], opCounts[0], opCounts[0]], `${type}: the counter operation count is constant w.r.t. row count`);
    assert.equal(opCounts[0], expectedCounters[type].length);
  }
  await app.assertIsolation(before, 'scaling imports');
});

test('positive control: the recorder DOES see per-row allocation - five sequential getNextId() calls are five counter operations (so "one per range" above is a real measurement)', async () => {
  const before = await app.baseline();
  const prior = await app.alphaCounter('expense_id');
  try {
    const ops = await recordingCounterOps(async () => {
      for (let i = 0; i < 5; i += 1) await app.alpha.getNextId('expense_id');
    });
    assert.equal(ops.length, 5);
    assert.deepEqual(summarize(ops), Array.from({ length: 5 }, () => reservation('expense_id', 1)));
  } finally {
    await restoreAlphaCounter('expense_id', prior);
  }
  await app.assertIsolation(before, 'positive control');
});

test('a CSV that fails model validation burns at most the ONE range reserved before the failing insert (a counter gap), writes no records and never reaches transaction_id', async () => {
  const before = await app.baseline();
  const c0 = await counters(ALL_IMPORT_COUNTERS);
  const csv = ['member_id,amount,month,year,mpesa_ref', '1,1000,7,2026,BAD-0', '2,2000,7,2026,BAD-1', ',3000,7,2026,BAD-2', '4,4000,7,2026,BAD-3'].join('\n');

  let response;
  const { logged } = await withCapturedConsoleError(async () => {
    const ops = await recordingCounterOps(async () => { response = await upload('contributions', csv); });
    assert.deepEqual(summarize(ops), [reservation('contribution_id', 4)], 'exactly one reservation - the transaction ids are never reserved because the contribution insert failed first');
  });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Failed to process CSV file. Ensure you are using the correct headers.' });
  assert.ok(logged.length >= 1, 'the failure is logged');

  assert.equal(await app.alpha.Contribution.countDocuments({ mpesa_ref: /^BAD-/ }), 0, 'no contribution written');
  assert.equal(await app.alpha.Transaction.countDocuments({ id: { $gt: c0.transaction_id } }), 0, 'no transaction written');
  assert.deepEqual(await counters(ALL_IMPORT_COUNTERS), { ...c0, contribution_id: c0.contribution_id + 4 }, 'only the reserved contribution range was consumed (an acceptable gap)');
  await app.assertIsolation(before, 'failed validation import');
  assert.deepEqual((await app.changedAlpha(before)), [app.collections.counters]);
});

test('if a tenant counter is BEHIND its existing ids the import still fails with a duplicate-key error and overwrites nothing, until sync-counters runs (documented behaviour, unchanged by bulk reservation)', async () => {
  const before = await app.baseline();
  const maxMemberId = (await app.alpha.Member.findOne().sort({ id: -1 }).lean()).id;
  await app.alpha.Counter.findByIdAndUpdate('member_id', { $set: { seq: 0 } }, { upsert: true }); // setup: alpha's counter is behind
  try {
    const membersBefore = await app.alpha.Member.find().sort({ id: 1 }).lean();

    let failed;
    const { logged } = await withCapturedConsoleError(async () => { failed = await upload('members', 'name\nBehind One\nBehind Two'); });
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.body, { error: 'Failed to process CSV file. Ensure you are using the correct headers.' });
    assert.ok(logged.some((text) => /E11000|duplicate key/i.test(text)), 'the cause is the unique id index');
    assert.deepEqual(await app.alpha.Member.find().sort({ id: 1 }).lean(), membersBefore, 'no existing member overwritten, none added');
    assert.equal(await app.alphaCounter('member_id'), 2, 'the reserved range [1, 2] was consumed');

    // sync-counters (admin route) repairs the counter from alpha's own collections; the next import succeeds above alpha's real max.
    const sync = await postJson(app.baseUrl, '/api/admin/sync-counters', {}, ADMIN());
    assert.equal(sync.status, 200);
    assert.equal(await app.alphaCounter('member_id'), maxMemberId);
    const ok = await upload('members', 'name\nBehind One\nBehind Two');
    assert.deepEqual(ok.body, { success: true, imported: 2 });
    assert.deepEqual((await app.alpha.Member.find({ name: /^Behind / }).sort({ id: 1 }).lean()).map((m) => m.id), [maxMemberId + 1, maxMemberId + 2]);
  } finally {
    // Whatever happened above, leave alpha's counter consistent with alpha's members (what sync-counters does) so a failure
    // here cannot cascade into later tests.
    const current = await app.alpha.Member.findOne().sort({ id: -1 }).lean();
    await app.alpha.Counter.findByIdAndUpdate('member_id', { $set: { seq: current.id } }, { upsert: true });
  }
  await app.assertIsolation(before, 'counter behind existing ids');
});

// ─── reserveIdRange itself (model-explicit, tenant-local) ───────────────────

test('reserveIdRange: count 0 reserves nothing (no counter write, empty range); invalid counts and unsupported counter names are rejected before ANY database operation', async () => {
  const { reserveIdRange } = require('../../routes/import');
  const before = await app.baseline();
  const c0 = await counters(ALL_IMPORT_COUNTERS);

  const ops = await recordingCounterOps(async () => {
    assert.deepEqual(await reserveIdRange(app.alpha, 'member_id', 0), []);
    for (const bad of [-1, 1.5, NaN, Infinity, 2 ** 53, '3', null, undefined, {}]) {
      await assert.rejects(() => reserveIdRange(app.alpha, 'member_id', bad), /count must be a non-negative integer/, `count ${String(bad)}`);
    }
    // Only the four import counters are acceptable names - never anything derived from elsewhere.
    for (const name of ['fine_id', 'welfare_id', 'notification_id', 'expense_id', '__proto__', 'constructor', '', 'member_id ', 'MEMBER_ID', 'member_id$', null, undefined, 42, {}, ['member_id']]) {
      await assert.rejects(() => reserveIdRange(app.alpha, name, 1), /unsupported counter/, `name ${String(name)}`);
    }
  });
  assert.deepEqual(ops, [], 'not one counter operation, on any database');
  assert.deepEqual(await counters(ALL_IMPORT_COUNTERS), c0);
  await app.assertIsolation(before, 'reserveIdRange validation');
  assert.deepEqual(await app.changedAlpha(before), []);
});

test('reserveIdRange yields exactly the ids and the counter state that N sequential getNextId() calls produce - for an existing counter and for an ABSENT (seeded) one - in a single operation on alpha', async () => {
  const { reserveIdRange } = require('../../routes/import');
  const before = await app.baseline();
  const prior = await app.alphaCounter('transaction_id');
  const counterDoc = () => app.alpha.Counter.findById('transaction_id').lean();
  try {
    for (const startAt of [null, 100]) { // null = the counter document does not exist yet
      const reset = () => (startAt === null
        ? app.alpha.Counter.deleteOne({ _id: 'transaction_id' })
        : app.alpha.Counter.findByIdAndUpdate('transaction_id', { $set: { seq: startAt } }, { upsert: true }));

      await reset();
      const sequentialIds = [];
      const sequentialOps = await recordingCounterOps(async () => { for (let i = 0; i < 4; i += 1) sequentialIds.push(await app.alpha.getNextId('transaction_id')); });
      const sequentialDoc = await counterDoc();

      await reset();
      let bulkIds;
      const bulkOps = await recordingCounterOps(async () => { bulkIds = await reserveIdRange(app.alpha, 'transaction_id', 4); });
      const bulkDoc = await counterDoc();

      assert.deepEqual(bulkIds, sequentialIds, `start ${startAt}: same ids`);
      assert.deepEqual(bulkIds, range((startAt ?? 0) + 1, 4), `start ${startAt}: contiguous from the counter`);
      assert.deepEqual(bulkDoc, sequentialDoc, `start ${startAt}: same counter document left behind`);
      assert.equal(sequentialOps.length, 4);
      assert.deepEqual(summarize(bulkOps), [reservation('transaction_id', 4)], `start ${startAt}: ONE operation instead of four`);
    }
  } finally {
    await restoreAlphaCounter('transaction_id', prior);
  }
  await app.assertIsolation(before, 'reserveIdRange equivalence');
});

test('concurrent reservations get disjoint contiguous blocks (one atomic $inc each) and the counter ends at their sum - and only alpha\'s counter is touched', async () => {
  const { reserveIdRange } = require('../../routes/import');
  const before = await app.baseline();
  const prior = await app.alphaCounter('member_id');
  const sizes = [5, 7, 3, 11];
  try {
    let ranges;
    const ops = await recordingCounterOps(async () => { ranges = await Promise.all(sizes.map((n) => reserveIdRange(app.alpha, 'member_id', n))); });
    assert.equal(ops.length, sizes.length, 'one operation per reservation');
    assert.ok(ops.every((o) => o.db === 'alpha'));
    ranges.forEach((ids, i) => {
      assert.equal(ids.length, sizes[i]);
      assert.deepEqual(ids, range(ids[0], sizes[i]), `reservation ${i} is contiguous`);
    });
    const total = sizes.reduce((a, b) => a + b, 0);
    assert.deepEqual(ranges.flat().sort((a, b) => a - b), range(prior + 1, total), 'disjoint blocks that together cover exactly prior+1 .. prior+total');
    assert.equal(await app.alphaCounter('member_id'), prior + total);
  } finally {
    await restoreAlphaCounter('member_id', prior);
  }
  await assertDefaultAndBetaCountersUntouched();
  await app.assertIsolation(before, 'concurrent reservations');
});

test('reserveIdRange without a usable tenant bundle fails loudly and never reaches another database (no fallback, no counter model taken from anywhere else)', async () => {
  const { reserveIdRange } = require('../../routes/import');
  const before = await app.baseline();
  const ops = await recordingCounterOps(async () => {
    await assert.rejects(() => reserveIdRange(undefined, 'member_id', 2), TypeError);
    await assert.rejects(() => reserveIdRange(null, 'member_id', 2), TypeError);
    await assert.rejects(() => reserveIdRange({}, 'member_id', 2), TypeError);
    // A bundle whose Counter is not a model fails loudly too - the helper never substitutes another one.
    await assert.rejects(() => reserveIdRange({ Counter: {} }, 'member_id', 2), TypeError);
  });
  assert.deepEqual(ops, [], 'no counter operation on alpha, beta or the default database');
  assert.deepEqual(await app.changedAlpha(before), []);
  await app.assertIsolation(before, 'reserveIdRange without a bundle');
});

// ─── contract / validation (unchanged) ──────────────────────────────────────

test('the CSV endpoint contract is unchanged: no file, empty CSV, unknown type and an unparsable row keep their status codes and messages, and write nothing outside alpha', async () => {
  const before = await app.baseline();
  const goodMembersCsv = 'name,phone\nValid Row,+255700';

  const noFile = await upload('members', null);
  assert.equal(noFile.status, 400);
  assert.deepEqual(noFile.body, { error: 'No file uploaded' });

  const empty = await upload('members', 'name,phone,office,status,entry_fee,join_date\n');
  assert.equal(empty.status, 400);
  assert.deepEqual(empty.body, { error: 'CSV file is empty' });

  const unknown = await upload('widgets', goodMembersCsv);
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body, { error: 'Invalid import type: widgets' });

  // Row without member_id: parseInt -> NaN, rejected by the model's validation. (The route logs these failures
  // with console.error; captured so the expected noise stays out of the report.)
  const { result: [invalid, nameless], logged } = await withCapturedConsoleError(async () => [
    await upload('contributions', 'member_id,amount,month,year\n,987123,7,2026'),
    // Name-less member row.
    await upload('members', 'name,phone\n,+255700'),
  ]);
  assert.equal(invalid.status, 500);
  assert.deepEqual(invalid.body, { error: 'Failed to process CSV file. Ensure you are using the correct headers.' });
  assert.equal(nameless.status, 500);
  assert.ok(logged.length >= 2, 'both failures are logged');

  assert.equal(await app.alpha.Contribution.countDocuments({ amount: 987123 }), 0);
  assert.equal(await app.alpha.Member.countDocuments({ phone: '+255700' }), 0);
  await app.assertIsolation(before, 'rejected imports');
  // Records are never written for a rejected CSV. (A CSV that fails model validation may leave unused
  // numeric ids behind - ids are allocated before insertMany - so the counters collection is excluded.)
  const changed = await app.changedAlpha(before);
  assert.deepEqual(changed.filter((name) => name !== app.collections.counters), []);
});

// ─── no request-selected database or tenant ─────────────────────────────────

test('multipart fields, query parameters and headers that name org_beta / tenant_beta are ignored: alpha is always written', async () => {
  const before = await app.baseline();
  const c0 = await counters(['member_id']);
  let response;
  const ops = await recordingCounterOps(async () => {
    response = await upload('members', 'name,phone\nHostile Selection Member,+255799', {
      fields: { organization_id: 'org_beta', database_name: 'tenant_beta', tenant: 'org_beta' },
      query: '?organization_id=org_beta&database_name=tenant_beta&tenant=org_beta',
      headers: { 'x-tenant-id': 'org_beta', 'x-organization-id': 'org_beta', 'x-database-name': 'tenant_beta' },
    });
  });
  const { status, body } = response;
  assert.deepEqual(summarize(ops), [reservation('member_id', 1)], 'the one reservation went to alpha\'s counter - no counter operation on beta or the default DB');
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { success: true, imported: 1 });
  const member = await app.alpha.Member.findOne({ name: 'Hostile Selection Member' }).lean();
  assert.equal(member.id, c0.member_id + 1);
  assert.equal(await app.beta.Member.countDocuments({ name: 'Hostile Selection Member' }), 0);
  await app.assertIsolation(before, 'hostile tenant selection');
});

// ─── auth semantics and the runtime-tenant gate ─────────────────────────────

test('import keeps its auth semantics and an org_beta / unknown-org token is rejected before the upload is even parsed', async () => {
  const before = await app.baseline();
  const csvFor = { members: 'name\nShould Not Exist', contributions: 'member_id,amount,month,year\n1,1,1,2026', loans: 'member_id,principal\n1,1' };
  for (const type of Object.keys(csvFor)) {
    assert.equal((await uploadCsv(app.baseUrl, type, csvFor[type], {})).status, 401, `${type} without a token`);
    const member = await uploadCsv(app.baseUrl, type, csvFor[type], { token: app.tokens.member1 });
    assert.equal(member.status, 403, `${type} as a member`);
    assert.equal(member.body.error, 'Admin only');
    for (const token of [app.tokens.betaAdmin, app.tokens.unknownOrgAdmin]) {
      const res = await uploadCsv(app.baseUrl, type, csvFor[type], { token });
      assert.equal(res.status, 403, `${type} with a non-runtime organization`);
      assert.match(res.body.error, /not a permitted runtime tenant/);
    }
  }
  await app.assertIsolation(before, 'rejected imports');
  assert.deepEqual(await app.changedAlpha(before), [], 'a rejected import writes nothing, not even to alpha');
});

// ─── missing tenant models: fail loudly, never fall back ────────────────────

test('without req.tenantModels the import handler fails loudly (500) for every type - there is no fallback to the poisoned, connected default DB', async () => {
  const router = require('../../routes/import');
  const before = await app.baseline();
  const csvFor = { members: 'name\nNo Fallback', contributions: 'member_id,amount,month,year\n1,1000,7,2026', loans: 'member_id,principal\n1,1000' };
  for (const [type, csv] of Object.entries(csvFor)) {
    // The handler catches, LOGS (console.error) and answers 500 - captured here so the expected noise stays out of the report.
    const { result: outcome, logged } = await withCapturedConsoleError(() => callHandlerWithoutTenantModels(router, 'post', '/:type', {
      params: { type }, file: { buffer: Buffer.from(csv, 'utf-8') },
    }));
    assertFailedBecauseTenantModelsAreMissing(outcome, logged, `import ${type}`);
    if (!outcome.threw) {
      assert.equal(outcome.status, 500);
      assert.ok(logged.length > 0, `${type}: the failure must also be logged`);
    }
  }
  await app.assertIsolation(before, 'import handler without tenant models');
  assert.deepEqual(await app.changedAlpha(before), []);
});

test('across the whole file the default and beta databases are byte-for-byte what they were at the start', async () => {
  await app.assertIsolation(globalBaseline, 'whole import suite');
});
