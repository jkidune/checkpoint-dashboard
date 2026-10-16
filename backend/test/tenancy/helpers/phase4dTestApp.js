// Shared helper for Phase 4D loan-domain isolation tests. Follows the same
// architecture as the Phase 4C helper: one disposable in-memory MongoDB with
// four distinct logical databases plus the control database.
//
//   checkpoint_control_test  — the control plane (organization registry).
//   checkpoint_legacy_unused — the "default/legacy" connection, poisoned
//                              with clearly-named SENTINEL records across
//                              every model the loan domain touches (Member,
//                              Contribution, Fine, Loan, Repayment,
//                              Transaction, Expense, FyRules, Counter,
//                              LoanRequestSubmission), so any accidental
//                              cross-connection read/write is unmistakable.
//   tenant_alpha              — org_checkpoint_investors's real data.
//   tenant_beta               — org_beta's data, stays untouched.

const http = require('http');
const jwt = require('jsonwebtoken');
const { startMemoryMongo, stopMemoryMongo } = require('./memoryMongo');

const TEST_JWT_SECRET = 'phase4d-test-jwt-secret';
const TEST_FORM_SECRET = 'phase4d-test-form-secret';

const DEFAULT_DB_COUNTER_POISON = 5000;
const CURRENT_FY = 2026;

function fiscalYearPeriods(fiscalYear) {
  return [
    ...Array.from({ length: 10 }, (_, index) => ({ month: index + 3, year: fiscalYear })),
    { month: 1, year: fiscalYear + 1 },
    { month: 2, year: fiscalYear + 1 },
  ];
}

let server;

async function poisonCounter(Counter, name, value) {
  await Counter.findByIdAndUpdate(name, { $set: { seq: value } }, { upsert: true });
}

