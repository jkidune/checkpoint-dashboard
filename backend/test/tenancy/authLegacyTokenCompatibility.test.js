// Proves the temporary ALLOW_LEGACY_ORGLESS_TOKENS migration-compatibility
// behavior in middleware/auth.js: tokens issued before organization_id
// existed on the payload are accepted while the flag is enabled (the
// default), mapped to the sole Phase 3 runtime organization, and rejected
// once the flag is disabled — while a token with an explicit WRONG
// organization never benefits from that fallback either way.
//
// ALLOW_LEGACY_ORGLESS_TOKENS is read once, at require time, into a
// module-level constant in middleware/auth.js. To exercise both states in
// one file, this test rebuilds the Express app (clearing the require
// cache for server.js/middleware/auth.js/routes/auth.js and setting the
// env var beforehand) between the "enabled" and "disabled" phases, rather
// than relying on two separate test files/processes.
//
// Test order: A, D, E all run against the first (compatibility-enabled,
// the default) app instance; C reboots the app with the flag disabled and
// runs last. Letters follow the task's item list, not declaration order.

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const http = require('http');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/memoryMongo');

// Fixed test secret, set before anything requires server.js — see the same
// note in helpers/authTestApp.js. middleware/auth.js reads
// process.env.JWT_SECRET once, at require time; letting dotenv load
// backend/.env's real secret instead would make every token this suite
// signs fail verification against a different value.
const JWT_SECRET = 'phase3-test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;

let alphaAdminUser;
let alphaMember;
let currentServer;
let baseUrl;

function signToken(claims) {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: '1h' });
}

function clearAuthRequireCache() {
  delete require.cache[require.resolve('../../server')];
  delete require.cache[require.resolve('../../middleware/auth')];
  delete require.cache[require.resolve('../../routes/auth')];
}

async function bootApp() {
  process.env.VERCEL = '1'; // prevent server.js from calling app.listen()/starting the cron itself
  clearAuthRequireCache();
  const app = require('../../server');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function closeApp(server) {
  await new Promise((resolve) => server.close(resolve));
}

before(async () => {
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';
  await startMemoryMongo({ dbName: 'checkpoint_legacy_unused' });

  const { createOrganization } = require('../../tenancy/organizationRegistry');
  const { getTenantModels } = require('../../tenancy/tenantModels');
  const bcrypt = require('bcryptjs');

  await createOrganization({
    organization_id: 'org_checkpoint_investors',
    name: 'Checkpoint Investors Club',
    slug: 'checkpoint-investors-club',
    database_name: 'tenant_alpha',
    legacy: true,
  });

  const alpha = await getTenantModels({ organization_id: 'org_checkpoint_investors' });
  alphaMember = await alpha.Member.create({ name: 'Alpha Admin', email: 'alpha-admin@example.com', status: 'active' });
  alphaAdminUser = await alpha.User.create({
    id: await alpha.getNextId('user_id'),
    member_id: alphaMember.id,
    username: 'alpha_admin',
    email: 'alpha-admin@example.com',
    password_hash: bcrypt.hashSync('AlphaPass123', 10),
    role: 'admin',
    name: 'Alpha Admin',
  });
}, { timeout: 60000 });

after(async () => {
  if (currentServer) await closeApp(currentServer);
  await stopMemoryMongo();
});

test('A & B. a valid old orgless token is accepted while compatibility is enabled (default), and maps to org_checkpoint_investors', async () => {
  delete process.env.ALLOW_LEGACY_ORGLESS_TOKENS; // unset => default enabled
  const boot = await bootApp();
  currentServer = boot.server;
  baseUrl = boot.baseUrl;

  const legacyToken = signToken({
    id: alphaAdminUser.id,
    username: 'alpha_admin',
    role: 'admin',
    member_id: alphaMember.id,
    name: 'Alpha Admin',
    // no organization_id — a pre-Phase-3 token
  });
  const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${legacyToken}` } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.organization_id, 'org_checkpoint_investors');
});

test('D. a token with an explicit wrong organization_id does NOT use the legacy fallback', async () => {
  const wrongOrgToken = signToken({
    id: alphaAdminUser.id,
    username: 'alpha_admin',
    role: 'admin',
    member_id: alphaMember.id,
    name: 'Alpha Admin',
    organization_id: 'org_beta',
  });
  const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${wrongOrgToken}` } });
  // Rejected on its own merits by the runtime allowlist — never silently
  // reinterpreted as "no organization_id, fall back to the approved one".
  assert.equal(res.status, 403);
});

test('E. newly issued tokens always include organization_id', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alpha_admin', password: 'AlphaPass123' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  const decoded = jwt.decode(body.token);
  assert.equal(decoded.organization_id, 'org_checkpoint_investors');
});

test('C. with compatibility disabled, the same old orgless token is rejected', async () => {
  await closeApp(currentServer);
  process.env.ALLOW_LEGACY_ORGLESS_TOKENS = 'false';
  const boot = await bootApp();
  currentServer = boot.server;
  baseUrl = boot.baseUrl;

  const legacyToken = signToken({
    id: alphaAdminUser.id,
    username: 'alpha_admin',
    role: 'admin',
    member_id: alphaMember.id,
    name: 'Alpha Admin',
  });
  const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${legacyToken}` } });
  assert.equal(res.status, 401);
});
