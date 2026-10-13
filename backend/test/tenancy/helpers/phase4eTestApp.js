// Shared helper for the Phase 4E (reporting, investments, fine-cash hotfix,
// reconciliation) tenant-isolation tests.
//
// WHY A REPLICA SET: routes/reconciliation.js applies a reconciliation inside
// a multi-document MongoDB transaction, and transactions only exist on a
// replica set. So unlike the Phase 4A-4D helpers (single MongoMemoryServer),
// this helper boots a one-node MongoMemoryReplSet. The shared
// helpers/memoryMongo.js is deliberately NOT modified or reused here.
//
// Four logical databases live on that ONE disposable replica set:
//
//   checkpoint_control_test  - the control plane (organization registry).
//   checkpoint_legacy_unused - the "default/legacy" connection (MONGO_URI
//                              points here). Poisoned with SENTINEL records
//                              for every Phase 4E model. Sentinel numeric
//                              ids deliberately COLLIDE with tenant_alpha's
//                              ids, and counters sit at 5000+, so any
//                              accidental default-bound read or write is
//                              unmistakable.
//   tenant_alpha             - org_checkpoint_investors (the only runtime
//                              tenant). Holds the real, deterministic data.
//   tenant_beta              - org_beta. Must never be touched.
//
// Safety: nothing here can reach production Atlas. MONGO_URI is set to the
// replica set's own 127.0.0.1 URI BEFORE server.js is loaded (server.js calls
// dotenv, which never overrides a variable that is already set), and the
// helper asserts that invariant before and after loading the real server.

const http = require('node:http');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const TEST_JWT_SECRET = 'phase4e-test-jwt-secret';
const ALPHA_ORG = 'org_checkpoint_investors';
const BETA_ORG = 'org_beta';
const DEFAULT_DB_NAME = 'checkpoint_legacy_unused';

// The reconciliation snapshot date every "post-reconciliation" movement is
// measured against. Fixed and in the past so the suite is clock-independent.
const CUTOFF = '2026-09-01';
const ALPHA_RUN_KEY = 'checkpoint-reconciliation-v1:2026-09-01T00:00:00Z';

// Same fiscal-year rule as routes/summary.js (FY starts in March), evaluated
// against "now" so contributions_this_fy is deterministic whenever this runs.
function fiscalYearFor(date) {
  const month = date.getMonth() + 1;
  return month >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}
const FY = fiscalYearFor(new Date());

// Poisoned default-DB counters (5000+, one distinct value per counter so a
// counter-name mix-up cannot hide) and beta counters (7000+).
const DEFAULT_COUNTERS = {
  member_id: 5001,
  contribution_id: 5002,
  loan_id: 5003,
  repayment_id: 5004,
  fine_id: 5005,
  welfare_id: 5006,
  transaction_id: 5007,
  expense_id: 5008,
  nav_update_id: 5009,
};
const BETA_COUNTERS = {
  member_id: 7001,
  contribution_id: 7002,
  loan_id: 7003,
  repayment_id: 7004,
  fine_id: 7005,
  welfare_id: 7006,
  transaction_id: 7007,
  expense_id: 7008,
  nav_update_id: 7009,
};
// nav_update_id in tenant_alpha is set to a distinctive value so the test can
// tell "consumed from alpha's sequence" apart from any other sequence.
const ALPHA_NAV_COUNTER = 40;

const SNAPSHOT_MODELS = [
  'Member', 'Contribution', 'Loan', 'Repayment', 'Fine', 'WelfareEvent',
  'Transaction', 'Expense', 'Investment', 'NavUpdate', 'FyRules',
  'ReconciliationRun', 'AuditSourceRecord', 'Counter',
];

let replSet;
let server;

function assertLocalDisposableUri(uri) {
  assert.ok(typeof uri === 'string' && uri.startsWith('mongodb://'), `unexpected MONGO_URI scheme: ${String(uri).slice(0, 20)}`);
  const { hostname } = new URL(uri);
  assert.ok(
    hostname === '127.0.0.1' || hostname === 'localhost',
    `refusing to run: MONGO_URI host "${hostname}" is not the local disposable replica set`
  );
  assert.ok(!/mongodb\.net|mongodb\+srv/i.test(uri), 'refusing to run: MONGO_URI looks like Atlas');
}

// ─── snapshots ───────────────────────────────────────────────────────────────

