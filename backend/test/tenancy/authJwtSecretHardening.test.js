// Proves the JWT_SECRET hardening: no hardcoded fallback secret remains,
// a missing secret fails the application closed, the JWT algorithm is
// pinned to HS256 on both sign and verify, and organization_id/no-
// database_name behavior is unaffected by any of this.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const { startAuthTestApp, stopAuthTestApp, TEST_JWT_SECRET } = require('./helpers/authTestApp');

let app;

before(async () => {
  app = await startAuthTestApp();
}, { timeout: 60000 });

after(async () => {
  await stopAuthTestApp();
});

async function getWithToken(path_, token) {
  const res = await fetch(`${app.baseUrl}${path_}`, { headers: { Authorization: `Bearer ${token}` } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // fine — some responses (e.g. 401s) may have no body
  }
  return { status: res.status, body };
}

test('1. auth configuration fails closed when JWT_SECRET is genuinely absent (isolated subprocess)', () => {
  // Runs in a real separate Node process — not the main test process —
  // because module-level env state (JWT_SECRET already validated once
  // this process's middleware/auth.js was first required) can't be
  // un-set/re-validated in-process without corrupting other tests.
  const childEnv = { ...process.env };
  delete childEnv.JWT_SECRET;

  const authModulePath = path.join(__dirname, '..', '..', 'middleware', 'auth.js');
  const result = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(authModulePath)})`],
    { env: childEnv, encoding: 'utf8' }
  );

  assert.notEqual(result.status, 0, 'expected the process to exit non-zero when JWT_SECRET is missing');
  assert.match(result.stderr, /JWT_SECRET environment variable is required/);
});

test('2. a JWT signed with the configured explicit test secret is accepted', async () => {
  const token = jwt.sign(
    { id: app.alphaAdminUser.id, username: 'alpha_admin', role: 'admin', member_id: app.alphaMember.id, name: 'Alpha Admin', organization_id: 'org_checkpoint_investors' },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  const { status } = await getWithToken('/api/auth/me', token);
  assert.equal(status, 200);
});

test('3. a JWT signed with the historical literal fallback secret is rejected', async () => {
  const token = jwt.sign(
    { id: app.alphaAdminUser.id, username: 'alpha_admin', role: 'admin', member_id: app.alphaMember.id, name: 'Alpha Admin', organization_id: 'org_checkpoint_investors' },
    'checkpoint_secret_2026', // the old hardcoded fallback — must not verify against the real configured secret
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  const { status } = await getWithToken('/api/auth/me', token);
  assert.equal(status, 401);
});

test('4 & 5. newly issued tokens contain organization_id and never contain database_name', async () => {
  const res = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alpha_admin', password: 'AlphaPass123' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);

  const decoded = jwt.decode(body.token);
  assert.equal(decoded.organization_id, 'org_checkpoint_investors');
  assert.equal(decoded.database_name, undefined);
  assert.deepEqual(Object.keys(decoded).sort(), ['exp', 'iat', 'id', 'member_id', 'name', 'organization_id', 'role', 'username'].sort());
});

test('6. HS256 tokens work normally', async () => {
  const token = jwt.sign(
    { id: app.alphaAdminUser.id, username: 'alpha_admin', role: 'admin', member_id: app.alphaMember.id, name: 'Alpha Admin', organization_id: 'org_checkpoint_investors' },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  const decodedHeader = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(decodedHeader.alg, 'HS256');

  const { status, body } = await getWithToken('/api/auth/me', token);
  assert.equal(status, 200);
  assert.equal(body.organization_id, 'org_checkpoint_investors');
});

test('7. a token using an unsupported algorithm ("none") is rejected', async () => {
  const unsignedToken = jwt.sign(
    { id: app.alphaAdminUser.id, username: 'alpha_admin', role: 'admin', member_id: app.alphaMember.id, name: 'Alpha Admin', organization_id: 'org_checkpoint_investors' },
    null,
    { algorithm: 'none', expiresIn: '1h' }
  );
  const { status } = await getWithToken('/api/auth/me', unsignedToken);
  assert.equal(status, 401);
});
