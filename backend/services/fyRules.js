// Pure, model-agnostic FY rules resolution — the shared default/merge
// semantics previously defined only inside routes/rules.js. Extracted so a
// tenant-explicit caller can resolve rules against a supplied FyRules
// model without importing routes/rules.js (which is bound to the
// default/legacy connection).
//
// routes/rules.js's getRulesForFY(fy) remains the default-bound
// compatibility entry point used by contributions.js, loans.js,
// rulesHotfix.js, and loanApprovalAssessment.js — it now simply delegates
// to getRulesForFYWithModel() below using the default FyRules model, with
// no change in behavior.

// ─── Default rules per FY (fallback if no DB record exists) ──────────────────
const DEFAULTS = {
  2024: {
    contribution_amount:     50000,
    late_fine_enabled:       false,
    late_fine_type:          'flat',
    late_fine_rate:          0.15,
    late_fine_flat_amount:   3500,
    loan_interest_rate:      0.05,
    loan_max_ratio:          null,
    loan_repayment_months:   null,
    overdue_penalty_enabled: false,
    overdue_penalty_rate:    0.10,
    entry_fee:               500000,
  },
  2025: {
    contribution_amount:     75000,
    late_fine_enabled:       true,
    late_fine_type:          'flat',
    late_fine_rate:          0.15,
    late_fine_flat_amount:   3500,
    loan_interest_rate:      0.05,
    loan_max_ratio:          null,
    loan_repayment_months:   null,
    overdue_penalty_enabled: false,
    overdue_penalty_rate:    0.10,
    entry_fee:               500000,
  },
  2026: {
    contribution_amount:     75000,
    late_fine_enabled:       true,
    late_fine_type:          'percentage',
    late_fine_rate:          0.15,
    late_fine_flat_amount:   3500,
    loan_interest_rate:      0.12,
    loan_max_ratio:          0.80,
    loan_repayment_months:   6,
    overdue_penalty_enabled: true,
    overdue_penalty_rate:    0.10,
    entry_fee:               500000,
  },
};

// Resolves FY rules against a caller-supplied FyRules model. Defaults are
// always spread first so that new fields (e.g. late_fine_type,
// late_fine_flat_amount) are filled in for DB records saved before those
// fields were added to the schema; DB values take precedence where they
// exist. This is the exact merge semantics routes/rules.js has always used.
async function getRulesForFYWithModel(FyRules, fy) {
  const defaults = DEFAULTS[fy] || DEFAULTS[2026];
  const doc = await FyRules.findOne({ fiscal_year: fy }).lean();
  if (doc) {
    return { ...defaults, ...doc };
  }
  return { fiscal_year: fy, ...defaults };
}

// Convenience wrapper for callers holding a full tenant model bundle
// (e.g. req.tenantModels) rather than a bare FyRules model reference.
async function getRulesForFYWithModels(models, fy) {
  return getRulesForFYWithModel(models.FyRules, fy);
}

module.exports = {
  DEFAULTS,
  getRulesForFYWithModel,
  getRulesForFYWithModels,
};
