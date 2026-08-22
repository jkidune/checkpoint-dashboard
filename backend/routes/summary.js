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

// FY starts March, ends February of the following year (matches loans.js/contributions.js).
function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

// ─── computeSummary ───────────────────────────────────────────────────────────
// Shared computation behind both GET / (full admin payload) and GET /snapshot
// (trimmed member payload) — each route just selects which fields to return.
async function computeSummary() {
  const allMembers = await Member.find().lean();
  const members    = allMembers.filter(m => m.status === 'active');
  const contribs   = await Contribution.find().lean();
  const loans      = await Loan.find().lean();
  const repayments = await Repayment.find().lean();
  const fines      = await Fine.find().lean();
  const welfares   = await WelfareEvent.find({ status: 'approved' }).lean();
  const expenses   = await Expense.find().lean();
  const latestReconciliation = await ReconciliationRun.findOne({ status: 'applied' })
    .sort({ applied_at: -1 })
    .select('-backup')
    .lean();

  const entry_fees           = allMembers.reduce((s, m) => s + (m.entry_fee || 100000), 0);
  const member_contributions = contribs.reduce((s, c) => s + c.amount, 0);
  const paid_fines           = fines.filter(f => f.status === 'paid').reduce((s, f) => s + f.amount, 0);
  const total_interest       = loans.reduce((s, l) => s + l.interest_amount, 0);
  const welfare_paid         = welfares.reduce((s, w) => s + w.amount, 0);
  const total_expenses       = expenses.reduce((s, e) => s + e.amount, 0);
  const net_profit           = paid_fines + total_interest;
  const total_equity         = entry_fees + member_contributions + net_profit - welfare_paid - total_expenses;

  const activeLoans      = loans.filter(l => l.status === 'active');
  const active_principal = activeLoans.reduce((s, l) => s + l.principal, 0);
  const active_repaid    = activeLoans.reduce((s, l) =>
    s + repayments.filter(r => r.loan_id === l.id).reduce((a, r) => a + r.amount, 0), 0);
  const in_circulation   = active_principal - active_repaid;

  const allYears = [...new Set(contribs.map(c => c.year))].sort();
  const monthly_contributions = [];
  for (const year of allYears) {
    for (let month = 1; month <= 12; month++) {
      const total = contribs.filter(c => c.year === year && c.month === month).reduce((s, c) => s + c.amount, 0);
      if (total > 0) monthly_contributions.push({ year, month, total });
    }
  }

  const monthly_stats = [];
  for (let month = 1; month <= 12; month++) {
    const obj = { month };
    allYears.forEach(year => {
      obj[`contributions_${year}`] = contribs.filter(c => c.year === year && c.month === month).reduce((s, c) => s + c.amount, 0);
    });
    monthly_stats.push(obj);
  }

  const availableLoanYears = [...new Set(loans.map(l => l.fiscal_year))].sort();
  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m.name; });

  const interest_by_member = members.map(m => {
    const mLoans = loans.filter(l => l.member_id === m.id);
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

  const investmentsValuated = await valuateInvestments();
  const total_investment_assets = investmentsValuated.reduce((s, i) => s + i.current_value, 0);

  const now = new Date();
  const current_fiscal_year = getFiscalYear(now.getMonth() + 1, now.getFullYear());
  const contributions_this_fy = contribs
    .filter(c => getFiscalYear(c.month, c.year) === current_fiscal_year)
    .reduce((s, c) => s + c.amount, 0);

  // "Net group position" = total equity: entry fees + contributions + net profit,
  // less welfare payouts and expenses. Same figure as equity.total — surfaced at
  // the top level too since it's the headline number for the member snapshot.
  const net_group_position = total_equity;

  return {
    equity: { entry_fees, member_contributions, net_profit, welfare_paid, total_expenses, total: total_equity },
    liabilities: { loans_issued: active_principal, repaid: active_repaid, in_circulation },
    cash_at_bank: total_equity - in_circulation,
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
    net_group_position,
    reconciliation: latestReconciliation ? {
      run_key: latestReconciliation.run_key,
      source_generated_on: latestReconciliation.source_generated_on,
      reporting_cutoff: latestReconciliation.reporting_cutoff,
      source_summary: latestReconciliation.source_summary,
      flags: latestReconciliation.flags,
      applied_at: latestReconciliation.applied_at,
      note: 'Ledger reconciliation applied. Reported cash and unverified investments remain separate from calculated cash until evidence is attached.',
    } : null,
  };
}

// ─── GET / ────────────────────────────────────────────────────────────────────
// Full payload — admin only.
router.get('/', authenticate, requireAdmin, async (req, res) => {
  res.json(await computeSummary());
});

// ─── GET /snapshot ────────────────────────────────────────────────────────────
// Trimmed club-wide aggregate payload for the member dashboard.
router.get('/snapshot', authenticate, async (req, res) => {
  const s = await computeSummary();
  res.json({
    cash_at_bank: s.cash_at_bank,
    total_loans_outstanding: s.liabilities.in_circulation,
    total_investment_assets: s.total_investment_assets,
    contributions_this_fy: s.contributions_this_fy,
    fiscal_year: s.current_fiscal_year,
    active_members: s.active_members,
    net_group_position: s.net_group_position,
  });
});

/* == FINES == */
router.get('/fines', authenticate, async (req, res) => {
  const query = req.user.role !== 'admin' ? { member_id: req.user.member_id } : {};
  let fines = await Fine.find(query).lean();
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
  const { amount, reason, year, status, paid_date, notes, review_required } = req.body;
  const updates = {};
  if (amount !== undefined)           updates.amount = parseInt(amount, 10);
  if (reason !== undefined)           updates.reason = reason;
  if (year !== undefined)             updates.year = parseInt(year, 10);
  if (status !== undefined)           updates.status = status;
  if (paid_date !== undefined)        updates.paid_date = paid_date || null;
  if (notes !== undefined)            updates.notes = notes || null;
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
    });
  }

  res.json(welfare);
});

module.exports = router;
