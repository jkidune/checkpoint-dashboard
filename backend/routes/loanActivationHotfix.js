const express = require('express');
const router = express.Router();
const { Loan, Member, Transaction, getNextId } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { assessLoanApproval } = require('../services/loanApprovalAssessment');

async function assessmentForLoan(loan, overrides = {}) {
  return assessLoanApproval({
    memberId: loan.member_id,
    principal: overrides.principal ?? loan.principal,
    loanDate: overrides.issued_date || loan.issued_date || new Date().toISOString().slice(0, 10),
    fiscalYear: loan.fiscal_year,
    assessmentDate: new Date(),
    excludeLoanId: loan.id,
  });
}

// Allows the admin UI to refresh the exact checks that will be enforced when a
// pending loan is activated. This endpoint does not change any financial record.
router.get('/:id/approval-assessment', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const loan = await Loan.findOne({ id }).lean();
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.status !== 'pending') {
    return res.status(409).json({ error: 'Approval assessment is only required for pending loans' });
  }
  res.json(await assessmentForLoan(loan));
});

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

  // Final approval gate: re-run live member financial clearance immediately before
  // any cash-out transaction. This catches arrears/fines/loans that appeared after
  // the original Form request was accepted.
  const assessment = await assessmentForLoan(existingLoan, updates);
  if (!assessment.eligible) {
    return res.status(409).json({
      error: 'Loan cannot be activated because the member no longer passes the live approval checks.',
      approval_blocked: true,
      assessment,
    });
  }

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
  res.json({ ...updated, approval_assessment: assessment });
});

module.exports = router;
