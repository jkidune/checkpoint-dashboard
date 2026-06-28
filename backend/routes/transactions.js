const express = require('express');
const router = express.Router();
const { Transaction, Member, AuditLog, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  const { member_id, type, limit = 50, offset = 0 } = req.query;
  const query = {};
  if (req.query.include_voided !== 'true') query.status = { $ne: 'voided' };
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
  const {
    member_id, amount, type, description, reference, transaction_date, fiscal_year,
    debit, credit, cash_impact, loan_impact, investment_impact, approval_status, audit_note,
  } = req.body;

  const tx = await Transaction.create({
    id:               await getNextId('transaction_id'),
    member_id:        member_id ? parseInt(member_id) : null,
    amount:           parseInt(amount),
    type,
    description:      description || null,
    reference:        reference || null,
    transaction_date: transaction_date || new Date().toISOString().split('T')[0],
    fiscal_year:      fiscal_year ? parseInt(fiscal_year) : null,
    debit:            Number(debit || 0),
    credit:           Number(credit || 0),
    cash_impact:      Number(cash_impact || 0),
    loan_impact:      Number(loan_impact || 0),
    investment_impact:Number(investment_impact || 0),
    approval_status:  approval_status || 'approved',
    created_by:       req.user.username,
    audit_note:       audit_note || null,
  });

  res.status(201).json(tx);
});

router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { reason, ...requested } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required for ledger corrections' });
  const original = await Transaction.findOne({ id }).lean();
  if (!original) return res.status(404).json({ error: 'Transaction not found' });
  const allowed = [
    'member_id', 'amount', 'type', 'description', 'reference', 'transaction_date', 'fiscal_year',
    'debit', 'credit', 'cash_impact', 'loan_impact', 'investment_impact', 'approval_status', 'status', 'audit_note',
  ];
  const updates = Object.fromEntries(Object.entries(requested).filter(([key]) => allowed.includes(key)));
  updates.last_edited_by = req.user.username;
  const updated = await Transaction.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();
  await AuditLog.create({
    record_type: 'transaction', record_id: id, action: updates.status === 'voided' ? 'void' : 'update',
    old_value: original, new_value: updated, reason, user: req.user.username,
  });
  res.json(updated);
});

module.exports = router;
