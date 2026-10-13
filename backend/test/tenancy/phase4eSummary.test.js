// Phase 4E isolation proof for /api/summary: the aggregate summary, the
// snapshot, fines CRUD and welfare - through the real Express server, real
// authenticate, real tenant resolution and real HTTP.
//
// tenant_alpha holds a small deterministic ledger (see helpers/phase4eTestApp.js
// for every figure). The default/legacy DB is poisoned with absurd sentinels
// whose numeric ids COLLIDE with alpha's, so a default-bound read or an
// id-based write would be unmistakable. tenant_beta must never change.
//
// Ordering matters: the READ-ONLY section runs first against a pristine alpha
// ledger so exact figures can be asserted; the MUTATION section runs last.

const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const {
  startPhase4eTestApp, stopPhase4eTestApp, snapshotModels, assertSnapshotEqual, expectedOverduePenalty,
} = require('./helpers/phase4eTestApp');
const { getJson, postJson, patchJson, deleteJson } = require('./helpers/httpJson');

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

// ═════════════════════════════════════════════════════════════════════════════
// READ-ONLY SECTION
// ═════════════════════════════════════════════════════════════════════════════

test('GET /api/summary: equity, liabilities, member and loan counts are computed from tenant_alpha only', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);
  assert.equal(status, 200);

  // entry fees 100000+120000+80000 (the FORMER member still counts); contributions 3x75000 + 50000;
  // paid fines 7000+5000; interest 48000+20000+10000+12000; welfare: only the APPROVED 50000;
  // expenses 25000+10000+15000.
  assert.deepEqual(body.equity, {
    entry_fees: 300000,
    member_contributions: 275000,
    net_profit: 102000,
    welfare_paid: 50000,
    total_expenses: 50000,
    total: 577000,
  });
  // active loans: l1 400000 + l2 200000 + l4 100000; repayments 100000+50000+20000 against them.
  assert.deepEqual(body.liabilities, { loans_issued: 700000, repaid: 170000, in_circulation: 530000 });
  assert.equal(body.active_members, 2, 'only the two active alpha members (default has 3 active sentinels)');
  assert.equal(body.active_loans, 3);
  assert.equal(body.net_group_position, 577000);
  assert.equal(body.current_fiscal_year, app.FY);
  assert.equal(body.contributions_this_fy, 225000, 'three FY contributions of 75000; the previous-FY 50000 is excluded');
});

test('GET /api/summary: interest, contribution and loan breakdowns come from alpha', async () => {
  const { body } = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);

  assert.deepEqual(body.availableLoanYears, [2025, 2026]);
  assert.deepEqual(body.interest_by_member, [
    { name: 'Alpha Active One', total_interest: 58000, interest_2025: 10000, interest_2026: 48000 },
    { name: 'Alpha Active Two', total_interest: 32000, interest_2025: 20000, interest_2026: 12000 },
  ]);
  assert.deepEqual(body.monthly_contributions, [
    { fiscal_year: app.FY - 1, year: app.FY - 1, month: 3, total: 50000 },
    { fiscal_year: app.FY, year: app.FY, month: 3, total: 150000 },
    { fiscal_year: app.FY, year: app.FY, month: 4, total: 75000 },
  ]);
  const march = body.monthly_stats.find((m) => m.month === 3);
  assert.equal(march[`contributions_${app.FY}`], 150000);
  assert.equal(march[`contributions_${app.FY - 1}`], 50000);
});

