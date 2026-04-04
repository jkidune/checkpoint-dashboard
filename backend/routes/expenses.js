const express = require('express');
const router  = express.Router();
const { Expense, getNextId } = require('../db/models');
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
      fiscal_year, reference, loan_id, member_id, approved_by, notes,
    } = req.body;

    if (!category || !description || !amount || !expense_date)
      return res.status(400).json({ error: 'category, description, amount, expense_date required' });

    const date = expense_date;
    const [y, m] = date.split('-').map(Number);
    const fy = fiscal_year ? parseInt(fiscal_year) : getFiscalYear(m, y);

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
      notes:        notes || null,
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
    const { category, description, amount, expense_date, reference, approved_by, notes } = req.body;
    const updates = {};
    if (category)     updates.category     = category;
    if (description)  updates.description  = description;
    if (amount)       updates.amount       = parseInt(amount);
    if (expense_date) updates.expense_date = expense_date;
    if (reference !== undefined) updates.reference  = reference;
    if (approved_by)  updates.approved_by  = approved_by;
    if (notes !== undefined) updates.notes = notes;

    const updated = await Expense.findOneAndUpdate(
      { id }, { $set: updates }, { returnDocument: 'after' }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'Expense not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await Expense.findOneAndDelete({ id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
