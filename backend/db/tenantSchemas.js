// Canonical schema DEFINITIONS for every "core" tenant-owned model.
//
// This is the single source of truth for field names, defaults, required
// flags, enums, and indexes on these models — schema/index parity with the
// pre-Phase-2 code is intentional and load-bearing, not incidental.
//
// This module defines schemas only. It never calls `mongoose.model(...)`
// or `connection.model(...)` itself, and it never touches any specific
// Mongoose connection — that is the job of the binder functions in
// db/models.js (default/legacy connection) and backend/tenancy/tenantModels.js
// (a tenant's connection). See db/counter.js for why `getNextId` is passed
// in rather than imported from a fixed default.
//
// Do NOT add organization_id or any other tenant-marker field here. Tenant
// isolation comes from which physical database these models are bound to,
// not from a field on the documents themselves.

const mongoose = require('mongoose');
const { addAutoIncrement } = require('./counter');

const options = { versionKey: false };

/**
 * @param {{ getNextId: (name: string) => Promise<number> }} deps
 */
function createCoreTenantSchemas({ getNextId }) {
  const memberSchema = new mongoose.Schema(
    {
      id: { type: Number, unique: true },
      name: { type: String, required: true },
      email: { type: String, default: null },
      phone: { type: String, default: null },
      office: { type: String, default: 'member' },
      status: { type: String, default: 'active' },
      entry_fee: { type: Number, default: 500000 },
      join_date: { type: String },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(memberSchema, 'member_id', getNextId);

  const contributionSchema = new mongoose.Schema(
    {
      id: { type: Number, unique: true },
      member_id: { type: Number, required: true },
      amount: { type: Number, required: true },
      month: { type: Number, required: true },
      year: { type: Number, required: true },
      status: { type: String, default: 'paid' },
      paid_date: { type: String },
      mpesa_ref: { type: String, default: null },
      notes: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(contributionSchema, 'contribution_id', getNextId);

  const loanSchema = new mongoose.Schema(
    {
      id: { type: Number, unique: true },
      member_id: { type: Number, required: true },
      loan_number: { type: String },
      principal: { type: Number, required: true },
      interest_rate: { type: Number, default: 0.05 },
      interest_amount: { type: Number, default: 0 },
      amount_deposited: { type: Number, default: 0 },
      issued_date: { type: String },
      due_date: { type: String },
      status: { type: String, default: 'active' },
      fiscal_year: { type: Number },
      disbursed: { type: Boolean, default: true },
      cancellation_reason: { type: String, default: null },
      cancelled_at: { type: Date, default: null },
      notes: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(loanSchema, 'loan_id', getNextId);

  const repaymentSchema = new mongoose.Schema(
    {
      id: { type: Number, unique: true },
      loan_id: { type: Number, required: true },
      amount: { type: Number, required: true },
      repayment_date: { type: String },
      mpesa_ref: { type: String, default: null },
      notes: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(repaymentSchema, 'repayment_id', getNextId);

  const transactionSchema = new mongoose.Schema(
    {
      id: { type: Number, unique: true },
      member_id: { type: Number, default: null },
      amount: { type: Number, required: true },
      type: { type: String, required: true },
      description: { type: String },
      reference: { type: String, default: null },
      transaction_date: { type: String },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(transactionSchema, 'transaction_id', getNextId);

  const userSchema = new mongoose.Schema(
    {
      id: { type: Number, unique: true },
      member_id: { type: Number, default: null },
      username: { type: String, required: true, unique: true },
      email: { type: String, default: null },
      password_hash: { type: String, required: true },
      role: { type: String, default: 'member' },
      name: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(userSchema, 'user_id', getNextId);

  const fineSchema = new mongoose.Schema(
    {
      id: { type: Number, unique: true },
      member_id: { type: Number, required: true },
      amount: { type: Number, required: true },
      reason: { type: String, required: true },
      year: { type: Number, required: true },
      contribution_month: { type: Number, default: null },
      contribution_year: { type: Number, default: null },
      status: { type: String, default: 'unpaid' },
      paid_date: { type: String, default: null },
      review_required: { type: Boolean, default: false },
      reconciliation_key: { type: String, default: null },
      notes: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(fineSchema, 'fine_id', getNextId);

  const welfareSchema = new mongoose.Schema(
    {
      id: { type: Number, unique: true },
      member_id: { type: Number, required: true },
      event_type: { type: String, required: true },
      amount: { type: Number, default: 50000 },
      status: { type: String, default: 'pending' },
      approved_date: { type: String, default: null },
      notes: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(welfareSchema, 'welfare_id', getNextId);

  // Tracks all outgoing group funds: AGM costs, registration fees, loan
  // overrides, etc. Every expense reduces the group's net capital in the
  // equity calculation.
  const expenseSchema = new mongoose.Schema(
    {
      id: { type: Number, unique: true },
      category: { type: String, required: true }, // 'AGM', 'Registration', 'Loan Override', 'Admin', 'Other'
      description: { type: String, required: true },
      amount: { type: Number, required: true },
      expense_date: { type: String, required: true },
      fiscal_year: { type: Number, required: true },
      reference: { type: String, default: null }, // receipt no, mpesa ref, etc.
      loan_id: { type: Number, default: null }, // set when category = 'Loan Override'
      member_id: { type: Number, default: null }, // set when linked to a member
      approved_by: { type: String, default: null }, // name of approving officer
      notes: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(expenseSchema, 'expense_id', getNextId);

  // Stores the constitution rules for each Fiscal Year. The backend reads
  // these at runtime so changes take effect without redeploys.
  const fyRulesSchema = new mongoose.Schema(
    {
      fiscal_year: { type: Number, required: true, unique: true },
      // Contributions
      contribution_amount: { type: Number, default: 75000 }, // TZS per member per month
      late_fine_enabled: { type: Boolean, default: false },
      late_fine_type: { type: String, default: 'percentage', enum: ['flat', 'percentage'] },
      late_fine_rate: { type: Number, default: 0.15 }, // 15% of contribution per month late (used when type='percentage')
      late_fine_flat_amount: { type: Number, default: 3500 }, // TZS flat one-time fine per late month (used when type='flat')
      // Loans
      loan_interest_rate: { type: Number, default: 0.05 }, // flat rate on principal
      loan_max_ratio: { type: Number, default: null }, // null = no cap; 0.80 = 80% of contributions
      loan_repayment_months: { type: Number, default: null }, // null = no fixed term
      overdue_penalty_enabled: { type: Boolean, default: false },
      overdue_penalty_rate: { type: Number, default: 0.1 }, // 10% of principal per month after term
      // Membership
      entry_fee: { type: Number, default: 500000 },
      updated_at: { type: Date, default: Date.now },
    },
    options
  );

  const investmentSchema = new mongoose.Schema(
    {
      provider: { type: String, required: true },
      // Fund/instrument name within the provider (e.g. iTrust's "iGrowth"
      // money-market fund). Needed alongside provider to look up the
      // matching NAV history.
      asset_class: { type: String, default: null },
      amount: { type: Number, required: true },
      status: { type: String, default: 'unverified' },
      verification_status: { type: String, default: 'pending evidence' },
      action_required: { type: String, default: null },
      reconciliation_key: { type: String, unique: true, sparse: true },
      source: { type: String, default: null },
      units_purchased: { type: Number, default: null },
      unit_cost_at_purchase: { type: Number, default: null },
      created_at: { type: Date, default: Date.now },
      updated_at: { type: Date, default: Date.now },
    },
    options
  );

  // Monthly unit-cost readings per provider/asset_class, used to value
  // unit-based investments (e.g. money-market funds) at current NAV
  // instead of cost.
  const navUpdateSchema = new mongoose.Schema(
    {
      provider: { type: String, required: true },
      asset_class: { type: String, required: true },
      unit_cost: { type: Number, required: true },
      effective_date: { type: String, required: true },
      source: { type: String, default: null },
      recorded_by: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(navUpdateSchema, 'nav_update_id', getNextId);

  // Targeted alerts for members (contribution due, loan due, fines)
  // surfaced in the member dashboard and aggregated for admins via
  // /api/notifications/attention.
  const notificationSchema = new mongoose.Schema(
    {
      member_id: { type: Number, required: true },
      type: {
        type: String,
        enum: ['contribution_due', 'loan_due', 'fine_issued', 'fine_overdue', 'custom'],
        required: true,
      },
      message: { type: String, required: true },
      due_date: { type: String, default: null },
      read: { type: Boolean, default: false },
      created_by: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  addAutoIncrement(notificationSchema, 'notification_id', getNextId);

  const reconciliationRunSchema = new mongoose.Schema(
    {
      run_key: { type: String, required: true, unique: true },
      source_hash: { type: String, required: true },
      schema_version: { type: String, required: true },
      source_generated_on: { type: String, required: true },
      reporting_cutoff: { type: mongoose.Schema.Types.Mixed, required: true },
      status: { type: String, default: 'prepared' },
      backup: { type: mongoose.Schema.Types.Mixed, required: true },
      result: { type: mongoose.Schema.Types.Mixed, default: null },
      source_summary: { type: mongoose.Schema.Types.Mixed, default: null },
      flags: { type: [mongoose.Schema.Types.Mixed], default: [] },
      applied_by: { type: String, default: null },
      created_at: { type: Date, default: Date.now },
      applied_at: { type: Date, default: null },
    },
    options
  );

  const auditSourceRecordSchema = new mongoose.Schema(
    {
      reconciliation_run: { type: String, required: true },
      source_type: { type: String, required: true },
      source_row: { type: Number, required: true },
      review_status: { type: String, default: 'unposted' },
      posted: { type: Boolean, default: false },
      payload: { type: mongoose.Schema.Types.Mixed, required: true },
      created_at: { type: Date, default: Date.now },
    },
    options
  );
  auditSourceRecordSchema.index(
    { reconciliation_run: 1, source_type: 1, source_row: 1 },
    { unique: true }
  );

  return {
    memberSchema,
    contributionSchema,
    loanSchema,
    repaymentSchema,
    transactionSchema,
    userSchema,
    fineSchema,
    welfareSchema,
    expenseSchema,
    fyRulesSchema,
    investmentSchema,
    navUpdateSchema,
    notificationSchema,
    reconciliationRunSchema,
    auditSourceRecordSchema,
  };
}

module.exports = { createCoreTenantSchemas };
