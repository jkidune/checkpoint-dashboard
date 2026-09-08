const { Member, Contribution, Loan, Repayment, Fine } = require('../db/models');
const { getRulesForFY } = require('../routes/rules');
const { computeMemberLoanEligibility } = require('./memberLoanEligibility');
const { getContributionDeadline, getFiscalYear } = require('./contributionFinePolicy');

function dateOnly(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' && value) {
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback instanceof Date ? fallback : new Date(fallback);
}

function toDateString(value) {
  return dateOnly(value).toISOString().slice(0, 10);
}

function fiscalYearFromDate(value) {
  const date = dateOnly(value);
  return getFiscalYear(date.getUTCMonth() + 1, date.getUTCFullYear());
}

function monthsDiff(startValue, endValue) {
  const start = dateOnly(startValue);
  const end = dateOnly(endValue);
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12;
  months -= start.getUTCMonth();
  months += end.getUTCMonth();
  return Math.max(0, months);
}

function addMonths(dateValue, count) {
  const date = dateOnly(dateValue);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
  next.setUTCMonth(next.getUTCMonth() + Number(count || 0));
  return next;
}

function periodLabel(month, year) {
  const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[month] || month} ${year}`;
}

function fiscalYearPeriods(fy) {
  return [
    ...Array.from({ length: 10 }, (_, index) => ({ month: index + 3, year: fy })),
    { month: 1, year: fy + 1 },
    { month: 2, year: fy + 1 },
  ];
}

function loanBalance(loan, repayments, rules, asOfDate) {
  const totalRepaid = repayments
    .filter((repayment) => Number(repayment.loan_id) === Number(loan.id))
    .reduce((sum, repayment) => sum + Number(repayment.amount || 0), 0);

  let penalty = 0;
  const repaymentMonths = Number(rules?.loan_repayment_months || 0);
  const activeMonths = loan.issued_date ? monthsDiff(loan.issued_date, asOfDate) : 0;
  if (
    rules?.overdue_penalty_enabled
    && loan.status !== 'paid'
    && repaymentMonths > 0
    && activeMonths > repaymentMonths
  ) {
    penalty = Math.round(
      Number(loan.principal || 0)
      * Number(rules.overdue_penalty_rate || 0)
      * (activeMonths - repaymentMonths),
    );
  }

  const totalOwed = Number(loan.principal || 0) + penalty;
  return {
    ...loan,
    total_repaid: totalRepaid,
    penalty,
    total_owed: totalOwed,
    balance: Math.max(0, totalOwed - totalRepaid),
  };
}

async function buildContributionClearance(member, fiscalYear, asOfDate) {
  const rules = await getRulesForFY(fiscalYear);
  const contributions = await Contribution.find({ member_id: member.id }).lean();
  const joinDate = member.join_date ? dateOnly(member.join_date) : null;
  const periods = fiscalYearPeriods(fiscalYear);
  const rows = [];

  for (const period of periods) {
    const periodStart = new Date(Date.UTC(period.year, period.month - 1, 1, 12, 0, 0));
    if (joinDate) {
      const joinMonthStart = new Date(Date.UTC(joinDate.getUTCFullYear(), joinDate.getUTCMonth(), 1, 12, 0, 0));
      if (periodStart < joinMonthStart) continue;
    }

    const deadline = getContributionDeadline(period.month, period.year);
    if (deadline >= asOfDate) continue;

    const paid = contributions
      .filter((item) => Number(item.month) === period.month && Number(item.year) === period.year)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const target = Number(rules.contribution_amount || 0);
    const outstanding = Math.max(0, target - paid);
    rows.push({
      month: period.month,
      year: period.year,
      label: periodLabel(period.month, period.year),
      deadline: deadline.toISOString().slice(0, 10),
      target,
      paid,
      outstanding,
      status: outstanding > 0 ? (paid > 0 ? 'partial' : 'unpaid') : 'paid',
    });
  }

  return {
    fiscal_year: fiscalYear,
    monthly_target: Number(rules.contribution_amount || 0),
    periods_due: rows.length,
    amount_due: rows.reduce((sum, item) => sum + item.target, 0),
    amount_paid: rows.reduce((sum, item) => sum + Math.min(item.paid, item.target), 0),
    arrears_total: rows.reduce((sum, item) => sum + item.outstanding, 0),
    arrears_count: rows.filter((item) => item.outstanding > 0).length,
    periods: rows,
  };
}

async function assessLoanApproval({
  memberId,
  principal,
  loanDate,
  fiscalYear = null,
  assessmentDate = new Date(),
  excludeLoanId = null,
} = {}) {
  const id = Number(memberId);
  const requestedPrincipal = Number(principal || 0);
  const asOfDate = dateOnly(assessmentDate);
  const effectiveLoanDate = loanDate ? dateOnly(loanDate) : asOfDate;
  const fy = Number(fiscalYear || fiscalYearFromDate(effectiveLoanDate));

  if (!Number.isFinite(id) || id <= 0) {
    return {
      assessment_date: toDateString(asOfDate),
      fiscal_year: fy,
      eligible: false,
      blockers: [{ code: 'member_missing', message: 'A verified member is required before this loan can be approved.' }],
      warnings: [],
    };
  }

  const [member, rules, eligibility, fines, loans, repayments] = await Promise.all([
    Member.findOne({ id }).lean(),
    getRulesForFY(fy),
    computeMemberLoanEligibility(id, fy),
    Fine.find({ member_id: id }).lean(),
    Loan.find({ member_id: id }).lean(),
    Repayment.find().lean(),
  ]);

  if (!member || !eligibility) {
    return {
      assessment_date: toDateString(asOfDate),
      fiscal_year: fy,
      eligible: false,
      blockers: [{ code: 'member_missing', message: 'The verified member record could not be found.' }],
      warnings: [],
    };
  }

  const contributionClearance = await buildContributionClearance(member, fy, asOfDate);
  const unpaidFines = fines
    .filter((fine) => fine.status === 'unpaid')
    .map((fine) => ({
      id: fine.id,
      amount: Number(fine.amount || 0),
      reason: fine.reason,
      year: fine.year,
      contribution_month: fine.contribution_month,
      contribution_year: fine.contribution_year,
    }));

  const rulesCache = { [fy]: rules };
  const relevantLoans = [];
  for (const loan of loans) {
    if (excludeLoanId != null && Number(loan.id) === Number(excludeLoanId)) continue;
    if (!['active', 'overdue', 'pending'].includes(loan.status)) continue;
    const loanFy = Number(loan.fiscal_year || fiscalYearFromDate(loan.issued_date || effectiveLoanDate));
    const loanRules = rulesCache[loanFy] || await getRulesForFY(loanFy);
    rulesCache[loanFy] = loanRules;
    relevantLoans.push(loanBalance(loan, repayments, loanRules, asOfDate));
  }

  const activeLoans = relevantLoans.filter((loan) => ['active', 'overdue'].includes(loan.status) && loan.balance > 0);
  const pendingLoans = relevantLoans.filter((loan) => loan.status === 'pending');
  const activeLoanBalance = activeLoans.reduce((sum, loan) => sum + Number(loan.balance || 0), 0);
  const pendingLoanPrincipal = pendingLoans.reduce((sum, loan) => sum + Number(loan.principal || 0), 0);
  const unpaidFineTotal = unpaidFines.reduce((sum, fine) => sum + fine.amount, 0);

  const interestRate = Number(rules.loan_interest_rate || 0);
  const interestAmount = Math.round(requestedPrincipal * interestRate);
  const netDisbursement = Math.max(0, requestedPrincipal - interestAmount);
  const repaymentMonths = rules.loan_repayment_months == null ? null : Number(rules.loan_repayment_months);
  const dueDate = repaymentMonths ? addMonths(effectiveLoanDate, repaymentMonths).toISOString().slice(0, 10) : null;
  const monthlyRepayment = repaymentMonths ? Math.ceil(requestedPrincipal / repaymentMonths) : null;
  const overduePenaltyPerMonth = rules.overdue_penalty_enabled
    ? Math.round(requestedPrincipal * Number(rules.overdue_penalty_rate || 0))
    : 0;

  const blockers = [];
  const warnings = [];

  if (String(member.status || '').toLowerCase() !== 'active') {
    blockers.push({ code: 'member_inactive', message: `Member status is ${member.status || 'unknown'}; only active members can receive a loan.` });
  }
  if (contributionClearance.arrears_total > 0) {
    blockers.push({
      code: 'contribution_arrears',
      message: `Member has TZS ${contributionClearance.arrears_total.toLocaleString('en-US')} in overdue FY${fy} contributions across ${contributionClearance.arrears_count} period(s).`,
    });
  }
  if (unpaidFineTotal > 0) {
    blockers.push({
      code: 'unpaid_fines',
      message: `Member has TZS ${unpaidFineTotal.toLocaleString('en-US')} in unpaid fines.`,
    });
  }
  if (activeLoanBalance > 0) {
    blockers.push({
      code: 'existing_loan_balance',
      message: `Member still owes TZS ${activeLoanBalance.toLocaleString('en-US')} on active/overdue loan(s).`,
    });
  }
  if (pendingLoanPrincipal > 0) {
    blockers.push({
      code: 'pending_loan',
      message: `Member already has TZS ${pendingLoanPrincipal.toLocaleString('en-US')} in another pending loan awaiting activation.`,
    });
  }
  if (requestedPrincipal <= 0) {
    blockers.push({ code: 'invalid_principal', message: 'The requested principal must be greater than zero.' });
  }
  if (eligibility.max_eligible != null && requestedPrincipal > Number(eligibility.max_eligible || 0)) {
    blockers.push({
      code: 'over_borrowing_limit',
      message: `Requested TZS ${requestedPrincipal.toLocaleString('en-US')} exceeds the FY${fy} borrowing limit of TZS ${Number(eligibility.max_eligible || 0).toLocaleString('en-US')}.`,
    });
  }

  if (eligibility.net_worth <= 0) {
    warnings.push({ code: 'zero_net_worth', message: 'Member net worth is zero or negative under the current Checkpoint calculation.' });
  }
  if (repaymentMonths == null) {
    warnings.push({ code: 'no_fixed_term', message: `FY${fy} has no fixed repayment term configured.` });
  }

  return {
    assessment_date: toDateString(asOfDate),
    loan_date: toDateString(effectiveLoanDate),
    fiscal_year: fy,
    eligible: blockers.length === 0,
    member: {
      id: member.id,
      name: member.name,
      status: member.status,
      office: member.office,
      join_date: member.join_date,
      phone: member.phone,
      email: member.email,
    },
    eligibility,
    contribution_clearance: contributionClearance,
    unpaid_fines: unpaidFines,
    unpaid_fines_total: unpaidFineTotal,
    active_loans: activeLoans,
    active_loan_balance: activeLoanBalance,
    pending_loans: pendingLoans,
    pending_loan_principal: pendingLoanPrincipal,
    loan_calculation: {
      principal: requestedPrincipal,
      interest_rate: interestRate,
      interest_amount: interestAmount,
      net_disbursement: netDisbursement,
      repayment_months: repaymentMonths,
      indicative_monthly_repayment: monthlyRepayment,
      due_date: dueDate,
      overdue_penalty_enabled: !!rules.overdue_penalty_enabled,
      overdue_penalty_rate: Number(rules.overdue_penalty_rate || 0),
      overdue_penalty_per_month: overduePenaltyPerMonth,
      loan_max_ratio: rules.loan_max_ratio == null ? null : Number(rules.loan_max_ratio),
    },
    blockers,
    warnings,
  };
}

module.exports = {
  assessLoanApproval,
  fiscalYearFromDate,
};
