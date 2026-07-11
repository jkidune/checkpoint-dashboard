const express = require('express');
const router = express.Router();
const { Member, Contribution, Loan, Repayment, Fine, WelfareEvent, Transaction, Expense, Investment, ReconciliationRun, AuditLog, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

function getMonthsDiff(d1, d2) {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  let months = (date2.getFullYear() - date1.getFullYear()) * 12;
  months -= date1.getMonth();
  months += date2.getMonth();
  return months <= 0 ? 0 : months;
}

router.get('/', authenticate, async (req, res) => {
  const allMembers = await Member.find().lean();
  const members    = allMembers.filter(m => m.status === 'active');
  const contribs   = await Contribution.find().lean();
  const loans      = await Loan.find().lean();
  const repayments = await Repayment.find({ status: { $ne: 'voided' } }).lean();
  const fines      = await Fine.find().lean();
  const welfares   = await WelfareEvent.find({ status: 'approved' }).lean();
  const expenses   = await Expense.find().lean();
  const investments = await Investment.find().lean();
  const latestReconciliation = await ReconciliationRun.findOne({ status: 'applied' })
    .sort({ applied_at: -1 })
    .select('-backup')
    .lean();

  const entry_fees           = allMembers.reduce((s, m) => s + (m.entry_fee || 100000), 0);
  const postedContribs        = contribs.filter(c => !['reconciled_void', 'voided'].includes(c.status));
  const validLoans            = loans.filter(l => !['cancelled', 'voided', 'not_disbursed'].includes(l.status) && l.disbursed !== false);
  const member_contributions = postedContribs.reduce((s, c) => s + c.amount, 0);
  const paid_fines           = fines.filter(f => f.status === 'paid').reduce((s, f) => s + f.amount, 0);
  const total_interest       = validLoans.reduce((s, l) => s + l.interest_amount, 0);
  const postedExpenses       = expenses.filter(e => e.status !== 'voided');
  const expenseWelfare       = postedExpenses.filter(e => e.category === 'Welfare' && e.cash_effect !== false)
    .reduce((s, e) => s + e.amount, 0);
  const welfare_paid         = welfares.reduce((s, w) => s + w.amount, 0) + expenseWelfare;
  const total_expenses       = postedExpenses
    .filter(e => e.category !== 'Welfare' && e.cash_effect !== false)
    .reduce((s, e) => s + e.amount, 0);
  const non_cash_controls    = postedExpenses.filter(e => e.cash_effect === false)
    .reduce((s, e) => s + e.amount, 0);
  const net_profit           = paid_fines + total_interest;
  const total_equity         = entry_fees + member_contributions + net_profit - welfare_paid - total_expenses;

  const activeLoans      = loans.filter(l => l.status === 'active' && l.disbursed !== false);
  const active_principal = activeLoans.reduce((s, l) => s + l.principal, 0);
  const active_repaid    = activeLoans.reduce((s, l) =>
    s + repayments.filter(r => r.loan_id === l.id).reduce((a, r) => a + r.amount, 0), 0);
  const in_circulation   = active_principal - active_repaid;
  const investment_assets = investments
    .filter(item => !['voided', 'cancelled'].includes(item.status))
    .reduce((sum, item) => sum + (item.carrying_value ?? item.amount ?? 0), 0);

  const reconciledPosition = latestReconciliation?.schema_version === '2026.06.reconciled-v2'
    ? latestReconciliation.source_summary?.financial_position
    : null;
  const reconciledCash = latestReconciliation?.schema_version === '2026.06.reconciled-v2'
    ? latestReconciliation.source_summary?.cash_reconciliation?.confirmed_mkoba_balance_tzs
    : null;
  const cash_at_bank = reconciledCash ?? (total_equity - in_circulation);
  const loans_outstanding = reconciledPosition?.working_net_loan_balance_tzs ?? in_circulation;
  const total_investments = reconciledPosition?.itrust_investment_at_cost_tzs ?? investment_assets;
  const total_group_assets = reconciledPosition?.total_recorded_assets_tzs
    ?? (cash_at_bank + loans_outstanding + total_investments);
  const total_group_liabilities = reconciledPosition?.recorded_loan_credit_tzs ?? 0;
  const net_group_position = total_group_assets - total_group_liabilities;

  const allYears = [...new Set(postedContribs.map(c => c.year))].sort();
  const monthly_contributions = [];
  for (const year of allYears) {
    for (let month = 1; month <= 12; month++) {
      const total = postedContribs.filter(c => c.year === year && c.month === month).reduce((s, c) => s + c.amount, 0);
      if (total > 0) monthly_contributions.push({ year, month, total });
    }
  }

  const monthly_stats = [];
  for (let month = 1; month <= 12; month++) {
    const obj = { month };
    allYears.forEach(year => {
      obj[`contributions_${year}`] = postedContribs.filter(c => c.year === year && c.month === month).reduce((s, c) => s + c.amount, 0);
    });
    monthly_stats.push(obj);
  }

  const availableLoanYears = [...new Set(validLoans.map(l => l.fiscal_year))].sort();
  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m.name; });

  const interest_by_member = members.map(m => {
    const mLoans = validLoans.filter(l => l.member_id === m.id);
    const obj = { name: m.name, total_interest: mLoans.reduce((s, l) => s + l.interest_amount, 0) };
    availableLoanYears.forEach(y => {
      obj[`interest_${y}`] = mLoans.filter(l => l.fiscal_year === y).reduce((s, l) => s + l.interest_amount, 0);
    });
    return obj;
  }).filter(m => m.total_interest > 0).sort((a, b) => b.total_interest - a.total_interest);

  const active_loan_list = activeLoans.map(l => {
    const total_repaid = repayments.filter(r => r.loan_id === l.id).reduce((s, r) => s + r.amount, 0);
    let penalty = 0;
    const months_active = getMonthsDiff(l.issued_date, new Date());
    if (l.fiscal_year >= 2026 && months_active > 6) {
      penalty = Math.round(l.principal * 0.10 * (months_active - 6));
    }
    return { ...l, member_name: memberMap[l.member_id] || '?', total_repaid, penalty, balance: Math.max(0, l.principal + penalty - total_repaid) };
  }).sort((a, b) => b.issued_date.localeCompare(a.issued_date));

  res.json({
    equity: { entry_fees, member_contributions, net_profit, welfare_paid, total_expenses, total: total_equity },
    liabilities: { loans_issued: active_principal, repaid: active_repaid, in_circulation },
    cash_at_bank,
    financial_overview: {
      cash_at_bank,
      investment_assets: total_investments,
      loans_outstanding,
      total_contributions: reconciledPosition?.contributions_paid_all_years_tzs ?? member_contributions,
      total_fines_collected: reconciledPosition?.fines_paid_tzs ?? paid_fines,
      interest_earned: reconciledPosition?.interest_charged_all_years_tzs ?? total_interest,
      welfare_paid: latestReconciliation?.schema_version === '2026.06.reconciled-v2'
        ? (latestReconciliation.source_summary?.cash_reconciliation?.welfare_support_tzs ?? welfare_paid)
        : welfare_paid,
      expenses_paid: latestReconciliation?.schema_version === '2026.06.reconciled-v2'
        ? (latestReconciliation.source_summary?.cash_reconciliation?.operating_expenses_tzs ?? total_expenses)
        : total_expenses,
      non_cash_controls,
      total_group_assets,
      total_group_liabilities,
      net_group_position,
      active_members: members.length,
      as_of: latestReconciliation?.reporting_cutoff || null,
    },
    active_members: members.length,
    active_loans: activeLoans.length,
    monthly_contributions,
    monthly_stats,
    availableLoanYears,
    interest_by_member,
    active_loan_list,
    investments,
    reconciliation: latestReconciliation ? {
      run_key: latestReconciliation.run_key,
      source_generated_on: latestReconciliation.source_generated_on,
      reporting_cutoff: latestReconciliation.reporting_cutoff,
      source_summary: latestReconciliation.source_summary,
      flags: latestReconciliation.flags,
      applied_at: latestReconciliation.applied_at,
      note: latestReconciliation.schema_version === '2026.06.reconciled-v2'
        ? 'Cash, investments and loans are reported separately. Itrust is carried at cost pending the provider statement.'
        : 'Ledger reconciliation applied. Reported cash and unverified investments remain separate from calculated cash until evidence is attached.',
    } : null,
  });
});

