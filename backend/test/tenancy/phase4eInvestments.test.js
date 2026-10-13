// Phase 4E isolation proof for /api/investments (GET /, POST /nav,
// GET /nav-history, GET /growth), through the real Express server, the real
// authenticate middleware, real tenant resolution and real HTTP.
//
// Layout: tenant_alpha (org_checkpoint_investors) holds the real data; the
// default/legacy database is poisoned with sentinel investments and NAV
// readings that would change every valuation if any route were still
// default-bound; tenant_beta must never be touched. See
// helpers/phase4eTestApp.js for the full dataset.
//
// Investment and NavUpdate have no numeric `id` field in the schema (their
// identity is the ObjectId `_id`), so every identity check here uses `_id`.

const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4eTestApp, stopPhase4eTestApp } = require('./helpers/phase4eTestApp');
const { getJson, postJson } = require('./helpers/httpJson');

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

const idOf = (doc) => String(doc._id);

// ─── Read isolation (state is pristine for this whole section) ──────────────

test('GET /api/investments returns exactly the three alpha holdings, newest first, and no default sentinel', async () => {
  const before = await app.baseline();
  const { atCost, atNav, noNav } = app.fx.alpha.investments;

  const { status, body } = await getJson(app.baseUrl, '/api/investments', app.tokens.admin);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));

  // created_at desc: noNav (now) > atNav (2026-09-20) > atCost (2026-02-01)
  assert.deepEqual(body.map((i) => String(i._id)), [idOf(noNav), idOf(atNav), idOf(atCost)]);
  assert.deepEqual(
    body.map((i) => i.provider).sort(),
    ['Alpha Bond Fund', 'Alpha Money Market', 'Alpha Unit Fund']
  );

  // None of the default-DB sentinels (provider, amount or source) leaked in.
  assert.ok(body.every((i) => i.source === 'manual'), 'every returned holding must be the alpha record');
  assert.ok(!body.some((i) => i.amount === 9876543 || i.amount === 5000000 || i.amount === 4000000));
  assert.ok(!body.some((i) => /SENTINEL/i.test(i.provider)));

  await app.assertIsolation(before, 'GET /api/investments');
});

test('valuation at NAV: alpha holding uses the latest ALPHA reading; the default NAV poison cannot change current_value', async () => {
  const { atNav } = app.fx.alpha.investments;
  const { body } = await getJson(app.baseUrl, '/api/investments', app.tokens.admin);
  const row = body.find((i) => String(i._id) === idOf(atNav));

  assert.equal(row.valuation, 'at_nav');
  // alpha: 100 units x 2000 (the 2026-05-31 reading beats the 2026-03-31 one)
  assert.equal(row.latest_unit_cost, 2000);
  assert.equal(row.nav_effective_date, '2026-05-31');
  assert.equal(row.current_value, 100 * 2000);
  // default-DB sentinels: NAV 99999 (-> 9,999,900) on the same provider/asset class
  assert.notEqual(row.current_value, 100 * 99999);
  assert.notEqual(row.latest_unit_cost, 99999);
});

test('valuation at cost: a manual holding uses amount, and units with NO alpha NAV fall back to cost despite a default NAV for the same provider/asset class', async () => {
  const { atCost, noNav } = app.fx.alpha.investments;
  const { body } = await getJson(app.baseUrl, '/api/investments', app.tokens.admin);

  const manual = body.find((i) => String(i._id) === idOf(atCost));
  assert.equal(manual.valuation, 'at_cost');
  assert.equal(manual.current_value, 200000);
  assert.equal(manual.current_value, manual.amount);

  const noNavRow = body.find((i) => String(i._id) === idOf(noNav));
  assert.equal(noNavRow.units_purchased, 50);
  assert.equal(noNavRow.asset_class, 'bond');
  // The default DB DOES hold a NAV (88888) for ('Alpha Bond Fund', 'bond'). If it were
  // consulted this would be at_nav at 50 x 88888 = 4,444,400.
  assert.equal(noNavRow.valuation, 'at_cost', 'no alpha NAV reading exists, so valuation must fall back to cost');
  assert.equal(noNavRow.current_value, 90000);
  assert.equal(noNavRow.latest_unit_cost, undefined);
  assert.equal(noNavRow.nav_effective_date, undefined);
});

