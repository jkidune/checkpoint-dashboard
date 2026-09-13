// Phase 4A isolation proof for the migrated /api/members routes. Uses the
// real Express app + real HTTP requests through the real authenticate
// middleware — never mocks — against a poisoned default/legacy database
// and a real tenant_alpha, so these tests prove the actual route handlers
// query req.tenantModels, not merely that req.tenantModels exists.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

const { startPhase4aTestApp, stopPhase4aTestApp } = require('./helpers/phase4aTestApp');
const { getJson, postJson, patchJson } = require('./helpers/httpJson');

let app;

before(async () => {
  app = await startPhase4aTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopPhase4aTestApp();
});

test('1, 2 & 3. GET /api/members reads tenant_alpha: default sentinel absent, tenant_alpha members present', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/members', app.adminToken);
  assert.equal(status, 200);
  const names = body.map((m) => m.name);
  assert.ok(!names.includes('DEFAULT DATABASE SENTINEL'), 'default DB sentinel must not appear');
  assert.ok(names.includes('Tenant Alpha Member'));
  assert.ok(names.includes('Alpha Admin Member'));
});

test('4. GET /api/members/me resolves the member from tenant_alpha', async () => {
  const { status, body } = await getJson(app.baseUrl, '/api/members/me', app.memberToken);
  assert.equal(status, 200);
  assert.equal(body.name, 'Tenant Alpha Member');
  assert.equal(body.id, app.alphaMember.id);
});

test('5. GET /api/members/:id resolves tenant_alpha data', async () => {
  const { status, body } = await getJson(app.baseUrl, `/api/members/${app.alphaMember.id}`, app.adminToken);
  assert.equal(status, 200);
  assert.equal(body.name, 'Tenant Alpha Member');
});

test('6. member self/admin authorization semantics are unchanged', async () => {
  // A member requesting someone else's record is forbidden...
  const forbidden = await getJson(app.baseUrl, `/api/members/${app.alphaAdminMember.id}`, app.memberToken);
  assert.equal(forbidden.status, 403);

  // ...but requesting their own record is fine.
  const own = await getJson(app.baseUrl, `/api/members/${app.alphaMember.id}`, app.memberToken);
  assert.equal(own.status, 200);
  assert.equal(own.body.name, 'Tenant Alpha Member');
});

test('7, 8, 9 & 10. POST /api/members creates only in tenant_alpha, with an ID from tenant_alpha\'s own counter, leaving the default DB and its counter untouched', async () => {
  const defaultMemberCountBefore = await app.defaultModels.Member.countDocuments();
  const defaultCounterBefore = await app.defaultModels.Counter.findById('member_id').lean();

  const { status, body: created } = await postJson(
    app.baseUrl,
    '/api/members',
    { name: 'Fresh Alpha Recruit', email: 'fresh-recruit@example.com' },
    app.adminToken
  );
  assert.equal(status, 201);

  // 8: allocated from tenant_alpha's own counter, nowhere near the
  // default DB's poisoned counter value.
  assert.ok(created.id < app.DEFAULT_DB_COUNTER_POISON, `expected a small tenant_alpha id, got ${created.id}`);

  // 7: exists in tenant_alpha...
  const inAlpha = await app.alpha.Member.findOne({ name: 'Fresh Alpha Recruit' }).lean();
  assert.ok(inAlpha);
  // ...not in the default DB...
  const inDefault = await app.defaultModels.Member.findOne({ name: 'Fresh Alpha Recruit' }).lean();
  assert.equal(inDefault, null);
  // ...and not in Beta.
  const inBeta = await app.beta.Member.findOne({ name: 'Fresh Alpha Recruit' }).lean();
  assert.equal(inBeta, null);

  // 9: default DB Member collection count unchanged.
  const defaultMemberCountAfter = await app.defaultModels.Member.countDocuments();
  assert.equal(defaultMemberCountAfter, defaultMemberCountBefore);

  // 10: default DB member_id counter unchanged.
  const defaultCounterAfter = await app.defaultModels.Counter.findById('member_id').lean();
  assert.equal(defaultCounterAfter.seq, defaultCounterBefore.seq);
});

test('11, 12 & 13. PATCH /api/members/:id updates only tenant_alpha, syncing only the linked tenant_alpha User', async () => {
  // 13 setup check: the default DB's sentinel User and tenant_alpha's
  // member-linked User happen to share the same numeric id (each is the
  // first User created in its own fresh, isolated counter space) — the
  // exact collision this test needs to prove PATCH can't cross.
  assert.equal(app.sentinelUser.member_id, app.sentinelMember.id);

  const defaultMemberBefore = await app.defaultModels.Member.findOne({ id: app.sentinelMember.id }).lean();
  const defaultUserBefore = await app.defaultModels.User.findOne({ id: app.sentinelUser.id }).lean();

  const { status, body } = await patchJson(
    app.baseUrl,
    `/api/members/${app.alphaMember.id}`,
    { phone: '255700009999', email: 'alpha-member-updated@example.com' },
    app.adminToken
  );
  assert.equal(status, 200);
  assert.equal(body.phone, '255700009999');

  // 11: tenant_alpha's own Member record updated.
  const alphaMemberAfter = await app.alpha.Member.findOne({ id: app.alphaMember.id }).lean();
  assert.equal(alphaMemberAfter.phone, '255700009999');
  assert.equal(alphaMemberAfter.email, 'alpha-member-updated@example.com');

  // 12: the linked tenant_alpha User's email was synchronized.
  const alphaUserAfter = await app.alpha.User.findOne({ id: app.alphaMemberUser.id }).lean();
  assert.equal(alphaUserAfter.email, 'alpha-member-updated@example.com');

  // 11 & 13: the default DB's identically-shaped Member/User records are untouched.
  const defaultMemberAfter = await app.defaultModels.Member.findOne({ id: app.sentinelMember.id }).lean();
  assert.equal(defaultMemberAfter.phone, defaultMemberBefore.phone);
  assert.equal(defaultMemberAfter.email, defaultMemberBefore.email);
  const defaultUserAfter = await app.defaultModels.User.findOne({ id: app.sentinelUser.id }).lean();
  assert.equal(defaultUserAfter.email, defaultUserBefore.email);
});

test('14. org_beta remained untouched throughout this suite', async () => {
  assert.equal(await app.beta.Member.countDocuments(), app.betaMemberCountBefore);
  const betaMember = await app.beta.Member.findOne({ id: app.betaMember.id }).lean();
  assert.equal(betaMember.name, 'Beta Sentinel Member');
});
