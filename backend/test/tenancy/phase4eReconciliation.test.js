// Phase 4E proof that routes/reconciliation.js is tenant-scoped end to end:
// preview, apply (a real multi-document MongoDB transaction), idempotency,
// hash conflict, rollback, latest and status - through the real Express
// server, real authenticate, real tenant resolution and real HTTP, on a
// disposable MongoMemoryReplSet (transactions require a replica set).
//
// The reconciliation transaction must run on a session that comes from the
// TENANT connection (models.ReconciliationRun.db.startSession()), and every
// write inside it must land in tenant_alpha only. The default/legacy database
// is poisoned with an "already reconciled" copy of the world (same names, same
// run keys, already-applied runs, matching ledgers), so a single default-bound
// read would change a preview, short-circuit an apply to "idempotent", or hide
// a hash conflict. tenant_beta must never change.
//
// Ordering matters: tests run top to bottom against ONE alpha database.
// Failure/rollback scenarios come first (against the pristine ledger), then the
// successful apply, then idempotency and the read endpoints.

const crypto = require('node:crypto');
const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const {
  startPhase4eTestApp, stopPhase4eTestApp, snapshotModels, assertSnapshotEqual,
} = require('./helpers/phase4eTestApp');
const { getJson, postJson } = require('./helpers/httpJson');

const SCHEMA = 'checkpoint-reconciliation-v1';
const GEN = {
  main: '2026-10-10T00:00:00Z',            // the successful apply
  activeMissing: '2026-10-20T00:00:00Z',   // rollback: "Active member missing from production"
  fineExceeds: '2026-10-21T00:00:00Z',     // rollback: "Fine total exceeds source"
  lateAuditCast: '2026-10-22T00:00:00Z',   // rollback: fails on the LAST write of the transaction
  statusProbe: '2026-10-24T00:00:00Z',     // a failed run created AFTER the successful one
};

const runKeyOf = (source) => `${SCHEMA}:${source.generated_on}`;
const hashOf = (source) => crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');

let app;

// Every request here goes to a real in-process Express 4 server. If a regression made a route throw
// inside an async handler the request would never be answered, so each test is bounded: it FAILS
// quickly instead of hanging the whole suite.
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);
let base;        // default + beta snapshots taken AFTER this file's extra default-DB poison
let PRISTINE;    // alpha counter values before any apply
let firstApplyResult;

// ─── source builders ────────────────────────────────────────────────────────

function baseSource(generatedOn, extra = {}) {
  return {
    schema_version: SCHEMA,
    generated_on: generatedOn,
    club: { reporting_cutoff: { Y3_loans: '2026-10-01', contributions: '2026-10-01' } },
    master_totals: { current_mkoba_cash_tzs: 1234567 },
    reconciliation_flags: [],
    member_alias_map: [],
    members: [],
    contribution_ledgers: [],
    loan_ledgers: { Y1_standardised: [], Y2_primary_ledger: [], Y3_current_snapshot: [] },
    investments: [],
    audit_form_contributions: [],
    audit_loan_requests: [],
    pending_review: [],
    ...extra,
  };
}

const noFines = { all_years_paid_tzs: 0, source_unpaid_fines_tzs: 0 };

// The full fixture. Against the pristine alpha ledger it exercises: Former/Y1-only
// member creation, contribution create + update (+ void), loan create + update,
// repayment signed adjustments, fine adjustments (paid + unpaid), an investment
// upsert and audit-record upserts.
function mainSource({ generatedOn = GEN.main, auditRows } = {}) {
  const FY = app.FY;
  return baseSource(generatedOn, {
    reconciliation_flags: [{ code: 'FIXTURE', note: 'phase 4e fixture flag' }],
    members: [
      { member: 'Alpha Active One', membership_status: 'Active', fines: { all_years_paid_tzs: 8000, source_unpaid_fines_tzs: 3500 } },
      { member: 'Alpha Active Two', membership_status: 'Active', fines: { all_years_paid_tzs: 7000, source_unpaid_fines_tzs: 2000 } },
      { member: 'Former Y1 Only Person', membership_status: 'Former / Y1 only', fines: noFines },
    ],
    contribution_ledgers: [{
      ledger: 'Y3',
      members: [
        { member: 'Alpha Active One', entry_fee_tzs: 100000, months: [
          { period: `Mar ${FY}`, amount_tzs: 80000 }, // alpha holds 75000 -> UPDATE
          { period: `Apr ${FY}`, amount_tzs: 75000 }, // alpha holds 75000 -> unchanged
          { period: `May ${FY}`, amount_tzs: 75000 }, // none -> CREATE
        ] },
        { member: 'Alpha Active Two', entry_fee_tzs: 120000, months: [
          { period: `Mar ${FY}`, amount_tzs: 0 },     // alpha holds 75000 -> UPDATE to 0 (void)
        ] },
        { member: 'Former Y1 Only Person', entry_fee_tzs: 90000, months: [
          { period: 'Mar 2024', amount_tzs: 50000 }, // CREATE for the new former member
        ] },
      ],
    }],
    loan_ledgers: {
      Y1_standardised: [
        { member: 'Former Y1 Only Person', loan_number: 'Y1-1', issue_date: '2024-04-01', principal: 100000, interest_rate: 0.05, interest: 5000, net_disbursed: 95000, total_repayments: 105000 },
      ],
      Y2_primary_ledger: [
        // matches alpha loan 2 (member two, 2025-03-15): UPDATE, repayments 20000 -> 50000 (+30000 adjustment)
        { member: 'Alpha Active Two', loan_number: 'Loan 2', issue_date: '2025-03-15', principal: 200000, interest_rate: 0.1, interest: 20000, net_disbursed: 180000, repayments_y2: 20000, repayments_y3: 30000, current_balance: 150000 },
      ],
      Y3_current_snapshot: [
        // matches alpha loan 1 (member one, 2026-04-01): UPDATE, repayments already 150000 (no adjustment)
        { member: 'Alpha Active One', is_new_y3: true, loan_number: 'Loan 1', issue_date: '2026-04-01', principal: 400000, interest_rate: 0.12, interest: 48000, net_disbursed: 352000, repayments_y3: 150000, current_balance: 250000 },
        // not new in Y3 -> ignored by the reconciliation
        { member: 'Alpha Active One', is_new_y3: false, loan_number: 'Loan 0', issue_date: '2025-06-01', principal: 100000, interest_rate: 0.05, interest: 10000, net_disbursed: 90000, repayments_y3: 0, current_balance: 0 },
        // no such loan in alpha: CREATE
        { member: 'Alpha Active Two', is_new_y3: true, loan_number: 'Loan 4', issue_date: '2026-10-01', principal: 250000, interest_rate: 0.12, interest: 30000, net_disbursed: 220000, repayments_y3: 0, current_balance: 250000 },
      ],
    },
    investments: [
      { provider: 'Reconciled Fund A', amount_tzs: 500000, status: 'active', verification_status: 'verified', action_required: null },
    ],
    audit_form_contributions: auditRows || [
      { source_row: 2, review_status: 'unposted', member: 'Alpha Active One', amount: 75000 },
      { source_row: 3, review_status: 'unposted', member: 'Alpha Active Two', amount: 75000 },
    ],
    audit_loan_requests: [
      { source_row: 2, member: 'Alpha Active Two', amount: 250000 },
    ],
  });
}