test('GET /api/investments/nav-history returns only alpha NAV readings, newest first, with and without filters', async () => {
  const all = await getJson(app.baseUrl, '/api/investments/nav-history', app.tokens.admin);
  assert.equal(all.status, 200);
  assert.deepEqual(
    all.body.map((r) => [r.provider, r.asset_class, r.unit_cost, r.effective_date]),
    [
      ['Alpha Unit Fund', 'igrowth', 2000, '2026-05-31'],
      ['Alpha Unit Fund', 'igrowth', 1500, '2026-03-31'],
    ]
  );
  assert.ok(all.body.every((r) => r.source === 'manual' && r.recorded_by === 'alpha_admin'));
  assert.ok(!all.body.some((r) => r.unit_cost === 99999 || r.unit_cost === 88888));

  const filtered = await getJson(
    app.baseUrl,
    '/api/investments/nav-history?provider=Alpha%20Unit%20Fund&asset_class=igrowth',
    app.tokens.admin
  );
  assert.equal(filtered.status, 200);
  assert.deepEqual(filtered.body.map((r) => r.unit_cost), [2000, 1500]);

  // The default DB has a NAV for this provider/class but alpha has none: the filter must come back empty.
  const bond = await getJson(app.baseUrl, '/api/investments/nav-history?provider=Alpha%20Bond%20Fund&asset_class=bond', app.tokens.admin);
  assert.equal(bond.status, 200);
  assert.deepEqual(bond.body, []);
});

test('GET /api/investments/growth is built from alpha investments and alpha NAV only (admin and member)', async () => {
  for (const token of [app.tokens.admin, app.tokens.member1]) {
    const { status, body } = await getJson(app.baseUrl, '/api/investments/growth', token);
    assert.equal(status, 200);

    const igrowth = body.find((s) => s.asset_class === 'igrowth');
    assert.ok(igrowth, 'igrowth series must exist');
    // alpha holds 100 units of igrowth. The default DB sentinel holds 1000, which would 10x every value.
    assert.deepEqual(igrowth.points, [
      { date: '2026-03-31', unit_cost: 1500, portfolio_value: 150000 },
      { date: '2026-05-31', unit_cost: 2000, portfolio_value: 200000 },
    ]);

    // alpha holds units of 'bond' but has no readings for it: an empty series, not the default 88888 reading.
    const bond = body.find((s) => s.asset_class === 'bond');
    assert.ok(bond, 'bond series must exist (alpha holds bond units)');
    assert.deepEqual(bond.points, []);
    assert.equal(body.length, 2);
  }
});

test('auth semantics are unchanged: admin-only routes reject members/anonymous; /growth only needs authentication', async () => {
  for (const path of ['/api/investments', '/api/investments/nav-history']) {
    assert.equal((await getJson(app.baseUrl, path)).status, 401, `${path} without token`);
    assert.equal((await getJson(app.baseUrl, path, 'not-a-jwt')).status, 401, `${path} with invalid token`);
    assert.equal((await getJson(app.baseUrl, path, app.tokens.member1)).status, 403, `${path} as member`);
  }
  assert.equal((await postJson(app.baseUrl, '/api/investments/nav', {}, app.tokens.member1)).status, 403);
  assert.equal((await postJson(app.baseUrl, '/api/investments/nav', {})).status, 401);
  assert.equal((await getJson(app.baseUrl, '/api/investments/growth')).status, 401);
});

test('org_beta is never runtime-activated: a valid org_beta token is rejected on every investments route and writes nothing', async () => {
  const before = await app.baseline();
  const alphaNavBefore = await app.alpha.NavUpdate.countDocuments();
  const alphaCounterBefore = await app.alphaCounter('nav_update_id');

  for (const [method, path, body] of [
    ['GET', '/api/investments'],
    ['GET', '/api/investments/nav-history'],
    ['GET', '/api/investments/growth'],
    ['POST', '/api/investments/nav', { provider: 'X', asset_class: 'y', unit_cost: 1, effective_date: '2026-07-01' }],
  ]) {
    const res = method === 'GET'
      ? await getJson(app.baseUrl, path, app.tokens.betaAdmin)
      : await postJson(app.baseUrl, path, body, app.tokens.betaAdmin);
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.match(res.body.error, /not a permitted runtime tenant/);
  }

  assert.equal(await app.alpha.NavUpdate.countDocuments(), alphaNavBefore);
  assert.equal(await app.alphaCounter('nav_update_id'), alphaCounterBefore);
  await app.assertIsolation(before, 'org_beta token');
});

// ─── Write isolation ────────────────────────────────────────────────────────

test('POST /api/investments/nav rejects an incomplete body (400) without consuming a counter or writing', async () => {
  const before = await app.baseline();
  const alphaCounterBefore = await app.alphaCounter('nav_update_id');
  const alphaNavBefore = await app.alpha.NavUpdate.countDocuments();

  const { status, body } = await postJson(
    app.baseUrl,
    '/api/investments/nav',
    { provider: 'Alpha Unit Fund', asset_class: 'igrowth', effective_date: '2026-07-31' }, // no unit_cost
    app.tokens.admin
  );
  assert.equal(status, 400);
  assert.match(body.error, /unit_cost/);

  assert.equal(await app.alphaCounter('nav_update_id'), alphaCounterBefore);
  assert.equal(await app.alpha.NavUpdate.countDocuments(), alphaNavBefore);
  await app.assertIsolation(before, 'invalid NAV post');
});

