const express = require('express');
const router = express.Router();
const { Member, Contribution, Loan, Repayment, Fine, WelfareEvent, Transaction, Expense, ReconciliationRun, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { valuateInvestments } = require('./investments');
const { getRulesForFY } = require('./rules');

const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

function getMonthsDiff(d1, d2) {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  let months = (date2.getFullYear() - date1.getFullYear()) * 12;
  months -= date1.getMonth();
  months += date2.getMonth();
  return months <= 0 ? 0 : months;
}

function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

function calendarYearForFYMonth(month, fy) {
  return month >= 3 ? fy : fy + 1;
}

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

function isAfterDate(value, cutoff) {
  const key = dateKey(value);
  return !!(key && cutoff && key > cutoff);
}

function extractPhysicalCash(reconciliation) {
  if (!reconciliation?.source_summary) return null;
  const source = reconciliation.source_summary;
  const candidates = [
    source.current_mkoba_cash_tzs,
    source.physical_mkoba_cash_tzs,
    source.actual_mkoba_cash_tzs,
    source.reported_cash_tzs,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function reconciliationCashDate(reconciliation) {
  // The physical M-Koba snapshot belongs to the source reporting cutoff, not
  // the date the reconciliation file happened to be generated or imported.
  // Y3_loans is the authoritative current-ledger cutoff used by reconciliation.
  return dateKey(reconciliation?.reporting_cutoff?.Y3_loans)
    || dateKey(reconciliation?.reporting_cutoff?.contributions)
    || dateKey(reconciliation?.source_generated_on)
    || dateKey(reconciliation?.applied_at);
}

function recordIsAfterReconciliation(financialDate, createdAt, cutoffDate, appliedAt) {
  const key = dateKey(financialDate);
  if (!key || !cutoffDate) return false;
  if (key > cutoffDate) return true;
  if (key < cutoffDate) return false;

  // Same financial date as the snapshot: only treat it as a new movement when
  // it was actually entered after the reconciliation had already been applied.
  if (!appliedAt || !createdAt) return false;
  const created = new Date(createdAt);
  const applied = new Date(appliedAt);
  return !Number.isNaN(created.getTime()) && !Number.isNaN(applied.getTime()) && created > applied;
}

function cashMovementSummary({ physicalCash, reconciliationDate, reconciliationAppliedAt, transactions, loans, expenses, investments }) {
  if (physicalCash === null || !reconciliationDate) return null;

  const postReconciliationTransactions = transactions.filter((transaction) => (
    recordIsAfterReconciliation(
      transaction.transaction_date,
      transaction.created_at,
      reconciliationDate,
      reconciliationAppliedAt,
    )
  ));
  const contributionsReceived = postReconciliationTransactions
    .filter((transaction) => transaction.type === 'contribution')
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const loanRepaymentsReceived = postReconciliationTransactions
    .filter((transaction) => transaction.type === 'loan_repayment')
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const finesReceived = postReconciliationTransactions
    .filter((transaction) => transaction.type === 'fine_payment')
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

  // An active/paid/overdue loan represents a real disbursement. Pending and
  // cancelled loans do not. This deliberately does not depend on the legacy
  // `disbursed` flag because older pending->active transitions could leave that
  // flag false even though the disbursement had happened.
  const loanDisbursements = loans
    .filter((loan) => (
      !['pending', 'cancelled'].includes(String(loan.status || '').toLowerCase())
      && recordIsAfterReconciliation(
        loan.issued_date,
        loan.created_at,
        reconciliationDate,
        reconciliationAppliedAt,
      )
    ))
    .reduce((sum, loan) => {
      // Actual M-Koba cash outflow is the amount deposited to the borrower. For
      // FYs with upfront retained interest this is lower than gross principal.
      const deposited = Number(loan.amount_deposited);
      return sum + (Number.isFinite(deposited) && deposited > 0 ? deposited : Number(loan.principal || 0));
    }, 0);

  const expensesPaid = expenses
    .filter((expense) => (
      expense.category !== 'Loan Override'
      && recordIsAfterReconciliation(
        expense.expense_date,
        expense.created_at,
        reconciliationDate,
        reconciliationAppliedAt,
      )
    ))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  const investmentTransfers = investments
    .filter((investment) => (
      !investment.reconciliation_key
      && recordIsAfterReconciliation(
        investment.created_at,
        investment.created_at,
        reconciliationDate,
        reconciliationAppliedAt,
      )
    ))
    .reduce((sum, investment) => sum + Number(investment.amount || 0), 0);

  const inflows = contributionsReceived + loanRepaymentsReceived + finesReceived;
  const outflows = loanDisbursements + expensesPaid + investmentTransfers;
  const netMovement = inflows - outflows;

  return {
    reconciled_balance: physicalCash,
    reconciled_as_of: reconciliationDate,
    contributions_received: contributionsReceived,
    loan_repayments_received: loanRepaymentsReceived,
    fines_received: finesReceived,
    loan_disbursements: loanDisbursements,
    expenses_paid: expensesPaid,
    investment_transfers: investmentTransfers,
    total_inflows: inflows,
    total_outflows: outflows,
    net_movement: netMovement,
    live_balance: physicalCash + netMovement,
    updated_at: new Date().toISOString(),
  };
}

async function computeSummary() {
  const [allMembers, contribs, loans, repayments, fines, welfares, expenses, transactions, latestReconciliation] = await Promise.all([
    Member.find().lean(),
    Contribution.find().lean(),
    Loan.find().lean(),
    Repayment.find().lean(),
    Fine.find().lean(),
    WelfareEvent.find({ status: 'approved' }).lean(),
    Expense.find().lean(),
    Transaction.find().lean(),
    ReconciliationRun.findOne({
      status: { $in: ['applied', 'PARTIALLY_RECONCILED', 'partially_reconciled'] },
    })
      .sort({ applied_at: -1, created_at: -1 })
      .select('-backup')
      .lean(),
  ]);

  const members = allMembers.filter((m) => m.status === 'active');
  const entry_fees = allMembers.reduce((sum, member) => sum + (member.entry_fee || 100000), 0);
  const member_contributions = contribs.reduce((sum, contribution) => sum + Number(contribution.amount || 0), 0);
  const paid_fines = fines.filter((fine) => fine.status === 'paid').reduce((sum, fine) => sum + Number(fine.amount || 0), 0);
  const total_interest = loans.reduce((sum, loan) => sum + Number(loan.interest_amount || 0), 0);
  const welfare_paid = welfares.reduce((sum, welfare) => sum + Number(welfare.amount || 0), 0);
  const total_expenses = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const net_profit = paid_fines + total_interest;
  const total_equity = entry_fees + member_contributions + net_profit - welfare_paid - total_expenses;

  const activeLoans = loans.filter((loan) => loan.status === 'active');
  const active_principal = activeLoans.reduce((sum, loan) => sum + Number(loan.principal || 0), 0);
  const active_repaid = activeLoans.reduce((sum, loan) =>
    sum + repayments.filter((repayment) => repayment.loan_id === loan.id).reduce((subtotal, repayment) => subtotal + Number(repayment.amount || 0), 0), 0);
  const in_circulation = Math.max(0, active_principal - active_repaid);

  const contributionFiscalYears = [...new Set(contribs.map((contribution) => getFiscalYear(contribution.month, contribution.year)))].sort();
  const monthly_contributions = [];
  for (const fy of contributionFiscalYears) {
    for (const month of FY_MONTHS) {
      const year = calendarYearForFYMonth(month, fy);
      const total = contribs
        .filter((contribution) => contribution.year === year && contribution.month === month)
        .reduce((sum, contribution) => sum + Number(contribution.amount || 0), 0);
      if (total > 0) monthly_contributions.push({ fiscal_year: fy, year, month, total });
    }
  }

  const monthly_stats = FY_MONTHS.map((month, fiscal_index) => {
    const obj = { month, fiscal_index };
    contributionFiscalYears.forEach((fy) => {
      const year = calendarYearForFYMonth(month, fy);
      obj[`contributions_${fy}`] = contribs
        .filter((contribution) => contribution.year === year && contribution.month === month)
        .reduce((sum, contribution) => sum + Number(contribution.amount || 0), 0);
      obj[`calendar_year_${fy}`] = year;
    });
    return obj;
  });

  const availableLoanYears = [...new Set(loans.map((loan) => loan.fiscal_year).filter((year) => Number.isFinite(Number(year))).map(Number))].sort();
  const memberMap = {};
  members.forEach((member) => { memberMap[member.id] = member.name; });

  const interest_by_member = members.map((member) => {
    const memberLoans = loans.filter((loan) => loan.member_id === member.id);
    const obj = { name: member.name, total_interest: memberLoans.reduce((sum, loan) => sum + Number(loan.interest_amount || 0), 0) };
    availableLoanYears.forEach((year) => {
      obj[`interest_${year}`] = memberLoans.filter((loan) => loan.fiscal_year === year).reduce((sum, loan) => sum + Number(loan.interest_amount || 0), 0);
    });
    return obj;
  }).filter((member) => member.total_interest > 0).sort((a, b) => b.total_interest - a.total_interest);

  const rulesCache = {};
  const active_loan_list = await Promise.all(activeLoans.map(async (loan) => {
    const total_repaid = repayments.filter((repayment) => repayment.loan_id === loan.id).reduce((sum, repayment) => sum + Number(repayment.amount || 0), 0);
    const fy = loan.fiscal_year;
    const rules = rulesCache[fy] || await getRulesForFY(fy);
    rulesCache[fy] = rules;
    const months_active = getMonthsDiff(loan.issued_date, new Date());
    let penalty = 0;
    if (rules.overdue_penalty_enabled && rules.loan_repayment_months && months_active > rules.loan_repayment_months) {
      penalty = Math.round(Number(loan.principal || 0) * Number(rules.overdue_penalty_rate || 0) * (months_active - rules.loan_repayment_months));
    }
    return { ...loan, member_name: memberMap[loan.member_id] || '?', total_repaid, penalty, balance: Math.max(0, Number(loan.principal || 0) + penalty - total_repaid) };
  }));
  active_loan_list.sort((a, b) => String(b.issued_date || '').localeCompare(String(a.issued_date || '')));

  const investmentsValuated = await valuateInvestments();
  const total_investment_assets = investmentsValuated.reduce((sum, investment) => sum + Number(investment.current_value || 0), 0);

  const now = new Date();
  const current_fiscal_year = getFiscalYear(now.getMonth() + 1, now.getFullYear());
  const contributions_this_fy = contribs
    .filter((contribution) => getFiscalYear(contribution.month, contribution.year) === current_fiscal_year)
    .reduce((sum, contribution) => sum + Number(contribution.amount || 0), 0);

  const calculatedCash = total_equity - in_circulation;
  const physicalCash = extractPhysicalCash(latestReconciliation);
  const reconciliationDate = reconciliationCashDate(latestReconciliation);
  const cashPosition = cashMovementSummary({
    physicalCash,
    reconciliationDate,
    reconciliationAppliedAt: latestReconciliation?.applied_at || null,
    transactions,
    loans,
    expenses,
    investments: investmentsValuated,
  });
  const cash_at_bank = cashPosition?.live_balance ?? physicalCash ?? calculatedCash;

  return {
    equity: { entry_fees, member_contributions, net_profit, welfare_paid, total_expenses, total: total_equity },
    liabilities: { loans_issued: active_principal, repaid: active_repaid, in_circulation },
    cash_at_bank,
    cash_source: cashPosition ? 'reconciled_plus_ledger_movements' : physicalCash !== null ? 'reconciled_physical' : 'calculated',
    cash_position: cashPosition || {
      reconciled_balance: physicalCash,
      reconciled_as_of: reconciliationDate,
      live_balance: cash_at_bank,
      updated_at: new Date().toISOString(),
      fallback_calculated: true,
    },
    active_members: members.length,
    active_loans: activeLoans.length,
    monthly_contributions,
    monthly_stats,
    availableLoanYears,
    interest_by_member,
    active_loan_list,
    investments: investmentsValuated,
    total_investment_assets,
    current_fiscal_year,
    contributions_this_fy,
    net_group_position: total_equity,
    reconciliation: latestReconciliation ? {
      run_key: latestReconciliation.run_key,
      source_generated_on: latestReconciliation.source_generated_on,
      reporting_cutoff: latestReconciliation.reporting_cutoff,
      source_summary: latestReconciliation.source_summary,
      flags: latestReconciliation.flags,
      applied_at: latestReconciliation.applied_at,
    } : null,
  };
}

router.get('/', authenticate, requireAdmin, async (req, res) => {
  res.json(await computeSummary());
});

router.get('/snapshot', authenticate, async (req, res) => {
  const summary = await computeSummary();
  res.json({
    cash_at_bank: summary.cash_at_bank,
    cash_source: summary.cash_source,
    cash_as_of: summary.cash_position?.updated_at || null,
    reconciled_cash: summary.cash_position?.reconciled_balance ?? null,
    reconciled_cash_as_of: summary.cash_position?.reconciled_as_of || null,
    total_loans_outstanding: summary.liabilities.in_circulation,
    total_investment_assets: summary.total_investment_assets,
    contributions_this_fy: summary.contributions_this_fy,
    fiscal_year: summary.current_fiscal_year,
    active_members: summary.active_members,
    net_group_position: summary.net_group_position,
  });
});

/* == FINES == */
router.get('/fines', authenticate, async (req, res) => {
  const query = req.user.role !== 'admin' ? { member_id: req.user.member_id } : {};
  let fines = await Fine.find(query).lean();
  const members = await Member.find().lean();
  fines = fines.map((fine) => ({ ...fine, member_name: (members.find((member) => member.id === fine.member_id) || {}).name || '?' }));
  fines.sort((a, b) => a.status.localeCompare(b.status) || a.member_name.localeCompare(b.member_name));
  res.json(fines);
});

router.post('/fines', authenticate, requireAdmin, async (req, res) => {
  const { member_id, amount, reason, year, status, paid_date } = req.body;
  const fine = await Fine.create({
    id: await getNextId('fine_id'),
    member_id: parseInt(member_id),
    amount: parseInt(amount),
    reason: reason || 'Late contribution',
    year: parseInt(year) || 2026,
    status: status || 'unpaid',
    paid_date: paid_date || null,
  });
  res.status(201).json(fine);
});

router.patch('/fines/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { amount, reason, year, status, paid_date, notes, review_required } = req.body;
  const updates = {};
  if (amount !== undefined) updates.amount = parseInt(amount, 10);
  if (reason !== undefined) updates.reason = reason;
  if (year !== undefined) updates.year = parseInt(year, 10);
  if (status !== undefined) updates.status = status;
  if (paid_date !== undefined) updates.paid_date = paid_date || null;
  if (notes !== undefined) updates.notes = notes || null;
  if (review_required !== undefined) updates.review_required = review_required;

  const fine = await Fine.findOneAndUpdate({ id }, { $set: updates }, { returnDocument: 'after' }).lean();
  if (!fine) return res.status(404).json({ error: 'Fine not found' });
  res.json(fine);
});

router.delete('/fines/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const deleted = await Fine.findOneAndDelete({ id }).lean();
  if (!deleted) return res.status(404).json({ error: 'Fine not found' });
  res.json({ ok: true, message: 'Fine deleted successfully', id });
});

/* == WELFARE == */
router.get('/welfare', authenticate, async (req, res) => {
  const query = req.user.role !== 'admin' ? { member_id: req.user.member_id } : {};
  let welfares = await WelfareEvent.find(query).lean();
  const members = await Member.find().lean();
  welfares = welfares.map((welfare) => ({ ...welfare, member_name: (members.find((member) => member.id === welfare.member_id) || {}).name || '?' }));
  welfares.sort((a, b) => b.created_at - a.created_at);
  res.json(welfares);
});

router.post('/welfare', authenticate, requireAdmin, async (req, res) => {
  const { member_id, event_type, amount, notes } = req.body;
  const welfare = await WelfareEvent.create({
    id: await getNextId('welfare_id'),
    member_id: parseInt(member_id),
    event_type,
    amount: parseInt(amount) || 50000,
    notes: notes || null,
  });
  res.status(201).json(welfare);
});

module.exports = router;