test('GET /api/summary: per-loan balances use alpha repayments and per-loan FY penalties use alpha FyRules', async () => {
  const { body } = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);
  const { l1, l2, l4 } = app.fx.alpha.loans;

  assert.deepEqual(body.active_loan_list.map((l) => l.id), [l4.id, l1.id, l2.id], 'sorted by issued_date desc, alpha loans only');
  const byId = Object.fromEntries(body.active_loan_list.map((l) => [l.id, l]));

  // FY2026: alpha rules = penalty ON, 5% after 3 months. Default-DB rules would be 50% after 1 month.
  const alpha2026 = app.fx.alpha.rules[2026];
  const expectedL1Penalty = expectedOverduePenalty(l1, alpha2026);
  const defaultSentinelL1Penalty = expectedOverduePenalty(l1, { overdue_penalty_enabled: true, overdue_penalty_rate: 0.5, loan_repayment_months: 1 });
  assert.ok(expectedL1Penalty > 0, 'fixture must exercise a non-zero alpha penalty');
  assert.notEqual(expectedL1Penalty, defaultSentinelL1Penalty);
  assert.equal(byId[l1.id].member_name, 'Alpha Active One');
  assert.equal(byId[l1.id].total_repaid, 150000);
  assert.equal(byId[l1.id].penalty, expectedL1Penalty);
  assert.equal(byId[l1.id].balance, Math.max(0, 400000 + expectedL1Penalty - 150000));

  // FY2025: alpha rules = penalty OFF. A default-bound lookup would apply 50% after 1 month.
  assert.equal(byId[l2.id].member_name, 'Alpha Active Two');
  assert.equal(byId[l2.id].total_repaid, 20000);
  assert.equal(byId[l2.id].penalty, 0, 'alpha FY2025 rules disable the penalty');
  assert.equal(byId[l2.id].balance, 180000);

  const expectedL4Penalty = expectedOverduePenalty(l4, alpha2026);
  assert.equal(byId[l4.id].total_repaid, 0);
  assert.equal(byId[l4.id].penalty, expectedL4Penalty);
  assert.equal(byId[l4.id].balance, 100000 + expectedL4Penalty);
});

test('GET /api/summary: investments are valued through the same alpha tenant (NAV, at cost, no-NAV fallback)', async () => {
  const { body } = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);
  const { atCost, atNav, noNav } = app.fx.alpha.investments;

  assert.equal(body.investments.length, 3);
  const byId = Object.fromEntries(body.investments.map((i) => [String(i._id), i]));
  assert.deepEqual(
    [byId[String(atCost._id)].valuation, byId[String(atCost._id)].current_value],
    ['at_cost', 200000]
  );
  assert.deepEqual(
    [byId[String(atNav._id)].valuation, byId[String(atNav._id)].current_value, byId[String(atNav._id)].latest_unit_cost],
    ['at_nav', 200000, 2000]
  );
  assert.deepEqual(
    [byId[String(noNav._id)].valuation, byId[String(noNav._id)].current_value],
    ['at_cost', 90000],
    'a default-DB NAV exists for this provider/asset class; alpha has none'
  );
  assert.equal(body.total_investment_assets, 490000);
});

test('GET /api/summary: cash position = alpha reconciled balance + alpha ledger movements; default sentinels are invisible', async () => {
  const { body } = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);

  assert.equal(body.cash_source, 'reconciled_plus_ledger_movements');
  const cash = { ...body.cash_position };
  assert.equal(typeof cash.updated_at, 'string');
  delete cash.updated_at;
  assert.deepEqual(cash, {
    reconciled_balance: 750000,          // alpha run (default sentinel run says 8,888,888)
    reconciled_as_of: '2026-09-01',      // alpha cutoff (default sentinel run says 2026-01-15)
    contributions_received: 75000,       // alpha tx dated after the cutoff (pre-cutoff 99,999 excluded)
    loan_repayments_received: 20000,
    fines_received: 5000,
    loan_disbursements: 88000,           // l4 (amount_deposited), issued after the cutoff
    expenses_paid: 15000,                // 'Loan Override' and pre-cutoff expenses excluded
    investment_transfers: 240000,        // holdings created after the cutoff, no reconciliation_key
    total_inflows: 100000,
    total_outflows: 343000,
    net_movement: -243000,
    live_balance: 507000,
  });
  assert.equal(body.cash_at_bank, 507000);

  // The latest-reconciliation block is alpha's run, not the default DB's same-key / later-dated sentinel.
  assert.equal(body.reconciliation.run_key, app.ALPHA_RUN_KEY);
  assert.deepEqual(body.reconciliation.source_summary, { current_mkoba_cash_tzs: 750000 });
  assert.deepEqual(body.reconciliation.reporting_cutoff, { Y3_loans: '2026-09-01', contributions: '2026-09-01' });
  assert.equal(body.reconciliation.applied_at, '2026-09-02T10:00:00.000Z');
  assert.deepEqual(body.reconciliation.flags, []);
});

