// Shared helper for Phase 4B member-loan-eligibility isolation tests.
// Adapts the Phase 4A test architecture (backend/test/tenancy/helpers/
// phase4aTestApp.js): one disposable in-memory MongoDB with THREE distinct
// logical databases, plus the tiny control database:
//
//   checkpoint_control_test  — the control plane (organization registry).
//   checkpoint_legacy_unused — the "default/legacy" connection, poisoned
//                              with clearly-named SENTINEL financial data
//                              AND a sentinel FyRules override, so this
//                              suite can prove BOTH the financial models
//                              and FyRules are tenant-bound.
//   tenant_alpha              — org_checkpoint_investors's real data.
//   tenant_beta               — org_beta's data, used only to prove it
//                               stays untouched by anything this suite does.
//
// The sentinel Member in the default DB and the real Member in tenant_alpha
// are deliberately given the SAME numeric id (each is the first Member
// created in its own fresh, isolated counter space) — the adversarial
// collision this suite is built to catch: if the migrated route ever fell
// back to the default connection, it would silently return the sentinel's
// numbers instead of failing loudly.

const http = require('http');
const jwt = require('jsonwebtoken');
const { startMemoryMongo, stopMemoryMongo } = require('./memoryMongo');

const TEST_JWT_SECRET = 'phase4b-test-jwt-secret';

let server;

async function startPhase4bTestApp() {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';
  process.env.CONTROL_DB_NAME = 'checkpoint_control_test';

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

  // Default/legacy connection — what memberLoanEligibility.js (both route
  // and service) used exclusively before Phase 4B.
  const defaultModels = require('../../../db/models');

  const FISCAL_YEAR = 2026;

  // ── Default DB: poisoned sentinel data, unmistakably different from
  // tenant_alpha's, for a member sharing tenant_alpha's future member id.
  const sentinelMember = await defaultModels.Member.create({
    name: 'DEFAULT DATABASE SENTINEL LOAN MEMBER',
    email: 'default-sentinel-loan@example.com',
    status: 'active',
  });
  await defaultModels.Contribution.create({
    member_id: sentinelMember.id,
    amount: 9999999,
    month: 4,
    year: FISCAL_YEAR,
    status: 'paid',
    paid_date: `${FISCAL_YEAR}-04-01`,
  });
  await defaultModels.Loan.create({
    member_id: sentinelMember.id,
    principal: 50000000,
    interest_amount: 6543210,
    status: 'active',
    disbursed: true,
    fiscal_year: FISCAL_YEAR,
  });
  await defaultModels.Fine.create({
    member_id: sentinelMember.id,
    amount: 8888888,
    reason: 'DEFAULT DATABASE SENTINEL FINE',
    year: FISCAL_YEAR,
    status: 'paid',
  });
  // Sentinel FyRules override for FY2026 — an unmistakable value nowhere
  // near any real DEFAULTS[2026] or tenant_alpha value.
  await defaultModels.FyRules.create({
    fiscal_year: FISCAL_YEAR,
    contribution_amount: 1,
    late_fine_enabled: false,
    loan_interest_rate: 0.99,
    loan_max_ratio: 9.0,
    loan_repayment_months: 1,
    overdue_penalty_enabled: false,
    overdue_penalty_rate: 0.01,
  });

  // ── tenant_alpha: real, small, known data.
  const alphaMember = await alpha.Member.create({
    name: 'Tenant Alpha Loan Member',
    email: 'alpha-loan-member@example.com',
    status: 'active',
  });
  await alpha.Contribution.create({
    member_id: alphaMember.id,
    amount: 75000,
    month: 4,
    year: FISCAL_YEAR,
    status: 'paid',
    paid_date: `${FISCAL_YEAR}-04-01`,
  });
  // Realized loan — counts toward interest.
  await alpha.Loan.create({
    member_id: alphaMember.id,
    principal: 500000,
    interest_amount: 5000,
    status: 'active',
    disbursed: true,
    fiscal_year: FISCAL_YEAR,
  });
  // Pending loan — must NOT count toward interest (realization semantics).
  await alpha.Loan.create({
    member_id: alphaMember.id,
    principal: 200000,
    interest_amount: 999999,
    status: 'pending',
    fiscal_year: FISCAL_YEAR,
  });
  // Cancelled loan — must NOT count toward interest.
  await alpha.Loan.create({
    member_id: alphaMember.id,
    principal: 300000,
    interest_amount: 888888,
    status: 'cancelled',
    fiscal_year: FISCAL_YEAR,
  });
  await alpha.Fine.create({
    member_id: alphaMember.id,
    amount: 3500,
    reason: 'Tenant Alpha late fine',
    year: FISCAL_YEAR,
    status: 'paid',
  });
  // Unpaid fine — must NOT count toward paid_fines.
  await alpha.Fine.create({
    member_id: alphaMember.id,
    amount: 777777,
    reason: 'Tenant Alpha unpaid fine (must not count)',
    year: FISCAL_YEAR,
    status: 'unpaid',
  });
  // tenant_alpha's own FY2026 rules override — deliberately distinct from
  // both the hardcoded DEFAULTS[2026] and the default DB's sentinel, so a
  // passing test can only mean the route actually read tenant_alpha's
  // FyRules record.
  await alpha.FyRules.create({
    fiscal_year: FISCAL_YEAR,
    contribution_amount: 75000,
    late_fine_enabled: true,
    loan_interest_rate: 0.09,
    loan_max_ratio: 0.65,
    loan_repayment_months: 9,
    overdue_penalty_enabled: false,
    overdue_penalty_rate: 0.05,
  });

  const alphaMemberUser = await alpha.User.create({
    id: await alpha.getNextId('user_id'),
    member_id: alphaMember.id,
    username: 'alpha_loan_member',
    email: 'alpha-loan-member@example.com',
    password_hash: 'unused',
    role: 'member',
    name: 'Tenant Alpha Loan Member',
  });

  // tenant_beta — must remain untouched by everything this suite does.
  const betaMemberCountBefore = await beta.Member.countDocuments();
  const betaContributionCountBefore = await beta.Contribution.countDocuments();
  const betaLoanCountBefore = await beta.Loan.countDocuments();
  const betaFineCountBefore = await beta.Fine.countDocuments();
  const betaFyRulesCountBefore = await beta.FyRules.countDocuments();

  process.env.VERCEL = '1'; // prevent server.js from calling app.listen()/starting the cron itself
  const app = require('../../../server');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const memberToken = jwt.sign(
    {
      id: alphaMemberUser.id,
      username: 'alpha_loan_member',
      role: 'member',
      member_id: alphaMember.id,
      name: 'Tenant Alpha Loan Member',
      organization_id: 'org_checkpoint_investors',
    },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  // A token with no linked member record, to exercise the 404 path.
  const noMemberToken = jwt.sign(
    {
      id: 999,
      username: 'no_member_user',
      role: 'member',
      member_id: null,
      name: 'No Member',
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
    alphaMemberUser,
    sentinelMember,
    FISCAL_YEAR,
    betaMemberCountBefore,
    betaContributionCountBefore,
    betaLoanCountBefore,
    betaFineCountBefore,
    betaFyRulesCountBefore,
    memberToken,
    noMemberToken,
  };
}

async function stopPhase4bTestApp() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  await stopMemoryMongo();
}

module.exports = { startPhase4bTestApp, stopPhase4bTestApp, TEST_JWT_SECRET };
