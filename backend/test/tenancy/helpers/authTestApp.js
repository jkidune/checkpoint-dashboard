// Shared helper for Phase 3 auth tests: boots the REAL Express app
// (backend/server.js), against a disposable in-memory MongoDB with TWO
// distinct, real logical tenant databases registered (org_checkpoint_investors
// -> tenant_alpha, org_beta -> tenant_beta), and exposes an HTTP base URL so
// tests can exercise the actual auth routes and middleware end-to-end —
// not mocks.

const http = require('http');
const bcrypt = require('bcryptjs');
const { startMemoryMongo, stopMemoryMongo } = require('./memoryMongo');

let server;

// Fixed test secret, set before anything requires server.js. middleware/auth.js
// reads process.env.JWT_SECRET once, at require time; if we let dotenv load
// backend/.env's real secret instead, every token this test suite signs
// (using a value read before dotenv ran) would fail signature verification
// against the real one — a classic require-order footgun, not a real
// security property to test around. Tests import this same constant to
// sign their own tokens.
const TEST_JWT_SECRET = 'phase3-test-jwt-secret';

async function startAuthTestApp() {
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  // Prevent any real email attempt: utils/memberMailer.js reads these once,
  // at require time, into a module-level `isConfigured` flag. Setting them
  // to empty strings before anything requires it — and before any
  // dotenv.config() call, which never overrides an already-set env var —
  // guarantees the mocked code path, never a real SMTP connection, during
  // tests.
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';

  await startMemoryMongo({ dbName: 'checkpoint_legacy_unused' });

  const { createOrganization } = require('../../../tenancy/organizationRegistry');
  const { getTenantModels } = require('../../../tenancy/tenantModels');

  await createOrganization({
    organization_id: 'org_checkpoint_investors',
    name: 'Checkpoint Investors Club',
    slug: 'checkpoint-investors-club',
    database_name: 'tenant_alpha',
    legacy: true,
  });
  await createOrganization({
    organization_id: 'org_beta',
    name: 'Beta Investment Club',
    slug: 'beta-club',
    database_name: 'tenant_beta',
  });

  const alpha = await getTenantModels({ organization_id: 'org_checkpoint_investors' });
  const beta = await getTenantModels({ organization_id: 'org_beta' });

  const alphaMember = await alpha.Member.create({ name: 'Alpha Admin', email: 'alpha-admin@example.com', status: 'active' });
  const alphaAdminUser = await alpha.User.create({
    id: await alpha.getNextId('user_id'),
    member_id: alphaMember.id,
    username: 'alpha_admin',
    email: 'alpha-admin@example.com',
    password_hash: bcrypt.hashSync('AlphaPass123', 10),
    role: 'admin',
    name: 'Alpha Admin',
  });
  // Active, unclaimed member — used by the signup test.
  const alphaUnclaimedMember = await alpha.Member.create({
    name: 'Alpha New Member',
    email: 'alpha-new@example.com',
    phone: '255700000001',
    status: 'active',
  });

  const betaMember = await beta.Member.create({ name: 'Beta Admin', email: 'beta-admin@example.com', status: 'active' });
  const betaAdminUser = await beta.User.create({
    id: await beta.getNextId('user_id'),
    member_id: betaMember.id,
    username: 'beta_admin',
    email: 'beta-admin@example.com',
    password_hash: bcrypt.hashSync('BetaPass123', 10),
    role: 'admin',
    name: 'Beta Admin',
  });

  process.env.VERCEL = '1'; // prevent server.js from calling app.listen()/starting the deadline-scan cron itself
  const app = require('../../../server');

  // Test-only diagnostic route, mounted directly on the real app instance
  // and using the REAL authenticate middleware — lets tests directly
  // inspect what it attaches to req without reaching into Express
  // internals or duplicating middleware logic.
  const { authenticate } = require('../../../middleware/auth');
  app.get('/__test/tenant-context', authenticate, (req, res) => {
    res.json({
      tenant: req.tenant,
      tenantModelsUserDbName: req.tenantModels?.User?.db?.name || null,
      user: req.user,
    });
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    alpha,
    beta,
    alphaMember,
    alphaAdminUser,
    alphaUnclaimedMember,
    betaMember,
    betaAdminUser,
  };
}

async function stopAuthTestApp() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  await stopMemoryMongo();
}

module.exports = { startAuthTestApp, stopAuthTestApp, TEST_JWT_SECRET };
