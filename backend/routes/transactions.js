const express = require('express');
const router = express.Router();
const { Transaction, Member, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  const { member_id, type, limit = 50, offset = 0 } = req.query;
  const query = {};

  if (req.user.role === 'admin') {
    if (member_id) query.member_id = parseInt(member_id);
  } else {
    if (req.user.member_id == null) {
      return res.status(404).json({ error: 'This account has no linked member record' });
    }
    query.member_id = req.user.member_id;
  }

  if (type) query.type = type;

  const safeLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

  const list = await Transaction.find(query)
    .sort({ transaction_date: -1, created_at: -1 })
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();
  const total = await Transaction.countDocuments(query);
  const members = req.user.role === 'admin' ? await Member.find().lean() : [];

  const result = list.map((t) => ({
    ...t,
    member_name: req.user.role === 'admin'
      ? (t.member_id ? (members.find((m) => m.id === t.member_id) || {}).name || '?' : '—')
      : undefined,
  }));

  res.json({ transactions: result, total });
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { member_id, amount, type, description, reference, transaction_date } = req.body;

  const tx = await Transaction.create({
    id:               await getNextId('transaction_id'),
    member_id:        member_id ? parseInt(member_id) : null,
    amount:           parseInt(amount),
    type,
    description:      description || null,
    reference:        reference || null,
    transaction_date: transaction_date || new Date().toISOString().split('T')[0],
  });

  res.status(201).json(tx);
});

module.exports = router;
