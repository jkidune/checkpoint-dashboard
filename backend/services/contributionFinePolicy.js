// Contribution fine policy shared by the hotfix routes.
//
// Business rule:
// - each contribution month can receive at most ONE late fine;
// - percentage fines are assessed once against that month's configured target;
// - the fine does NOT grow again as more calendar months pass;
// - a different overdue contribution month receives its own separate fine.

function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

function getContributionDeadline(month, year) {
  let deadlineMonth = month + 1;
  let deadlineYear = year;
  if (deadlineMonth > 12) {
    deadlineMonth = 1;
    deadlineYear += 1;
  }
  return new Date(`${deadlineYear}-${String(deadlineMonth).padStart(2, '0')}-05T23:59:59Z`);
}

function isContributionLate(month, year, paidDate) {
  if (!paidDate) return false;
  const paid = new Date(`${paidDate}T12:00:00Z`);
  return paid > getContributionDeadline(month, year);
}

function isContributionOverdueAsOf(month, year, asOfDate = new Date()) {
  return asOfDate > getContributionDeadline(month, year);
}

function calculateOneTimeFine(rules, contributionTarget, month, year, fy) {
  if (!rules?.late_fine_enabled) return null;

  const type = rules.late_fine_type || 'percentage';
  if (type === 'flat') {
    const amount = Number(rules.late_fine_flat_amount || 3500);
    return {
      amount,
      reason: `Late contribution ${month}/${year} — one-time flat fine TZS ${amount.toLocaleString()} (FY${fy})`,
      fine_type: 'flat',
    };
  }

  const rate = Number(rules.late_fine_rate || 0);
  const amount = Math.round(Number(contributionTarget || 0) * rate);
  return {
    amount,
    reason: `Late contribution ${month}/${year} — one-time ${Math.round(rate * 100)}% fine (FY${fy})`,
    fine_type: 'percentage',
  };
}

function fineMatchesContributionPeriod(fine, month, year) {
  if (!fine) return false;
  if (fine.contribution_month === month && fine.contribution_year === year) return true;
  return typeof fine.reason === 'string' && fine.reason.startsWith(`Late contribution ${month}/${year}`);
}

function finePeriodQuery(memberId, month, year) {
  return {
    member_id: memberId,
    $or: [
      { contribution_month: month, contribution_year: year },
      { reason: new RegExp(`^Late contribution ${month}\\/${year}`) },
    ],
  };
}

module.exports = {
  getFiscalYear,
  getContributionDeadline,
  isContributionLate,
  isContributionOverdueAsOf,
  calculateOneTimeFine,
  fineMatchesContributionPeriod,
  finePeriodQuery,
};
