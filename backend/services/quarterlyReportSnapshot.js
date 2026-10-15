const { getRulesForFYWithModel } = require('./fyRules');
const { valuateInvestmentsWithModelsAt } = require('../routes/investments');

const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

function dateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function fiscalCalendarYear(month, fiscalYear) {
  return Number(month) >= 3 ? Number(fiscalYear) : Number(fiscalYear) + 1;
}

function getFiscalYear(month, year) {
  return Number(month) >= 3 ? Number(year) : Number(year) - 1;
}

function monthEndKey(month, year) {
  const value = new Date(Date.UTC(Number(year), Number(month), 0));
  return value.toISOString().slice(0, 10);
}

function fiscalQuarterPeriod(fiscalYear, quarter) {
  const fy = Number(fiscalYear);
  const q = Number(quarter);
  if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) throw new Error('Invalid fiscal_year');
  if (![1, 2, 3, 4].includes(q)) throw new Error('quarter must be between 1 and 4');

  const starts = {
    1: [3, fy],
    2: [6, fy],
    3: [9, fy],
    4: [12, fy],
  };
  const ends = {
    1: [5, fy],
    2: [8, fy],
    3: [11, fy],
    4: [2, fy + 1],
  };
  const [startMonth, startYear] = starts[q];
  const [endMonth, endYear] = ends[q];
  return {
    fiscal_year: fy,
    quarter: q,
    period_start: `${startYear}-${String(startMonth).padStart(2, '0')}-01`,
    period_end: monthEndKey(endMonth, endYear),
  };
}

function quarterPeriods(fiscalYear, quarter) {
  const indexes = {
    1: [0, 1, 2],
    2: [3, 4, 5],
    3: [6, 7, 8],
    4: [9, 10, 11],
  }[Number(quarter)];
  return indexes.map((index) => {
    const month = FY_MONTHS[index];
    return { month, year: fiscalCalendarYear(month, fiscalYear) };
  });
}

function memberEffectiveJoinDate(member) {
  return dateKey(member.join_date) || dateKey(member.created_at);
}