// Fails inside the transaction on a rule that already exists in the route:
// a Former member is created first (and the member_id counter advances inside the
// transaction), then the next member is Active and absent from alpha.
function activeMissingSource(generatedOn = GEN.activeMissing, extra = {}) {
  return baseSource(generatedOn, {
    members: [
      { member: 'Rollback Former Person', membership_status: 'Former / Y1 only', fines: noFines },
      { member: 'Missing Active Person', membership_status: 'Active', fines: noFines },
    ],
    contribution_ledgers: [{ ledger: 'Y3', members: [{ member: 'Rollback Former Person', entry_fee_tzs: 70000, months: [] }] }],
    ...extra,
  });
}

// Fails LATE via the existing "Fine total exceeds source" rule: by then the transaction has already
// created a member, changed/created contributions, created/updated loans, written repayment
// adjustments and written a fine adjustment for the first member.
function fineExceedsSource() {
  const FY = app.FY;
  return baseSource(GEN.fineExceeds, {
    members: [
      { member: 'Alpha Active One', membership_status: 'Active', fines: { all_years_paid_tzs: 9000, source_unpaid_fines_tzs: 3500 } },
      { member: 'Alpha Active Two', membership_status: 'Active', fines: { all_years_paid_tzs: 1000, source_unpaid_fines_tzs: 0 } }, // alpha already holds 7000 paid -> throws
      { member: 'Rollback Former Person', membership_status: 'Former / Y1 only', fines: noFines },
    ],
    contribution_ledgers: [{
      ledger: 'Y3',
      members: [
        { member: 'Alpha Active One', entry_fee_tzs: 100000, months: [{ period: `Mar ${FY}`, amount_tzs: 90000 }, { period: `May ${FY}`, amount_tzs: 60000 }] },
        { member: 'Rollback Former Person', entry_fee_tzs: 70000, months: [{ period: 'Mar 2024', amount_tzs: 40000 }] },
      ],
    }],
    loan_ledgers: {
      Y1_standardised: [
        { member: 'Rollback Former Person', loan_number: 'RB-1', issue_date: '2024-05-01', principal: 80000, interest_rate: 0.05, interest: 4000, net_disbursed: 76000, total_repayments: 84000 },
      ],
      Y2_primary_ledger: [
        { member: 'Alpha Active Two', loan_number: 'Loan 2', issue_date: '2025-03-15', principal: 200000, interest_rate: 0.1, interest: 20000, net_disbursed: 180000, repayments_y2: 20000, repayments_y3: 40000, current_balance: 140000 },
      ],
      Y3_current_snapshot: [
        { member: 'Alpha Active One', is_new_y3: true, loan_number: 'Loan X', issue_date: '2026-10-02', principal: 50000, interest_rate: 0.12, interest: 6000, net_disbursed: 44000, repayments_y3: 10000, current_balance: 40000 },
      ],
    },
  });
}

async function setAlphaCounters(values) {
  for (const [name, seq] of Object.entries(values)) {
    await app.alpha.Counter.updateOne({ _id: name }, { $set: { seq } }, { upsert: true });
  }
}

// Observes (and calls straight through to) startSession on both connections so the test can state
// exactly which connection the route's transaction session came from. Not a mock of the route.
function observeStartSession() {
  const tenantConn = app.alpha.ReconciliationRun.db;
  const defaultConn = app.mongoose.connection;
  const calls = { tenant: 0, defaultConnection: 0 };
  const real = Object.getPrototypeOf(tenantConn).startSession; // inherited Connection.prototype method
  tenantConn.startSession = function observed(...args) { calls.tenant += 1; return real.apply(this, args); };
  defaultConn.startSession = function observed(...args) { calls.defaultConnection += 1; return real.apply(this, args); };
  return {
    calls,
    restore() { delete tenantConn.startSession; delete defaultConn.startSession; },
  };
}

