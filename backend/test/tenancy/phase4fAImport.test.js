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
// transaction_id). These tests prove those ids come from tenant_alpha's
// sequences - never from the default database's (5000+) or beta's (7000+).
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
    await upload('contributions', 'member_id,amount,month,year\n,1000,7,2026'),
    // Name-less member row.
    await upload('members', 'name,phone\n,+255700'),
  ]);
  assert.equal(invalid.status, 500);
  assert.deepEqual(invalid.body, { error: 'Failed to process CSV file. Ensure you are using the correct headers.' });
  assert.equal(nameless.status, 500);
  assert.ok(logged.length >= 2, 'both failures are logged');

  assert.equal(await app.alpha.Contribution.countDocuments({ amount: 1000 }), 0);
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
  const { status, body } = await upload('members', 'name,phone\nHostile Selection Member,+255799', {
    fields: { organization_id: 'org_beta', database_name: 'tenant_beta', tenant: 'org_beta' },
    query: '?organization_id=org_beta&database_name=tenant_beta&tenant=org_beta',
    headers: { 'x-tenant-id': 'org_beta', 'x-organization-id': 'org_beta', 'x-database-name': 'tenant_beta' },
  });
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
