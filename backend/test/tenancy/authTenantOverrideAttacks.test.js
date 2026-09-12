// Proves a client cannot select or override which tenant a request
// resolves to — not through the request body, not through headers, not
// through a query parameter, and not through a signed token claiming a
// different (or nonexistent, or suspended) organization. Uses the real
// running Express app and real HTTP requests, not mocked middleware.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { startAuthTestApp, stopAuthTestApp, TEST_JWT_SECRET } = require('./helpers/authTestApp');

const JWT_SECRET = TEST_JWT_SECRET;
let app;

before(async () => {
  app = await startAuthTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopAuthTestApp();
});

function signToken(claims, options = { expiresIn: '1h' }) {
  return jwt.sign(claims, JWT_SECRET, options);
}

async function postJson(path, body, headers = {}) {
  const res = await fetch(`${app.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getWithToken(path, token) {
  const res = await fetch(`${app.baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // no JSON body (e.g. some 401s) — fine, status is what matters here
  }
  return { status: res.status, body };
}

test('1. login body containing organization_id: org_beta does not authenticate against Beta', async () => {
  const { status, body } = await postJson('/api/auth/login', {
    username: 'beta_admin',
    password: 'BetaPass123',
    organization_id: 'org_beta',
  });
  assert.equal(status, 401);
  assert.ok(!body.token);
});

test('2. x-organization-id header cannot change tenant', async () => {
  const { status } = await postJson(
    '/api/auth/login',
    { username: 'beta_admin', password: 'BetaPass123' },
    { 'x-organization-id': 'org_beta' }
  );
  assert.equal(status, 401); // beta_admin does not exist in the only tenant login ever resolves
});

test('3. x-tenant-id header cannot change tenant', async () => {
  const { status } = await postJson(
    '/api/auth/login',
    { username: 'beta_admin', password: 'BetaPass123' },
    { 'x-tenant-id': 'org_beta' }
  );
  assert.equal(status, 401);
});

test('4. organization_id query parameter cannot change tenant', async () => {
  const res = await fetch(`${app.baseUrl}/api/auth/login?organization_id=org_beta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'beta_admin', password: 'BetaPass123' }),
  });
  assert.equal(res.status, 401);
});

test('5. a valid signed token claiming org_beta is rejected by the Phase 3 runtime organization guard', async () => {
  const token = signToken({
    id: app.betaAdminUser.id,
    username: 'beta_admin',
    role: 'admin',
    member_id: app.betaMember.id,
    name: 'Beta Admin',
    organization_id: 'org_beta',
  });
  const { status } = await getWithToken('/api/auth/me', token);
  assert.equal(status, 403);
});

test('6. a token claiming an unknown organization_id is rejected', async () => {
  const token = signToken({
    id: 1,
    username: 'nobody',
    role: 'admin',
    member_id: null,
    name: 'Nobody',
    organization_id: 'org_does_not_exist',
  });
  const { status } = await getWithToken('/api/auth/me', token);
  assert.equal(status, 403);
});

test('7. a suspended org_checkpoint_investors is rejected, even with a correctly-signed token', async () => {
  const { getOrganizationModel } = require('../../tenancy/organizationRegistry');
  const Organization = await getOrganizationModel();
  await Organization.updateOne({ organization_id: 'org_checkpoint_investors' }, { status: 'suspended' });

  try {
    const token = signToken({
      id: app.alphaAdminUser.id,
      username: 'alpha_admin',
      role: 'admin',
      member_id: app.alphaMember.id,
      name: 'Alpha Admin',
      organization_id: 'org_checkpoint_investors',
    });
    const { status } = await getWithToken('/api/auth/me', token);
    assert.equal(status, 403);
  } finally {
    // Restore so later tests (and other test files sharing no state, but
    // this file's own remaining tests) see the normal active tenant.
    await Organization.updateOne({ organization_id: 'org_checkpoint_investors' }, { status: 'active' });
  }
});

test('8. an orgless legacy signed token maps only to org_checkpoint_investors', async () => {
  const token = signToken({
    id: app.alphaAdminUser.id,
    username: 'alpha_admin',
    role: 'admin',
    member_id: app.alphaMember.id,
    name: 'Alpha Admin',
    // no organization_id — a pre-Phase-3 token
  });
  const { status, body } = await getWithToken('/api/auth/me', token);
  assert.equal(status, 200);
  assert.equal(body.organization_id, 'org_checkpoint_investors');
  assert.equal(body.tenant.slug, 'checkpoint-investors-club');
});

test('9. an invalid/tampered token never receives a tenant context', async () => {
  const { status, body } = await getWithToken('/api/auth/me', 'not-a-real-token');
  assert.equal(status, 401);
  assert.ok(!body || body.tenant === undefined);
});