// The default/legacy DB gets a complete, already-reconciled copy of the world for the main source plus
// an already-APPLIED run for every run key this file uses.
async function poisonDefaultWithAlreadyReconciledCopy() {
  const D = app.defaultModels;
  const FY = app.FY;
  await D.Member.create([
    { id: 7001, name: 'Alpha Active One', status: 'active', entry_fee: 100000 },
    { id: 7002, name: 'Alpha Active Two', status: 'active', entry_fee: 120000 },
    { id: 7003, name: 'Former Y1 Only Person', status: 'former', entry_fee: 90000 },
  ]);
  await D.Contribution.create([
    { id: 7001, member_id: 7001, amount: 80000, month: 3, year: FY, status: 'paid' },
    { id: 7002, member_id: 7001, amount: 75000, month: 4, year: FY, status: 'paid' },
    { id: 7003, member_id: 7001, amount: 75000, month: 5, year: FY, status: 'paid' },
    { id: 7004, member_id: 7003, amount: 50000, month: 3, year: 2024, status: 'paid' },
  ]);
  const loans = [
    { id: 7001, member_id: 7003, loan_number: 'Y1-1', principal: 100000, interest_rate: 0.05, interest_amount: 5000, issued_date: '2024-04-01', status: 'paid', fiscal_year: 2024 },
    { id: 7002, member_id: 7002, loan_number: 'Loan 2', principal: 200000, interest_rate: 0.1, interest_amount: 20000, issued_date: '2025-03-15', status: 'active', fiscal_year: 2025 },
    { id: 7003, member_id: 7001, loan_number: 'Loan 1', principal: 400000, interest_rate: 0.12, interest_amount: 48000, issued_date: '2026-04-01', status: 'active', fiscal_year: 2026 },
    { id: 7004, member_id: 7002, loan_number: 'Loan 4', principal: 250000, interest_rate: 0.12, interest_amount: 30000, issued_date: '2026-10-01', status: 'active', fiscal_year: 2026 },
  ];
  await D.Loan.create(loans);
  await D.Repayment.create([
    { id: 7001, loan_id: 7001, amount: 105000 },
    { id: 7002, loan_id: 7002, amount: 50000 },
    { id: 7003, loan_id: 7003, amount: 150000 },
  ]);
  await D.AuditSourceRecord.create([
    { reconciliation_run: `${SCHEMA}:${GEN.main}`, source_type: 'google_form_contribution', source_row: 2, review_status: 'unposted', posted: false, payload: { sentinel: true } },
  ]);
  await D.ReconciliationRun.create(Object.values(GEN).map((generatedOn) => ({
    run_key: `${SCHEMA}:${generatedOn}`, source_hash: 'default-sentinel-already-applied', schema_version: SCHEMA,
    source_generated_on: generatedOn, reporting_cutoff: { Y3_loans: '2026-10-01', contributions: '2026-10-01' },
    source_summary: { current_mkoba_cash_tzs: 8888888 }, backup: {}, result: { sentinel: true, members_created: 99 },
    status: 'applied', applied_by: 'DEFAULT SENTINEL', applied_at: new Date('2026-10-30T00:00:00Z'), created_at: new Date('2026-10-30T00:00:00Z'),
  })));
}

before(async () => {
  app = await startPhase4eTestApp();
  await poisonDefaultWithAlreadyReconciledCopy();
  base = await app.baseline();
  PRISTINE = {};
  for (const name of ['member_id', 'contribution_id', 'loan_id', 'repayment_id', 'fine_id']) {
    PRISTINE[name] = await app.alphaCounter(name);
  }
}, { timeout: 120000 });

after(async () => {
  await stopPhase4eTestApp();
});

// ═════════════════════════════════════════════════════════════════════════════
// (a) tenant connection + replica-set transaction infrastructure
// ═════════════════════════════════════════════════════════════════════════════

test('every model the reconciliation touches is bound to the SAME tenant connection object (not the default, not beta)', async () => {
  const names = ['Member', 'Contribution', 'Loan', 'Repayment', 'Fine', 'Investment', 'Counter', 'ReconciliationRun', 'AuditSourceRecord'];
  const tenantConnection = app.alpha.Member.db;

  for (const name of names) {
    assert.strictEqual(app.alpha[name].db, tenantConnection, `alpha.${name}.db must be the one tenant connection`);
    assert.notStrictEqual(app.alpha[name].db, app.mongoose.connection, `alpha.${name} must not be on the default connection`);
    assert.notStrictEqual(app.alpha[name].db, app.beta[name].db, `alpha.${name} must not share beta's connection`);
    assert.strictEqual(app.defaultModels[name].db, app.mongoose.connection, `default ${name} sits on the default connection`);
  }
  assert.equal(tenantConnection.name, 'tenant_alpha');
  assert.equal(app.mongoose.connection.name, 'checkpoint_legacy_unused');

  // The models an authenticated request receives (req.tenantModels) come from the same trusted path
  // and therefore share that exact connection object.
  const requestModels = await app.getTenantModels({ organization_id: 'org_checkpoint_investors' });
  for (const name of names) {
    assert.strictEqual(requestModels[name].db, tenantConnection, `req.tenantModels.${name}.db`);
  }
});