async function startPhase4dTestApp() {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.FORM_SECRET = TEST_FORM_SECRET;
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
  const defaultModels = {
    ...require('../../../db/models'),
    ...require('../../../db/loanRequestModels'),
  };

  // Approval-gated tests must remain valid regardless of the wall clock. The
  // live assessment checks contribution arrears against "now", so members used
  // by pending→active / loan-request flows are paid for every period in the FY:
  // March..December of CURRENT_FY, then January/February of CURRENT_FY + 1.
  async function seedFullFiscalYearContributions(memberId, fiscalYear = CURRENT_FY, amount = 75000) {
    for (const { month, year } of fiscalYearPeriods(fiscalYear)) {
      await alpha.Contribution.create({
        id: await alpha.getNextId('contribution_id'),
        member_id: memberId,
        amount,
        month,
        year,
        status: 'paid',
        paid_date: `${year}-${String(month).padStart(2, '0')}-05`,
      });
    }
  }

  // ─── FY rules for alpha ──────────────────────────────────────────────────
  await alpha.FyRules.create({
    fiscal_year: CURRENT_FY,
    contribution_amount: 75000,
    late_fine_enabled: true,
    late_fine_type: 'percentage',
    late_fine_rate: 0.15,
    loan_interest_rate: 0.12,
    loan_max_ratio: 0.80,
    loan_repayment_months: 6,
    overdue_penalty_enabled: false, // keep off so eligibility calculation stays simple
    overdue_penalty_rate: 0.10,
  });

  // ─── Alpha loan member ───────────────────────────────────────────────────
  // Active member with enough contributions to be loan-eligible.
  // 8 months * 75000 = 600000 net_worth; max_eligible = 0.80 * 600000 = 480000.
  const alphaLoanMember = await alpha.Member.create({
    id: await alpha.getNextId('member_id'),
    name: 'Tenant Alpha Loan Member',
    email: 'alpha-loan-member@example.com',
    status: 'active',
    join_date: `${CURRENT_FY}-03-01`,
  });
  const alphaLoanMemberUser = await alpha.User.create({
    id: await alpha.getNextId('user_id'),
    member_id: alphaLoanMember.id,
    username: 'alpha_loan_member',
    email: 'alpha-loan-member@example.com',
    password_hash: 'unused',
    role: 'member',
    name: 'Tenant Alpha Loan Member',
  });

  // Contributions: 8 months fully paid (months 3-10 of CURRENT_FY)
  for (const mo of [3, 4, 5, 6, 7, 8, 9, 10]) {
    await alpha.Contribution.create({
      id: await alpha.getNextId('contribution_id'),
      member_id: alphaLoanMember.id,
      amount: 75000,
      month: mo,
      year: CURRENT_FY,
      status: 'paid',
      paid_date: `${CURRENT_FY}-${String(mo).padStart(2, '0')}-05`,
    });
  }

  // ─── Existing alpha active loan (for repayment tests & read tests) ───────
  const alphaActiveLoan = await alpha.Loan.create({
    id: await alpha.getNextId('loan_id'),
    member_id: alphaLoanMember.id,
    loan_number: 'Loan 1',
    principal: 200000,
    interest_rate: 0.12,
    interest_amount: 24000,
    amount_deposited: 176000,
    issued_date: `${CURRENT_FY}-03-15`,
    due_date: `${CURRENT_FY}-09-15`,
    status: 'active',
    fiscal_year: CURRENT_FY,
    disbursed: true,
  });
  const alphaActiveLoanRepayment = await alpha.Repayment.create({
    id: await alpha.getNextId('repayment_id'),
    loan_id: alphaActiveLoan.id,
    amount: 50000,
    repayment_date: `${CURRENT_FY}-04-01`,
  });

  // ─── Alpha pending loan (for activation tests) ────────────────────────────
  // A second member to avoid interfering with the eligibility / active-loan
  // checks for the loan member (active loan above).
  const alphaActivationMember = await alpha.Member.create({
    id: await alpha.getNextId('member_id'),
    name: 'Tenant Alpha Activation Member',
    email: 'alpha-activation-member@example.com',
    status: 'active',
    join_date: `${CURRENT_FY}-03-01`,
  });
  const alphaActivationMemberUser = await alpha.User.create({
    id: await alpha.getNextId('user_id'),
    member_id: alphaActivationMember.id,
    username: 'alpha_activation_member',
    email: 'alpha-activation-member@example.com',
    password_hash: 'unused',
    role: 'member',
    name: 'Tenant Alpha Activation Member',
  });
  // Full-FY contributions keep the live approval gate deterministic even
  // after the November/December/January/February deadlines pass.
  await seedFullFiscalYearContributions(alphaActivationMember.id);

  const alphaPendingLoan = await alpha.Loan.create({
    id: await alpha.getNextId('loan_id'),
    member_id: alphaActivationMember.id,
    loan_number: 'Loan 1',
    principal: 300000,
    interest_rate: 0.12,
    interest_amount: 36000,
    amount_deposited: 264000,
    issued_date: `${CURRENT_FY}-05-01`,
    due_date: `${CURRENT_FY}-11-01`,
    status: 'pending',
    fiscal_year: CURRENT_FY,
    disbursed: false,
  });

  // ─── Alpha blocked member: has unpaid fine → activation will be blocked ───
  const alphaBlockedMember = await alpha.Member.create({
    id: await alpha.getNextId('member_id'),
    name: 'Tenant Alpha Blocked Member',
    email: 'alpha-blocked-member@example.com',
    status: 'active',
    join_date: `${CURRENT_FY}-03-01`,
  });
  // Keep contribution clearance clean so the unpaid fine remains the
  // intentional reason this member is blocked, whatever date the suite runs.
  await seedFullFiscalYearContributions(alphaBlockedMember.id);
  await alpha.Fine.create({
    id: await alpha.getNextId('fine_id'),
    member_id: alphaBlockedMember.id,
    amount: 5000,
    reason: 'Unpaid fine blocking activation',
    year: CURRENT_FY,
    status: 'unpaid',
  });
  const alphaBlockedPendingLoan = await alpha.Loan.create({
    id: await alpha.getNextId('loan_id'),
    member_id: alphaBlockedMember.id,
    loan_number: 'Loan 1',
    principal: 200000,
    interest_rate: 0.12,
    interest_amount: 24000,
    amount_deposited: 176000,
    issued_date: `${CURRENT_FY}-05-01`,
    status: 'pending',
    fiscal_year: CURRENT_FY,
    disbursed: false,
  });

  // ─── Alpha form/loan-request member ───────────────────────────────────────
  // Used by loanRequests tests — active, matched by name in public POST.
  const alphaFormMember = await alpha.Member.create({
    id: await alpha.getNextId('member_id'),
    name: 'Tenant Alpha Form Member',
    email: 'alpha-form-member@example.com',
    status: 'active',
    join_date: `${CURRENT_FY}-03-01`,
  });
  // Loan-request workbench/review/conversion can invoke the live approval
  // assessment, so this fixture must remain paid-up for the whole FY.
  await seedFullFiscalYearContributions(alphaFormMember.id);

  // ─── Poison the default/legacy connection ──────────────────────────────────
  const sentinelMember = await defaultModels.Member.create({
    name: 'DEFAULT DATABASE SENTINEL LOAN MEMBER',
    email: 'default-sentinel-loan@example.com',
    status: 'active',
  });
  // Sentinel loan with same member_id as alphaLoanMember to catch ID collisions
  const sentinelLoan = await defaultModels.Loan.create({
    id: alphaActiveLoan.id, // deliberate collision
    member_id: sentinelMember.id,
    loan_number: 'SENTINEL LOAN - DEFAULT DB',
    principal: 99999999,
    interest_amount: 9999999,
    status: 'active',
    disbursed: true,
    fiscal_year: CURRENT_FY,
  });
  await defaultModels.Repayment.create({
    id: alphaActiveLoanRepayment.id, // deliberate collision
    loan_id: sentinelLoan.id,
    amount: 88888888,
    repayment_date: `${CURRENT_FY}-04-01`,
    notes: 'DEFAULT DB REPAYMENT SENTINEL',
  });
  await defaultModels.Transaction.create({
    member_id: sentinelMember.id,
    amount: 99999999,
    type: 'sentinel',
    description: 'DEFAULT DATABASE SENTINEL TRANSACTION',
    transaction_date: `${CURRENT_FY}-01-01`,
  });
  await defaultModels.Contribution.create({
    member_id: sentinelMember.id,
    amount: 9999999,
    month: 3,
    year: CURRENT_FY,
    status: 'paid',
    paid_date: `${CURRENT_FY}-03-05`,
  });
  await defaultModels.Fine.create({
    member_id: sentinelMember.id,
    amount: 8888888,
    reason: 'DEFAULT DATABASE SENTINEL FINE',
    year: CURRENT_FY,
    status: 'unpaid',
  });
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
  await defaultModels.Expense.create({
    category: 'DEFAULT DB SENTINEL EXPENSE',
    description: 'DEFAULT DATABASE SENTINEL EXPENSE',
    amount: 77777777,
    expense_date: `${CURRENT_FY}-01-01`,
    fiscal_year: CURRENT_FY,
  });
  // A LoanRequestSubmission sentinel with the SAME name as alphaFormMember —
  // used to prove alpha's own LoanRequestSubmission model is isolated.
  const sentinelLoanRequest = await defaultModels.LoanRequestSubmission.create({
    source_id: 'loan-request:default-db-sentinel',
    member_name: 'Tenant Alpha Form Member',
    amount_requested: 9999999,
    requested_date: `${CURRENT_FY}-05-01`,
    match_status: 'matched',
    matched_member_id: sentinelMember.id,
  });

  // A DEFAULT-DB member with EXACTLY the same name as alphaFormMember — proves that
  // the public POST's matchMember lookup uses alpha's Member collection, not the default DB.
  // Any match must resolve to alphaFormMember.id (numeric), not this one's id (9999).
  // Using an explicit high numeric id well outside the alpha counter range makes the
  // numeric-vs-numeric assertion in test 32 meaningful and unambiguous.
  const defaultSameNameMember = await defaultModels.Member.create({
    id: 9999,
    name: 'Tenant Alpha Form Member',
    email: 'default-same-name-member@example.com',
    status: 'active',
  });

  // A DEFAULT-DB LoanRequestSubmission with a specific source_id that exists ONLY in the
  // default DB (not alpha). Used by the real source_id collision test to prove that alpha's
  // duplicate detection is scoped to the alpha DB, not the default DB.
  const defaultCollisionSubmission = await defaultModels.LoanRequestSubmission.create({
    source_id: 'phase4d-default-only-source-collision',
    member_name: 'Tenant Alpha Form Member',
    amount_requested: 99999,
    requested_date: `${CURRENT_FY}-05-01`,
    match_status: 'unmatched',
  });

  await poisonCounter(defaultModels.Counter, 'member_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'contribution_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'fine_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'transaction_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'loan_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'repayment_id', DEFAULT_DB_COUNTER_POISON);
  await poisonCounter(defaultModels.Counter, 'expense_id', DEFAULT_DB_COUNTER_POISON);

  // ─── tenant_beta: sentinel, must remain untouched throughout ────────────
  const betaMember = await beta.Member.create({ name: 'Beta Sentinel Member', status: 'active' });
  const betaCountsBefore = {
    member: await beta.Member.countDocuments(),
    contribution: await beta.Contribution.countDocuments(),
    fine: await beta.Fine.countDocuments(),
    transaction: await beta.Transaction.countDocuments(),
    loan: await beta.Loan.countDocuments(),
    repayment: await beta.Repayment.countDocuments(),
    expense: await beta.Expense.countDocuments(),
    loanRequest: await beta.LoanRequestSubmission.countDocuments(),
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
  const loanMemberToken = signToken({
    id: alphaLoanMemberUser.id,
    username: 'alpha_loan_member',
    role: 'member',
    member_id: alphaLoanMember.id,
    name: 'Tenant Alpha Loan Member',
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    alpha,
    beta,
    defaultModels,
    CURRENT_FY,
    DEFAULT_DB_COUNTER_POISON,
    TEST_FORM_SECRET,
    fiscalYearPeriods,
    seedFullFiscalYearContributions,
    // alpha fixtures
    alphaLoanMember,
    alphaLoanMemberUser,
    alphaActiveLoan,
    alphaActiveLoanRepayment,
    alphaActivationMember,
    alphaActivationMemberUser,
    alphaPendingLoan,
    alphaBlockedMember,
    alphaBlockedPendingLoan,
    alphaFormMember,
    // default DB sentinels
    sentinelMember,
    sentinelLoan,
    sentinelLoanRequest,
    defaultSameNameMember,
    defaultCollisionSubmission,
    // beta
    betaMember,
    betaCountsBefore,
    // tokens
    adminToken,
    loanMemberToken,
    signToken,
  };
}

async function stopPhase4dTestApp() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  await stopMemoryMongo();
}

module.exports = { startPhase4dTestApp, stopPhase4dTestApp, TEST_JWT_SECRET, TEST_FORM_SECRET };
