const express = require('express');
const router = express.Router();
const { Member, Contribution, Loan, Repayment, Fine, WelfareEvent, Transaction, getNextId } = require('../db/models');
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
  const members    = await Member.find({ status: 'active' }).lean();
  const contribs   = await Contribution.find().lean();
  const loans      = await Loan.find().lean();
  const repayments = await Repayment.find().lean();
  const fines      = await Fine.find().lean();
  const welfares   = await WelfareEvent.find({ status: 'approved' }).lean();

  const entry_fees           = members.reduce((s, m) => s + (m.entry_fee || 100000), 0);
  const member_contributions = contribs.reduce((s, c) => s + c.amount, 0);
  const paid_fines           = fines.filter(f => f.status === 'paid').reduce((s, f) => s + f.amount, 0);
  const total_interest       = loans.reduce((s, l) => s + l.interest_amount, 0);
  const welfare_paid         = welfares.reduce((s, w) => s + w.amount, 0);
  const net_profit           = paid_fines + total_interest;
  const total_equity         = entry_fees + member_contributions + net_profit - welfare_paid;

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

  res.json({
    equity: { entry_fees, member_contributions, net_profit, welfare_paid, total: total_equity },
    liabilities: { loans_issued: active_principal, repaid: active_repaid, in_circulation },
    cash_at_bank: total_equity - in_circulation,
    active_members: members.length,
    active_loans: activeLoans.length,
    monthly_contributions,
    monthly_stats,
    availableLoanYears,
    interest_by_member,
    active_loan_list,
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
  const { status, paid_date } = req.body;
  const updates = {};
  if (status)    updates.status = status;
  if (paid_date) updates.paid_date = paid_date;
  const fine = await Fine.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();
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
    });
  }

  res.json(welfare);
});

module.exports = router;
