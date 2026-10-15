// Phase 4F-A isolation proof for routes/admin.js, through the real Express
// server (server.js), real authenticate, real tenant resolution and real HTTP.
//
// Routes under test:
//   POST /api/admin/sync-counters        - rewrites the request tenant's counters
//   POST /api/admin/migrate-member-office - raw-collection backfill of Member.office
//   GET  /api/admin/roster-audit          - read-only member / user coverage report
//
// The default/legacy database is poisoned with colliding-id sentinels, each
// collection ALSO holding a default-only record with the highest id (4000+) so
// that a default-bound sync-counters could not be mistaken for tenant_alpha's;
// tenant_beta holds sentinels too. Both are deep-snapshotted (every document of
// every collection, counters included) before and compared after every call.

const { before, after, test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const {
  startPhase4fATestApp, stopPhase4fATestApp, callHandlerWithoutTenantModels, requestWithHeaders, withCapturedConsoleError,
  assertFailedBecauseTenantModelsAreMissing,
} = require('./helpers/phase4fATestApp');
const { getJson, postJson } = require('./helpers/httpJson');

let app;
let globalBaseline;

// Every request goes to a real in-process Express 4 server. If a regression made a route throw
// inside an async handler the request would never be answered, so each test is bounded: it FAILS
// quickly instead of hanging the whole suite.
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);

before(async () => {
  app = await startPhase4fATestApp();
  // Fixture for migrate-member-office: legacy `role`-only member documents in the OTHER two databases (raw
  // collection inserts - the Member schema no longer declares `role`). Same ids as alpha's legacy members
  // where possible, plus default-only / beta-only ones. They are part of the poison, so they are inserted
  // BEFORE the baseline every later comparison is made against.
  await app.defaultModels.Member.collection.insertMany([
    { id: 501, name: 'DEFAULT legacy A', role: 'default-role-A' },
    { id: 502, name: 'DEFAULT legacy B', role: 'default-role-B' },
    { id: 5999, name: 'DEFAULT legacy only', role: 'default-role-only' },
  ]);
  await app.beta.Member.collection.insertMany([
    { id: 501, name: 'BETA legacy A', role: 'beta-role-A' },
    { id: 5998, name: 'BETA legacy only', role: 'beta-role-only' },
  ]);
  globalBaseline = await app.baseline();
}, { timeout: 120000 });

after(async () => {
  await stopPhase4fATestApp();
});

const SYNC_TARGETS = {
  member_id: 'Member',
  contribution_id: 'Contribution',
  loan_id: 'Loan',
  repayment_id: 'Repayment',
  transaction_id: 'Transaction',
  user_id: 'User',
  fine_id: 'Fine',
  welfare_id: 'WelfareEvent',
};

async function alphaMaxIds() {
  const out = {};
  for (const [counter, modelName] of Object.entries(SYNC_TARGETS)) {
    const doc = await app.alpha[modelName].findOne({}).sort({ id: -1 }).select('id').lean();
    out[counter] = doc?.id || 0;
  }
  return out;
}

async function corruptAlphaCounters(value = 999) {
  for (const counter of Object.keys(SYNC_TARGETS)) {
    await app.alpha.Counter.findByIdAndUpdate(counter, { $set: { seq: value } }, { upsert: true });
  }
}

// ─── roster-audit (read-only) ───────────────────────────────────────────────

test('GET /api/admin/roster-audit reports ONLY tenant_alpha members, with user coverage from tenant_alpha users only', async () => {
  const before = await app.baseline();
  const { status, body } = await getJson(app.baseUrl, '/api/admin/roster-audit', app.tokens.admin);
  assert.equal(status, 200, JSON.stringify(body));

  // Sorted by name; exactly alpha's five members - no default sentinel (ids 1-5 and 4000) and no beta member.
  assert.deepEqual(body.map((r) => r.name), [
    'Alpha Active Five', 'Alpha Active One', 'Alpha Active Three', 'Alpha Active Two', 'Alpha Former Four',
  ]);
  const byName = Object.fromEntries(body.map((r) => [r.name, r]));

  assert.deepEqual(byName['Alpha Active One'], {
    id: app.fx.alpha.members.one.id, name: 'Alpha Active One', status: 'active', office: 'chairperson',
    email: 'one@alpha.test', phone: '+255700000001', has_user: true, user_username: 'alpha_user_one', user_role: 'member',
  });
  // The default DB has users whose member_id collides with alpha members 2 and 3, and an admin-role user for each.
  // Those must not make alpha's members look covered.
  assert.deepEqual(byName['Alpha Active Two'], {
    id: app.fx.alpha.members.two.id, name: 'Alpha Active Two', status: 'active', office: 'member',
    email: 'two@alpha.test', phone: null, has_user: false, user_username: null, user_role: null,
  });
  assert.equal(byName['Alpha Active Three'].has_user, false);
  assert.equal(byName['Alpha Active Three'].email, null);
  assert.equal(byName['Alpha Former Four'].status, 'former');
  assert.equal(byName['Alpha Active Five'].has_user, false);

  // Never leaks credentials, nor anything from the other databases.
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /password_hash|NOT-A-REAL-HASH|SENTINEL|DEFAULT_|BETA_|sentinel\.invalid/);

  await app.assertIsolation(before, 'roster-audit');
  assert.deepEqual(await app.changedAlpha(before), [], 'roster-audit is read-only');
});

