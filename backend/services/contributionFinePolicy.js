// Contribution fine policy shared by contribution, form-intake and automation routes.
//
// Business rule:
// - each contribution month can receive at most ONE fine;
// - automatic fines are for MISSING contribution months after the deadline;
// - the recorded paid_date must NOT create a fine because historical/data-entry
//   delays can make an already-paid contribution appear late;
// - percentage fines are assessed once against that month's configured target;
// - the fine does NOT grow again as more calendar months pass;
// - a different missing contribution month receives its own separate fine.

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

// Deprecated as a fine trigger.
//
// Checkpoint previously inferred a fine from paid_date > deadline. That produced
// false fines when a contribution had already been made but was entered into the
// system later. Fine eligibility is now determined only by the scheduled missing-
// month scanner, which checks whether a member has any contribution recorded for
// the period after its deadline has passed.
function isContributionLate() {
  return false;
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
      reason: `Missing contribution ${month}/${year} — one-time flat fine TZS ${amount.toLocaleString()} (FY${fy})`,
      fine_type: 'flat',
    };
  }

  const rate = Number(rules.late_fine_rate || 0);
  const amount = Math.round(Number(contributionTarget || 0) * rate);
  return {
    amount,
    reason: `Missing contribution ${month}/${year} — one-time ${Math.round(rate * 100)}% fine (FY${fy})`,
    fine_type: 'percentage',
  };
}

function fineMatchesContributionPeriod(fine, month, year) {
  if (!fine) return false;
  if (fine.contribution_month === month && fine.contribution_year === year) return true;
  if (typeof fine.reason !== 'string') return false;
  return fine.reason.startsWith(`Late contribution ${month}/${year}`)
    || fine.reason.startsWith(`Missing contribution ${month}/${year}`);
}

function finePeriodQuery(memberId, month, year) {
  return {
    member_id: memberId,
    $or: [
      { contribution_month: month, contribution_year: year },
      { reason: new RegExp(`^(?:Late|Missing) contribution ${month}\\/${year}`) },
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