test('GET /api/summary/snapshot returns the same alpha-only figures for an admin and for a member', async () => {
  for (const token of [app.tokens.admin, app.tokens.member1]) {
    const { status, body } = await getJson(app.baseUrl, '/api/summary/snapshot', token);
    assert.equal(status, 200);
    assert.equal(typeof body.cash_as_of, 'string');
    const { cash_as_of, ...stable } = body;
    assert.deepEqual(stable, {
      cash_at_bank: 507000,
      cash_source: 'reconciled_plus_ledger_movements',
      reconciled_cash: 750000,
      reconciled_cash_as_of: '2026-09-01',
      total_loans_outstanding: 530000,
      total_investment_assets: 490000,
      contributions_this_fy: 225000,
      fiscal_year: app.FY,
      active_members: 2,
      net_group_position: 577000,
    });
  }
});

test('reading the summary and snapshot writes nothing anywhere when no receipt repair is due', async () => {
  const before = await app.baseline();
  const alphaBefore = await snapshotModels(app.alpha);

  assert.equal((await getJson(app.baseUrl, '/api/summary', app.tokens.admin)).status, 200);
  assert.equal((await getJson(app.baseUrl, '/api/summary/snapshot', app.tokens.admin)).status, 200);
  assert.equal((await getJson(app.baseUrl, '/api/summary/fines', app.tokens.admin)).status, 200);
  assert.equal((await getJson(app.baseUrl, '/api/summary/welfare', app.tokens.admin)).status, 200);

  assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), 'reads must not mutate tenant_alpha');
  await app.assertIsolation(before, 'summary reads');
});

test('auth semantics are unchanged on the summary routes', async () => {
  assert.equal((await getJson(app.baseUrl, '/api/summary')).status, 401);
  assert.equal((await getJson(app.baseUrl, '/api/summary', 'not-a-jwt')).status, 401);
  assert.equal((await getJson(app.baseUrl, '/api/summary', app.tokens.member1)).status, 403, 'summary is admin-only');
  assert.equal((await getJson(app.baseUrl, '/api/summary/snapshot')).status, 401);
  assert.equal((await getJson(app.baseUrl, '/api/summary/fines')).status, 401);
  assert.equal((await getJson(app.baseUrl, '/api/summary/welfare')).status, 401);

  const fineBody = { member_id: app.fx.alpha.members.one.id, amount: 1000, reason: 'x', year: 2026 };
  assert.equal((await postJson(app.baseUrl, '/api/summary/fines', fineBody, app.tokens.member1)).status, 403);
  assert.equal((await patchJson(app.baseUrl, '/api/summary/fines/1', { notes: 'x' }, app.tokens.member1)).status, 403);
  assert.equal((await deleteJson(app.baseUrl, '/api/summary/fines/1', app.tokens.member1)).status, 403);
  assert.equal((await postJson(app.baseUrl, '/api/summary/welfare', { member_id: 1, event_type: 'x' }, app.tokens.member1)).status, 403);
});

test('org_beta is never runtime-activated: a valid org_beta token is rejected on every summary route and writes nothing', async () => {
  const before = await app.baseline();
  const alphaBefore = await snapshotModels(app.alpha);
  const token = app.tokens.betaAdmin;

  const attempts = [
    getJson(app.baseUrl, '/api/summary', token),
    getJson(app.baseUrl, '/api/summary/snapshot', token),
    getJson(app.baseUrl, '/api/summary/fines', token),
    getJson(app.baseUrl, '/api/summary/welfare', token),
    postJson(app.baseUrl, '/api/summary/fines', { member_id: 1, amount: 1, reason: 'x', year: 2026 }, token),
    patchJson(app.baseUrl, '/api/summary/fines/1', { notes: 'x' }, token),
    deleteJson(app.baseUrl, '/api/summary/fines/1', token),
    postJson(app.baseUrl, '/api/summary/welfare', { member_id: 1, event_type: 'x' }, token),
  ];
  for (const res of await Promise.all(attempts)) {
    assert.equal(res.status, 403);
    assert.match(res.body.error, /not a permitted runtime tenant/);
  }
  assertSnapshotEqual(alphaBefore, await snapshotModels(app.alpha), 'org_beta token must not touch alpha');
  await app.assertIsolation(before, 'org_beta token');
});

// ─── Fines & welfare reads ──────────────────────────────────────────────────

