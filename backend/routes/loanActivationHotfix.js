const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { assessLoanApprovalWithModels } = require('../services/loanApprovalAssessment');

// Escapes text so it can be embedded in a RegExp as an exact literal.
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A loan's disbursement transaction carries the loan's FULL identity in its
// description: "(<loan_number>, FY<fiscal_year>)". This is the same marker that
// routes/loans.js writes and matches and that services/quarterlyReportSnapshot.js
// reads. The fiscal year is part of the identity because loan numbers restart
// every fiscal year (a member's first loan of each year is "Loan 1"), so a loan
// number alone cannot tell one year's loan from another's.
//
// Returns null for a legacy loan that lacks a loan number or a fiscal year: such
// a loan has no identity that can be matched.
function loanDisbursementMarker(loan) {
  return loan.loan_number && loan.fiscal_year != null
    ? `(${loan.loan_number}, FY${loan.fiscal_year})`
    : null;
}

// Model-explicit helper: runs the approval assessment against the same tenant
// DB that the loan lives in, with no fallback to the default connection.
async function assessmentForLoan(models, loan, overrides = {}) {
  return assessLoanApprovalWithModels(models, {
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
  const loan = await req.tenantModels.Loan.findOne({ id }).lean();
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.status !== 'pending') {
    return res.status(409).json({ error: 'Approval assessment is only required for pending loans' });
  }
  res.json(await assessmentForLoan(req.tenantModels, loan));
});

// Intercepts only pending -> active activation so Form-created pending loans become
// real cash outflows at the correct moment. All other PATCH requests fall through
// to the normal loans router.
router.patch('/:id', authenticate, requireAdmin, async (req, res, next) => {
  if (req.body?.status !== 'active') return next();

  const id = parseInt(req.params.id, 10);
  const existingLoan = await req.tenantModels.Loan.findOne({ id }).lean();
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
  const assessment = await assessmentForLoan(req.tenantModels, existingLoan, updates);
  if (!assessment.eligible) {
    return res.status(409).json({
      error: 'Loan cannot be activated because the member no longer passes the live approval checks.',
      approval_blocked: true,
      assessment,
    });
  }

  // Idempotency guard: skip the cash-out only if THIS loan's own disbursement is
  // already recorded (same member and the full loan identity, e.g. left behind by
  // an earlier activation attempt that was interrupted). A disbursement for last
  // year's "Loan 1", or for any other loan of the member, is a different cash-out
  // and must never suppress this one.
  //
  // A legacy loan without a loan number or fiscal year has no identity to match
  // on. We do not guess from the member's other disbursements, which could hide a
  // real cash-out: nothing matches, and the disbursement is recorded.
  const marker = loanDisbursementMarker(existingLoan);
  const existingTx = marker
    ? await req.tenantModels.Transaction.findOne({
        member_id: existingLoan.member_id,
        type: 'loan_disbursement',
        description: new RegExp(escapeRegex(marker), 'i'),
      }).lean()
    : null;

  if (!existingTx) {
    const member = await req.tenantModels.Member.findOne({ id: existingLoan.member_id }).lean();
    const transactionDate = updates.issued_date || existingLoan.issued_date || new Date().toISOString().split('T')[0];
    // Full identity when the loan has one; otherwise label it by loan number or id
    // so the ledger never shows "undefined"/"null". That label has no ", FY<year>"
    // part, so it can never be mistaken for a full-identity marker later.
    const loanLabel = existingLoan.loan_number || `Loan #${existingLoan.id}`;
    await req.tenantModels.Transaction.create({
      id: await req.tenantModels.getNextId('transaction_id'),
      member_id: existingLoan.member_id,
      amount: updates.amount_deposited ?? existingLoan.amount_deposited ?? updates.principal ?? existingLoan.principal,
      type: 'loan_disbursement',
      description: `Loan disbursed — ${member ? member.name : ''} ${marker || `(${loanLabel})`}`,
      transaction_date: transactionDate,
    });
  }

  const updated = await req.tenantModels.Loan.findOneAndUpdate({ id }, { $set: updates }, { new: true }).lean();
  res.json({ ...updated, approval_assessment: assessment });
});

module.exports = router;
