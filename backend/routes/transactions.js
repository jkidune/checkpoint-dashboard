const express = require('express');
const router = express.Router();
const { db, nextId } = require('../db/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const { member_id, type, limit = 50, offset = 0 } = req.query;
  let list = db.get('transactions').value();
  if (member_id) list = list.filter(t => t.member_id === parseInt(member_id));
  if (type)      list = list.filter(t => t.type === type);

  const members = db.get('members').value();
  list = list.map(t => ({ ...t, member_name: t.member_id ? (members.find(m => m.id === t.member_id)||{}).name || '?' : '—' }));
  list = list.sort((a,b) => b.transaction_date.localeCompare(a.transaction_date));

  const total = list.length;
  list = list.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  res.json({ transactions: list, total });
});

router.post('/', authenticate, requireAdmin, (req, res) => {
  const { member_id, amount, type, description, reference, transaction_date } = req.body;
  const tx = {
    id: nextId('transactions'), member_id: member_id ? parseInt(member_id) : null,
    amount: parseInt(amount), type, description: description||null, reference: reference||null,
    transaction_date: transaction_date||new Date().toISOString().split('T')[0],
    created_at: new Date().toISOString()
  };
  db.get('transactions').push(tx).write();
  res.status(201).json(tx);
});

module.exports = router;