// Full, deterministic, JSON-normalised dump of every Phase 4E-relevant
// collection reachable from `models` (counters included). Used to prove that
// the default/legacy database and tenant_beta are byte-for-byte untouched.
async function snapshotModels(models) {
  const out = {};
  for (const name of SNAPSHOT_MODELS) {
    const docs = await models[name].find().lean();
    docs.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    out[name] = JSON.parse(JSON.stringify(docs));
  }
  return out;
}

function assertSnapshotEqual(expected, actual, label, { except = [] } = {}) {
  for (const name of SNAPSHOT_MODELS) {
    if (except.includes(name)) continue;
    assert.deepStrictEqual(actual[name], expected[name], `${label}: ${name} collection changed`);
  }
}

// ─── date / penalty helpers (mirror routes/summary.js on purpose) ────────────

// Identical arithmetic to getMonthsDiff() in routes/summary.js. The overdue
// penalty depends on "today", so the expected value must be derived from the
// same clock rather than hard-coded.
function monthsDiff(d1, d2) {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  let months = (date2.getFullYear() - date1.getFullYear()) * 12;
  months -= date1.getMonth();
  months += date2.getMonth();
  return months <= 0 ? 0 : months;
}

function expectedOverduePenalty(loan, rules, now = new Date()) {
  const monthsActive = monthsDiff(loan.issued_date, now);
  if (rules.overdue_penalty_enabled && rules.loan_repayment_months && monthsActive > rules.loan_repayment_months) {
    return Math.round(Number(loan.principal) * Number(rules.overdue_penalty_rate) * (monthsActive - rules.loan_repayment_months));
  }
  return 0;
}