test('the disposable cluster is a real replica set and a transaction on a tenant-connection session commits to tenant_alpha only and aborts atomically', async () => {
  const hello = await app.mongoose.connection.db.admin().command({ hello: 1 });
  assert.ok(hello.setName, 'transactions need a replica set');
  assert.equal(hello.isWritablePrimary, true);

  const before = await snapshotModels(app.alpha);
  const session = await app.alpha.ReconciliationRun.db.startSession();
  await assert.rejects(
    session.withTransaction(async () => {
      await app.alpha.Member.create([{ id: 999, name: 'aborted member' }], { session });
      await app.alpha.Counter.findByIdAndUpdate('member_id', { $inc: { seq: 1 } }, { upsert: true, session });
      throw new Error('abort on purpose');
    }),
    /abort on purpose/
  );
  await session.endSession();
  assertSnapshotEqual(before, await snapshotModels(app.alpha), 'an aborted tenant-session transaction must leave no trace');
  assert.equal(await app.defaultModels.Member.findOne({ id: 999 }).lean(), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// (g, part 1) latest / status before any apply
// ═════════════════════════════════════════════════════════════════════════════

test('GET /latest and /status return alpha\'s seeded run; the default same-key run and the far-future default run are invisible', async () => {
  const latest = await getJson(app.baseUrl, '/api/reconciliation/latest', app.tokens.admin);
  assert.equal(latest.status, 200);
  assert.equal(latest.body.run_key, app.ALPHA_RUN_KEY);
  assert.equal(latest.body.source_summary.current_mkoba_cash_tzs, 750000);
  assert.equal(latest.body.applied_by, 'alpha_admin');
  assert.equal(latest.body.backup, undefined, 'backup is never returned');

  const status = await getJson(app.baseUrl, '/api/reconciliation/status', app.tokens.admin);
  assert.equal(status.status, 200);
  assert.equal(status.body.run_key, app.ALPHA_RUN_KEY);
  assert.equal(status.body.source_summary.current_mkoba_cash_tzs, 750000);
  assert.equal(status.body.backup, undefined);
});

// ═════════════════════════════════════════════════════════════════════════════
// (b) preview
// ═════════════════════════════════════════════════════════════════════════════

test('POST /preview: current counts and proposed deltas come from alpha only; a same-run_key APPLIED default run does not make it already_applied', async () => {
  const source = mainSource();
  const alphaBefore = await snapshotModels(app.alpha);

  // Poison preconditions: the default DB says this run is applied and everything is reconciled; alpha knows nothing.
  assert.ok(await app.defaultModels.ReconciliationRun.exists({ run_key: runKeyOf(source), status: 'applied' }));
  assert.equal(await app.alpha.ReconciliationRun.exists({ run_key: runKeyOf(source) }), null);

  const { status, body } = await postJson(app.baseUrl, '/api/reconciliation/preview', source, app.tokens.admin);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, {
    run_key: runKeyOf(source),
    source_hash: hashOf(source),
    already_applied: false,
    current: { members: 3, contributions: 4, loans: 4, repayments: 3, fines: 3 },
    proposed: {
      missing_members: ['Former Y1 Only Person'],
      contribution_month_changes: 4, // one-Mar update, one-May create, two-Mar void, former create
      missing_loans: 2,              // the Y1 former loan and the new "Loan 4"
      changed_loans: 1,              // loan 2 (repayments 20000 -> 50000)
      audit_form_records: 3,
      investments: 1,
    },
    blocked_from_posting: [],
  });

  // Preview is read-only everywhere.
  assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), 'preview must not write to alpha');
  await app.assertIsolation(base, 'preview');
});

// ═════════════════════════════════════════════════════════════════════════════
// validation + auth semantics + tenant gate
// ═════════════════════════════════════════════════════════════════════════════

test('malformed sources are rejected with 400 and create no run; auth semantics are unchanged', async () => {
  const alphaBefore = await snapshotModels(app.alpha);

  for (const path of ['/api/reconciliation/preview', '/api/reconciliation/apply']) {
    const bad = await postJson(app.baseUrl, path, {}, app.tokens.admin);
    assert.equal(bad.status, 400, path);
    assert.equal(bad.body.error, 'Unsupported or incomplete reconciliation file');
    assert.equal((await postJson(app.baseUrl, path, mainSource())).status, 401, `${path} anonymous`);
    assert.equal((await postJson(app.baseUrl, path, mainSource(), app.tokens.member1)).status, 403, `${path} as member`);
  }
  assert.equal((await getJson(app.baseUrl, '/api/reconciliation/latest')).status, 401);
  assert.equal((await getJson(app.baseUrl, '/api/reconciliation/latest', app.tokens.member1)).status, 200, 'latest only needs authentication');
  assert.equal((await getJson(app.baseUrl, '/api/reconciliation/status')).status, 401);
  assert.equal((await getJson(app.baseUrl, '/api/reconciliation/status', app.tokens.member1)).status, 403, 'status is admin-only');

  assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), 'rejected requests must not write');
  await app.assertIsolation(base, 'rejected requests');
});

test('org_beta is never runtime-activated: a valid org_beta token is rejected on every reconciliation route and nothing is written anywhere', async () => {
  const alphaBefore = await snapshotModels(app.alpha);
  const token = app.tokens.betaAdmin;

  for (const res of [
    await postJson(app.baseUrl, '/api/reconciliation/preview', mainSource(), token),
    await postJson(app.baseUrl, '/api/reconciliation/apply', mainSource(), token),
    await getJson(app.baseUrl, '/api/reconciliation/latest', token),
    await getJson(app.baseUrl, '/api/reconciliation/status', token),
  ]) {
    assert.equal(res.status, 403);
    assert.match(res.body.error, /not a permitted runtime tenant/);
  }
  assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), 'org_beta token must not touch alpha');
  await app.assertIsolation(base, 'org_beta token');
});

// ═════════════════════════════════════════════════════════════════════════════
// (f) rollback - against the pristine alpha ledger
// ═════════════════════════════════════════════════════════════════════════════

test('rollback (existing rule): a Former member is created and counters are synced INSIDE the transaction, then "Active member missing from production" aborts all of it', async () => {
  // Put the member counter BEHIND the highest member id so the in-transaction sync really writes, then check it comes back.
  await setAlphaCounters({ member_id: 1 });
  try {
    const source = activeMissingSource();
    const alphaBefore = await snapshotModels(app.alpha);

    const { status, body } = await postJson(app.baseUrl, '/api/reconciliation/apply', source, app.tokens.admin);
    assert.equal(status, 500, JSON.stringify(body));
    assert.equal(body.error, 'Active member missing from production: Missing Active Person');
    assert.equal(body.run_key, runKeyOf(source));

    // The run record is OUTSIDE the transaction: it must exist in alpha, marked failed.
    const run = await app.alpha.ReconciliationRun.findOne({ run_key: runKeyOf(source) }).lean();
    assert.equal(run.status, 'failed');
    assert.equal(run.result.error, body.error);
    assert.equal(run.source_hash, hashOf(source));
    assert.equal(run.applied_at, null);
    assert.equal(run.backup.members.length, 3, 'the pre-apply backup was captured from alpha');

    // Nothing else changed: no Member (the Former one was created in-transaction), no counter movement.
    const alphaAfter = await snapshotModels(app.alpha);
    assertSnapshotEqual(alphaBefore, alphaAfter, 'rolled-back apply must leave tenant_alpha unchanged', { except: ['ReconciliationRun'] });
    assert.equal(await app.alpha.Member.findOne({ name: 'Rollback Former Person' }).lean(), null);
    assert.equal(await app.alphaCounter('member_id'), 1, 'the counter sync AND the in-transaction increment must be rolled back');
    assert.equal(await app.alpha.ReconciliationRun.countDocuments(), 2, 'seeded run + this failed run');
  } finally {
    await setAlphaCounters({ member_id: PRISTINE.member_id });
  }
  await app.assertIsolation(base, 'rollback: active member missing');
});

