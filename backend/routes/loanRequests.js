const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { Member, Loan, getNextId } = require('../db/models');
const { LoanRequestSubmission } = require('../db/loanRequestModels');
const { computeMemberLoanEligibility } = require('../services/memberLoanEligibility');
const { assessLoanApproval, fiscalYearFromDate } = require('../services/loanApprovalAssessment');

function normalize(value) {
  return String(value || '').trim();
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableBoolean(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const text = normalize(value).toLowerCase();
  if (['ndio', 'yes', 'true', '1'].includes(text)) return true;
  if (['hapana', 'no', 'false', '0'].includes(text)) return false;
  return null;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFiscalYearFromDate(value) {
  try {
    return fiscalYearFromDate(value);
  } catch (_) {
    return null;
  }
}

function formAuth(req, res, next) {
  const secret = process.env.FORM_SECRET;
  if (!secret) return res.status(500).json({ error: 'FORM_SECRET not configured on server' });
  if (req.headers['x-form-secret'] !== secret) return res.status(401).json({ error: 'Invalid form secret' });
  next();
}

async function matchMember(memberName) {
  const submitted = normalize(memberName);
  if (!submitted) return { member: null, status: 'unmatched' };

  const exact = await Member.findOne({ name: new RegExp(`^${escapeRegex(submitted)}$`, 'i') }).lean();
  if (exact) return { member: exact, status: 'matched' };

  const active = await Member.find({ status: 'active' }).lean();
  const words = submitted.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = active.map((member) => {
    const memberWords = String(member.name || '').toLowerCase().split(/\s+/).filter(Boolean);
    const score = words.filter((word) => memberWords.some((candidate) => candidate === word || candidate.startsWith(word) || word.startsWith(candidate))).length;
    return { member, score };
  }).sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score < 2) return { member: null, status: 'unmatched' };
  if (scored[1] && scored[1].score === scored[0].score) return { member: null, status: 'ambiguous' };
  return { member: scored[0].member, status: 'matched' };
}

function sourceId(payload) {
  if (payload.sourceId) return normalize(payload.sourceId);
  const canonical = JSON.stringify({
    memberName: normalize(payload.memberName).toLowerCase(),
    amountRequested: Number(payload.amountRequested || 0),
    requestedDate: normalize(payload.requestedDate),
    submittedAt: normalize(payload.submittedAt),
  });
  return `loan-request:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

async function enrichRequest(request) {
  const fy = getFiscalYearFromDate(request.requested_date);
  let eligibility = null;
  if (request.match_status === 'matched' && request.matched_member_id && fy) {
    eligibility = await computeMemberLoanEligibility(request.matched_member_id, fy);
  }

  const requested = Number(request.amount_requested || 0);
  const exceeds = eligibility?.max_eligible != null && requested > Number(eligibility.max_eligible || 0);
  const expectedInterest = eligibility ? Math.round(requested * Number(eligibility.interest_rate || 0)) : null;
  const submittedInterest = nullableNumber(request.submitted_interest_amount);
  const interestMatches = submittedInterest == null || expectedInterest == null
    ? null
    : submittedInterest === expectedInterest;

  const activeLoanCount = request.matched_member_id
    ? await Loan.countDocuments({ member_id: request.matched_member_id, status: { $in: ['active', 'overdue'] } })
    : null;

  const reviewWarnings = [];
  if (interestMatches === false) reviewWarnings.push('Submitted Form interest does not match the authoritative FY interest calculation.');
  if (request.committee_approved !== true) reviewWarnings.push('Executive committee approval is not confirmed on the Form.');
  if (request.oath_accepted !== true) reviewWarnings.push('Repayment oath acceptance is not confirmed on the Form.');
  if (request.has_other_debt === false && activeLoanCount > 0) reviewWarnings.push('The Form says there is no other debt, but Checkpoint has an active/overdue loan for this member.');
  if (request.has_other_debt === true && activeLoanCount === 0) reviewWarnings.push('The Form says there is another debt, but Checkpoint has no active/overdue loan for this member.');

  return {
    ...request,
    fiscal_year: fy,
    eligibility,
    exceeds_eligibility: exceeds,
    expected_interest_amount: expectedInterest,
    submitted_interest_matches_rule: interestMatches,
    active_loan_count: activeLoanCount,
    review_warnings: reviewWarnings,
  };
}

async function buildRequestAssessment(request) {
  const fy = getFiscalYearFromDate(request.requested_date);
  let assessment;

  if (request.match_status !== 'matched' || !request.matched_member_id) {
    assessment = {
      assessment_date: new Date().toISOString().slice(0, 10),
      loan_date: request.requested_date,
      fiscal_year: fy,
      eligible: false,
      member: null,
      eligibility: null,
      contribution_clearance: null,
      unpaid_fines: [],
      unpaid_fines_total: 0,
      active_loans: [],
      active_loan_balance: 0,
      pending_loans: [],
      pending_loan_principal: 0,
      loan_calculation: null,
      blockers: [{ code: 'member_match', message: 'The Form applicant must be matched to one Checkpoint member before acceptance.' }],
      warnings: [],
    };
  } else {
    assessment = await assessLoanApproval({
      memberId: request.matched_member_id,
      principal: request.amount_requested,
      loanDate: request.requested_date,
      fiscalYear: fy,
      assessmentDate: new Date(),
      excludeLoanId: request.linked_loan_id || null,
    });
  }

  const blockers = [...(assessment.blockers || [])];
  const warnings = [...(assessment.warnings || [])];
  const calculation = assessment.loan_calculation;

  if (request.committee_approved !== true) {
    blockers.push({
      code: 'committee_approval_missing',
      message: request.committee_approved === false
        ? 'The applicant indicated that the executive committee has not approved the request.'
        : 'Executive committee approval is not confirmed on the submitted Form.',
    });
  }
  if (request.oath_accepted !== true) {
    blockers.push({
      code: 'repayment_oath_missing',
      message: request.oath_accepted === false
        ? 'The applicant did not accept the repayment oath.'
        : 'Repayment oath acceptance is not confirmed on the submitted Form.',
    });
  }

  if (calculation) {
    const submittedInterest = nullableNumber(request.submitted_interest_amount);
    if (submittedInterest != null && submittedInterest !== Number(calculation.interest_amount || 0)) {
      warnings.push({
        code: 'interest_mismatch',
        message: `Form interest is TZS ${submittedInterest.toLocaleString('en-US')}; Checkpoint calculates TZS ${Number(calculation.interest_amount || 0).toLocaleString('en-US')}. Checkpoint remains authoritative.`,
      });
    }

    const submittedTerm = nullableNumber(request.requested_term_months);
    if (submittedTerm != null && calculation.repayment_months != null && submittedTerm !== Number(calculation.repayment_months)) {
      warnings.push({
        code: 'term_mismatch',
        message: `Form repayment term is ${submittedTerm} month(s); FY${assessment.fiscal_year} rule is ${calculation.repayment_months} month(s).`,
      });
    }

    const submittedMonthly = nullableNumber(request.submitted_monthly_repayment);
    if (submittedMonthly != null && calculation.indicative_monthly_repayment != null && submittedMonthly !== Number(calculation.indicative_monthly_repayment)) {
      warnings.push({
        code: 'monthly_repayment_mismatch',
        message: `Form monthly repayment is TZS ${submittedMonthly.toLocaleString('en-US')}; Checkpoint indicative repayment is TZS ${Number(calculation.indicative_monthly_repayment).toLocaleString('en-US')}.`,
      });
    }
  }

  const systemHasDebt = Number(assessment.active_loan_balance || 0) > 0 || Number(assessment.pending_loan_principal || 0) > 0;
  if (request.has_other_debt === false && systemHasDebt) {
    warnings.push({ code: 'debt_declaration_mismatch', message: 'The Form says there is no other debt, while Checkpoint shows an outstanding/pending loan.' });
  }
  if (request.has_other_debt === true && !systemHasDebt) {
    warnings.push({ code: 'debt_declaration_unverified', message: 'The Form declares another debt, but Checkpoint does not show an outstanding/pending Checkpoint loan.' });
  }
  if (!request.disbursement_phone) {
    warnings.push({ code: 'missing_disbursement_phone', message: 'No loan disbursement phone/account was provided on the Form.' });
  }

  return {
    ...assessment,
    eligible: blockers.length === 0,
    blockers,
    warnings,
    form_checks: {
      committee_approved: request.committee_approved,
      oath_accepted: request.oath_accepted,
      has_other_debt: request.has_other_debt,
      submitted_interest_amount: nullableNumber(request.submitted_interest_amount),
      submitted_monthly_repayment: nullableNumber(request.submitted_monthly_repayment),
      submitted_term_months: nullableNumber(request.requested_term_months),
    },
  };
}

// Google Form → safe loan-request inbox. No Loan record is created here.
router.post('/', formAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const memberName = normalize(payload.memberName);
    const amountRequested = Number(payload.amountRequested);
    const requestedDate = normalize(payload.requestedDate) || new Date().toISOString().slice(0, 10);
    const requestedTermMonths = payload.requestedTermMonths == null || payload.requestedTermMonths === ''
      ? null
      : Number(payload.requestedTermMonths);

    if (!memberName || !Number.isFinite(amountRequested) || amountRequested <= 0 || !getFiscalYearFromDate(requestedDate)) {
      return res.status(400).json({ error: 'memberName, positive amountRequested and a valid requestedDate are required' });
    }

    const id = sourceId(payload);
    const existing = await LoanRequestSubmission.findOne({ source_id: id }).lean();
    if (existing) return res.json({ success: true, duplicate_submission: true, request: await enrichRequest(existing) });

    const match = await matchMember(memberName);
    const created = await LoanRequestSubmission.create({
      source_id: id,
      submitted_at: payload.submittedAt ? new Date(payload.submittedAt) : new Date(),
      member_name: memberName,
      matched_member_id: match.member?.id || null,
      match_status: match.status,
      amount_requested: amountRequested,
      requested_date: requestedDate,
      purpose: normalize(payload.purpose) || null,
      requested_term_months: Number.isFinite(requestedTermMonths) ? requestedTermMonths : null,
      submitted_interest_amount: nullableNumber(payload.submittedInterestAmount),
      submitted_monthly_repayment: nullableNumber(payload.submittedMonthlyRepayment),
      has_other_debt: nullableBoolean(payload.hasOtherDebt),
      last_loan_month: normalize(payload.lastLoanMonth) || null,
      last_loan_amount: nullableNumber(payload.lastLoanAmount),
      repayments_completed_by: normalize(payload.repaymentsCompletedBy) || null,
      committee_approved: nullableBoolean(payload.committeeApproved),
      disbursement_phone: normalize(payload.disbursementPhone) || null,
      oath_accepted: nullableBoolean(payload.oathAccepted),
      notes: normalize(payload.notes) || null,
      source_payload: payload,
    });

    res.status(201).json({
      success: true,
      staged: true,
      message: 'Loan request received for Admin review. No loan was created or disbursed.',
      request: await enrichRequest(created.toObject()),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await LoanRequestSubmission.findOne({ source_id: sourceId(req.body || {}) }).lean();
      return res.json({ success: true, duplicate_submission: true, request: existing ? await enrichRequest(existing) : null });
    }
    console.error('[forms/loan-request]', error);
    res.status(500).json({ error: 'Failed to stage loan request' });
  }
});

router.get('/', authenticate, requireAdmin, async (req, res) => {
  const query = {};
  if (req.query.status && req.query.status !== 'all') query.review_status = req.query.status;
  const rows = await LoanRequestSubmission.find(query).sort({ created_at: -1 }).limit(250).lean();
  res.json(await Promise.all(rows.map(enrichRequest)));
});

// Detailed live financial workbench. Nothing is approved or posted by this read.
router.get('/:id/workbench', authenticate, requireAdmin, async (req, res) => {
  const request = await LoanRequestSubmission.findById(req.params.id).lean();
  if (!request) return res.status(404).json({ error: 'Loan request not found' });
  const [enriched, assessment] = await Promise.all([
    enrichRequest(request),
    buildRequestAssessment(request),
  ]);
  res.json({ request: enriched, assessment });
});

router.patch('/:id/review', authenticate, requireAdmin, async (req, res) => {
  const status = normalize(req.body.status);
  if (!['pending', 'accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, accepted, or rejected' });
  }
  const existing = await LoanRequestSubmission.findById(req.params.id).lean();
  if (!existing) return res.status(404).json({ error: 'Loan request not found' });
  if (existing.review_status === 'converted') return res.status(409).json({ error: 'Converted requests cannot be returned to review' });

  if (status === 'accepted') {
    const assessment = await buildRequestAssessment(existing);
    if (!assessment.eligible) {
      return res.status(409).json({
        error: 'Loan request cannot be accepted until all blocking clearance items are resolved.',
        approval_blocked: true,
        assessment,
      });
    }
  }

  const updated = await LoanRequestSubmission.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        review_status: status,
        review_note: normalize(req.body.note) || null,
        reviewed_by: req.user.name || req.user.username || 'admin',
        reviewed_at: status === 'pending' ? null : new Date(),
      },
    },
    { new: true },
  ).lean();
  res.json(await enrichRequest(updated));
});

// Accepted request → pending Loan record. Still no disbursement transaction.
router.post('/:id/convert', authenticate, requireAdmin, async (req, res) => {
  const request = await LoanRequestSubmission.findById(req.params.id).lean();
  if (!request) return res.status(404).json({ error: 'Loan request not found' });
  if (request.linked_loan_id) {
    const existingLoan = await Loan.findOne({ id: request.linked_loan_id }).lean();
    return res.json({ success: true, already_converted: true, loan: existingLoan });
  }
  if (request.review_status !== 'accepted') return res.status(409).json({ error: 'Accept the loan request before creating a pending loan' });

  const assessment = await buildRequestAssessment(request);
  if (!assessment.eligible) {
    return res.status(409).json({
      error: 'Loan request no longer passes live approval checks. Resolve the blocking items before creating a pending loan.',
      approval_blocked: true,
      assessment,
    });
  }

  const calculation = assessment.loan_calculation;
  const fy = assessment.fiscal_year;
  const principal = Number(calculation.principal);
  const existingCount = await Loan.countDocuments({ member_id: request.matched_member_id, fiscal_year: fy });
  const loanNumber = `Loan ${existingCount + 1}`;

  const loan = await Loan.create({
    id: await getNextId('loan_id'),
    member_id: request.matched_member_id,
    loan_number: loanNumber,
    principal,
    interest_rate: Number(calculation.interest_rate || 0),
    interest_amount: Number(calculation.interest_amount || 0),
    amount_deposited: Number(calculation.net_disbursement || 0),
    issued_date: request.requested_date,
    due_date: calculation.due_date,
    status: 'pending',
    fiscal_year: fy,
    disbursed: false,
    notes: [
      request.purpose ? `Purpose: ${request.purpose}` : null,
      request.disbursement_phone ? `Disbursement phone: ${request.disbursement_phone}` : null,
      request.requested_term_months ? `Form repayment term: ${request.requested_term_months} months` : null,
      request.last_loan_month ? `Previous loan month: ${request.last_loan_month}` : null,
      request.last_loan_amount != null ? `Previous loan amount: TZS ${Number(request.last_loan_amount).toLocaleString('en-US')}` : null,
      request.repayments_completed_by ? `Previous repayments completed: ${request.repayments_completed_by}` : null,
      `Created from Google Form loan request ${request.source_id}`,
      `Approval checks passed ${assessment.assessment_date}`,
    ].filter(Boolean).join(' | '),
  });

  await LoanRequestSubmission.findByIdAndUpdate(req.params.id, {
    $set: {
      review_status: 'converted',
      linked_loan_id: loan.id,
      reviewed_by: req.user.name || req.user.username || 'admin',
      reviewed_at: new Date(),
    },
  });

  res.status(201).json({ success: true, loan, assessment });
});

module.exports = router;