test('a pre-Phase-3 token without organization_id still resolves to the one runtime tenant (alpha), never to the default DB', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/admin/roster-audit', app.tokens.orglessAdmin);
  assert.equal(status, 200);
  assert.equal(body.length, 5);
  assert.ok(body.every((r) => r.name.startsWith('Alpha ')));
});

// ─── sync-counters ──────────────────────────────────────────────────────────

test('POST /api/admin/sync-counters rewrites ONLY tenant_alpha counters, from tenant_alpha collections', async () => {
  // Make every alpha counter wrong (and give a non-target counter a distinctive value) so the effect is visible.
  await corruptAlphaCounters(999);
  await app.alpha.Counter.findByIdAndUpdate('notification_id', { $set: { seq: 77 } }, { upsert: true });
  const before = await app.baseline();

  const expected = await alphaMaxIds();
  // Pin the fixture-derived values too, so a drifting fixture cannot make the comparison vacuous.
  assert.deepEqual(expected, {
    member_id: 5, contribution_id: 3, loan_id: 2, repayment_id: 3, transaction_id: 4, user_id: 2, fine_id: 3, welfare_id: 0,
  });

  const { status, body } = await postJson(app.baseUrl, '/api/admin/sync-counters', {}, app.tokens.admin);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { ok: true, counters: expected });

  for (const [counter, max] of Object.entries(expected)) {
    assert.equal(await app.alphaCounter(counter), max, `alpha ${counter}`);
  }
  // welfare_id: alpha has NO welfare events although the default DB has some (max 4007) - it is created as 0.
  assert.equal(await app.alphaCounter('welfare_id'), 0);
  // Counters outside the eight sync targets are left alone.
  assert.equal(await app.alphaCounter('notification_id'), 77);

  // The default DB's and beta's counters did not move to their own collections' max ids (4000+ / 6000+).
  for (const [counter, value] of Object.entries(app.DEFAULT_COUNTERS)) assert.equal(await app.defaultCounter(counter), value, `default ${counter}`);
  for (const [counter, value] of Object.entries(app.BETA_COUNTERS)) assert.equal(await app.betaCounter(counter), value, `beta ${counter}`);

  await app.assertIsolation(before, 'sync-counters');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.counters], 'only alpha\'s counters collection may change');
});

