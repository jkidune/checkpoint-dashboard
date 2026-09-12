// Explicit security check: the JWT carries organization_id (the tenant
// IDENTITY, safe to hand to the client), and nowhere in the auth surface —
// the decoded JWT, GET /api/auth/me, or the public user object returned by
// login/signup — does database_name (the tenant's physical database, a
// trust-boundary internal) ever leak to the client.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { startAuthTestApp, stopAuthTestApp } = require('./helpers/authTestApp');

let app;

before(async () => {
  app = await startAuthTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopAuthTestApp();
});

function assertNoDatabaseNameAnywhere(value, path = '$') {
  if (value === null || typeof value !== 'object') return;
  for (const [key, val] of Object.entries(value)) {
    assert.notEqual(key, 'database_name', `unexpected "database_name" key at ${path}.${key}`);
    if (typeof val === 'string') {
      assert.ok(!/tenant_alpha|tenant_beta/.test(val), `tenant database name leaked as a string value at ${path}.${key}: "${val}"`);
    }
    assertNoDatabaseNameAnywhere(val, `${path}.${key}`);
  }
}

test('decoded JWT contains organization_id and does not contain database_name', async () => {
  const res = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alpha_admin', password: 'AlphaPass123' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);

  const decoded = jwt.decode(body.token);
  assert.equal(decoded.organization_id, 'org_checkpoint_investors');
  assertNoDatabaseNameAnywhere(decoded, 'decoded_jwt');
});

test('login public user object does not expose database_name', async () => {
  const res = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alpha_admin', password: 'AlphaPass123' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assertNoDatabaseNameAnywhere(body.user, 'login_response.user');
});

test('signup public user object does not expose database_name', async () => {
  const res = await fetch(`${app.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_or_phone: 'alpha-new@example.com',
      username: 'jwt_leak_test_user',
      password: 'SignupPass123',
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assertNoDatabaseNameAnywhere(body.user, 'signup_response.user');
});

test('GET /api/auth/me does not expose database_name', async () => {
  const loginRes = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alpha_admin', password: 'AlphaPass123' }),
  });
  const { token } = await loginRes.json();

  const meRes = await fetch(`${app.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meBody = await meRes.json();
  assert.equal(meRes.status, 200);
  assert.equal(meBody.organization_id, 'org_checkpoint_investors');
  assert.ok(meBody.tenant, 'expected /me to include tenant metadata');
  assertNoDatabaseNameAnywhere(meBody, '/me response');
});
