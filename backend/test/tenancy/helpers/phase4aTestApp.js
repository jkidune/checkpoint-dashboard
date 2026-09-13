// Shared helper for Phase 4A route-isolation tests. Boots the REAL
// Express app against a disposable in-memory MongoDB with THREE distinct
// logical databases:
//
//   checkpoint_legacy_unused  — the "default/legacy" connection, seeded
//                               with clearly-named SENTINEL records and a
//                               counter deliberately advanced far beyond
//                               tenant_alpha's, so any test that
//                               accidentally still hits the default
//                               connection is caught immediately.
//   tenant_alpha              — org_checkpoint_investors's real data.
//   tenant_beta               — org_beta's data, used only to prove it
//                               stays untouched by anything this suite does.
//
// Tests exercise the real HTTP routes (members/transactions/expenses)
// through the real authenticate middleware — not mocks — which is what
// proves the migrated handlers actually query req.tenantModels rather
// than merely asserting it exists.

const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { startMemoryMongo, stopMemoryMongo } = require('./memoryMongo');

const TEST_JWT_SECRET = 'phase4a-test-jwt-secret';

// Deliberately far past anything a handful of tenant_alpha test records
// would ever reach, so "did this write land in the default DB instead"
// is unmistakable in the resulting IDs.
const DEFAULT_DB_COUNTER_POISON = 5000;

let server;

async function poisonCounter(Counter, name, value) {
  await Counter.findByIdAndUpdate(name, { $set: { seq: value } }, { upsert: true });
}

async function startPhase4aTestApp() {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
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

  // Default/legacy connection — this is what members.js/transactions.js/
  // expenses.js used to read/write before Phase 4A. require('../../../db/models')
  // returns models bound to mongoose.connection (the default connection),
  // exactly like the pre-Phase-4A route code did.
  const defaultModels = require('../../../db/models');

  const sentinelMember = await defaultModels.Member.create({
    name: 'DEFAULT DATABASE SENTINEL',
    email: 'default-sentinel@example.com',
    status: 'active',
  });
  const sentinelTransaction = await defaultModels.Transaction.create({
    amount: 999999,
    type: 'sentinel',
    description: 'DEFAULT DATABASE SENTINEL TRANSACTION',
    transaction_date: '2020-01-01',
  });
  const sentinelExpense = await defaultModels.Expense.create({
    category: 'Other',
    description: 'DEFAULT DATABASE SENTINEL EXPENSE',
    amount: 999999,
    expense_date: '2020-01-01',
    fiscal_year: 2019,
  });
  // A User in the default DB sharing an id with an alpha User later on,
  // used to prove PATCH /members/:id email sync never touches it.
  const sentinelUser = await defaultModels.User.create({
    id: await defaultModels.getNextId('user_id'),
    member_id: sentinelMember.id,
    username: 'default_sentinel_user',
    email: 'default-sentinel@example.com',
    password_hash: bcrypt.hashSync('unused', 10),
    role: 'member',
    name: 'DEFAULT DATABASE SENTINEL',
  });

  await poisonCounter(defaultModels.Counter, 'member_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'transaction_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'expense_id', DEFAULT_DB_COUNTER_POISON);

  // Real tenant_alpha data.
  const alphaMember = await alpha.Member.create({
    name: 'Tenant Alpha Member',
    email: 'alpha-member@example.com',
    status: 'active',
  });
  const alphaAdminMember = await alpha.Member.create({
    name: 'Alpha Admin Member',
    email: 'alpha-admin-member@example.com',
    status: 'active',
  });
  const alphaAdminUser = await alpha.User.create({
    id: await alpha.getNextId('user_id'),
    member_id: alphaAdminMember.id,
    username: 'alpha_admin',
    email: 'alpha-admin-member@example.com',
    password_hash: bcrypt.hashSync('AlphaPass123', 10),
    role: 'admin',
    name: 'Alpha Admin Member',
  });
  const alphaMemberUser = await alpha.User.create({
    id: await alpha.getNextId('user_id'),
    member_id: alphaMember.id,
    username: 'alpha_member',
    email: 'alpha-member@example.com',
    password_hash: bcrypt.hashSync('MemberPass123', 10),
    role: 'member',
    name: 'Tenant Alpha Member',
  });

  // tenant_beta data — must remain untouched by everything this suite does.
  const betaMember = await beta.Member.create({ name: 'Beta Sentinel Member', status: 'active' });
  const betaMemberCountBefore = await beta.Member.countDocuments();
  const betaTransactionCountBefore = await beta.Transaction.countDocuments();
  const betaExpenseCountBefore = await beta.Expense.countDocuments();
  const betaUserCountBefore = await beta.User.countDocuments();

  process.env.VERCEL = '1'; // prevent server.js from calling app.listen()/starting the cron itself
  const app = require('../../../server');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  function signToken(overrides = {}) {
    return jwt.sign(
      {
        id: alphaAdminUser.id,
        username: 'alpha_admin',
        role: 'admin',
        member_id: alphaAdminMember.id,
        name: 'Alpha Admin Member',
        organization_id: 'org_checkpoint_investors',
        ...overrides,
      },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
  }

  const adminToken = signToken();
  const memberToken = jwt.sign(
    {
      id: alphaMemberUser.id,
      username: 'alpha_member',
      role: 'member',
      member_id: alphaMember.id,
      name: 'Tenant Alpha Member',
      organization_id: 'org_checkpoint_investors',
    },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    alpha,
    beta,
    defaultModels,
    alphaMember,
    alphaAdminMember,
    alphaAdminUser,
    alphaMemberUser,
    betaMember,
    betaMemberCountBefore,
    betaTransactionCountBefore,
    betaExpenseCountBefore,
    betaUserCountBefore,
    sentinelMember,
    sentinelTransaction,
    sentinelExpense,
    sentinelUser,
    adminToken,
    memberToken,
    signToken,
    DEFAULT_DB_COUNTER_POISON,
  };
}

async function stopPhase4aTestApp() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  await stopMemoryMongo();
}

module.exports = { startPhase4aTestApp, stopPhase4aTestApp, TEST_JWT_SECRET };
