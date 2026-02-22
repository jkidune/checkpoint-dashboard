const express = require('express');
const router = express.Router();
const { db, nextId } = require('../db/database');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const members     = db.get('members').filter(m => m.status === 'active').value();
  const contribs    = db.get('contributions').value();
  const loans       = db.get('loans').value();
  const repayments  = db.get('loan_repayments').value();
  const fines       = db.get('fines').value();

  // Equity
  const entry_fees           = members.length * 100000;
  const member_contributions = contribs.reduce((s,c) => s+c.amount, 0);
  const paid_fines           = fines.filter(f => f.status === 'paid').reduce((s,f) => s+f.amount, 0);
  const total_interest       = loans.reduce((s,l) => s+l.interest_amount, 0);
  const net_profit           = paid_fines + total_interest;
  const total_equity         = entry_fees + member_contributions + net_profit;

  // Liabilities (active loans in circulation)
  const activeLoans = loans.filter(l => l.status === 'active');
  const active_principal = activeLoans.reduce((s,l) => s+l.principal, 0);
  const active_repaid    = activeLoans.reduce((s,l) => {
    return s + repayments.filter(r => r.loan_id === l.id).reduce((a,r) => a+r.amount, 0);
  }, 0);
  const in_circulation = active_principal - active_repaid;

  // Monthly contribution stats
  const allYears = [...new Set(contribs.map(c => c.year))].sort();
  const monthly_contributions = [];
  for (const year of allYears) {
    for (let month = 1; month <= 12; month++) {
      const total = contribs.filter(c => c.year === year && c.month === month).reduce((s,c) => s+c.amount, 0);
      if (total > 0) monthly_contributions.push({ year, month, total });
    }
  }

  // Monthly stats comparison (2024 vs 2025)
  const monthly_stats = [];
  for (let month = 1; month <= 12; month++) {
    const c2025 = contribs.filter(c => c.year === 2025 && c.month === month).reduce((s,c) => s+c.amount, 0);
    const c2024 = contribs.filter(c => c.year === 2024 && c.month === month).reduce((s,c) => s+c.amount, 0);
    if (c2025 > 0 || c2024 > 0) monthly_stats.push({ month, contributions_2025: c2025, contributions_2024: c2024 });
  }

  // Interest by member
  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m.name; });
  const interest_by_member = members.map(m => {
    const mLoans2025 = loans.filter(l => l.member_id === m.id && l.fiscal_year === 2025);
    const mLoans2024 = loans.filter(l => l.member_id === m.id && l.fiscal_year === 2024);
    return {
      name: m.name,
      interest_2025: mLoans2025.reduce((s,l) => s+l.interest_amount, 0),
      interest_2024: mLoans2024.reduce((s,l) => s+l.interest_amount, 0),
    };
  }).filter(m => m.interest_2025 > 0 || m.interest_2024 > 0)
    .sort((a,b) => b.interest_2025 - a.interest_2025);

  // Active loan list
  const active_loan_list = activeLoans.map(l => {
    const total_repaid = repayments.filter(r => r.loan_id === l.id).reduce((s,r) => s+r.amount, 0);
    return { ...l, member_name: memberMap[l.member_id] || '?', total_repaid, balance: l.principal - total_repaid };
  }).sort((a,b) => b.issued_date.localeCompare(a.issued_date));

  res.json({
    equity: { entry_fees, member_contributions, net_profit, total: total_equity },
    liabilities: { loans_issued: active_principal, repaid: active_repaid, in_circulation },
    cash_at_bank: 1789500,
    active_members: members.length,
    active_loans: activeLoans.length,
    monthly_contributions,
    monthly_stats,
    interest_by_member,
    active_loan_list,
  });
});

router.get('/fines', authenticate, (req, res) => {
  const fines = db.get('fines').value();
  const members = db.get('members').value();
  res.json(fines.map(f => ({ ...f, member_name: (members.find(m => m.id === f.member_id)||{}).name || '?' }))
    .sort((a,b) => a.status.localeCompare(b.status) || a.member_name.localeCompare(b.member_name)));
});

router.post('/fines', authenticate, (req, res) => {
  const { member_id, amount, reason, year, status, paid_date } = req.body;
  const fine = {
    id: nextId('fines'), member_id: parseInt(member_id), amount: parseInt(amount),
    reason: reason||'Late contribution', year: parseInt(year)||2025,
    status: status||'unpaid', paid_date: paid_date||null, created_at: new Date().toISOString()
  };
  db.get('fines').push(fine).write();
  res.status(201).json(fine);
});

router.patch('/fines/:id', authenticate, (req, res) => {
  const id = parseInt(req.params.id);
  const { status, paid_date } = req.body;
  const updates = {};
  if (status)    updates.status = status;
  if (paid_date) updates.paid_date = paid_date;
  db.get('fines').find(f => f.id === id).assign(updates).write();
  res.json(db.get('fines').find(f => f.id === id).value());
});

module.exports = router;