test('hash conflict: re-sending a FAILED run_key with altered content is rejected with 409 and writes nothing (an applied default run with that key does not mask it)', async () => {
  const failed = activeMissingSource();
  const altered = activeMissingSource(GEN.activeMissing, { master_totals: { current_mkoba_cash_tzs: 1 } });
  assert.equal(runKeyOf(altered), runKeyOf(failed), 'same run_key / generated_on');
  assert.notEqual(hashOf(altered), hashOf(failed), 'different content');
  assert.ok(await app.defaultModels.ReconciliationRun.exists({ run_key: runKeyOf(failed), status: 'applied' }), 'poison precondition');

  const alphaBefore = await snapshotModels(app.alpha);
  const { status, body } = await postJson(app.baseUrl, '/api/reconciliation/apply', altered, app.tokens.admin);
  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error, 'Run key already exists with a different source hash');

  assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), '409 must not write anything to tenant_alpha (the failed run is untouched too)');
  const run = await app.alpha.ReconciliationRun.findOne({ run_key: runKeyOf(failed) }).lean();
  assert.equal(run.status, 'failed');
  assert.equal(run.source_hash, hashOf(failed));
  await app.assertIsolation(base, '409 conflict');
});

test('rollback (existing rule, LATE): "Fine total exceeds source" aborts after members, contributions, loans, repayments and a fine adjustment were written inside the transaction', async () => {
  await setAlphaCounters({ contribution_id: 2, loan_id: 1, repayment_id: 1, fine_id: 0 });
  try {
    const source = fineExceedsSource();
    const alphaBefore = await snapshotModels(app.alpha);

    const { status, body } = await postJson(app.baseUrl, '/api/reconciliation/apply', source, app.tokens.admin);
    assert.equal(status, 500, JSON.stringify(body));
    assert.equal(body.error, 'Fine total exceeds source for Alpha Active Two (paid)');

    assert.equal((await app.alpha.ReconciliationRun.findOne({ run_key: runKeyOf(source) }).lean()).status, 'failed');
    assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), 'late rollback must leave tenant_alpha unchanged', { except: ['ReconciliationRun'] });

    // Spell out the models the transaction had written to before it failed.
    assert.equal(await app.alpha.Member.findOne({ name: 'Rollback Former Person' }).lean(), null);
    assert.equal((await app.alpha.Contribution.findOne({ id: app.fx.alpha.contributions.c1.id }).lean()).amount, 75000, 'contribution update rolled back');
    assert.equal(await app.alpha.Contribution.countDocuments({ mpesa_ref: /^recon:/ }), 0);
    assert.equal(await app.alpha.Loan.countDocuments({ loan_number: { $in: ['RB-1', 'Loan X'] } }), 0);
    assert.equal((await app.alpha.Loan.findOne({ id: app.fx.alpha.loans.l2.id }).lean()).notes ?? null, null, 'loan update rolled back');
    assert.equal(await app.alpha.Repayment.countDocuments({ mpesa_ref: /^recon:/ }), 0);
    assert.equal(await app.alpha.Fine.countDocuments({ reconciliation_key: /^recon:/ }), 0);
    assert.deepEqual(
      [await app.alphaCounter('contribution_id'), await app.alphaCounter('loan_id'), await app.alphaCounter('repayment_id'), await app.alphaCounter('fine_id')],
      [2, 1, 1, 0],
      'every counter moved inside the transaction must be back at its pre-apply value'
    );
  } finally {
    await setAlphaCounters({
      contribution_id: PRISTINE.contribution_id, loan_id: PRISTINE.loan_id,
      repayment_id: PRISTINE.repayment_id, fine_id: PRISTINE.fine_id,
    });
  }
  await app.assertIsolation(base, 'rollback: fine total exceeds source');
});

test('rollback (LAST write): an uncastable audit row fails the final bulkWrite AFTER every other model - including the investment upsert - was written, and all of it is rolled back', async () => {
  // Identical to the successful fixture below except for one malformed audit row, so the only difference
  // between "applied" and "rolled back" is the final write.
  const source = mainSource({
    generatedOn: GEN.lateAuditCast,
    auditRows: [{ source_row: 'not-a-number', review_status: 'unposted', member: 'Alpha Active One', amount: 1 }],
  });
  await setAlphaCounters({ loan_id: 0, repayment_id: 1 });
  try {
    const alphaBefore = await snapshotModels(app.alpha);

    const { status, body } = await postJson(app.baseUrl, '/api/reconciliation/apply', source, app.tokens.admin);
    assert.equal(status, 500, JSON.stringify(body));
    assert.match(body.error, /Cast to Number failed.*source_row/);

    assert.equal((await app.alpha.ReconciliationRun.findOne({ run_key: runKeyOf(source) }).lean()).status, 'failed');
    assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), 'last-write rollback must leave tenant_alpha unchanged', { except: ['ReconciliationRun'] });

    assert.equal(await app.alpha.Member.countDocuments(), 3, 'no Former member');
    assert.equal(await app.alpha.Contribution.countDocuments({ mpesa_ref: /^recon:/ }), 0);
    assert.equal(await app.alpha.Loan.countDocuments(), 4);
    assert.equal(await app.alpha.Repayment.countDocuments({ mpesa_ref: /^recon:/ }), 0);
    assert.equal(await app.alpha.Fine.countDocuments({ reconciliation_key: /^recon:/ }), 0);
    assert.equal(await app.alpha.Investment.countDocuments({ reconciliation_key: /^recon:/ }), 0, 'investment upsert rolled back');
    assert.equal(await app.alpha.AuditSourceRecord.countDocuments(), 0);
    assert.equal(await app.alphaCounter('loan_id'), 0);
    assert.equal(await app.alphaCounter('repayment_id'), 1);
  } finally {
    await setAlphaCounters({ loan_id: PRISTINE.loan_id, repayment_id: PRISTINE.repayment_id });
  }
  await app.assertIsolation(base, 'rollback: last write');
});

