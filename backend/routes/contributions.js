const express = require('express');
const router = express.Router();
const { db, nextId } = require('../db/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const { year, month, member_id } = req.query;
  let list = db.get('contributions').value();
  if (year)      list = list.filter(c => c.year === parseInt(year));
  if (month)     list = list.filter(c => c.month === parseInt(month));
  if (member_id) list = list.filter(c => c.member_id === parseInt(member_id));
  const members = db.get('members').value();
  list = list.map(c => ({ ...c, member_name: (members.find(m => m.id === c.member_id)||{}).name || '?' }));
  res.json(list.sort((a,b) => b.year - a.year || b.month - a.month));
});

router.get('/grid/:year', authenticate, (req, res) => {
  const year = parseInt(req.params.year);
  const members = db.get('members').filter(m => m.status === 'active').value().sort((a,b) => a.name.localeCompare(b.name));
  const contribs = db.get('contributions').filter(c => c.year === year).value();

  const grid = members.map(m => {
    const months = {};
    for (let i = 1; i <= 12; i++) {
      const c = contribs.find(c => c.member_id === m.id && c.month === i);
      months[i] = c ? { amount: c.amount, status: c.status, id: c.id } : null;
    }
    return {
      member_id: m.id,
      member_name: m.name,
      role: m.role,
      months,
      total: contribs.filter(c => c.member_id === m.id).reduce((s,c) => s+c.amount, 0),
    };
  });

  const monthlyTotals = {};
  for (let i = 1; i <= 12; i++) {
    monthlyTotals[i] = contribs.filter(c => c.month === i).reduce((s,c) => s+c.amount, 0);
  }

  res.json({ grid, monthlyTotals, year });
});

router.post('/', authenticate, requireAdmin, (req, res) => {
  const { member_id, amount, month, year, status, paid_date, mpesa_ref, notes } = req.body;
  if (!member_id || !amount || !month || !year) return res.status(400).json({ error: 'member_id, amount, month, year required' });

  // Check duplicate
  const exists = db.get('contributions').find(c => c.member_id === parseInt(member_id) && c.month === parseInt(month) && c.year === parseInt(year)).value();
  if (exists) return res.status(409).json({ error: 'Contribution already recorded for this month/year' });

  const contrib = {
    id: nextId('contributions'), member_id: parseInt(member_id), amount: parseInt(amount),
    month: parseInt(month), year: parseInt(year), status: status||'paid',
    paid_date: paid_date||new Date().toISOString().split('T')[0], mpesa_ref: mpesa_ref||null,
    notes: notes||null, created_at: new Date().toISOString()
  };
  db.get('contributions').push(contrib).write();

  // Log transaction
  const member = db.get('members').find(m => m.id === parseInt(member_id)).value();
  db.get('transactions').push({
    id: nextId('transactions'), member_id: parseInt(member_id), amount: parseInt(amount),
    type: 'contribution', description: `Monthly contribution - ${member ? member.name : ''}`,
    reference: mpesa_ref||null, transaction_date: paid_date||new Date().toISOString().split('T')[0],
    created_at: new Date().toISOString()
  }).write();

  res.status(201).json(contrib);
});

router.patch('/:id', authenticate, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { amount, status, paid_date, mpesa_ref, notes } = req.body;
  const updates = {};
  if (amount !== undefined)   updates.amount = parseInt(amount);
  if (status)                 updates.status = status;
  if (paid_date)              updates.paid_date = paid_date;
  if (mpesa_ref !== undefined) updates.mpesa_ref = mpesa_ref;
  if (notes !== undefined)    updates.notes = notes;
  db.get('contributions').find(c => c.id === id).assign(updates).write();
  res.json(db.get('contributions').find(c => c.id === id).value());
});

router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  db.get('contributions').remove(c => c.id === id).write();
  res.json({ success: true });
});

module.exports = router;
