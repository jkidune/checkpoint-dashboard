const { Contribution, Loan, Fine, Member } = require('../db/models');
const { getRulesForFY } = require('../routes/rules');

function sum(records, field) {
  return records.reduce((total, record) => total + Number(record?.[field] || 0), 0);
}

function calculateNetWorthFromRecords({ contributions = [], loans = [], fines = [] }) {
  const totalContributions = sum(contributions, 'amount');
  // Loan interest is earned by the club only when the loan has actually been
  // disbursed. Pending/cancelled loans must not inflate a member's borrowing base.
  // Historical loans without the newer disbursed field are treated as realized
  // unless they are explicitly pending/cancelled.
  const realizedLoans = loans.filter((loan) => (
    loan?.status !== 'pending'
    && loan?.status !== 'cancelled'
    && loan?.disbursed !== false
  ));
  const totalLoanInterest = sum(realizedLoans, 'interest_amount');
  const paidFines = sum(fines.filter((fine) => fine.status === 'paid'), 'amount');
  const netWorth = totalContributions + totalLoanInterest + paidFines;

  return {
    total_contributions: totalContributions,
    total_loan_interest: totalLoanInterest,
    realized_loan_count: realizedLoans.length,
    paid_fines: paidFines,
    net_worth: netWorth,
  };
}

async function computeMemberLoanEligibility(memberId, fiscalYear) {
  const id = Number(memberId);
  const fy = Number(fiscalYear);
  const [member, contributions, memberLoans, fines, rules] = await Promise.all([
    Member.findOne({ id }).lean(),
    Contribution.find({ member_id: id }).lean(),
    Loan.find({ member_id: id }).lean(),
    Fine.find({ member_id: id }).lean(),
    getRulesForFY(fy),
  ]);

  if (!member) return null;

  const breakdown = calculateNetWorthFromRecords({
    contributions,
    loans: memberLoans,
    fines,
  });
  const ratio = rules.loan_max_ratio == null ? null : Number(rules.loan_max_ratio);
  const maxEligible = ratio == null ? null : Math.round(breakdown.net_worth * ratio);

  return {
    member_id: id,
    member_name: member.name,
    fiscal_year: fy,
    ...breakdown,
    loan_max_ratio: ratio,
    max_eligible: maxEligible,
    interest_rate: Number(rules.loan_interest_rate || 0),
    repayment_months: rules.loan_repayment_months ?? null,
    overdue_penalty_enabled: !!rules.overdue_penalty_enabled,
    overdue_penalty_rate: Number(rules.overdue_penalty_rate || 0),
  };
}

module.exports = {
  calculateNetWorthFromRecords,
  computeMemberLoanEligibility,
};