test('POST /api/investments/nav writes the NavUpdate to alpha only and consumes nav_update_id from the ALPHA counter', async () => {
  const before = await app.baseline();
  const alphaCounterBefore = await app.alphaCounter('nav_update_id');
  const defaultCounterBefore = await app.defaultCounter('nav_update_id');
  const alphaNavBefore = await app.alpha.NavUpdate.countDocuments();
  assert.equal(alphaCounterBefore, app.ALPHA_NAV_COUNTER);
  assert.equal(defaultCounterBefore, app.DEFAULT_COUNTERS.nav_update_id);

  const { status, body } = await postJson(
    app.baseUrl,
    '/api/investments/nav',
    { provider: 'Alpha Unit Fund', asset_class: 'igrowth', unit_cost: '2100', effective_date: '2026-07-31', source: 'monthly statement' },
    app.tokens.admin
  );
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.provider, 'Alpha Unit Fund');
  assert.equal(body.asset_class, 'igrowth');
  assert.equal(body.unit_cost, 2100);
  assert.equal(body.effective_date, '2026-07-31');
  assert.equal(body.source, 'monthly statement');
  assert.equal(body.recorded_by, 'Alpha Admin');
  assert.match(String(body._id), /^[0-9a-f]{24}$/);

  // The document lives in alpha and nowhere else.
  const inAlpha = await app.alpha.NavUpdate.findById(body._id).lean();
  assert.ok(inAlpha, 'NavUpdate must exist in tenant_alpha');
  assert.equal(inAlpha.unit_cost, 2100);
  assert.equal(await app.alpha.NavUpdate.countDocuments(), alphaNavBefore + 1);
  assert.equal(await app.defaultModels.NavUpdate.findById(body._id).lean(), null, 'must not exist in the default DB');
  assert.equal(await app.beta.NavUpdate.findById(body._id).lean(), null, 'must not exist in tenant_beta');

  // nav_update_id is drawn from alpha's sequence (40 -> 41); the default sequence (5009) is untouched.
  // NOTE (pre-existing, unchanged by this phase): NavUpdate has no numeric `id` field, so the
  // allocated value is consumed but not persisted on the document.
  assert.equal(await app.alphaCounter('nav_update_id'), alphaCounterBefore + 1);
  assert.equal(await app.defaultCounter('nav_update_id'), defaultCounterBefore);

  // Default DB and beta are byte-for-byte unchanged (counts, documents, counters).
  await app.assertIsolation(before, 'POST /nav');
});

test('after POST /nav, valuation, history and growth reflect the new ALPHA reading only', async () => {
  const before = await app.baseline();
  const { atNav } = app.fx.alpha.investments;

  const list = await getJson(app.baseUrl, '/api/investments', app.tokens.admin);
  const row = list.body.find((i) => String(i._id) === idOf(atNav));
  assert.equal(row.valuation, 'at_nav');
  assert.equal(row.latest_unit_cost, 2100);
  assert.equal(row.nav_effective_date, '2026-07-31');
  assert.equal(row.current_value, 100 * 2100);

  const history = await getJson(app.baseUrl, '/api/investments/nav-history', app.tokens.admin);
  assert.deepEqual(history.body.map((r) => r.unit_cost), [2100, 2000, 1500]);
  assert.deepEqual(history.body.map((r) => r.effective_date), ['2026-07-31', '2026-05-31', '2026-03-31']);

  const growth = await getJson(app.baseUrl, '/api/investments/growth', app.tokens.member1);
  const igrowth = growth.body.find((s) => s.asset_class === 'igrowth');
  assert.deepEqual(igrowth.points.map((p) => p.unit_cost), [1500, 2000, 2100]);
  assert.equal(igrowth.points[2].portfolio_value, 210000);

  await app.assertIsolation(before, 'post-write reads');
});

test('the default/legacy database and tenant_beta are byte-for-byte untouched after the whole investments suite', async () => {
  // Counts + documents + counters, compared against live snapshots taken at the start of
  // each mutating test, plus the absolute sentinel values that must never move.
  assert.equal(await app.defaultModels.NavUpdate.countDocuments(), 2);
  assert.equal(await app.defaultModels.Investment.countDocuments(), 3);
  assert.equal(await app.defaultCounter('nav_update_id'), app.DEFAULT_COUNTERS.nav_update_id);
  assert.equal(await app.beta.NavUpdate.countDocuments(), 1);
  assert.equal(await app.beta.Investment.countDocuments(), 1);
  assert.equal(await app.betaCounter('nav_update_id'), app.BETA_COUNTERS.nav_update_id);
});
