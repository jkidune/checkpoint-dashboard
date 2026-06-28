const express = require('express');
const router = express.Router();
const { Investment, Transaction, AuditLog, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  const investments = await Investment.find().sort({ created_at: -1 }).lean();
  res.json(investments);
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { provider, investment_name, amount, transaction_date, reference, notes } = req.body;
  if (!provider || !amount || !transaction_date) return res.status(400).json({ error: 'provider, amount and transaction_date required' });
  const value = Number(amount);
  const investment = await Investment.create({
    provider, investment_name: investment_name || provider, amount: value, carrying_value: value,
    transaction_date, reference: reference || null, cash_impact: -value, status: 'active',
    verification_status: 'provider statement pending', action_required: notes || null, source: 'manual',
  });
  await Transaction.create({
    id: await getNextId('transaction_id'), amount: value, type: 'investment_transfer',
    description: investment_name || provider, reference: reference || null, transaction_date,
    fiscal_year: Number(transaction_date.slice(5, 7)) >= 3 ? Number(transaction_date.slice(0, 4)) : Number(transaction_date.slice(0, 4)) - 1,
    debit: value, cash_impact: -value, investment_impact: value, created_by: req.user.username,
    audit_note: 'Investment transfer recorded as an asset, not an expense.',
  });
  res.status(201).json(investment);
});

router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const { reason, ...updates } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required for investment corrections' });
  const original = await Investment.findById(req.params.id).lean();
  if (!original) return res.status(404).json({ error: 'Investment not found' });
  const allowed = ['provider', 'investment_name', 'carrying_value', 'status', 'verification_status', 'action_required', 'reference'];
  const values = Object.fromEntries(Object.entries(updates).filter(([key]) => allowed.includes(key)));
  values.updated_at = new Date();
  const updated = await Investment.findByIdAndUpdate(req.params.id, { $set: values }, { new: true }).lean();
  await AuditLog.create({
    record_type: 'investment', record_id: req.params.id, action: 'update', old_value: original,
    new_value: updated, reason, user: req.user.username,
  });
  res.json(updated);
});

module.exports = router;