async function waitFor(check, { timeoutMs = 8000, intervalMs = 25, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── app bootstrap ───────────────────────────────────────────────────────────

async function startPhase4eTestApp() {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.FORM_SECRET = 'phase4e-test-form-secret';
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';
  process.env.CONTROL_DB_NAME = 'checkpoint_control_test';

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 60000 }],
  });
  await replSet.waitUntilRunning();

  const mongoUri = replSet.getUri(DEFAULT_DB_NAME);
  assertLocalDisposableUri(mongoUri);
  process.env.MONGO_URI = mongoUri;

  const mongoose = require('mongoose');
  const { createOrganization } = require('../../../tenancy/organizationRegistry');
  const { getTenantModels } = require('../../../tenancy/tenantModels');

  await createOrganization({
    organization_id: ALPHA_ORG,
    name: 'Checkpoint Investors Club',
    slug: 'checkpoint-investors-club',
    database_name: 'tenant_alpha',
    legacy: true,
  });
  await createOrganization({
    organization_id: BETA_ORG,
    name: 'Beta Investment Club',
    slug: 'beta-club',
    database_name: 'tenant_beta',
  });

  const alpha = await getTenantModels({ organization_id: ALPHA_ORG });
  const beta = await getTenantModels({ organization_id: BETA_ORG });
  const defaultModels = require('../../../db/models');

  // Build indexes up front so the first multi-document transaction never
  // races an in-progress background index build.
  for (const bundle of [alpha, beta, defaultModels]) {
    await Promise.all(SNAPSHOT_MODELS.map((name) => bundle[name].init()));
  }

  const fx = { alpha: {}, default: {}, beta: {} };

  // ═══ tenant_alpha: the one real runtime tenant ═══════════════════════════
  const mk = async (Model, counterName, data) => Model.create({ id: await alpha.getNextId(counterName), ...data });

  // FY rules. 2026: overdue penalty ON at 5% after 3 months. 2025: OFF.
  // (Neither equals the hard-coded DEFAULTS in services/fyRules.js, nor the
  // default-DB sentinel rules below, so each source is distinguishable.)
  await alpha.FyRules.create({
    fiscal_year: 2026,
    contribution_amount: 75000,
    late_fine_enabled: true,
    late_fine_type: 'percentage',
    late_fine_rate: 0.15,
    loan_interest_rate: 0.12,
    loan_max_ratio: 0.8,
    loan_repayment_months: 3,
    overdue_penalty_enabled: true,
    overdue_penalty_rate: 0.05,
  });
  await alpha.FyRules.create({
    fiscal_year: 2025,
    contribution_amount: 75000,
    loan_interest_rate: 0.1,
    loan_repayment_months: 3,
    overdue_penalty_enabled: false,
    overdue_penalty_rate: 0.07,
  });
  fx.alpha.rules = {
    2026: { overdue_penalty_enabled: true, overdue_penalty_rate: 0.05, loan_repayment_months: 3 },
    2025: { overdue_penalty_enabled: false, overdue_penalty_rate: 0.07, loan_repayment_months: 3 },
  };

  const m1 = await mk(alpha.Member, 'member_id', { name: 'Alpha Active One', email: 'one@alpha.test', status: 'active', entry_fee: 100000, join_date: '2024-01-01' });
  const m2 = await mk(alpha.Member, 'member_id', { name: 'Alpha Active Two', email: 'two@alpha.test', status: 'active', entry_fee: 120000, join_date: '2024-01-01' });
  const m3 = await mk(alpha.Member, 'member_id', { name: 'Alpha Former Three', email: 'three@alpha.test', status: 'former', entry_fee: 80000, join_date: '2024-01-01' });
  fx.alpha.members = { one: m1.toObject(), two: m2.toObject(), former: m3.toObject() };

  const contrib = (member, month, year, amount) => mk(alpha.Contribution, 'contribution_id', {
    member_id: member.id, amount, month, year, status: 'paid', paid_date: `${year}-${String(month).padStart(2, '0')}-05`,
  });
  fx.alpha.contributions = {
    c1: (await contrib(m1, 3, FY, 75000)).toObject(),
    c2: (await contrib(m1, 4, FY, 75000)).toObject(),
    c3: (await contrib(m2, 3, FY, 75000)).toObject(),
    c4: (await contrib(m1, 3, FY - 1, 50000)).toObject(), // previous fiscal year
  };

  const loan = (member, n, props) => mk(alpha.Loan, 'loan_id', { member_id: member.id, loan_number: `Loan ${n}`, disbursed: true, ...props });
  fx.alpha.loans = {
    // active, FY2026 rules (penalty ON): the penalty path
    l1: (await loan(m1, 1, { principal: 400000, interest_rate: 0.12, interest_amount: 48000, amount_deposited: 352000, issued_date: '2026-04-01', status: 'active', fiscal_year: 2026 })).toObject(),
    // active, FY2025 rules (penalty OFF): proves per-loan FY lookup hits alpha's FY2025 doc
    l2: (await loan(m2, 2, { principal: 200000, interest_rate: 0.1, interest_amount: 20000, amount_deposited: 180000, issued_date: '2025-03-15', status: 'active', fiscal_year: 2025 })).toObject(),
    // fully paid: counts toward interest but is not an active loan
    l3: (await loan(m1, 0, { principal: 100000, interest_rate: 0.05, interest_amount: 10000, amount_deposited: 90000, issued_date: '2025-06-01', status: 'paid', fiscal_year: 2025 })).toObject(),
    // issued AFTER the reconciliation cutoff: a post-reconciliation disbursement
    l4: (await loan(m2, 3, { principal: 100000, interest_rate: 0.12, interest_amount: 12000, amount_deposited: 88000, issued_date: '2026-09-10', status: 'active', fiscal_year: 2026 })).toObject(),
  };

  const repay = (l, amount, date) => mk(alpha.Repayment, 'repayment_id', { loan_id: l.id, amount, repayment_date: date });
  fx.alpha.repayments = {
    r1: (await repay(fx.alpha.loans.l1, 100000, '2026-06-01')).toObject(),
    r2: (await repay(fx.alpha.loans.l1, 50000, '2026-07-01')).toObject(),
    r3: (await repay(fx.alpha.loans.l2, 20000, '2025-09-01')).toObject(),
  };

  const fine = (member, props) => mk(alpha.Fine, 'fine_id', { member_id: member.id, year: 2026, ...props });
  fx.alpha.fines = {
    unpaid: (await fine(m1, { amount: 3500, reason: 'Late contribution Mar', status: 'unpaid' })).toObject(),
    // paid BEFORE the cutoff: never eligible for a receipt
    paidPre: (await fine(m2, { amount: 7000, reason: 'Late contribution Apr', status: 'paid', paid_date: '2026-08-15' })).toObject(),
    // paid AFTER the cutoff and already matched by transactions.fineReceipt below
    paidPostMatched: (await fine(m1, { amount: 5000, reason: 'Late contribution May', status: 'paid', paid_date: '2026-09-10' })).toObject(),
  };

  fx.alpha.welfare = {
    approved: (await mk(alpha.WelfareEvent, 'welfare_id', { member_id: m1.id, event_type: 'medical', amount: 50000, status: 'approved', notes: 'approved welfare' })).toObject(),
    pending: (await mk(alpha.WelfareEvent, 'welfare_id', { member_id: m2.id, event_type: 'bereavement', amount: 30000, status: 'pending', notes: 'pending welfare' })).toObject(),
  };

  const expense = (props) => mk(alpha.Expense, 'expense_id', { fiscal_year: 2026, ...props });
  fx.alpha.expenses = {
    ops: (await expense({ category: 'Operations', description: 'Office supplies', amount: 25000, expense_date: '2026-05-01' })).toObject(), // pre-cutoff
    loanOverride: (await expense({ category: 'Loan Override', description: 'Loan override', amount: 10000, expense_date: '2026-09-05' })).toObject(), // excluded from cash bridge
    admin: (await expense({ category: 'Admin', description: 'Admin costs', amount: 15000, expense_date: '2026-09-12' })).toObject(), // post-cutoff
  };

  const tx = (props) => mk(alpha.Transaction, 'transaction_id', props);
  fx.alpha.transactions = {
    contribution: (await tx({ member_id: m1.id, amount: 75000, type: 'contribution', description: 'Sep contribution', transaction_date: '2026-09-15' })).toObject(),
    repayment: (await tx({ member_id: m2.id, amount: 20000, type: 'loan_repayment', description: 'Sep repayment', transaction_date: '2026-09-20' })).toObject(),
    preCutoff: (await tx({ member_id: m1.id, amount: 99999, type: 'contribution', description: 'Aug contribution', transaction_date: '2026-08-01' })).toObject(),
    fineReceipt: (await tx({ member_id: m1.id, amount: 5000, type: 'fine_payment', description: 'Fine payment — Late contribution May', reference: `fine:${fx.alpha.fines.paidPostMatched.id}`, transaction_date: '2026-09-10' })).toObject(),
  };

  // Investments: no numeric id on this model (identity is _id) and no counter.
  fx.alpha.investments = {
    atCost: (await alpha.Investment.create({ provider: 'Alpha Money Market', amount: 200000, status: 'active', source: 'manual', created_at: new Date('2026-02-01T08:00:00Z') })).toObject(),
    atNav: (await alpha.Investment.create({ provider: 'Alpha Unit Fund', asset_class: 'igrowth', amount: 150000, units_purchased: 100, status: 'active', source: 'manual', created_at: new Date('2026-09-20T08:00:00Z') })).toObject(),
    // has units + asset_class but NO alpha NAV reading -> must fall back to cost
    noNav: (await alpha.Investment.create({ provider: 'Alpha Bond Fund', asset_class: 'bond', amount: 90000, units_purchased: 50, status: 'active', source: 'manual' })).toObject(),
  };
  fx.alpha.navs = {
    older: (await alpha.NavUpdate.create({ provider: 'Alpha Unit Fund', asset_class: 'igrowth', unit_cost: 1500, effective_date: '2026-03-31', source: 'manual', recorded_by: 'alpha_admin' })).toObject(),
    newer: (await alpha.NavUpdate.create({ provider: 'Alpha Unit Fund', asset_class: 'igrowth', unit_cost: 2000, effective_date: '2026-05-31', source: 'manual', recorded_by: 'alpha_admin' })).toObject(),
  };
  await alpha.Counter.findByIdAndUpdate('nav_update_id', { $set: { seq: ALPHA_NAV_COUNTER } }, { upsert: true });

  fx.alpha.reconRun = (await alpha.ReconciliationRun.create({
    run_key: ALPHA_RUN_KEY,
    source_hash: 'alpha-seeded-hash',
    schema_version: 'checkpoint-reconciliation-v1',
    source_generated_on: '2026-09-01T00:00:00Z',
    reporting_cutoff: { Y3_loans: CUTOFF, contributions: CUTOFF },
    source_summary: { current_mkoba_cash_tzs: 750000 },
    backup: {},
    result: { seeded: true },
    status: 'applied',
    flags: [],
    applied_by: 'alpha_admin',
    applied_at: new Date('2026-09-02T10:00:00Z'),
    created_at: new Date('2026-09-02T10:00:00Z'),
  })).toObject();

  // ═══ default/legacy DB: sentinels with COLLIDING numeric ids ═════════════
  const D = defaultModels;
  const dMembers = await D.Member.create([
    { id: m1.id, name: 'DEFAULT SENTINEL MEMBER 1', status: 'active', entry_fee: 8888888 },
    { id: m2.id, name: 'DEFAULT SENTINEL MEMBER 2', status: 'active', entry_fee: 8888888 },
    { id: m3.id, name: 'DEFAULT SENTINEL MEMBER 3', status: 'active', entry_fee: 8888888 },
  ]);
  await D.Contribution.create(
    [1, 2, 3, 4].map((id) => ({ id, member_id: id <= 3 ? id : 1, amount: 9999999, month: 3, year: FY, status: 'paid', paid_date: `${FY}-03-05` }))
  );
  await D.Loan.create(
    [1, 2, 3, 4].map((id) => ({
      id, member_id: 1, loan_number: `DEFAULT SENTINEL LOAN ${id}`, principal: 99999999, interest_amount: 9999999,
      amount_deposited: 99999999, issued_date: '2026-09-20', status: 'active', fiscal_year: id % 2 ? 2026 : 2025,
    }))
  );
  await D.Repayment.create([1, 2, 3].map((id) => ({ id, loan_id: id, amount: 88888888, repayment_date: '2026-09-21' })));
  const dFines = await D.Fine.create([
    { id: fx.alpha.fines.unpaid.id, member_id: 1, amount: 8888888, reason: 'DEFAULT SENTINEL FINE (collides with alpha unpaid fine)', year: 2026, status: 'unpaid' },
    { id: fx.alpha.fines.paidPre.id, member_id: 2, amount: 7777777, reason: 'DEFAULT SENTINEL PAID FINE (collides with alpha pre-cutoff fine)', year: 2026, status: 'paid', paid_date: '2026-09-20' },
    { id: fx.alpha.fines.paidPostMatched.id, member_id: 1, amount: 6666666, reason: 'DEFAULT SENTINEL PAID FINE 3', year: 2026, status: 'paid', paid_date: '2026-09-21' },
    // Default-only id: alpha has no fine with this id. PATCH/DELETE on it must 404.
    { id: 9001, member_id: 1, amount: 4444444, reason: 'DEFAULT SENTINEL ONLY FINE 9001', year: 2026, status: 'paid', paid_date: '2026-09-22' },
  ]);
  await D.WelfareEvent.create([
    { id: fx.alpha.welfare.approved.id, member_id: 1, event_type: 'sentinel', amount: 6666666, status: 'approved' },
    { id: fx.alpha.welfare.pending.id, member_id: 2, event_type: 'sentinel', amount: 6666666, status: 'approved' },
  ]);
  await D.Transaction.create([
    { id: 1, member_id: 1, amount: 9999999, type: 'contribution', description: 'DEFAULT SENTINEL TX', transaction_date: '2026-09-25' },
    { id: 2, member_id: 1, amount: 9999999, type: 'loan_repayment', description: 'DEFAULT SENTINEL TX', transaction_date: '2026-09-25' },
    { id: 3, member_id: 1, amount: 9999999, type: 'fine_payment', description: 'DEFAULT SENTINEL TX', reference: 'fine:9001', transaction_date: '2026-09-25' },
    { id: 4, member_id: 1, amount: 9999999, type: 'fine_payment', description: 'DEFAULT SENTINEL TX', reference: `fine:${fx.alpha.fines.paidPostMatched.id}`, transaction_date: '2026-09-25' },
  ]);
  await D.Expense.create([1, 2, 3].map((id) => ({
    id, category: 'Admin', description: 'DEFAULT SENTINEL EXPENSE', amount: 7777777, expense_date: '2026-09-25', fiscal_year: 2026,
  })));
  await D.Investment.create([
    { provider: 'DEFAULT SENTINEL FUND', amount: 9876543, status: 'active', source: 'sentinel', created_at: new Date('2026-09-25T00:00:00Z') },
    // Same provider/asset class as alpha's NAV-valued holdings, with absurd unit counts.
    { provider: 'Alpha Unit Fund', asset_class: 'igrowth', amount: 5000000, units_purchased: 1000, status: 'active', source: 'sentinel', created_at: new Date('2026-09-25T00:00:00Z') },
    { provider: 'Alpha Bond Fund', asset_class: 'bond', amount: 4000000, units_purchased: 500, status: 'active', source: 'sentinel', created_at: new Date('2026-09-25T00:00:00Z') },
  ]);
  await D.NavUpdate.create([
    // Later than alpha's newest reading and <= today, so a default-bound read would pick these.
    { provider: 'Alpha Unit Fund', asset_class: 'igrowth', unit_cost: 99999, effective_date: '2026-06-15', source: 'sentinel', recorded_by: 'sentinel' },
    { provider: 'Alpha Bond Fund', asset_class: 'bond', unit_cost: 88888, effective_date: '2026-06-15', source: 'sentinel', recorded_by: 'sentinel' },
  ]);
  for (const fiscal_year of [2025, 2026]) {
    await D.FyRules.create({
      fiscal_year, contribution_amount: 1, late_fine_enabled: false, loan_interest_rate: 0.99, loan_max_ratio: 9,
      loan_repayment_months: 1, overdue_penalty_enabled: true, overdue_penalty_rate: 0.5,
    });
  }
  await D.ReconciliationRun.create([
    {
      // SAME run_key as alpha's seeded run, but a different cutoff/cash and a LATER applied_at.
      run_key: ALPHA_RUN_KEY, source_hash: 'default-sentinel-hash', schema_version: 'checkpoint-reconciliation-v1',
      source_generated_on: '2026-09-01T00:00:00Z', reporting_cutoff: { Y3_loans: '2026-01-15', contributions: '2026-01-15' },
      source_summary: { current_mkoba_cash_tzs: 8888888 }, backup: {}, result: { sentinel: true }, status: 'applied',
      applied_by: 'DEFAULT SENTINEL', applied_at: new Date('2026-10-05T00:00:00Z'), created_at: new Date('2026-10-05T00:00:00Z'),
    },
    {
      // Far-future "latest": a default-bound /latest or /status would return this one.
      run_key: 'checkpoint-reconciliation-v1:2099-01-01T00:00:00Z', source_hash: 'default-sentinel-hash-2',
      schema_version: 'checkpoint-reconciliation-v1', source_generated_on: '2099-01-01T00:00:00Z',
      reporting_cutoff: { Y3_loans: '2099-01-01', contributions: '2099-01-01' },
      source_summary: { current_mkoba_cash_tzs: 7777777 }, backup: {}, result: { sentinel: true }, status: 'applied',
      applied_by: 'DEFAULT SENTINEL', applied_at: new Date('2099-01-01T00:00:00Z'), created_at: new Date('2099-01-01T00:00:00Z'),
    },
  ]);
  await D.AuditSourceRecord.create({
    reconciliation_run: 'sentinel-run', source_type: 'google_form_contribution', source_row: 2,
    review_status: 'sentinel', posted: false, payload: { sentinel: true },
  });
  for (const [name, value] of Object.entries(DEFAULT_COUNTERS)) {
    await D.Counter.findByIdAndUpdate(name, { $set: { seq: value } }, { upsert: true });
  }
  fx.default = {
    members: dMembers.map((d) => d.toObject()),
    fines: dFines.map((d) => d.toObject()),
    onlyFineId: 9001,
  };

  // ═══ tenant_beta: must stay untouched ════════════════════════════════════
  await beta.Member.create({ id: 1, name: 'Beta Sentinel Member', status: 'active', entry_fee: 424242 });
  await beta.Contribution.create({ id: 1, member_id: 1, amount: 424242, month: 3, year: FY, status: 'paid' });
  await beta.Loan.create({ id: 1, member_id: 1, principal: 424242, status: 'active', fiscal_year: 2026, issued_date: '2026-09-20' });
  await beta.Repayment.create({ id: 1, loan_id: 1, amount: 4242 });
  await beta.Fine.create({ id: 1, member_id: 1, amount: 4242, reason: 'BETA SENTINEL FINE', year: 2026, status: 'paid', paid_date: '2026-09-25' });
  await beta.WelfareEvent.create({ id: 1, member_id: 1, event_type: 'beta', amount: 4242, status: 'approved' });
  await beta.Transaction.create({ id: 1, member_id: 1, amount: 4242, type: 'fine_payment', reference: 'fine:1', transaction_date: '2026-09-25' });
  await beta.Expense.create({ id: 1, category: 'BETA', description: 'BETA SENTINEL EXPENSE', amount: 4242, expense_date: '2026-09-25', fiscal_year: 2026 });
  await beta.Investment.create({ provider: 'BETA SENTINEL FUND', amount: 4242 });
  await beta.NavUpdate.create({ provider: 'BETA SENTINEL FUND', asset_class: 'beta', unit_cost: 4242, effective_date: '2026-06-15' });
  await beta.FyRules.create({ fiscal_year: 2026, overdue_penalty_enabled: true, overdue_penalty_rate: 0.33, loan_repayment_months: 1 });
  await beta.ReconciliationRun.create({
    run_key: 'checkpoint-reconciliation-v1:2026-09-03T00:00:00Z', source_hash: 'beta-sentinel-hash',
    schema_version: 'checkpoint-reconciliation-v1', source_generated_on: '2026-09-03T00:00:00Z',
    reporting_cutoff: { Y3_loans: '2026-09-03' }, source_summary: { current_mkoba_cash_tzs: 424242 }, backup: {},
    status: 'applied', applied_by: 'beta', applied_at: new Date('2026-09-04T00:00:00Z'),
  });
  await beta.AuditSourceRecord.create({
    reconciliation_run: 'beta-sentinel-run', source_type: 'google_form_contribution', source_row: 7,
    review_status: 'sentinel', posted: false, payload: { beta: true },
  });
  for (const [name, value] of Object.entries(BETA_COUNTERS)) {
    await beta.Counter.findByIdAndUpdate(name, { $set: { seq: value } }, { upsert: true });
  }

  // ═══ the real server ═════════════════════════════════════════════════════
  process.env.VERCEL = '1'; // server.js: do not listen / start the deadline cron
  const app = require('../../../server');
  // dotenv (called inside server.js) must NOT have replaced the disposable URI.
  assert.equal(process.env.MONGO_URI, mongoUri, 'MONGO_URI was overridden after loading server.js');
  assertLocalDisposableUri(process.env.MONGO_URI);
  assert.ok(['127.0.0.1', 'localhost'].includes(mongoose.connection.host), `default connection host is "${mongoose.connection.host}"`);
  assert.equal(mongoose.connection.name, DEFAULT_DB_NAME);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  function signToken(overrides = {}) {
    return jwt.sign(
      {
        id: 1, username: 'alpha_admin', role: 'admin', member_id: null, name: 'Alpha Admin',
        organization_id: ALPHA_ORG, ...overrides,
      },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
  }
  const tokens = {
    admin: signToken(),
    member1: signToken({ id: 11, username: 'alpha_member_one', role: 'member', member_id: m1.id, name: m1.name }),
    member2: signToken({ id: 12, username: 'alpha_member_two', role: 'member', member_id: m2.id, name: m2.name }),
    // A registered but never-runtime-activated organization.
    betaAdmin: signToken({ username: 'beta_admin', organization_id: BETA_ORG }),
  };

  const counter = (models) => async (name) => (await models.Counter.findById(name).lean())?.seq ?? null;

  async function baseline() {
    return { default: await snapshotModels(defaultModels), beta: await snapshotModels(beta) };
  }

  // The default/legacy database and tenant_beta must be deep-equal to `before`.
  async function assertIsolation(before, label = 'isolation') {
    const after = await baseline();
    assertSnapshotEqual(before.default, after.default, `${label} (default/legacy DB)`);
    assertSnapshotEqual(before.beta, after.beta, `${label} (tenant_beta)`);
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    mongoose,
    getTenantModels,
    alpha,
    beta,
    defaultModels,
    fx,
    FY,
    CUTOFF,
    ALPHA_RUN_KEY,
    DEFAULT_COUNTERS,
    BETA_COUNTERS,
    ALPHA_NAV_COUNTER,
    tokens,
    signToken,
    alphaCounter: counter(alpha),
    defaultCounter: counter(defaultModels),
    betaCounter: counter(beta),
    snapshotModels,
    baseline,
    assertIsolation,
    SNAPSHOT_MODELS,
  };
}

async function stopPhase4eTestApp() {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  const mongoose = require('mongoose');
  await mongoose.disconnect().catch(() => {});
  if (replSet) {
    await replSet.stop();
    replSet = undefined;
  }
}

module.exports = {
  startPhase4eTestApp,
  stopPhase4eTestApp,
  TEST_JWT_SECRET,
  snapshotModels,
  assertSnapshotEqual,
  expectedOverduePenalty,
  monthsDiff,
  waitFor,
  sleep,
  fiscalYearFor,
};