/* == FINES == */
router.get('/fines', authenticate, async (req, res) => {
  let fines = await Fine.find().lean();
  const members = await Member.find().lean();
  fines = fines.map(f => ({ ...f, member_name: (members.find(m => m.id === f.member_id) || {}).name || '?' }));
  fines.sort((a, b) => a.status.localeCompare(b.status) || a.member_name.localeCompare(b.member_name));
  res.json(fines);
});

router.post('/fines', authenticate, requireAdmin, async (req, res) => {
  const { member_id, amount, reason, year, status, paid_date } = req.body;
  const fine = await Fine.create({
    id:        await getNextId('fine_id'),
    member_id: parseInt(member_id),
    amount:    parseInt(amount),
    reason:    reason || 'Late contribution',
    year:      parseInt(year) || 2026,
    status:    status || 'unpaid',
    paid_date: paid_date || null,
  });
  res.status(201).json(fine);
});

router.patch('/fines/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { status, paid_date, reason } = req.body;
  const original = await Fine.findOne({ id }).lean();
  if (!original) return res.status(404).json({ error: 'Fine not found' });
  const updates = {};
  if (status)    updates.status = status;
  if (paid_date) updates.paid_date = paid_date;
  const fine = await Fine.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();
  await AuditLog.create({
    record_type: 'fine', record_id: id, action: 'update', old_value: original, new_value: fine,
    reason: reason || 'Administrative correction', user: req.user.username,
  });
  res.json(fine);
});

