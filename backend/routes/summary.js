const express = require('express');
const router = express.Router();
const { Member, Contribution, Loan, Repayment, Fine, WelfareEvent, Transaction, Expense, ReconciliationRun, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { valuateInvestments } = require('./investments');

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

async function computeSummary() {
  const allMembers = await Member.find().lean();
  const members = allMembers.filter((m) => m.status === 'active');
  const contribs = await Contribution.find().lean();
  const loans = await Loan.find().lean();
  const repayments = await Repayment.find().lean();
  const fines = await Fine.find().lean();
  const welfares = await WelfareEvent.find({ status: 'approved' }).lean();
  const expenses = await Expense.find().lean();
  const latestReconciliation = await ReconciliationRun.findOne({
    status: { $in: ['applied', 'PARTIALLY_RECONCILED', 'partially_reconciled'] },
  })
    .sort({ applied_at: -1, created_at: -1 })
    .select('-backup')
    .lean();

  const entry_fees = allMembers.reduce((sum, member) => sum + (member.entry_fee || 100000), 0);
  const member_contributions = contribs.reduce((sum, contribution) => sum + contribution.amount, 0);
  const paid_fines = fines.filter((fine) => fine.status === 'paid').reduce((sum, fine) => sum + fine.amount, 0);
  const total_interest = loans.reduce((sum, loan) => sum + loan.interest_amount, 0);
  const welfare_paid = welfares.reduce((sum, welfare) => sum + welfare.amount, 0);
  const total_expenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const net_profit = paid_fines + total_interest;
  const total_equity = entry_fees + member_contributions + net_profit - welfare_paid - total_expenses;

  const activeLoans = loans.filter((loan) => loan.status === 'active');
  const active_principal = activeLoans.reduce((sum, loan) => sum + loan.principal, 0);
  const active_repaid = activeLoans.reduce((sum, loan) =>
    sum + repayments.filter((repayment) => repayment.loan_id === loan.id).reduce((subtotal, repayment) => subtotal + repayment.amount, 0), 0);
  const in_circulation = Math.max(0, active_principal - active_repaid);

  const allYears = [...new Set(contribs.map((contribution) => contribution.year))].sort();
  const monthly_contributions = [];
  for (const year of allYears) {
    for (let month = 1; month <= 12; month += 1) {
      const total = contribs.filter((contribution) => contribution.year === year && contribution.month === month).reduce((sum, contribution) => sum + contribution.amount, 0);
      if (total > 0) monthly_contributions.push({ year, month, total });
    }
  }

  const monthly_stats = [];
  for (let month = 1; month <= 12; month += 1) {
    const obj = { month };
    allYears.forEach((year) => {
      obj[`contributions_${year}`] = contribs.filter((contribution) => contribution.year === year && contribution.month === month).reduce((sum, contribution) => sum + contribution.amount, 0);
    });
    monthly_stats.push(obj);
  }

  const availableLoanYears = [...new Set(loans.map((loan) => loan.fiscal_year))].sort();
  const memberMap = {};
  members.forEach((member) => { memberMap[member.id] = member.name; });

  const interest_by_member = members.map((member) => {
    const memberLoans = loans.filter((loan) => loan.member_id === member.id);
    const obj = { name: member.name, total_interest: memberLoans.reduce((sum, loan) => sum + loan.interest_amount, 0) };
    availableLoanYears.forEach((year) => {
      obj[`interest_${year}`] = memberLoans.filter((loan) => loan.fiscal_year === year).reduce((sum, loan) => sum + loan.interest_amount, 0);
    });
    return obj;
  }).filter((member) => member.total_interest > 0).sort((a, b) => b.total_interest - a.total_interest);

  const active_loan_list = activeLoans.map((loan) => {
    const total_repaid = repayments.filter((repayment) => repayment.loan_id === loan.id).reduce((sum, repayment) => sum + repayment.amount, 0);
    let penalty = 0;
    const months_active = getMonthsDiff(loan.issued_date, new Date());
    if (loan.fiscal_year >= 2026 && months_active > 6) {
      penalty = Math.round(loan.principal * 0.10 * (months_active - 6));
    }
    return { ...loan, member_name: memberMap[loan.member_id] || '?', total_repaid, penalty, balance: Math.max(0, loan.principal + penalty - total_repaid) };
  }).sort((a, b) => String(b.issued_date || '').localeCompare(String(a.issued_date || '')));

  const investmentsValuated = await valuateInvestments();
  const total_investment_assets = investmentsValuated.reduce((sum, investment) => sum + investment.current_value, 0);

  const now = new Date();
  const current_fiscal_year = getFiscalYear(now.getMonth() + 1, now.getFullYear());
  const contributions_this_fy = contribs
    .filter((contribution) => getFiscalYear(contribution.month, contribution.year) === current_fiscal_year)
    .reduce((sum, contribution) => sum + contribution.amount, 0);

  const calculatedCash = total_equity - in_circulation;
  const physicalCash = extractPhysicalCash(latestReconciliation);
  const cash_at_bank = physicalCash ?? calculatedCash;

  return {
    equity: { entry_fees, member_contributions, net_profit, welfare_paid, total_expenses, total: total_equity },
    liabilities: { loans_issued: active_principal, repaid: active_repaid, in_circulation },
    cash_at_bank,
    cash_source: physicalCash !== null ? 'reconciled_physical' : 'calculated',
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
    cash_as_of: summary.reconciliation?.applied_at || summary.reconciliation?.source_generated_on || null,
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