// ═════════════════════════════════════════════════════════════════════════════
// (c) the successful apply
// ═════════════════════════════════════════════════════════════════════════════

test('POST /apply: runs a transaction on a TENANT-connection session and writes every model to alpha only, with ids from alpha counters', async () => {
  // Counters BEHIND the highest ids: without the in-transaction syncCounter the first create would reuse an
  // existing id and fail on the unique index, so success proves the sync ran against alpha's own counters.
  await setAlphaCounters({ loan_id: 0, repayment_id: 1 });
  const source = mainSource();
  const runKey = runKeyOf(source);
  const FY = app.FY;
  const M1 = app.fx.alpha.members.one;
  const M2 = app.fx.alpha.members.two;
  const defaultCountersBefore = {};
  for (const name of Object.keys(app.DEFAULT_COUNTERS)) defaultCountersBefore[name] = await app.defaultCounter(name);
  const betaCountersBefore = {};
  for (const name of Object.keys(app.BETA_COUNTERS)) betaCountersBefore[name] = await app.betaCounter(name);

  const spy = observeStartSession();
  let res;
  try {
    res = await postJson(app.baseUrl, '/api/reconciliation/apply', source, app.tokens.admin);
  } finally {
    spy.restore();
  }
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.idempotent, false);
  assert.equal(res.body.run_key, runKey);
  assert.equal(res.body.source_hash, hashOf(source));
  firstApplyResult = res.body.result;
  assert.deepEqual(firstApplyResult, {
    members_created: 1,
    contributions_created: 2,
    contributions_updated: 2,
    loans_created: 2,
    loans_updated: 2,
    repayment_adjustments_created: 2,
    fine_adjustments_created: 2,
    investments_upserted: 1,
    audit_records_upserted: 3,
  });

  // The transaction's session came from the TENANT connection, never from the default connection.
  assert.deepEqual(spy.calls, { tenant: 1, defaultConnection: 0 });

  // ReconciliationRun lifecycle: applying -> applied, in alpha.
  const run = await app.alpha.ReconciliationRun.findOne({ run_key: runKey }).lean();
  assert.equal(run.status, 'applied');
  assert.deepEqual(run.result, firstApplyResult);
  assert.equal(run.source_hash, hashOf(source));
  assert.equal(run.applied_by, 'alpha_admin', 'applied_by is req.user.username');
  assert.ok(run.applied_at instanceof Date);
  assert.deepEqual(run.source_summary, { current_mkoba_cash_tzs: 1234567 });
  assert.deepEqual(run.flags, [{ code: 'FIXTURE', note: 'phase 4e fixture flag' }]);
  assert.equal(run.backup.members.length, 3, 'backup holds the pre-apply alpha ledger');
  assert.equal(run.backup.fines.length, 3);

  const note = `Reconciled from ${runKey}; originals retained in ReconciliationRun backup`;

  // Member: Former / Y1-only created in alpha, id from alpha's member counter (3 -> 4).
  const former = await app.alpha.Member.findOne({ name: 'Former Y1 Only Person' }).lean();
  assert.deepEqual(
    { id: former.id, office: former.office, status: former.status, entry_fee: former.entry_fee, join_date: former.join_date },
    { id: 4, office: 'member', status: 'former', entry_fee: 90000, join_date: '2024-01-01' }
  );

  // Contributions: 1 updated (80000), 1 voided (0), 2 created with sequential alpha ids.
  const c1 = await app.alpha.Contribution.findOne({ id: app.fx.alpha.contributions.c1.id }).lean();
  assert.equal(c1.amount, 80000);
  assert.equal(c1.status, 'paid');
  assert.equal(c1.notes, note);
  const c3 = await app.alpha.Contribution.findOne({ id: app.fx.alpha.contributions.c3.id }).lean();
  assert.deepEqual([c3.amount, c3.status, c3.notes], [0, 'reconciled_void', note]);
  const may = await app.alpha.Contribution.findOne({ member_id: M1.id, month: 5, year: FY }).lean();
  assert.deepEqual(
    { id: may.id, amount: may.amount, status: may.status, paid_date: may.paid_date, mpesa_ref: may.mpesa_ref },
    { id: 5, amount: 75000, status: 'paid', paid_date: `${FY}-05-01`, mpesa_ref: `recon:${runKey}:${M1.id}:${FY}-5` }
  );
  const formerContribution = await app.alpha.Contribution.findOne({ member_id: former.id, month: 3, year: 2024 }).lean();
  assert.deepEqual([formerContribution.id, formerContribution.amount], [6, 50000]);

  // Loans: Y1 former loan + Y3 "Loan 4" created (ids 5, 6); loans 1 and 2 updated in place.
  const y1Loan = await app.alpha.Loan.findOne({ loan_number: 'Y1-1' }).lean();
  assert.deepEqual(
    { id: y1Loan.id, member_id: y1Loan.member_id, principal: y1Loan.principal, interest_amount: y1Loan.interest_amount, amount_deposited: y1Loan.amount_deposited, status: y1Loan.status, fiscal_year: y1Loan.fiscal_year, issued_date: y1Loan.issued_date },
    { id: 5, member_id: former.id, principal: 100000, interest_amount: 5000, amount_deposited: 95000, status: 'paid', fiscal_year: 2024, issued_date: '2024-04-01' }
  );
  const loan4 = await app.alpha.Loan.findOne({ loan_number: 'Loan 4', member_id: M2.id }).lean();
  assert.deepEqual(
    { id: loan4.id, principal: loan4.principal, status: loan4.status, fiscal_year: loan4.fiscal_year, issued_date: loan4.issued_date, amount_deposited: loan4.amount_deposited },
    { id: 6, principal: 250000, status: 'active', fiscal_year: 2026, issued_date: '2026-10-01', amount_deposited: 220000 }
  );
  const l2 = await app.alpha.Loan.findOne({ id: app.fx.alpha.loans.l2.id }).lean();
  assert.deepEqual([l2.loan_number, l2.status, l2.fiscal_year, l2.notes], ['Loan 2', 'active', 2025, note]);
  const l1 = await app.alpha.Loan.findOne({ id: app.fx.alpha.loans.l1.id }).lean();
  assert.deepEqual([l1.loan_number, l1.status, l1.fiscal_year, l1.notes], ['Loan 1', 'active', 2026, note]);

  // Repayments: signed adjustments only where the source total differs (ids 4, 5).
  const formerRepayment = await app.alpha.Repayment.findOne({ loan_id: y1Loan.id }).lean();
  assert.deepEqual(
    { id: formerRepayment.id, amount: formerRepayment.amount, repayment_date: formerRepayment.repayment_date, mpesa_ref: formerRepayment.mpesa_ref },
    { id: 4, amount: 105000, repayment_date: '2026-10-01', mpesa_ref: `recon:${runKey}:loan:${y1Loan.id}` }
  );
  const l2Adjustment = await app.alpha.Repayment.findOne({ mpesa_ref: `recon:${runKey}:loan:${l2.id}` }).lean();
  assert.deepEqual([l2Adjustment.id, l2Adjustment.loan_id, l2Adjustment.amount], [5, l2.id, 30000]);
  assert.equal(await app.alpha.Repayment.countDocuments({ mpesa_ref: /^recon:/ }), 2, 'loan 1 needed no adjustment');

  // Fines: one paid adjustment for member one (8000 - 5000), one unpaid adjustment for member two.
  const paidAdjustment = await app.alpha.Fine.findOne({ reconciliation_key: `recon:${runKey}:fine:${M1.id}:paid` }).lean();
  assert.deepEqual(
    { id: paidAdjustment.id, amount: paidAdjustment.amount, status: paidAdjustment.status, paid_date: paidAdjustment.paid_date, review_required: paidAdjustment.review_required },
    { id: 4, amount: 3000, status: 'paid', paid_date: '2026-10-01', review_required: false }
  );
  const unpaidAdjustment = await app.alpha.Fine.findOne({ reconciliation_key: `recon:${runKey}:fine:${M2.id}:unpaid` }).lean();
  assert.deepEqual(
    { id: unpaidAdjustment.id, amount: unpaidAdjustment.amount, status: unpaidAdjustment.status, review_required: unpaidAdjustment.review_required },
    { id: 5, amount: 2000, status: 'unpaid', review_required: true }
  );

  // Investment upserted in alpha (no numeric id, no counter - identity is the reconciliation key).
  const investment = await app.alpha.Investment.findOne({ reconciliation_key: `recon:${runKey}:investment:reconciled fund a` }).lean();
  assert.deepEqual(
    { provider: investment.provider, amount: investment.amount, status: investment.status, verification_status: investment.verification_status, source: investment.source },
    { provider: 'Reconciled Fund A', amount: 500000, status: 'active', verification_status: 'verified', source: 'Checkpoint System Reconciliation' }
  );

  // Audit records upserted in alpha.
  const audit = await app.alpha.AuditSourceRecord.find({ reconciliation_run: runKey }).lean();
  assert.deepEqual(
    audit.map((a) => [a.source_type, a.source_row, a.review_status, a.posted]).sort(),
    [['google_form_contribution', 2, 'unposted', false], ['google_form_contribution', 3, 'unposted', false], ['google_form_loan_request', 2, 'unposted', false]]
  );

  // Counters: alpha's own, synced to the highest id and advanced once per create.
  const expectedCounters = { member_id: 4, contribution_id: 6, loan_id: 6, repayment_id: 5, fine_id: 5 };
  for (const [name, seq] of Object.entries(expectedCounters)) {
    assert.equal(await app.alphaCounter(name), seq, `alpha ${name}`);
    assert.ok(seq < 5000, `${name} must come from alpha, not the 5000+ default counters`);
  }
  assert.equal(await app.alphaCounter('welfare_id'), 2, 'unrelated alpha counters untouched');

  // Default and beta: nothing - documents, counts and counters.
  for (const [name, value] of Object.entries(defaultCountersBefore)) assert.equal(await app.defaultCounter(name), value, `default ${name}`);
  for (const [name, value] of Object.entries(betaCountersBefore)) assert.equal(await app.betaCounter(name), value, `beta ${name}`);
  await app.assertIsolation(base, 'apply');
});