/* == WELFARE == */
router.get('/welfare', authenticate, async (req, res) => {
  let welfares = await WelfareEvent.find().lean();
  const members = await Member.find().lean();
  welfares = welfares.map(w => ({ ...w, member_name: (members.find(m => m.id === w.member_id) || {}).name || '?' }));
  welfares.sort((a, b) => b.created_at - a.created_at);
  res.json(welfares);
});

router.post('/welfare', authenticate, requireAdmin, async (req, res) => {
  const { member_id, event_type, amount, notes } = req.body;
  const welfare = await WelfareEvent.create({
    id:         await getNextId('welfare_id'),
    member_id:  parseInt(member_id),
    event_type,
    amount:     parseInt(amount) || 50000,
    status:     'pending',
    notes:      notes || null,
  });
  res.status(201).json(welfare);
});

router.patch('/welfare/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { status, approved_date } = req.body;

  const updates = {};
  if (status)       updates.status = status;
  if (approved_date) updates.approved_date = approved_date;
  if (status === 'approved' && !approved_date) {
    updates.approved_date = new Date().toISOString().split('T')[0];
  }

  const welfare = await WelfareEvent.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();

  if (status === 'approved') {
    await Transaction.create({
      id:               await getNextId('transaction_id'),
      member_id:        welfare.member_id,
      amount:           welfare.amount,
      type:             'welfare_payment',
      description:      `Welfare support: ${welfare.event_type}`,
      transaction_date: welfare.approved_date || new Date().toISOString().split('T')[0],
      debit:            welfare.amount,
      cash_impact:      -welfare.amount,
      created_by:       req.user.username,
    });
  }

  res.json(welfare);
});

module.exports = router;
