// Shared helper for Phase 4C rules+contributions isolation tests. Adapts the
// Phase 4A/4B test architecture: one disposable in-memory MongoDB with THREE
// distinct logical databases, plus the tiny control database:
//
//   checkpoint_control_test  — the control plane (organization registry).
//   checkpoint_legacy_unused — the "default/legacy" connection, poisoned with
//                              clearly-named SENTINEL records across every
//                              model this phase touches (Member, Contribution,
//                              Fine, Transaction, Loan, Repayment, FyRules,
//                              Counter), so any accidental cross-connection
//                              read/write is unmistakable.
//   tenant_alpha              — org_checkpoint_investors's real data.
//   tenant_beta               — org_beta's data, used only to prove it stays
//                               untouched by anything this suite does.
//
// Separate alpha members are used per route-domain (rules-scan vs
// contributions-CRUD vs bulk-payment) so tests in different files — and
// different tests within the same file — don't interfere with each other's
// fixtures, even though they all share one tenant_alpha connection.

const http = require('http');
const jwt = require('jsonwebtoken');
const { startMemoryMongo, stopMemoryMongo } = require('./memoryMongo');

const TEST_JWT_SECRET = 'phase4c-test-jwt-secret';

// Deliberately far past anything a handful of tenant_alpha test records
// would ever reach, so "did this write land in the default DB instead" is
// unmistakable in the resulting IDs.
const DEFAULT_DB_COUNTER_POISON = 5000;
const CURRENT_FY = 2026; // matches real wall-clock "today" for date-dependent scan logic

let server;

async function poisonCounter(Counter, name, value) {
  await Counter.findByIdAndUpdate(name, { $set: { seq: value } }, { upsert: true });
}