// ═════════════════════════════════════════════════════════════════════════════
// (d) idempotency
// ═════════════════════════════════════════════════════════════════════════════

test('a second identical apply is idempotent: returns the stored result and writes nothing at all', async () => {
  const source = mainSource();
  const alphaBefore = await snapshotModels(app.alpha);

  const { status, body } = await postJson(app.baseUrl, '/api/reconciliation/apply', source, app.tokens.admin);
  assert.equal(status, 200);
  assert.equal(body.idempotent, true);
  assert.equal(body.run_key, runKeyOf(source));
  assert.deepEqual(body.result, firstApplyResult);

  // Every alpha collection - documents, counts AND counters - is identical.
  assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), 'idempotent apply must write nothing');
  await app.assertIsolation(base, 'idempotent apply');
});

test('after the apply, preview reports alpha as converged (already_applied, no deltas) and counts the new alpha rows', async () => {
  const source = mainSource();
  const { status, body } = await postJson(app.baseUrl, '/api/reconciliation/preview', source, app.tokens.admin);
  assert.equal(status, 200);
  assert.equal(body.already_applied, true, 'alpha now has this run applied');
  assert.deepEqual(body.current, { members: 4, contributions: 6, loans: 6, repayments: 5, fines: 5 });
  assert.deepEqual(body.proposed, {
    missing_members: [], contribution_month_changes: 0, missing_loans: 0, changed_loans: 0, audit_form_records: 3, investments: 1,
  });
});