test('sync-counters is idempotent: a second run reports the same figures and changes nothing', async () => {
  const before = await app.baseline();
  const first = await postJson(app.baseUrl, '/api/admin/sync-counters', {}, app.tokens.admin);
  const second = await postJson(app.baseUrl, '/api/admin/sync-counters', {}, app.tokens.admin);
  assert.equal(first.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.deepEqual(first.body.counters, await alphaMaxIds());
  await app.assertIsolation(before, 'sync-counters twice');
  assert.deepEqual(await app.changedAlpha(before), [], 'counters were already in sync');
});

test('after sync-counters the next allocated ids continue alpha\'s sequence (never the default or beta ones)', async () => {
  const { status, body } = await postJson(app.baseUrl, '/api/admin/sync-counters', {}, app.tokens.admin);
  assert.equal(status, 200);
  const nextMember = await app.alpha.getNextId('member_id');
  assert.equal(nextMember, body.counters.member_id + 1);
  assert.ok(nextMember < 100, `alpha id ${nextMember} must be in alpha's own sequence`);
  // Hand the id back so later tests see a consistent alpha counter.
  await app.alpha.Counter.findByIdAndUpdate('member_id', { $set: { seq: body.counters.member_id } });
});

// ─── migrate-member-office ──────────────────────────────────────────────────

async function insertLegacyRoleMembers(Model, docs) {
  // The RAW collection on purpose: the Member schema no longer declares `role`.
  await Model.collection.insertMany(docs);
}

test('POST /api/admin/migrate-member-office backfills `office` from `role` in tenant_alpha only', async () => {
  await insertLegacyRoleMembers(app.alpha.Member, [
    { id: 501, name: 'Legacy Role Member A', role: 'secretary' },                       // matched (no office)
    { id: 502, name: 'Legacy Role Member B', role: 'treasurer', office: null },          // matched (office null)
    { id: 503, name: 'Already Has Office', role: 'chairperson', office: 'member' },      // not matched: office set
    { id: 504, name: 'Null Role', role: null },                                          // not matched: role null
    { id: 505, name: 'No Role No Office' },                                              // not matched: no role
  ]);
  // The default DB (ids 501, 502 collide; 5999 is default-only) and tenant_beta (501 collides; 5998 is
  // beta-only) hold legacy `role`-only members too - inserted in before().
  const before = await app.baseline();

  const { status, body } = await postJson(app.baseUrl, '/api/admin/migrate-member-office', {}, app.tokens.admin);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.matched, 2);
  assert.equal(body.updated, 2);
  assert.deepEqual(
    body.members.slice().sort((a, b) => a.id - b.id),
    [
      { id: 501, name: 'Legacy Role Member A', office: 'secretary' },
      { id: 502, name: 'Legacy Role Member B', office: 'treasurer' },
    ]
  );

  const alphaDocs = Object.fromEntries((await app.alpha.Member.collection.find({ id: { $gte: 501, $lte: 505 } }).toArray()).map((d) => [d.id, d]));
  assert.equal(alphaDocs[501].office, 'secretary');
  assert.equal(alphaDocs[501].role, 'secretary', 'the old role field is kept (additive only)');
  assert.equal(alphaDocs[502].office, 'treasurer');
  assert.equal(alphaDocs[503].office, 'member', 'an existing office is never overwritten');
  assert.equal(alphaDocs[504].office, undefined);
  assert.equal(alphaDocs[505].office, undefined);

  // The same-id default / beta documents were NOT backfilled.
  const defaultDocs = Object.fromEntries((await app.defaultModels.Member.collection.find({ id: { $in: [501, 502, 5999] } }).toArray()).map((d) => [d.id, d]));
  for (const id of [501, 502, 5999]) assert.equal(defaultDocs[id].office, undefined, `default member ${id} must not be backfilled`);
  const betaDocs = Object.fromEntries((await app.beta.Member.collection.find({ id: { $in: [501, 5998] } }).toArray()).map((d) => [d.id, d]));
  for (const id of [501, 5998]) assert.equal(betaDocs[id].office, undefined, `beta member ${id} must not be backfilled`);

  await app.assertIsolation(before, 'migrate-member-office');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.members]);

  // Idempotent: nothing left to backfill in alpha, and still nothing touched elsewhere.
  const afterFirst = await app.baseline();
  const rerun = await postJson(app.baseUrl, '/api/admin/migrate-member-office', {}, app.tokens.admin);
  assert.equal(rerun.status, 200);
  assert.deepEqual(rerun.body, { ok: true, matched: 0, updated: 0, members: [] });
  await app.assertIsolation(afterFirst, 'migrate-member-office re-run');
  assert.deepEqual(await app.changedAlpha(afterFirst), []);
});

test('migrate-member-office omits the member list when more than 50 documents match (response contract), still alpha only', async () => {
  const docs = Array.from({ length: 51 }, (_, i) => ({ id: 600 + i, name: `Bulk Legacy ${i}`, role: 'bulk-role' }));
  await insertLegacyRoleMembers(app.alpha.Member, docs);
  const before = await app.baseline();

  const { status, body } = await postJson(app.baseUrl, '/api/admin/migrate-member-office', {}, app.tokens.admin);
  assert.equal(status, 200);
  assert.equal(body.matched, 51);
  assert.equal(body.updated, 51);
  assert.equal('members' in body, false, 'members is undefined (omitted from JSON) above 50 matches');
  assert.equal(await app.alpha.Member.collection.countDocuments({ id: { $gte: 600, $lte: 650 }, office: 'bulk-role' }), 51);

  await app.assertIsolation(before, 'migrate-member-office 51 docs');
  assert.deepEqual(await app.changedAlpha(before), [app.collections.members]);
});

// ─── no request-selected database or tenant ─────────────────────────────────

