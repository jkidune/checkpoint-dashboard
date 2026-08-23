const express = require('express');
const router = express.Router();
const { Loan, Member, Transaction, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Intercepts only pending -> active activation so Form-created pending loans become
// real cash outflows at the correct moment. All other PATCH requests fall through
// to the normal loans router.
router.patch('/:id', authenticate, requireAdmin, async (req, res, next) => {
  if (req.body?.status !== 'active') return next();

  const id = parseInt(req.params.id, 10);
  const existingLoan = await Loan.findOne({ id }).lean();
  if (!existingLoan || existingLoan.status !== 'pending') return next();

  const updates = { status: 'active', disbursed: true };
  if (req.body.due_date !== undefined) updates.due_date = req.body.due_date || null;
  if (req.body.issued_date) updates.issued_date = req.body.issued_date;
  if (req.body.notes !== undefined) updates.notes = req.body.notes || null;
  if (req.body.principal !== undefined) updates.principal = parseInt(req.body.principal, 10);
  if (req.body.interest_amount !== undefined) updates.interest_amount = parseInt(req.body.interest_amount, 10);
  if (req.body.amount_deposited !== undefined) updates.amount_deposited = parseInt(req.body.amount_deposited, 10);

  const existingTx = await Transaction.findOne({
    member_id: existingLoan.member_id,
    type: 'loan_disbursement',
    description: new RegExp(existingLoan.loan_number || `Loan #${existingLoan.id}`, 'i'),
  }).lean();

  if (!existingTx) {
    const member = await Member.findOne({ id: existingLoan.member_id }).lean();
    const transactionDate = updates.issued_date || existingLoan.issued_date || new Date().toISOString().split('T')[0];
    await Transaction.create({
      id: await getNextId('transaction_id'),
      member_id: existingLoan.member_id,
      amount: updates.amount_deposited ?? existingLoan.amount_deposited ?? updates.principal ?? existingLoan.principal,
      type: 'loan_disbursement',
      description: `Loan disbursed — ${member ? member.name : ''} (${existingLoan.loan_number}, FY${existingLoan.fiscal_year})`,
      transaction_date: transactionDate,
    });
  }

  const updated = await Loan.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();
  res.json(updated);
});

module.exports = router;
