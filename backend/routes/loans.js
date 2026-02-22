const express = require('express');
const router = express.Router();
const { db, nextId } = require('../db/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

function enrichLoan(loan) {
  const repayments = db.get('loan_repayments').filter(r => r.loan_id === loan.id).value();
  const total_repaid = repayments.reduce((s,r) => s+r.amount, 0);
  const member = db.get('members').find(m => m.id === loan.member_id).value();
  return { ...loan, member_name: member ? member.name : '?', total_repaid, balance: Math.max(0, loan.principal - total_repaid) };
}

router.get('/', authenticate, (req, res) => {
  const { fiscal_year, status, member_id } = req.query;
  let list = db.get('loans').value();
  if (fiscal_year) list = list.filter(l => l.fiscal_year === parseInt(fiscal_year));
  if (status)      list = list.filter(l => l.status === status);
  if (member_id)   list = list.filter(l => l.member_id === parseInt(member_id));
  res.json(list.map(enrichLoan).sort((a,b) => b.issued_date.localeCompare(a.issued_date)));
});

router.get('/:id', authenticate, (req, res) => {
  const id = parseInt(req.params.id);
  const loan = db.get('loans').find(l => l.id === id).value();
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  const repayments = db.get('loan_repayments').filter(r => r.loan_id === id).value()
    .sort((a,b) => a.repayment_date.localeCompare(b.repayment_date));
  res.json({ ...enrichLoan(loan), repayments });
});

router.post('/', authenticate, requireAdmin, (req, res) => {
  const { member_id, principal, issued_date, due_date, fiscal_year, notes } = req.body;
  if (!member_id || !principal || !issued_date) return res.status(400).json({ error: 'member_id, principal, issued_date required' });

  const mid = parseInt(member_id);
  const fy = parseInt(fiscal_year) || new Date().getFullYear();
  const existing = db.get('loans').filter(l => l.member_id === mid && l.fiscal_year === fy).value().length;
  const loan_number = `Loan ${existing + 1}`;
  const p = parseInt(principal);
  const interest_amount = Math.round(p * 0.05);

  const loan = {
    id: nextId('loans'), member_id: mid, loan_number, principal: p,
    interest_rate: 0.05, interest_amount, amount_deposited: p - interest_amount,
    issued_date, due_date: due_date||null, status: 'active', fiscal_year: fy,
    notes: notes||null, created_at: new Date().toISOString()
  };
  db.get('loans').push(loan).write();

  const member = db.get('members').find(m => m.id === mid).value();
  db.get('transactions').push({
    id: nextId('transactions'), member_id: mid, amount: p, type: 'loan_disbursement',
    description: `Loan disbursed - ${member ? member.name : ''} (${loan_number})`,
    reference: null, transaction_date: issued_date, created_at: new Date().toISOString()
  }).write();

  res.status(201).json(loan);
});

router.post('/:id/repayments', authenticate, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { amount, repayment_date, mpesa_ref, notes } = req.body;
  if (!amount || !repayment_date) return res.status(400).json({ error: 'amount and repayment_date required' });

  const loan = db.get('loans').find(l => l.id === id).value();
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const repayment = {
    id: nextId('loan_repayments'), loan_id: id, amount: parseInt(amount),
    repayment_date, mpesa_ref: mpesa_ref||null, notes: notes||null,
    created_at: new Date().toISOString()
  };
  db.get('loan_repayments').push(repayment).write();

  // Check if fully repaid
  const totalRepaid = db.get('loan_repayments').filter(r => r.loan_id === id).value().reduce((s,r) => s+r.amount, 0);
  if (totalRepaid >= loan.principal) {
    db.get('loans').find(l => l.id === id).assign({ status: 'paid' }).write();
  }

  db.get('transactions').push({
    id: nextId('transactions'), member_id: loan.member_id, amount: parseInt(amount),
    type: 'loan_repayment', description: `Loan repayment - ${loan.loan_number}`,
    reference: mpesa_ref||null, transaction_date: repayment_date, created_at: new Date().toISOString()
  }).write();

  res.status(201).json(repayment);
});

router.patch('/:id', authenticate, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { status, due_date, notes } = req.body;
  const updates = {};
  if (status)   updates.status = status;
  if (due_date) updates.due_date = due_date;
  if (notes)    updates.notes = notes;
  db.get('loans').find(l => l.id === id).assign(updates).write();
  res.json(enrichLoan(db.get('loans').find(l => l.id === id).value()));
});

module.exports = router;