test('member matching still strips diacritics: a stored "Zoé Ñandú" matches a source "Zoe Nandu" (guards normalizeName)', async () => {
  // Preview is read-only; the member is created with an explicit id (no counter use) and removed afterwards.
  const accented = await app.alpha.Member.create({ id: 9990, name: 'Zoé Ñandú', status: 'active', entry_fee: 100000 });
  try {
    const matched = baseSource('2026-10-23T00:00:00Z', {
      members: [{ member: 'Zoe Nandu', membership_status: 'Active', fines: noFines }],
    });
    const hit = await postJson(app.baseUrl, '/api/reconciliation/preview', matched, app.tokens.admin);
    assert.equal(hit.status, 200, JSON.stringify(hit.body));
    assert.deepEqual(hit.body.proposed.missing_members, [], 'diacritics must be normalised away when matching names');

    // Control: a genuinely absent name is still reported missing.
    const absent = baseSource('2026-10-23T00:00:00Z', {
      members: [{ member: 'Nobody Matching', membership_status: 'Active', fines: noFines }],
    });
    const miss = await postJson(app.baseUrl, '/api/reconciliation/preview', absent, app.tokens.admin);
    assert.deepEqual(miss.body.proposed.missing_members, ['Nobody Matching']);
  } finally {
    await app.alpha.Member.deleteOne({ _id: accented._id });
  }
  assert.equal(await app.alpha.Member.findOne({ id: 9990 }).lean(), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// (g, part 2) latest / status after the apply, and the summary that reads it
// ═════════════════════════════════════════════════════════════════════════════

test('GET /latest returns the newly applied ALPHA run; GET /status returns the most recently created ALPHA run (even a failed one); default sentinels never appear', async () => {
  const mainKey = runKeyOf(mainSource());

  for (const token of [app.tokens.admin, app.tokens.member1]) {
    const latest = await getJson(app.baseUrl, '/api/reconciliation/latest', token);
    assert.equal(latest.status, 200);
    assert.equal(latest.body.run_key, mainKey);
    assert.equal(latest.body.status, 'applied');
    assert.deepEqual(latest.body.result, firstApplyResult);
    assert.equal(latest.body.source_summary.current_mkoba_cash_tzs, 1234567);
    assert.equal(latest.body.backup, undefined);
  }
  const status = await getJson(app.baseUrl, '/api/reconciliation/status', app.tokens.admin);
  assert.equal(status.body.run_key, mainKey, 'the successful apply is the newest run so far');

  // A failed apply created AFTER the successful one becomes /status, but /latest still points at the applied run.
  const probe = activeMissingSource(GEN.statusProbe);
  const failed = await postJson(app.baseUrl, '/api/reconciliation/apply', probe, app.tokens.admin);
  assert.equal(failed.status, 500);

  const statusAfter = await getJson(app.baseUrl, '/api/reconciliation/status', app.tokens.admin);
  assert.equal(statusAfter.body.run_key, runKeyOf(probe));
  assert.equal(statusAfter.body.status, 'failed');
  const latestAfter = await getJson(app.baseUrl, '/api/reconciliation/latest', app.tokens.admin);
  assert.equal(latestAfter.body.run_key, mainKey);

  // The far-future default sentinel (2099, cash 7,777,777) and the default run with alpha's seeded key
  // (cash 8,888,888) would each win /latest or /status if either route were default-bound.
  for (const body of [statusAfter.body, latestAfter.body]) {
    assert.notEqual(body.run_key, 'checkpoint-reconciliation-v1:2099-01-01T00:00:00Z');
    assert.ok(![7777777, 8888888].includes(body.source_summary.current_mkoba_cash_tzs));
    assert.notEqual(body.applied_by, 'DEFAULT SENTINEL');
  }
  await app.assertIsolation(base, 'latest/status');
});

test('the summary now reports the newly applied ALPHA reconciliation and the reconciled-in alpha member', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);
  assert.equal(status, 200);
  assert.equal(body.reconciliation.run_key, runKeyOf(mainSource()));
  assert.equal(body.cash_position.reconciled_balance, 1234567);
  assert.equal(body.cash_position.reconciled_as_of, '2026-10-01');
  assert.equal(body.equity.entry_fees, 300000 + 90000, 'the Former member created by the apply counts toward entry fees');
  assert.equal(body.active_members, 2, 'a former member is not active');
  await app.assertIsolation(base, 'summary after apply');
});

test('the default/legacy database and tenant_beta are byte-for-byte untouched after the whole reconciliation suite', async () => {
  await app.assertIsolation(base, 'end of reconciliation suite');
  assert.equal(await app.defaultModels.ReconciliationRun.countDocuments(), 2 + Object.keys(GEN).length);
  assert.equal(await app.defaultModels.AuditSourceRecord.countDocuments(), 2);
  assert.equal(await app.beta.ReconciliationRun.countDocuments(), 1);
});
