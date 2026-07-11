const express = require('express');
const router  = express.Router();
const { Expense, Transaction, AuditLog, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

const CATEGORIES = ['AGM', 'Registration', 'Admin', 'Supplies', 'Loan Override', 'Welfare', 'Other'];

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { fiscal_year, category } = req.query;
    const filter = {};
    if (req.query.include_voided !== 'true') filter.status = { $ne: 'voided' };
    if (fiscal_year) filter.fiscal_year = parseInt(fiscal_year);
    if (category)    filter.category    = category;

    const list = await Expense.find(filter).lean();
    res.json(list.sort((a, b) => b.expense_date.localeCompare(a.expense_date)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /categories ──────────────────────────────────────────────────────────
router.get('/categories', authenticate, (req, res) => {
  res.json(CATEGORIES);
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      category, description, amount, expense_date,
      fiscal_year, reference, loan_id, member_id, approved_by, cash_effect, notes,
    } = req.body;

    if (!category || !description || !amount || !expense_date)
      return res.status(400).json({ error: 'category, description, amount, expense_date required' });

    const date = expense_date;
    const [y, m] = date.split('-').map(Number);
    const fy = fiscal_year ? parseInt(fiscal_year) : getFiscalYear(m, y);
    const hasCashEffect = cash_effect === undefined ? category !== 'Loan Override' : Boolean(cash_effect);

    const expense = await Expense.create({
      id:           await getNextId('expense_id'),
      category,
      description,
      amount:       parseInt(amount),
      expense_date: date,
      fiscal_year:  fy,
      reference:    reference || null,
      loan_id:      loan_id   ? parseInt(loan_id)   : null,
      member_id:    member_id ? parseInt(member_id) : null,
      approved_by:  approved_by || null,
      cash_effect:  hasCashEffect,
      status:       hasCashEffect ? 'approved' : 'control_only',
      notes:        notes || null,
    });

    await Transaction.create({
      id: await getNextId('transaction_id'),
      member_id: member_id ? parseInt(member_id) : null,
      amount: parseInt(amount),
      type: category === 'Welfare' ? 'welfare_payment' : (hasCashEffect ? 'group_expense' : 'control_exception'),
      description,
      reference: reference || null,
      transaction_date: date,
      fiscal_year: fy,
      debit: hasCashEffect ? parseInt(amount) : 0,
      cash_impact: hasCashEffect ? -parseInt(amount) : 0,
      approval_status: hasCashEffect ? 'approved' : 'control_only',
      created_by: req.user.username,
      audit_note: hasCashEffect ? null : 'Non-cash control item; does not reduce bank cash.',
    });

    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /:id ───────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { category, description, amount, expense_date, reference, approved_by, cash_effect, notes, reason } = req.body;
    const original = await Expense.findOne({ id }).lean();
    if (!original) return res.status(404).json({ error: 'Expense not found' });
    const updates = {};
    if (category)     updates.category     = category;
    if (description)  updates.description  = description;
    if (amount)       updates.amount       = parseInt(amount);
    if (expense_date) updates.expense_date = expense_date;
    if (reference !== undefined) updates.reference  = reference;
    if (approved_by)  updates.approved_by  = approved_by;
    if (cash_effect !== undefined) updates.cash_effect = Boolean(cash_effect);
    if (notes !== undefined) updates.notes = notes;

    const updated = await Expense.findOneAndUpdate(
      { id }, { $set: updates }, { returnDocument: 'after' }
    ).lean();
    await AuditLog.create({
      record_type: 'expense', record_id: id, action: 'update', old_value: original, new_value: updated,
      reason: reason || 'Administrative correction', user: req.user.username,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const original = await Expense.findOne({ id }).lean();
    if (!original) return res.status(404).json({ error: 'Expense not found' });
    const updated = await Expense.findOneAndUpdate(
      { id }, { $set: { status: 'voided', cash_effect: false } }, { new: true }
    ).lean();
    await AuditLog.create({
      record_type: 'expense', record_id: id, action: 'void', old_value: original, new_value: updated,
      reason: req.body?.reason || 'Administrative correction', user: req.user.username,
    });
    res.json({ success: true, expense: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
