const fs = require('fs');

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/validateReconciliationV2.js <reconciliation-v2.json>');
  process.exit(2);
}

const source = JSON.parse(fs.readFileSync(input, 'utf8'));
const checks = [];
const check = (name, actual, expected, note = '') => checks.push({
  name, actual, expected, difference: actual - expected, status: actual === expected ? 'OK' : 'FAIL', note,
});

const cash = source.cash_reconciliation;
check(
  'Bank cash roll-forward',
  cash.opening_cash_reconstructed_tzs + cash.member_deposits_and_app_contributions_tzs
    - cash.loan_disbursements_tzs - cash.operating_expenses_tzs - cash.welfare_support_tzs
    - cash.itrust_investment_transfer_tzs,
  cash.reconciled_cash_balance_tzs,
  'The TZS 5,000,000 Itrust transfer is a cash outflow into an investment asset, not an expense.'
);
check('Confirmed M-Koba balance', cash.reconciled_cash_balance_tzs, cash.confirmed_mkoba_balance_tzs);
check('M-Koba stated difference', cash.difference_tzs, 0);

const financial = source.financial_position;
check(
  'Total recorded assets',
  financial.confirmed_mkoba_cash_tzs + financial.itrust_investment_at_cost_tzs + financial.gross_current_loan_balance_tzs,
  financial.total_recorded_assets_tzs
);
check(
  'Working net loan balance',
  financial.gross_current_loan_balance_tzs - financial.recorded_loan_credit_tzs,
  financial.working_net_loan_balance_tzs
);
check(
  'Current loan register total',
  source.current_loans.reduce((sum, loan) => sum + loan.current_balance_tzs, 0),
  financial.gross_current_loan_balance_tzs
);

const paidCashCosts = source.expenses_and_welfare.filter(item => item.cash_effect);
check(
  'Operating expenses',
  paidCashCosts.filter(item => item.category !== 'Welfare').reduce((sum, item) => sum + item.amount_tzs, 0),
  cash.operating_expenses_tzs
);
check(
  'Welfare payments',
  paidCashCosts.filter(item => item.category === 'Welfare').reduce((sum, item) => sum + item.amount_tzs, 0),
  cash.welfare_support_tzs
);
check(
  'Non-cash control items',
  source.expenses_and_welfare.filter(item => !item.cash_effect).reduce((sum, item) => sum + item.amount_tzs, 0),
  420000,
  'Control disclosure only; excluded from cash expenses.'
);

check(
  'Member contribution totals',
  source.member_financial_status.reduce((sum, member) => sum + member.contributions.total, 0),
  financial.contributions_paid_all_years_tzs
);

for (const loan of source.current_loans) {
  const yearLabels = loan.origin.startsWith('New Y3') ? ['Y3'] : ['Y2', 'Y3'];
  const repayments = yearLabels.flatMap(year => source.loan_repayment_allocations[year] || [])
    .filter(row => row.member === loan.member && row.loan_no === loan.loan_no)
    .reduce((sum, row) => sum + row.amount_tzs, 0);
  check(
    `Loan balance: ${loan.member} ${loan.loan_no}`,
    loan.original_principal_tzs - repayments,
    loan.current_balance_tzs,
    'Calculated only from traceable repayment allocations.'
  );
}

const repaymentKeys = Object.entries(source.loan_repayment_allocations).flatMap(([year, rows]) =>
  rows.map(row => `${year}|${row.member}|${row.loan_no}|${row.payment_date}|${row.amount_tzs}|${row.evidence || ''}`)
);
check('Duplicate repayment allocations', repaymentKeys.length - new Set(repaymentKeys).size, 0);

const references = [
  ...source.expenses_and_welfare.map(item => item.reference).filter(Boolean),
  ...source.system_update_actions.map(item => item.receipt_reference).filter(Boolean),
];
check('Duplicate authoritative references', references.length - new Set(references).size, 0);

console.table(checks);
if (source.data_quality_flags?.length) {
  console.log('\nReview flags (not silently overwritten):');
  for (const flag of source.data_quality_flags) console.log(`- ${flag.type}: ${flag.scope} - ${flag.detail}`);
}
const failed = checks.filter(item => item.status === 'FAIL');
console.log(`\nResult: ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length} checks passed)`);
process.exit(failed.length ? 1 : 0);