test('body / query / header attempts to select org_beta or tenant_beta are ignored: the JWT tenant (alpha) is always used', async () => {
  await corruptAlphaCounters(999);
  const before = await app.baseline();
  const hostile = {
    organization_id: 'org_beta', database_name: 'tenant_beta', tenant: 'org_beta', tenant_id: 'org_beta', slug: 'beta-club',
  };
  const hostileHeaders = {
    'x-tenant-id': 'org_beta', 'x-organization-id': 'org_beta', 'x-database-name': 'tenant_beta', 'x-tenant-database': 'tenant_beta',
  };

  const sync = await requestWithHeaders(
    app.baseUrl, 'POST', '/api/admin/sync-counters?organization_id=org_beta&database_name=tenant_beta&tenant=org_beta',
    { token: app.tokens.admin, body: hostile, headers: hostileHeaders }
  );
  assert.equal(sync.status, 200, JSON.stringify(sync.body));
  assert.deepEqual(sync.body.counters, await alphaMaxIds());
  for (const [counter, max] of Object.entries(await alphaMaxIds())) assert.equal(await app.alphaCounter(counter), max);

  const roster = await requestWithHeaders(
    app.baseUrl, 'GET', '/api/admin/roster-audit?organization_id=org_beta&database_name=tenant_beta',
    { token: app.tokens.admin, headers: hostileHeaders }
  );
  assert.equal(roster.status, 200);
  const rosterNames = roster.body.map((r) => r.name);
  for (const name of ['Alpha Active One', 'Alpha Active Two', 'Alpha Active Three', 'Alpha Former Four', 'Alpha Active Five']) {
    assert.ok(rosterNames.includes(name), `${name} must be listed`);
  }
  assert.doesNotMatch(JSON.stringify(roster.body), /BETA|SENTINEL|DEFAULT/);

  // Exactly one alpha legacy member is waiting. beta (and the default DB) hold un-migrated legacy `role`
  // members that a beta-selecting request would have matched instead.
  await insertLegacyRoleMembers(app.alpha.Member, [{ id: 700, name: 'Hostile Legacy', role: 'hostile-role' }]);
  const beforeMigrate = await app.baseline();
  const migrate = await requestWithHeaders(
    app.baseUrl, 'POST', '/api/admin/migrate-member-office?database_name=tenant_beta',
    { token: app.tokens.admin, body: hostile, headers: hostileHeaders }
  );
  assert.equal(migrate.status, 200);
  assert.equal(migrate.body.matched, 1, 'only alpha\'s own legacy member may be picked up');
  assert.deepEqual(migrate.body.members, [{ id: 700, name: 'Hostile Legacy', office: 'hostile-role' }]);
  await app.assertIsolation(beforeMigrate, 'hostile migrate-member-office');

  await app.assertIsolation(before, 'hostile tenant selection');
});

// ─── auth semantics and the runtime-tenant gate ─────────────────────────────

test('admin routes keep their auth semantics and an org_beta / unknown-org token is rejected before ANY read or write', async () => {
  await corruptAlphaCounters(999);
  const before = await app.baseline();
  const routes = [
    ['POST', '/api/admin/sync-counters'],
    ['POST', '/api/admin/migrate-member-office'],
    ['GET', '/api/admin/roster-audit'],
  ];

  for (const [method, path] of routes) {
    const call = (token) => requestWithHeaders(app.baseUrl, method, path, { token, body: method === 'POST' ? {} : undefined });
    assert.equal((await call(undefined)).status, 401, `${method} ${path} without a token`);
    assert.equal((await call('not.a.jwt')).status, 401, `${method} ${path} with an invalid token`);
    const member = await call(app.tokens.member1);
    assert.equal(member.status, 403, `${method} ${path} as a member`);
    assert.equal(member.body.error, 'Admin only');
    for (const token of [app.tokens.betaAdmin, app.tokens.unknownOrgAdmin]) {
      const res = await call(token);
      assert.equal(res.status, 403, `${method} ${path} with a non-runtime organization`);
      assert.match(res.body.error, /not a permitted runtime tenant/);
    }
  }

  await app.assertIsolation(before, 'rejected admin requests');
  assert.deepEqual(await app.changedAlpha(before), [], 'rejected requests must not touch alpha either (the corrupted counters stay corrupted)');
  assert.equal(await app.alphaCounter('member_id'), 999);
  // restore a consistent alpha for any later test
  await postJson(app.baseUrl, '/api/admin/sync-counters', {}, app.tokens.admin);
});

// ─── missing tenant models: fail loudly, never fall back ────────────────────

test('without req.tenantModels every admin handler fails loudly (500) - there is no fallback to the poisoned, connected default DB', async () => {
  const router = require('../../routes/admin');
  const before = await app.baseline();
  for (const [method, path] of [['post', '/sync-counters'], ['post', '/migrate-member-office'], ['get', '/roster-audit']]) {
    // These handlers catch, LOG (console.error) and answer 500 - captured here so the expected noise stays out of the report.
    const { result: outcome, logged } = await withCapturedConsoleError(() => callHandlerWithoutTenantModels(router, method, path));
    assertFailedBecauseTenantModelsAreMissing(outcome, logged, `${method.toUpperCase()} ${path}`);
    if (!outcome.threw) {
      assert.equal(outcome.status, 500);
      assert.equal(typeof outcome.body.error, 'string');
      assert.ok(logged.length > 0, `${path}: the failure must also be logged`);
    }
  }
  await app.assertIsolation(before, 'admin handlers without tenant models');
  assert.deepEqual(await app.changedAlpha(before), []);
});

test('across the whole file the default and beta databases are byte-for-byte what they were at the start', async () => {
  await app.assertIsolation(globalBaseline, 'whole admin suite');
});