async function startPhase4cTestApp() {
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
  const defaultModels = require('../../../db/models');

  // ─── Poison the default/legacy connection ──────────────────────────────
  const sentinelMember = await defaultModels.Member.create({
    name: 'DEFAULT DATABASE SENTINEL RULES/CONTRIB MEMBER',
    email: 'default-sentinel-rc@example.com',
    status: 'active',
  });
  await defaultModels.Contribution.create({
    member_id: sentinelMember.id,
    amount: 9999999,
    month: 3,
    year: CURRENT_FY,
    status: 'paid',
    paid_date: `${CURRENT_FY}-03-05`,
  });
  const sentinelUnpaidFine = await defaultModels.Fine.create({
    member_id: sentinelMember.id,
    amount: 8888888,
    reason: 'DEFAULT DATABASE SENTINEL UNPAID FINE',
    year: CURRENT_FY,
    status: 'unpaid',
  });
  const sentinelPaidFine = await defaultModels.Fine.create({
    member_id: sentinelMember.id,
    amount: 7777777,
    reason: 'DEFAULT DATABASE SENTINEL PAID FINE',
    year: CURRENT_FY,
    status: 'paid',
    paid_date: `${CURRENT_FY}-01-01`,
  });
  await defaultModels.Transaction.create({
    member_id: sentinelMember.id,
    amount: 9999999,
    type: 'sentinel',
    description: 'DEFAULT DATABASE SENTINEL TRANSACTION',
    transaction_date: `${CURRENT_FY}-01-01`,
  });
  const sentinelLoan = await defaultModels.Loan.create({
    member_id: sentinelMember.id,
    principal: 50000000,
    interest_amount: 6543210,
    status: 'active',
    disbursed: true,
    fiscal_year: CURRENT_FY,
  });
  await defaultModels.Repayment.create({
    loan_id: sentinelLoan.id,
    amount: 6666666,
    repayment_date: `${CURRENT_FY}-01-01`,
  });
  // Sentinel FyRules for the "current" FY — late_fine_enabled:false is the
  // strongest possible signal: if any hotfix/scan handler ever fell back to
  // this record, fine generation would silently no-op instead of running.
  await defaultModels.FyRules.create({
    fiscal_year: CURRENT_FY,
    contribution_amount: 1,
    late_fine_enabled: false,
    loan_interest_rate: 0.99,
    loan_max_ratio: 9.0,
    loan_repayment_months: 1,
    overdue_penalty_enabled: false,
    overdue_penalty_rate: 0.01,
  });
  // Sentinel FyRules for the arbitrary "rules CRUD" FYs used below.
  await defaultModels.FyRules.create({
    fiscal_year: 2030,
    contribution_amount: 99,
    late_fine_enabled: false,
    loan_interest_rate: 0.88,
    loan_max_ratio: 9.9,
    loan_repayment_months: 2,
    overdue_penalty_enabled: false,
    overdue_penalty_rate: 0.02,
  });
  await defaultModels.FyRules.create({
    fiscal_year: 2033,
    contribution_amount: 88,
    late_fine_enabled: false,
    loan_interest_rate: 0.77,
    loan_max_ratio: 8.8,
    loan_repayment_months: 3,
    overdue_penalty_enabled: false,
    overdue_penalty_rate: 0.03,
  });

  await poisonCounter(defaultModels.Counter, 'member_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'contribution_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'fine_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'transaction_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'loan_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'repayment_id', DEFAULT_DB_COUNTER_POISON);

  // ─── tenant_alpha: rules-CRUD FYs (arbitrary, date-independent) ────────
  // FY2030: alpha has its own override, deliberately distinct from both
  // DEFAULTS and the default DB's sentinel.
  await alpha.FyRules.create({
    fiscal_year: 2030,
    contribution_amount: 12345,
    late_fine_enabled: true,
    loan_interest_rate: 0.11,
    loan_max_ratio: 0.55,
    loan_repayment_months: 4,
    overdue_penalty_enabled: false,
    overdue_penalty_rate: 0.04,
  });
  // FY2031: alpha has NO override at all, and 2031 has no DEFAULTS entry —
  // the tenant route must fall back to DEFAULTS[2026] through req.tenantModels.

  // ─── tenant_alpha: rules-hotfix scan/recalculate member ────────────────
  const alphaScanMember = await alpha.Member.create({
    name: 'Tenant Alpha Scan Member',
    email: 'alpha-scan-member@example.com',
    status: 'active',
  });
  // Full, on-time, paid contributions for every FY_MONTHS period EXCEPT
  // month 3 (left genuinely missing -> the one fine scan-fines must
  // generate) and month 4 (also missing, but pre-fined below to prove
  // duplicate suppression).
  const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];
  for (const mo of FY_MONTHS) {
    if (mo === 3 || mo === 4) continue;
    const yr = mo >= 3 ? CURRENT_FY : CURRENT_FY + 1;
    await alpha.Contribution.create({
      member_id: alphaScanMember.id,
      amount: 75000,
      month: mo,
      year: yr,
      status: 'paid',
      paid_date: `${yr}-${String(mo).padStart(2, '0')}-05`,
    });
  }
  // A pre-existing fine for month 4 — must suppress duplicate assessment.
  const alphaExistingScanFine = await alpha.Fine.create({
    id: await alpha.getNextId('fine_id'),
    member_id: alphaScanMember.id,
    amount: 11250,
    reason: `Missing contribution 4/${CURRENT_FY} — one-time 15% fine (FY${CURRENT_FY})`,
    year: CURRENT_FY,
    contribution_month: 4,
    contribution_year: CURRENT_FY,
    status: 'unpaid',
  });
  // A "Late contribution ..." prefixed fine — the reason-text shape
  // routes/rules.js's own (shadowed) legacy scan produces, and the only
  // shape rulesHotfix.js's recalculate-fines query (`reason: /^Late
  // contribution/`) actually matches. Left unpaid so recalculate corrects it.
  const alphaUnpaidAutoFineToCorrect = await alpha.Fine.create({
    id: await alpha.getNextId('fine_id'),
    member_id: alphaScanMember.id,
    amount: 1, // deliberately wrong, so recalculate's correction is visible
    reason: `Late contribution 5/${CURRENT_FY} — stale amount to be corrected (FY${CURRENT_FY})`,
    year: CURRENT_FY,
    contribution_month: 5,
    contribution_year: CURRENT_FY,
    status: 'unpaid',
  });
  // A paid historical fine with the same reason prefix — must remain
  // completely untouched by recalculate (paid financial history is immutable).
  const alphaPaidAutoFine = await alpha.Fine.create({
    id: await alpha.getNextId('fine_id'),
    member_id: alphaScanMember.id,
    amount: 22222,
    reason: `Late contribution 6/${CURRENT_FY} — historical paid fine (FY${CURRENT_FY})`,
    year: CURRENT_FY,
    contribution_month: 6,
    contribution_year: CURRENT_FY,
    status: 'paid',
    paid_date: `${CURRENT_FY}-07-01`,
  });

  // ─── tenant_alpha: contributions CRUD member ───────────────────────────
  // status: 'inactive' deliberately — routes/rules.js's and
  // rulesHotfix.js's fine-scan handlers loop over Member.find({status:
  // 'active'}), and this member's contribution history is intentionally
  // partial (see below) purely to exercise contribution CRUD, not fine
  // scanning. Keeping it out of the "active" set keeps the rules-hotfix
  // scan/recalculate tests in phase4cRulesHotfix.test.js deterministic.
  // No contribution/bulk-payment route filters by member status, so this
  // has no effect on this member's own domain tests.
  const alphaContribMember = await alpha.Member.create({
    name: 'Tenant Alpha Contrib Member',
    email: 'alpha-contrib-member@example.com',
    status: 'inactive',
  });
  const alphaContribMemberUser = await alpha.User.create({
    id: await alpha.getNextId('user_id'),
    member_id: alphaContribMember.id,
    username: 'alpha_contrib_member',
    email: 'alpha-contrib-member@example.com',
    password_hash: 'unused',
    role: 'member',
    name: 'Tenant Alpha Contrib Member',
  });
  const alphaExistingContribution = await alpha.Contribution.create({
    id: await alpha.getNextId('contribution_id'),
    member_id: alphaContribMember.id,
    amount: 75000,
    month: 3,
    year: CURRENT_FY,
    status: 'paid',
    paid_date: `${CURRENT_FY}-03-05`,
  });
  // Deliberate collision fixture for the PATCH/DELETE isolation tests: a
  // default-DB contribution forced to the SAME numeric id as
  // alphaExistingContribution (ids don't naturally collide here since
  // several other alpha contributions were created first above).
  const collidingDefaultContribution = await defaultModels.Contribution.create({
    id: alphaExistingContribution.id,
    member_id: sentinelMember.id,
    amount: 9999999,
    month: 3,
    year: CURRENT_FY,
    status: 'paid',
    paid_date: `${CURRENT_FY}-03-05`,
    notes: 'DEFAULT DB COLLISION SENTINEL CONTRIBUTION',
  });

  // ─── tenant_alpha: bulk-payment member (separate, so bulk allocation's
  // full-history scan of FY2025→current never sees the CRUD member's data) ─
  // status: 'inactive' for the same reason as alphaContribMember above —
  // this member deliberately has unpaid/missing contribution periods so
  // bulk-payment allocation has something to allocate against, which would
  // otherwise also surface as fine-scan candidates.
  const alphaBulkMember = await alpha.Member.create({
    name: 'Tenant Alpha Bulk Member',
    email: 'alpha-bulk-member@example.com',
    status: 'inactive',
  });
  await alpha.FyRules.create({
    fiscal_year: CURRENT_FY,
    contribution_amount: 75000,
    late_fine_enabled: true,
    late_fine_type: 'percentage',
    late_fine_rate: 0.15,
    loan_interest_rate: 0.12,
    loan_max_ratio: 0.80,
    loan_repayment_months: 6,
    overdue_penalty_enabled: true,
    overdue_penalty_rate: 0.10,
  });
  const alphaBulkLoan = await alpha.Loan.create({
    member_id: alphaBulkMember.id,
    principal: 200000,
    interest_amount: 10000,
    status: 'active',
    disbursed: true,
    fiscal_year: CURRENT_FY,
  });
  // One pre-existing unpaid fine for the bulk member, to exercise the
  // fines-paid branch during bulk payment.
  const alphaBulkExistingFine = await alpha.Fine.create({
    id: await alpha.getNextId('fine_id'),
    member_id: alphaBulkMember.id,
    amount: 5000,
    reason: 'Tenant Alpha bulk member pre-existing unpaid fine',
    year: CURRENT_FY,
    status: 'unpaid',
  });

  // ─── tenant_alpha: partial-fine-safety member ──────────────────────────
  // No contributions at all, and no active loan — isolated on purpose so a
  // small total_amount (less than one month's contribution target, but
  // less than the fine amount too) deterministically exercises the
  // blocked_by_partial_fine safety path regardless of "today"'s date.
  const alphaPartialFineMember = await alpha.Member.create({
    name: 'Tenant Alpha Partial-Fine Member',
    email: 'alpha-partial-fine-member@example.com',
    status: 'inactive',
  });
  const alphaPartialFineExistingFine = await alpha.Fine.create({
    id: await alpha.getNextId('fine_id'),
    member_id: alphaPartialFineMember.id,
    amount: 10000,
    reason: 'Tenant Alpha partial-fine member pre-existing unpaid fine',
    year: CURRENT_FY,
    status: 'unpaid',
  });

  // ─── tenant_beta: sentinel, must remain untouched throughout ───────────
  const betaMember = await beta.Member.create({ name: 'Beta Sentinel Member', status: 'active' });
  const betaCountsBefore = {
    member: await beta.Member.countDocuments(),
    contribution: await beta.Contribution.countDocuments(),
    fine: await beta.Fine.countDocuments(),
    transaction: await beta.Transaction.countDocuments(),
    loan: await beta.Loan.countDocuments(),
    repayment: await beta.Repayment.countDocuments(),
    fyRules: await beta.FyRules.countDocuments(),
  };

  process.env.VERCEL = '1';
  const app = require('../../../server');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  function signToken(overrides = {}) {
    return jwt.sign(
      {
        id: 1,
        username: 'alpha_admin',
        role: 'admin',
        member_id: null,
        name: 'Alpha Admin',
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
      id: alphaContribMemberUser.id,
      username: 'alpha_contrib_member',
      role: 'member',
      member_id: alphaContribMember.id,
      name: 'Tenant Alpha Contrib Member',
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
    CURRENT_FY,
    DEFAULT_DB_COUNTER_POISON,
    sentinelMember,
    sentinelUnpaidFine,
    sentinelPaidFine,
    sentinelLoan,
    alphaScanMember,
    alphaExistingScanFine,
    alphaUnpaidAutoFineToCorrect,
    alphaPaidAutoFine,
    alphaContribMember,
    alphaContribMemberUser,
    alphaExistingContribution,
    collidingDefaultContribution,
    alphaBulkMember,
    alphaBulkLoan,
    alphaBulkExistingFine,
    alphaPartialFineMember,
    alphaPartialFineExistingFine,
    betaMember,
    betaCountsBefore,
    adminToken,
    memberToken,
    signToken,
  };
}

async function stopPhase4cTestApp() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  await stopMemoryMongo();
}

module.exports = { startPhase4cTestApp, stopPhase4cTestApp, TEST_JWT_SECRET };