test('GET /api/summary/fines (admin) returns exactly the alpha fines with member names from alpha', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/summary/fines', app.tokens.admin);
  assert.equal(status, 200);

  // sorted by status then member_name: paid/One, paid/Two, unpaid/One
  assert.deepEqual(
    body.map((f) => [f.id, f.status, f.amount, f.member_name]),
    [
      [3, 'paid', 5000, 'Alpha Active One'],
      [2, 'paid', 7000, 'Alpha Active Two'],
      [1, 'unpaid', 3500, 'Alpha Active One'],
    ]
  );
  // Every id collides with a default sentinel (8888888 / 7777777 / 6666666 / 4444444).
  assert.ok(!body.some((f) => /SENTINEL/i.test(f.reason) || /SENTINEL/i.test(f.member_name)));
});

test('GET /api/summary/fines (member) returns only that member\'s own alpha fines', async () => {
  const one = await getJson(app.baseUrl, '/api/summary/fines', app.tokens.member1);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.map((f) => [f.id, f.member_id, f.member_name]), [
    [3, app.fx.alpha.members.one.id, 'Alpha Active One'],
    [1, app.fx.alpha.members.one.id, 'Alpha Active One'],
  ]);

  const two = await getJson(app.baseUrl, '/api/summary/fines', app.tokens.member2);
  assert.deepEqual(two.body.map((f) => [f.id, f.member_id, f.member_name]), [
    [2, app.fx.alpha.members.two.id, 'Alpha Active Two'],
  ]);
});

test('GET /api/summary/welfare: admin sees only alpha events; members are filtered to their own', async () => {
  const admin = await getJson(app.baseUrl, '/api/summary/welfare', app.tokens.admin);
  assert.equal(admin.status, 200);
  // created_at desc: the pending event was created after the approved one
  assert.deepEqual(
    admin.body.map((w) => [w.id, w.status, w.amount, w.member_name]),
    [
      [2, 'pending', 30000, 'Alpha Active Two'],
      [1, 'approved', 50000, 'Alpha Active One'],
    ]
  );
  assert.ok(!admin.body.some((w) => w.amount === 6666666 || w.event_type === 'sentinel'));

  const one = await getJson(app.baseUrl, '/api/summary/welfare', app.tokens.member1);
  assert.deepEqual(one.body.map((w) => [w.id, w.member_name]), [[1, 'Alpha Active One']]);
  const two = await getJson(app.baseUrl, '/api/summary/welfare', app.tokens.member2);
  assert.deepEqual(two.body.map((w) => [w.id, w.member_name]), [[2, 'Alpha Active Two']]);
});

// ═════════════════════════════════════════════════════════════════════════════
// MUTATION SECTION (runs last)
// ═════════════════════════════════════════════════════════════════════════════

test('POST /api/summary/fines creates the fine in alpha with fine_id from the ALPHA counter', async () => {
  const before = await app.baseline();
  const alphaCounterBefore = await app.alphaCounter('fine_id');
  assert.equal(alphaCounterBefore, 3);
  assert.equal(await app.defaultCounter('fine_id'), app.DEFAULT_COUNTERS.fine_id);

  const { status, body } = await postJson(
    app.baseUrl,
    '/api/summary/fines',
    { member_id: app.fx.alpha.members.one.id, amount: 5000, reason: 'Phase 4E tenant fine', year: 2026, status: 'unpaid' },
    app.tokens.admin
  );
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.id, alphaCounterBefore + 1);
  assert.equal(body.id, 4);
  assert.equal(body.reason, 'Phase 4E tenant fine');

  const inAlpha = await app.alpha.Fine.findOne({ id: 4 }).lean();
  assert.equal(inAlpha.amount, 5000);
  assert.equal(inAlpha.member_id, app.fx.alpha.members.one.id);
  assert.equal(await app.alphaCounter('fine_id'), 4);
  assert.equal(await app.defaultModels.Fine.findOne({ id: 4 }).lean(), null);
  await app.assertIsolation(before, 'POST /fines');
});

test('PATCH /api/summary/fines/:id on an id that also exists in the default DB updates ONLY the alpha fine', async () => {
  const before = await app.baseline();
  const targetId = app.fx.alpha.fines.unpaid.id; // alpha id 1 (3500); default id 1 is an 8,888,888 sentinel

  const { status, body } = await patchJson(
    app.baseUrl,
    `/api/summary/fines/${targetId}`,
    { amount: 4000, notes: 'tenant alpha note', review_required: true },
    app.tokens.admin
  );
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.id, targetId);
  assert.equal(body.amount, 4000);
  assert.equal(body.notes, 'tenant alpha note');
  assert.equal(body.review_required, true);

  const inAlpha = await app.alpha.Fine.findOne({ id: targetId }).lean();
  assert.equal(inAlpha.amount, 4000);
  assert.equal(inAlpha.notes, 'tenant alpha note');
  // The colliding default sentinel (same numeric id) is byte-for-byte unchanged.
  const stillDefault = await app.defaultModels.Fine.findOne({ id: targetId }).lean();
  assert.equal(stillDefault.amount, 8888888);
  assert.equal(stillDefault.notes, null);
  await app.assertIsolation(before, 'PATCH /fines');
});

