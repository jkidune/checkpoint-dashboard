export const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

export const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getFiscalYear(month, year) {
  return Number(month) >= 3 ? Number(year) : Number(year) - 1;
}

export function getCurrentFiscalYear(date = new Date()) {
  return getFiscalYear(date.getMonth() + 1, date.getFullYear());
}

export function fiscalCalendarYear(month, fy) {
  return Number(month) >= 3 ? Number(fy) : Number(fy) + 1;
}

export function fiscalPeriodLabel(month, fy, short = false) {
  const name = MONTH_NAMES[Number(month)] || 'Unknown';
  const label = short ? name.slice(0, 3) : name;
  return `${label} ${fiscalCalendarYear(month, fy)}`;
}

export function elapsedFiscalMonths(fy, date = new Date()) {
  let count = 0;
  for (const month of FY_MONTHS) {
    const year = fiscalCalendarYear(month, fy);
    if (year < date.getFullYear() || (year === date.getFullYear() && month <= date.getMonth() + 1)) count += 1;
  }
  return Math.max(0, Math.min(12, count));
}

export function contributionForPeriod(contributions = [], month, fy) {
  const year = fiscalCalendarYear(month, fy);
  return contributions.filter((item) => Number(item.month) === Number(month) && Number(item.year) === year);
}

export function contributionAmountForPeriod(contributions = [], month, fy) {
  return contributionForPeriod(contributions, month, fy).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

export function contributionsForFY(contributions = [], fy) {
  return contributions.filter((item) => getFiscalYear(item.month, item.year) === Number(fy));
}

export function loanBalance(loan) {
  if (!loan) return 0;
  if (loan.balance !== undefined && loan.balance !== null) return Math.max(0, Number(loan.balance || 0));
  return Math.max(0, Number(loan.principal || 0) - Number(loan.total_repaid || 0));
}