function periodDateForContribution(contribution) {
  const month = Number(contribution.month);
  const year = Number(contribution.year);
  if (!month || !year) return null;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function contributionReceiptDate(contribution) {
  // paid_date is authoritative for a simple contribution. Legacy rows without
  // one fall back to their financial period, then created_at. Bulk top-ups are
  // reconstructed separately from their dated transactions below.
  return dateKey(contribution.paid_date)
    || periodDateForContribution(contribution)
    || dateKey(contribution.created_at);
}

function transactionMatchesContributionPeriod(transaction, contribution) {
  if (transaction.type !== 'contribution') return false;
  if (Number(transaction.member_id) !== Number(contribution.member_id)) return false;
  const marker = `(${Number(contribution.month)}/${Number(contribution.year)},`;
  return String(transaction.description || '').includes(marker);
}

function happenedAfterBoundary(financialDate, createdAt, cutoffDate, boundaryTimestamp = null) {
  const key = dateKey(financialDate);
  if (!key || !cutoffDate) return false;
  if (key > cutoffDate) return true;
  if (key < cutoffDate) return false;
  if (!boundaryTimestamp || !createdAt) return false;

  const created = new Date(createdAt);
  const boundary = new Date(boundaryTimestamp);
  return !Number.isNaN(created.getTime())
    && !Number.isNaN(boundary.getTime())
    && created > boundary;
}

function contributionAmountAtCutoff(contribution, transactions, cutoff, boundaryTimestamp = null) {
  if (String(contribution.status || 'paid').toLowerCase() === 'unpaid') return 0;

  const currentAmount = Number(contribution.amount || 0);
  if (currentAmount <= 0) return 0;

  const latestReceiptDate = contributionReceiptDate(contribution);
  if (latestReceiptDate && latestReceiptDate < cutoff) return currentAmount;
  if (latestReceiptDate === cutoff && !boundaryTimestamp) return currentAmount;

  // Bulk-payment top-ups overwrite Contribution.amount with the cumulative
  // value and paid_date with the latest installment date. Subtract installments
  // that happened after this historical boundary, including same-day top-ups
  // recorded after a reconciliation was applied.
  const postBoundaryTopUps = transactions
    .filter((transaction) => (
      transactionMatchesContributionPeriod(transaction, contribution)
      && happenedAfterBoundary(
        transaction.transaction_date,
        transaction.created_at,
        cutoff,
        boundaryTimestamp,
      )
    ))
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

  if (postBoundaryTopUps > 0) return Math.max(0, currentAmount - postBoundaryTopUps);

  if (
    latestReceiptDate === cutoff
    && boundaryTimestamp
    && happenedAfterBoundary(
      latestReceiptDate,
      contribution.created_at,
      cutoff,
      boundaryTimestamp,
    )
  ) {
    return 0;
  }

  // No reconstructable pre-boundary installment remains.
  return latestReceiptDate && latestReceiptDate <= cutoff ? currentAmount : 0;
}

function within(value, start, end) {
  const key = dateKey(value);
  return Boolean(key && key >= start && key <= end);
}

function onOrBefore(value, end) {
  const key = dateKey(value);
  return Boolean(key && key <= end);
}

function monthsDiffAt(d1, d2) {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  if (Number.isNaN(date1.getTime()) || Number.isNaN(date2.getTime())) return 0;
  let months = (date2.getFullYear() - date1.getFullYear()) * 12;
  months -= date1.getMonth();
  months += date2.getMonth();
  return months <= 0 ? 0 : months;
}

function extractPhysicalCash(reconciliation) {
  if (!reconciliation?.source_summary) return null;
  const candidates = [
    reconciliation.source_summary.current_mkoba_cash_tzs,
    reconciliation.source_summary.physical_mkoba_cash_tzs,
    reconciliation.source_summary.actual_mkoba_cash_tzs,
    reconciliation.source_summary.reported_cash_tzs,
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return null;
}

function reconciliationCashDate(reconciliation) {
  return dateKey(reconciliation?.reporting_cutoff?.Y3_loans)
    || dateKey(reconciliation?.reporting_cutoff?.contributions)
    || dateKey(reconciliation?.source_generated_on)
    || dateKey(reconciliation?.applied_at);
}

function recordIsAfterReconciliation(financialDate, createdAt, cutoffDate, appliedAt, reportEnd) {
  const key = dateKey(financialDate);
  if (!key || !cutoffDate || key > reportEnd) return false;
  return happenedAfterBoundary(financialDate, createdAt, cutoffDate, appliedAt);
}

function formatTzs(value) {
  return `TZS ${Math.round(Number(value || 0)).toLocaleString('en-US')}`;
}

function categoryTotals(rows, field = 'category') {
  const out = {};
  for (const row of rows) {
    const key = String(row[field] || 'Other');
    out[key] = (out[key] || 0) + Number(row.amount || 0);
  }
  return Object.entries(out)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

async function buildQuarterlyReportSnapshot(models, { fiscal_year, quarter, organization_name }) {
  const period = fiscalQuarterPeriod(fiscal_year, quarter);
  const { period_start: periodStart, period_end: periodEnd } = period;
  const quarterMonthKeys = new Set(
    quarterPeriods(period.fiscal_year, period.quarter)
      .map(({ month, year }) => `${year}-${String(month).padStart(2, '0')}`)
  );

  const [
    members,
    contributions,
    loans,
    repayments,
    fines,
    welfare,
    expenses,
    transactions,
    reconciliationRuns,
  ] = await Promise.all([
    models.Member.find().lean(),
    models.Contribution.find().lean(),
    models.Loan.find().lean(),
    models.Repayment.find().lean(),
    models.Fine.find().lean(),
    models.WelfareEvent.find().lean(),
    models.Expense.find().lean(),
    models.Transaction.find().lean(),
    models.ReconciliationRun.find({
      status: { $in: ['applied', 'PARTIALLY_RECONCILED', 'partially_reconciled'] },
    }).sort({ applied_at: -1, created_at: -1 }).select('-backup').lean(),
  ]);

  const rules = await getRulesForFYWithModel(models.FyRules, period.fiscal_year);
  const activeMembers = members.filter((member) => {
    const joined = memberEffectiveJoinDate(member);
    return member.status === 'active' && (!joined || joined <= periodEnd);
  });

  const contributionSnapshots = contributions.map((item) => ({
    ...item,
    amount_at_cutoff: contributionAmountAtCutoff(item, transactions, periodEnd),
  }));
  const quarterContributions = contributionSnapshots.filter((item) => {
    const key = `${item.year}-${String(item.month).padStart(2, '0')}`;
    return quarterMonthKeys.has(key) && item.amount_at_cutoff > 0;
  });
  const contributionsToDate = contributionSnapshots.filter((item) => {
    const key = periodDateForContribution(item);
    return key && key <= periodEnd && item.amount_at_cutoff > 0;
  });
  const ytdContributions = contributionSnapshots.filter((item) => (
    getFiscalYear(item.month, item.year) === period.fiscal_year
      && periodDateForContribution(item) <= periodEnd
      && item.amount_at_cutoff > 0
  ));

  const contributionTarget = Number(rules.contribution_amount || 0);
  const qPeriods = quarterPeriods(period.fiscal_year, period.quarter);
  const expectedForPeriods = (periods, memberList = activeMembers) => periods.reduce((sum, { month, year }) => {
    const cutoff = monthEndKey(month, year);
    const eligible = memberList.filter((member) => {
      const joined = memberEffectiveJoinDate(member);
      return !joined || joined <= cutoff;
    }).length;
    return sum + eligible * contributionTarget;
  }, 0);
  const elapsedFyPeriods = FY_MONTHS
    .map((month) => ({ month, year: fiscalCalendarYear(month, period.fiscal_year) }))
    .filter(({ month, year }) => `${year}-${String(month).padStart(2, '0')}-01` <= periodEnd);

  const quarterContributionTotal = quarterContributions.reduce((sum, item) => sum + Number(item.amount_at_cutoff || 0), 0);
  const ytdContributionTotal = ytdContributions.reduce((sum, item) => sum + Number(item.amount_at_cutoff || 0), 0);
  const expectedQuarter = expectedForPeriods(qPeriods);
  const expectedYtd = expectedForPeriods(elapsedFyPeriods);

  const rulesByFy = new Map();
  async function loanRules(fy) {
    const key = Number(fy || period.fiscal_year);
    if (!rulesByFy.has(key)) rulesByFy.set(key, await getRulesForFYWithModel(models.FyRules, key));
    return rulesByFy.get(key);
  }

  const loanDisbursementEvidence = (loan) => {
    const marker = loan.loan_number && loan.fiscal_year != null
      ? `(${loan.loan_number}, FY${loan.fiscal_year})`
      : null;

    // Legacy rows may not have enough identity to distinguish one member's
    // multiple loans. In that case, do not guess from unrelated transactions.
    if (!marker) {
      return {
        date: dateKey(loan.issued_date),
        created_at: null,
        source: 'legacy_issued_date',
      };
    }

    const disbursement = transactions
      .filter((transaction) => (
        transaction.type === 'loan_disbursement'
        && Number(transaction.member_id) === Number(loan.member_id)
        && String(transaction.description || '').includes(marker)
      ))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0];

    if (!disbursement) {
      return {
        date: dateKey(loan.issued_date),
        created_at: null,
        source: 'issued_date_fallback',
      };
    }

    const transactionDate = dateKey(disbursement.transaction_date) || dateKey(loan.issued_date);
    const recordedDate = dateKey(disbursement.created_at);
    const effectiveDate = transactionDate && recordedDate
      ? (transactionDate > recordedDate ? transactionDate : recordedDate)
      : (recordedDate || transactionDate || dateKey(loan.issued_date));

    return {
      date: effectiveDate,
      created_at: disbursement.created_at || null,
      source: 'loan_disbursement_transaction',
    };
  };

  const loansIssuedByEnd = loans
    .map((loan) => {
      const evidence = loanDisbursementEvidence(loan);
      return {
        ...loan,
        report_disbursement_date: evidence.date,
        report_disbursement_created_at: evidence.created_at,
        report_disbursement_source: evidence.source,
      };
    })
    .filter((loan) => {
      if (!loan.report_disbursement_date || loan.report_disbursement_date > periodEnd) return false;
      const status = String(loan.status || '').toLowerCase();
      if (
        status === 'pending'
        && loan.report_disbursement_source !== 'loan_disbursement_transaction'
        && loan.disbursed !== true
      ) return false;
      if (status === 'cancelled') {
        const cancelledAt = dateKey(loan.cancelled_at);
        // New cancellations are timestamped in routes/loans.js. Legacy
        // cancelled loans may not have that timestamp; keep them in historical
        // snapshots rather than erasing periods in which they were disbursed.
        return cancelledAt ? cancelledAt > periodEnd : true;
      }
      return true;
    });

  const loanPosition = [];
  for (const loan of loansIssuedByEnd) {
    const repaymentsToEnd = repayments
      .filter((repayment) => repayment.loan_id === loan.id && onOrBefore(repayment.repayment_date, periodEnd))
      .reduce((sum, repayment) => sum + Number(repayment.amount || 0), 0);
    const loanFyRules = await loanRules(loan.fiscal_year);
    const monthsActive = monthsDiffAt(loan.issued_date, periodEnd);
    let penalty = 0;
    if (
      loanFyRules.overdue_penalty_enabled
      && loanFyRules.loan_repayment_months
      && monthsActive > loanFyRules.loan_repayment_months
    ) {
      penalty = Math.round(
        Number(loan.principal || 0)
          * Number(loanFyRules.overdue_penalty_rate || 0)
          * (monthsActive - loanFyRules.loan_repayment_months)
      );
    }
    loanPosition.push({
      ...loan,
      repayments_to_period_end: repaymentsToEnd,
      penalty_at_period_end: penalty,
      // Reconstruct the balance from dated repayments at the report cut-off.
      // Today's loan.status must not erase a balance that still existed in an
      // older quarter simply because the loan was paid later.
      balance_at_period_end: Math.max(0, Number(loan.principal || 0) + penalty - repaymentsToEnd),
    });
  }

  const outstandingLoans = loanPosition
    .filter((loan) => loan.balance_at_period_end > 0)
    .sort((a, b) => {
      const dateOrder = String(a.issued_date || '').localeCompare(String(b.issued_date || ''));
      if (dateOrder !== 0) return dateOrder;
      return Number(a.id || 0) - Number(b.id || 0);
    });
  const quarterLoans = loansIssuedByEnd.filter((loan) => within(loan.report_disbursement_date, periodStart, periodEnd));
  const quarterRepayments = repayments.filter((item) => within(item.repayment_date, periodStart, periodEnd));

  const fineCreatedKey = (fine) => (
    dateKey(fine.created_at)
    || (fine.contribution_month && fine.contribution_year
      ? `${fine.contribution_year}-${String(fine.contribution_month).padStart(2, '0')}-01`
      : null)
    || dateKey(fine.paid_date)
  );
  const finesByEnd = fines.filter((fine) => {
    const key = fineCreatedKey(fine);
    return key && key <= periodEnd;
  });
  const assessedQuarter = finesByEnd
    .filter((fine) => {
      const key = fineCreatedKey(fine);
      return key >= periodStart && key <= periodEnd;
    })
    .reduce((sum, fine) => sum + Number(fine.amount || 0), 0);
  const paidFinesToEnd = finesByEnd.filter((fine) => (
    fine.status === 'paid' && fine.paid_date && fine.paid_date <= periodEnd
  ));
  const paidFinesQuarter = finesByEnd.filter((fine) => (
    fine.status === 'paid' && within(fine.paid_date, periodStart, periodEnd)
  ));
  const outstandingFinesAtEnd = finesByEnd.filter((fine) => (
    !fine.paid_date || fine.paid_date > periodEnd || fine.status !== 'paid'
  ));

  const expensesToEnd = expenses.filter((item) => onOrBefore(item.expense_date, periodEnd));
  const quarterExpenses = expensesToEnd.filter((item) => within(item.expense_date, periodStart, periodEnd));
  const ytdExpenses = expensesToEnd.filter((item) => Number(item.fiscal_year) === period.fiscal_year);

  const welfareToEnd = welfare.filter((item) => (
    item.status === 'approved'
      && onOrBefore(item.approved_date || item.created_at, periodEnd)
  ));
  const quarterWelfare = welfareToEnd.filter((item) => within(item.approved_date || item.created_at, periodStart, periodEnd));
  const ytdWelfare = welfareToEnd.filter((item) => {
    const key = dateKey(item.approved_date || item.created_at);
    return key && key >= `${period.fiscal_year}-03-01` && key <= periodEnd;
  });

  const investmentsAtEnd = await valuateInvestmentsWithModelsAt(models, periodEnd);
  const investmentCost = investmentsAtEnd.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const investmentValue = investmentsAtEnd.reduce((sum, item) => sum + Number(item.current_value || 0), 0);
  const quarterInvestmentTransfers = investmentsAtEnd
    .filter((item) => within(item.created_at, periodStart, periodEnd))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const membersJoinedByEnd = members.filter((member) => {
    const joined = memberEffectiveJoinDate(member);
    return !joined || joined <= periodEnd;
  });
  const entryFees = membersJoinedByEnd.reduce((sum, member) => sum + Number(member.entry_fee || 100000), 0);
  const contributionsAllTime = contributionsToDate.reduce((sum, item) => sum + Number(item.amount_at_cutoff || 0), 0);
  const fineIncome = paidFinesToEnd.reduce((sum, fine) => sum + Number(fine.amount || 0), 0);
  const interestIncome = loansIssuedByEnd.reduce((sum, loan) => sum + Number(loan.interest_amount || 0), 0);
  const welfarePaid = welfareToEnd.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expensesPaid = expensesToEnd.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalEquity = entryFees + contributionsAllTime + fineIncome + interestIncome - welfarePaid - expensesPaid;
  const outstandingLoanBalance = outstandingLoans.reduce((sum, loan) => sum + Number(loan.balance_at_period_end || 0), 0);
  const principalInCirculation = loanPosition.reduce(
    (sum, loan) => sum + Math.max(0, Number(loan.principal || 0) - Number(loan.repayments_to_period_end || 0)),
    0
  );

  const eligibleReconciliations = reconciliationRuns
    .map((run) => ({ run, cashDate: reconciliationCashDate(run) }))
    .filter(({ cashDate }) => cashDate && cashDate <= periodEnd)
    .sort((a, b) => b.cashDate.localeCompare(a.cashDate));
  const reconciliation = eligibleReconciliations[0]?.run || null;
  const reconciliationDate = eligibleReconciliations[0]?.cashDate || null;
  const physicalCash = extractPhysicalCash(reconciliation);

  let cashPosition;
  if (physicalCash !== null && reconciliationDate) {
    const appliedAt = reconciliation?.applied_at || null;
    const postTransactions = transactions.filter((item) => recordIsAfterReconciliation(
      item.transaction_date,
      item.created_at,
      reconciliationDate,
      appliedAt,
      periodEnd,
    ));
    const contributionsReceived = contributions.reduce((sum, contribution) => {
      const atReportEnd = contributionAmountAtCutoff(contribution, transactions, periodEnd);
      const atReconciliation = contributionAmountAtCutoff(
        contribution,
        transactions,
        reconciliationDate,
        appliedAt,
      );
      return sum + Math.max(0, atReportEnd - atReconciliation);
    }, 0);
    const entryFeesReceived = membersJoinedByEnd
      .filter((member) => {
        const effectiveDate = memberEffectiveJoinDate(member);
        return recordIsAfterReconciliation(
          effectiveDate,
          member.created_at,
          reconciliationDate,
          appliedAt,
          periodEnd,
        );
      })
      .reduce((sum, member) => sum + Number(member.entry_fee || 100000), 0);
    const loanRepaymentsReceived = repayments
      .filter((item) => recordIsAfterReconciliation(
        item.repayment_date,
        item.created_at,
        reconciliationDate,
        appliedAt,
        periodEnd,
      ))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const finesReceived = postTransactions
      .filter((item) => item.type === 'fine_payment')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const loanDisbursements = loansIssuedByEnd
      .filter((loan) => recordIsAfterReconciliation(
        loan.report_disbursement_date,
        loan.report_disbursement_created_at,
        reconciliationDate,
        appliedAt,
        periodEnd,
      ))
      .reduce((sum, loan) => {
        const deposited = Number(loan.amount_deposited);
        return sum + (Number.isFinite(deposited) && deposited > 0 ? deposited : Number(loan.principal || 0));
      }, 0);
    const postExpenses = expensesToEnd
      .filter((item) => item.category !== 'Loan Override' && recordIsAfterReconciliation(
        item.expense_date,
        item.created_at,
        reconciliationDate,
        appliedAt,
        periodEnd,
      ))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const welfarePayouts = welfareToEnd
      .filter((item) => recordIsAfterReconciliation(
        item.approved_date || item.created_at,
        item.created_at,
        reconciliationDate,
        appliedAt,
        periodEnd,
      ))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const investmentTransfers = investmentsAtEnd
      .filter((item) => !item.reconciliation_key && recordIsAfterReconciliation(
        item.created_at,
        item.created_at,
        reconciliationDate,
        appliedAt,
        periodEnd,
      ))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const inflows = entryFeesReceived + contributionsReceived + loanRepaymentsReceived + finesReceived;
    const outflows = loanDisbursements + postExpenses + welfarePayouts + investmentTransfers;
    cashPosition = {
      source: 'reconciled_plus_ledger_movements',
      reconciled_balance: physicalCash,
      reconciled_as_of: reconciliationDate,
      entry_fees_received: entryFeesReceived,
      contributions_received: contributionsReceived,
      loan_repayments_received: loanRepaymentsReceived,
      fines_received: finesReceived,
      loan_disbursements: loanDisbursements,
      expenses_paid: postExpenses,
      welfare_paid: welfarePayouts,
      investment_transfers: investmentTransfers,
      total_inflows: inflows,
      total_outflows: outflows,
      net_movement: inflows - outflows,
      closing_balance: physicalCash + inflows - outflows,
    };
  } else {
    cashPosition = {
      source: 'calculated',
      reconciled_balance: null,
      reconciled_as_of: null,
      entry_fees_received: null,
      contributions_received: null,
      loan_repayments_received: null,
      fines_received: null,
      loan_disbursements: null,
      expenses_paid: null,
      welfare_paid: null,
      investment_transfers: quarterInvestmentTransfers,
      total_inflows: null,
      total_outflows: null,
      net_movement: null,
      // Match the live summary's fallback principle: cash is equity less
      // principal still circulating as loans. Penalties remain portfolio
      // receivables but are not cash that was disbursed from the group.
      principal_in_circulation: principalInCirculation,
      closing_balance: Math.max(0, totalEquity - principalInCirculation),
      fallback_calculated: true,
    };
  }

  const memberStanding = [];
  for (const member of activeMembers) {
    const memberYtd = ytdContributions
      .filter((item) => item.member_id === member.id)
      .reduce((sum, item) => sum + Number(item.amount_at_cutoff || 0), 0);
    const memberExpected = expectedForPeriods(elapsedFyPeriods, [member]);
    const memberQuarter = quarterContributions
      .filter((item) => item.member_id === member.id)
      .reduce((sum, item) => sum + Number(item.amount_at_cutoff || 0), 0);
    const memberLoanBalance = outstandingLoans
      .filter((loan) => loan.member_id === member.id)
      .reduce((sum, loan) => sum + Number(loan.balance_at_period_end || 0), 0);
    const memberFineBalance = outstandingFinesAtEnd
      .filter((fine) => fine.member_id === member.id)
      .reduce((sum, fine) => sum + Number(fine.amount || 0), 0);
    const arrears = Math.max(0, memberExpected - memberYtd);
    memberStanding.push({
      member_id: member.id,
      member_name: member.name,
      contributions_quarter: memberQuarter,
      contributions_ytd: memberYtd,
      expected_ytd: memberExpected,
      contribution_arrears: arrears,
      loan_balance: memberLoanBalance,
      outstanding_fines: memberFineBalance,
      status: arrears > 0 || memberFineBalance > 0 ? 'attention' : 'current',
    });
  }
  memberStanding.sort((a, b) => a.member_name.localeCompare(b.member_name));

  const monthlyContributions = qPeriods.map(({ month, year }) => {
    const amount = quarterContributions
      .filter((item) => Number(item.month) === month && Number(item.year) === year)
      .reduce((sum, item) => sum + Number(item.amount_at_cutoff || 0), 0);
    const expected = expectedForPeriods([{ month, year }]);
    return { month, year, amount, expected };
  });

  const controls = [];
  const legacyCancelledLoans = loansIssuedByEnd.filter(
    (loan) => String(loan.status || '').toLowerCase() === 'cancelled' && !loan.cancelled_at,
  );
  if (legacyCancelledLoans.length) {
    controls.push({
      type: 'loan_cancellation_history',
      severity: 'attention',
      message: `${legacyCancelledLoans.length} cancelled loan(s) have no historical cancellation timestamp. They are retained in this snapshot because their disbursement predates the report cut-off.`,
    });
  }
  if (!reconciliation) {
    controls.push({
      type: 'reconciliation',
      severity: 'attention',
      message: 'No applied cash reconciliation snapshot was available on or before the report cut-off. Closing cash uses the existing calculated fallback.',
    });
  } else if (physicalCash === null) {
    controls.push({
      type: 'reconciliation_cash',
      severity: 'attention',
      message: 'An applied reconciliation exists for the report period, but it contains no recognised physical-cash value. Closing cash therefore uses the calculated fallback.',
    });
  }
  for (const flag of reconciliation?.flags || []) {
    controls.push({
      type: 'reconciliation_flag',
      severity: 'attention',
      message: typeof flag === 'string' ? flag : JSON.stringify(flag),
    });
  }
  for (const holding of investmentsAtEnd.filter((item) => item.valuation === 'at_cost' && item.units_purchased != null)) {
    controls.push({
      type: 'investment_valuation',
      severity: 'info',
      message: `${holding.provider}${holding.asset_class ? ` / ${holding.asset_class}` : ''} is carried at cost because no qualifying NAV existed at the report cut-off.`,
    });
  }

  const quarterRepaymentTotal = quarterRepayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const quarterPrincipalIssued = quarterLoans.reduce((sum, item) => sum + Number(item.principal || 0), 0);
  const quarterInterest = quarterLoans.reduce((sum, item) => sum + Number(item.interest_amount || 0), 0);
  const quarterExpenseTotal = quarterExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const quarterWelfareTotal = quarterWelfare.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    schema_version: 'checkpoint-quarterly-report-v1',
    organization: { name: organization_name || 'Checkpoint Investment Club' },
    report_basis: {
      fiscal_year: period.fiscal_year,
      quarter: period.quarter,
      period_start: periodStart,
      period_end: periodEnd,
      source_cutoff: periodEnd,
      generated_at: new Date().toISOString(),
      assumptions: [
        'Fiscal year runs from March to February.',
        'Contribution receipts are reconstructed at the report cut-off. Bulk-payment top-ups use their dated contribution transactions so installments received before the cut-off remain visible even when the cumulative row was updated later.',
        'Contribution expectations use the FY contribution rule, current active-member status, and effective join dates (join_date, then created_at fallback) on or before the report cut-off. Historical membership-status changes cannot be reconstructed without effective-dated status history.',
        'Loan balances are reconstructed from dated repayments recorded on or before the report cut-off and the applicable loan FY penalty rules, rather than today\'s loan status.',
        'Post-reconciliation entry fees are recognised as cash inflows using member join_date, with created_at as a fallback when join_date is absent.',
        'Post-reconciliation welfare payouts are recognised as cash outflows using approved_date (or created_at when approved_date is absent).',
        'When no eligible reconciliation exists, calculated cash follows the live summary principle: group equity less loan principal still in circulation; overdue penalties are not treated as cash outflows.',
        'Investment values use the latest NAV on or before the report cut-off, with cost fallback where no qualifying NAV exists.',
      ],
    },
    headline: {
      contributions_quarter: quarterContributionTotal,
      cash_position: cashPosition.closing_balance,
      outstanding_loans: outstandingLoanBalance,
      investment_assets: investmentValue,
      net_group_position: totalEquity,
      active_members: activeMembers.length,
    },
    financial_position: {
      entry_fees: entryFees,
      member_contributions: contributionsAllTime,
      paid_fines: fineIncome,
      total_interest: interestIncome,
      welfare_paid: welfarePaid,
      total_expenses: expensesPaid,
      total_equity: totalEquity,
      cash_at_period_end: cashPosition.closing_balance,
      outstanding_loans: outstandingLoanBalance,
      investment_assets: investmentValue,
      net_group_position: totalEquity,
    },
    contributions: {
      quarter_received: quarterContributionTotal,
      quarter_expected: expectedQuarter,
      collection_rate: expectedQuarter > 0 ? quarterContributionTotal / expectedQuarter : null,
      ytd_received: ytdContributionTotal,
      ytd_expected: expectedYtd,
      ytd_arrears: Math.max(0, expectedYtd - ytdContributionTotal),
      monthly: monthlyContributions,
      fully_current_members: memberStanding.filter((item) => item.contribution_arrears === 0).length,
      members_with_arrears: memberStanding.filter((item) => item.contribution_arrears > 0).length,
    },
    loans: {
      issued_count: quarterLoans.length,
      principal_issued: quarterPrincipalIssued,
      repayments_received: quarterRepaymentTotal,
      outstanding_balance: outstandingLoanBalance,
      principal_in_circulation: principalInCirculation,
      outstanding_count: outstandingLoans.length,
      overdue_count: outstandingLoans.filter((loan) => Number(loan.penalty_at_period_end || 0) > 0).length,
      interest_on_quarter_loans: quarterInterest,
      portfolio: outstandingLoans.map((loan) => ({
        loan_id: loan.id,
        loan_number: loan.loan_number,
        member_id: loan.member_id,
        principal: Number(loan.principal || 0),
        issued_date: loan.issued_date,
        disbursement_date: loan.report_disbursement_date,
        repayments_to_period_end: loan.repayments_to_period_end,
        penalty_at_period_end: loan.penalty_at_period_end,
        balance_at_period_end: loan.balance_at_period_end,
      })),
    },
    investments: {
      total_invested_cost: investmentCost,
      current_value: investmentValue,
      gain_loss: investmentValue - investmentCost,
      quarter_transfers: quarterInvestmentTransfers,
      holdings: investmentsAtEnd.map((item) => ({
        provider: item.provider,
        asset_class: item.asset_class,
        amount: Number(item.amount || 0),
        units_purchased: item.units_purchased,
        latest_unit_cost: item.latest_unit_cost ?? null,
        nav_effective_date: item.nav_effective_date ?? null,
        current_value: Number(item.current_value || 0),
        valuation: item.valuation,
      })),
    },
    cash_position: cashPosition,
    expenses: {
      quarter_total: quarterExpenseTotal,
      ytd_total: ytdExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      categories: categoryTotals(quarterExpenses),
    },
    welfare: {
      quarter_total: quarterWelfareTotal,
      ytd_total: ytdWelfare.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      event_count: quarterWelfare.length,
    },
    fines: {
      assessed_quarter: assessedQuarter,
      paid_quarter: paidFinesQuarter.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      outstanding_at_period_end: outstandingFinesAtEnd.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    },
    member_standing: memberStanding,
    controls: {
      reconciliation_status: reconciliation ? reconciliation.status : 'not_available',
      reconciliation_as_of: reconciliationDate,
      flags: controls,
    },
    narrative_default: {
      executive_summary: `During Q${period.quarter} FY${period.fiscal_year}, member contributions totalled ${formatTzs(quarterContributionTotal)}. At ${periodEnd}, outstanding loans were ${formatTzs(outstandingLoanBalance)}, investment assets were valued at ${formatTzs(investmentValue)}, and the recorded closing cash position was ${formatTzs(cashPosition.closing_balance)}.`,
      management_notes: '',
    },
  };
}

module.exports = {
  buildQuarterlyReportSnapshot,
  fiscalQuarterPeriod,
  quarterPeriods,
  dateKey,
};
