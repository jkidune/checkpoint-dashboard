const express = require('express');
const router = express.Router();
const { Transaction, Member, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  const { member_id, type, limit = 50, offset = 0 } = req.query;
  const query = {};
  if (member_id) query.member_id = parseInt(member_id);
  if (type)      query.type = type;

  const list = await Transaction.find(query)
    .sort({ transaction_date: -1 })
    .skip(parseInt(offset))
    .limit(parseInt(limit))
    .lean();
  const total = await Transaction.countDocuments(query);
  const members = await Member.find().lean();

  const result = list.map(t => ({
    ...t,
    member_name: t.member_id ? (members.find(m => m.id === t.member_id) || {}).name || '?' : '—',
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