test('DELETE /api/summary/fines/:id on an id that also exists in the default DB deletes ONLY the alpha fine', async () => {
  const before = await app.baseline();
  const targetId = app.fx.alpha.fines.paidPre.id; // alpha id 2 (7000); default id 2 is a 7,777,777 sentinel

  const { status, body } = await deleteJson(app.baseUrl, `/api/summary/fines/${targetId}`, app.tokens.admin);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { ok: true, message: 'Fine deleted successfully', id: targetId });

  assert.equal(await app.alpha.Fine.findOne({ id: targetId }), null, 'alpha fine must be gone');
  assert.ok(await app.defaultModels.Fine.findOne({ id: targetId }), 'default sentinel with the same id must survive');
  await app.assertIsolation(before, 'DELETE /fines');
});

test('PATCH and DELETE on an id that exists ONLY in the default DB return 404 and leave it untouched', async () => {
  const before = await app.baseline();
  const id = app.fx.default.onlyFineId; // 9001 - not in alpha

  const patch = await patchJson(app.baseUrl, `/api/summary/fines/${id}`, { amount: 1, status: 'unpaid' }, app.tokens.admin);
  assert.equal(patch.status, 404);
  assert.equal(patch.body.error, 'Fine not found');
  const del = await deleteJson(app.baseUrl, `/api/summary/fines/${id}`, app.tokens.admin);
  assert.equal(del.status, 404);
  assert.equal(del.body.error, 'Fine not found');

  assert.ok(await app.defaultModels.Fine.findOne({ id }), 'default-only fine must still exist');
  await app.assertIsolation(before, '404 on default-only id');
});

test('POST /api/summary/welfare creates the event in alpha with welfare_id from the ALPHA counter', async () => {
  const before = await app.baseline();
  const alphaCounterBefore = await app.alphaCounter('welfare_id');
  assert.equal(alphaCounterBefore, 2);
  assert.equal(await app.defaultCounter('welfare_id'), app.DEFAULT_COUNTERS.welfare_id);

  const { status, body } = await postJson(
    app.baseUrl,
    '/api/summary/welfare',
    { member_id: app.fx.alpha.members.two.id, event_type: 'medical', amount: 30000, notes: 'Phase 4E welfare' },
    app.tokens.admin
  );
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.id, alphaCounterBefore + 1);
  assert.equal(body.id, 3);
  assert.equal(body.status, 'pending', 'new welfare events are pending until approved');

  assert.ok(await app.alpha.WelfareEvent.findOne({ id: 3 }));
  assert.equal(await app.alphaCounter('welfare_id'), 3);
  assert.equal(await app.defaultModels.WelfareEvent.findOne({ id: 3 }), null);

  // Members only see their own new event.
  const two = await getJson(app.baseUrl, '/api/summary/welfare', app.tokens.member2);
  assert.deepEqual(two.body.map((w) => w.id).sort(), [2, 3]);
  const one = await getJson(app.baseUrl, '/api/summary/welfare', app.tokens.member1);
  assert.deepEqual(one.body.map((w) => w.id), [1]);

  await app.assertIsolation(before, 'POST /welfare');
});

test('the summary reflects the alpha mutations immediately, and only alpha\'s', async () => {
  const before = await app.baseline();
  const { body } = await getJson(app.baseUrl, '/api/summary', app.tokens.admin);

  // paid fines are now only alpha fine 3 (5000): fine 2 was deleted, fine 1 (unpaid) was edited,
  // the new fine (4) is unpaid. The pending welfare events are not counted.
  assert.deepEqual(body.equity, {
    entry_fees: 300000,
    member_contributions: 275000,
    net_profit: 95000,        // 5000 paid fines + 90000 interest
    welfare_paid: 50000,
    total_expenses: 50000,
    total: 570000,
  });
  await app.assertIsolation(before, 'post-mutation summary');
});
