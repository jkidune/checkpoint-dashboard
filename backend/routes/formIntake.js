const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { Member, Transaction, Contribution, Repayment } = require('../db/models');
const { FormIntakeSubmission } = require('../db/formIntakeModels');

function formAuth(req, res, next) {
  const secret = process.env.FORM_SECRET;
  if (!secret) return res.status(500).json({ error: 'FORM_SECRET not configured on server' });
  if (req.headers['x-form-secret'] !== secret) return res.status(401).json({ error: 'Invalid form secret' });
  next();
}

function normalize(value) {
  return String(value || '').trim();
}

async function matchMember(memberName) {
  const submitted = normalize(memberName);
  if (!submitted) return { member: null, status: 'unmatched' };

  const exact = await Member.findOne({ name: new RegExp(`^${submitted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
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

async function duplicateEvidence(reference) {
  const ref = normalize(reference);
  if (!ref) return [];
  const [transactions, contributions, repayments] = await Promise.all([
    Transaction.find({ reference: ref }).lean(),
    Contribution.find({ mpesa_ref: ref }).lean(),
    Repayment.find({ mpesa_ref: ref }).lean(),
  ]);
  return [
    ...transactions.map((item) => ({ collection: 'transactions', id: item.id, amount: item.amount, type: item.type, date: item.transaction_date })),
    ...contributions.map((item) => ({ collection: 'contributions', id: item.id, amount: item.amount, month: item.month, year: item.year })),
    ...repayments.map((item) => ({ collection: 'repayments', id: item.id, amount: item.amount, loan_id: item.loan_id, date: item.repayment_date })),
  ];
}

function sourceId(payload) {
  if (payload.sourceId) return normalize(payload.sourceId);
  const canonical = JSON.stringify({
    memberName: normalize(payload.memberName).toLowerCase(),
    amount: Number(payload.amount || 0),
    date: normalize(payload.date),
    type: normalize(payload.type),
    months: Array.isArray(payload.months) ? payload.months.map(normalize) : [],
    mpesaRef: normalize(payload.mpesaRef).toUpperCase(),
    submittedAt: normalize(payload.submittedAt),
  });
  return `generated:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

router.post('/', formAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const memberName = normalize(payload.memberName);
    const amount = Number(payload.amount);
    const paymentDate = normalize(payload.date);
    const type = normalize(payload.type);
    const months = Array.isArray(payload.months) ? payload.months.map(normalize).filter(Boolean) : [];
    const mpesaRef = normalize(payload.mpesaRef).toUpperCase() || null;

    if (!memberName || !Number.isFinite(amount) || amount <= 0 || !paymentDate || !['monthly', 'loan_repayment', 'fine'].includes(type)) {
      return res.status(400).json({ error: 'memberName, positive amount, date and a supported type are required' });
    }

    const id = sourceId(payload);
    const existing = await FormIntakeSubmission.findOne({ source_id: id }).lean();
    if (existing) return res.status(200).json({ success: true, duplicate_submission: true, submission: existing });

    const [match, duplicates] = await Promise.all([matchMember(memberName), duplicateEvidence(mpesaRef)]);
    const submission = await FormIntakeSubmission.create({
      source_id: id,
      submitted_at: payload.submittedAt ? new Date(payload.submittedAt) : new Date(),
      member_name: memberName,
      matched_member_id: match.member?.id || null,
      match_status: match.status,
      amount,
      payment_date: paymentDate,
      type,
      months,
      mpesa_ref: mpesaRef,
      notes: normalize(payload.notes) || null,
      duplicate_reference: duplicates.length > 0,
      duplicate_matches: duplicates,
      source_payload: payload,
    });

    res.status(201).json({
      success: true,
      staged: true,
      message: 'Submission received for Admin review. No financial records were changed.',
      submission: {
        id: submission._id,
        source_id: submission.source_id,
        member_name: submission.member_name,
        matched_member_id: submission.matched_member_id,
        match_status: submission.match_status,
        duplicate_reference: submission.duplicate_reference,
        review_status: submission.review_status,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await FormIntakeSubmission.findOne({ source_id: sourceId(req.body || {}) }).lean();
      return res.json({ success: true, duplicate_submission: true, submission: existing });
    }
    console.error('[forms/intake]', error);
    res.status(500).json({ error: 'Failed to stage form submission' });
  }
});

router.get('/', authenticate, requireAdmin, async (req, res) => {
  const query = {};
  if (req.query.status && req.query.status !== 'all') query.review_status = req.query.status;
  const list = await FormIntakeSubmission.find(query).sort({ created_at: -1 }).limit(250).lean();
  res.json(list);
});

router.patch('/:id/review', authenticate, requireAdmin, async (req, res) => {
  const status = String(req.body.status || '');
  if (!['accepted', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'status must be pending, accepted, or rejected' });
  const updated = await FormIntakeSubmission.findByIdAndUpdate(
    req.params.id,
    { $set: { review_status: status, review_note: normalize(req.body.note) || null, reviewed_by: req.user.name || req.user.username || 'admin', reviewed_at: status === 'pending' ? null : new Date() } },
    { new: true }
  ).lean();
  if (!updated) return res.status(404).json({ error: 'Submission not found' });
  res.json(updated);
});

module.exports = router;
