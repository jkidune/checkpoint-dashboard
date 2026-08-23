const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { Member, Loan, getNextId } = require('../db/models');
const { LoanRequestSubmission } = require('../db/loanRequestModels');
const { getRulesForFY } = require('./rules');
const { computeMemberLoanEligibility } = require('../services/memberLoanEligibility');

function normalize(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFiscalYearFromDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  return month >= 3 ? year : year - 1;
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
    purpose: normalize(payload.purpose),
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
  return {
    ...request,
    fiscal_year: fy,
    eligibility,
    exceeds_eligibility: exceeds,
  };
}

// Google Form → safe loan-request inbox. No Loan record is created here.
router.post('/', formAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const memberName = normalize(payload.memberName);
    const amountRequested = Number(payload.amountRequested);
    const requestedDate = normalize(payload.requestedDate) || new Date().toISOString().slice(0, 10);
    const purpose = normalize(payload.purpose) || null;
    const requestedTermMonths = payload.requestedTermMonths == null || payload.requestedTermMonths === ''
      ? null
      : Number(payload.requestedTermMonths);

    if (!memberName || !Number.isFinite(amountRequested) || amountRequested <= 0 || !getFiscalYearFromDate(requestedDate)) {
      return res.status(400).json({ error: 'memberName, positive amountRequested and a valid requestedDate are required' });
    }

    const id = sourceId(payload);
    const existing = await LoanRequestSubmission.findOne({ source_id: id }).lean();
    if (existing) {
      return res.json({ success: true, duplicate_submission: true, request: await enrichRequest(existing) });
    }

    const match = await matchMember(memberName);
    const created = await LoanRequestSubmission.create({
      source_id: id,
      submitted_at: payload.submittedAt ? new Date(payload.submittedAt) : new Date(),
      member_name: memberName,
      matched_member_id: match.member?.id || null,
      match_status: match.status,
      amount_requested: amountRequested,
      requested_date: requestedDate,
      purpose,
      requested_term_months: Number.isFinite(requestedTermMonths) ? requestedTermMonths : null,
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

router.patch('/:id/review', authenticate, requireAdmin, async (req, res) => {
  const status = normalize(req.body.status);
  if (!['pending', 'accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, accepted, or rejected' });
  }
  const existing = await LoanRequestSubmission.findById(req.params.id).lean();
  if (!existing) return res.status(404).json({ error: 'Loan request not found' });
  if (existing.review_status === 'converted') return res.status(409).json({ error: 'Converted requests cannot be returned to review' });

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
  if (request.match_status !== 'matched' || !request.matched_member_id) return res.status(400).json({ error: 'Loan request does not have an unambiguous member match' });

  const fy = getFiscalYearFromDate(request.requested_date);
  const eligibility = await computeMemberLoanEligibility(request.matched_member_id, fy);
  if (!eligibility) return res.status(404).json({ error: 'Member not found' });
  if (eligibility.max_eligible != null && Number(request.amount_requested) > Number(eligibility.max_eligible)) {
    return res.status(400).json({
      error: `Requested loan exceeds the FY${fy} member net-worth limit. Use the manual Issue Loan flow if an override is approved.`,
      requires_override: true,
      eligibility,
    });
  }

  const rules = await getRulesForFY(fy);
  const principal = Number(request.amount_requested);
  const interestRate = Number(rules.loan_interest_rate || 0);
  const interestAmount = Math.round(principal * interestRate);
  const existingCount = await Loan.countDocuments({ member_id: request.matched_member_id, fiscal_year: fy });
  const loanNumber = `Loan ${existingCount + 1}`;

  let dueDate = null;
  if (rules.loan_repayment_months) {
    const due = new Date(`${request.requested_date}T12:00:00Z`);
    due.setUTCMonth(due.getUTCMonth() + Number(rules.loan_repayment_months));
    dueDate = due.toISOString().slice(0, 10);
  }

  const loan = await Loan.create({
    id: await getNextId('loan_id'),
    member_id: request.matched_member_id,
    loan_number: loanNumber,
    principal,
    interest_rate: interestRate,
    interest_amount: interestAmount,
    amount_deposited: principal - interestAmount,
    issued_date: request.requested_date,
    due_date: dueDate,
    status: 'pending',
    fiscal_year: fy,
    disbursed: false,
    notes: [
      request.purpose ? `Loan request purpose: ${request.purpose}` : null,
      request.notes,
      `Created from Google Form loan request ${request.source_id}`,
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

  res.status(201).json({ success: true, loan, eligibility });
});

module.exports = router;
