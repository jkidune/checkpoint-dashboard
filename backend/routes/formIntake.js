const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  Member,
  Transaction,
  Contribution,
  Repayment,
  Loan,
  Fine,
  getNextId,
} = require('../db/models');
const { FormIntakeSubmission } = require('../db/formIntakeModels');
const { getRulesForFY } = require('./rules');
const {
  getFiscalYear,
  isContributionLate,
  calculateOneTimeFine,
  finePeriodQuery,
} = require('../services/contributionFinePolicy');

const MONTH_MAP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formAuth(req, res, next) {
  const secret = process.env.FORM_SECRET;
  if (!secret) return res.status(500).json({ error: 'FORM_SECRET not configured on server' });
  if (req.headers['x-form-secret'] !== secret) return res.status(401).json({ error: 'Invalid form secret' });
  next();
}

function normalize(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function duplicateEvidence(reference, session = null) {
  const ref = normalize(reference).toUpperCase();
  if (!ref) return [];
  const options = session ? { session } : {};
  const [transactions, contributions, repayments] = await Promise.all([
    Transaction.find({ reference: ref }, null, options).lean(),
    Contribution.find({ mpesa_ref: ref }, null, options).lean(),
    Repayment.find({ mpesa_ref: ref }, null, options).lean(),
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

function periodFromMonthName(monthName, paymentDate) {
  const month = MONTH_MAP[normalize(monthName).toLowerCase()];
  if (!month) return null;
  const paid = new Date(`${paymentDate}T12:00:00Z`);
  if (Number.isNaN(paid.getTime())) return null;
  let year = paid.getUTCFullYear();
  const paymentMonth = paid.getUTCMonth() + 1;
  // Google Form payments are treated as arrears/current-period payments. If the
  // selected month is later in the calendar than the payment month, use the
  // immediately preceding calendar year rather than posting to a future month.
  if (month > paymentMonth) year -= 1;
  return { month, year, label: `${MONTH_NAMES[month]} ${year}`, fy: getFiscalYear(month, year) };
}

async function buildMonthlyPreview(submission) {
  const uniquePeriods = [];
  const seen = new Set();
  for (const monthName of submission.months || []) {
    const period = periodFromMonthName(monthName, submission.payment_date);
    if (!period) continue;
    const key = `${period.year}-${period.month}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePeriods.push(period);
    }
  }
  uniquePeriods.sort((a, b) => a.year - b.year || a.month - b.month);

  if (!uniquePeriods.length) {
    return { valid: false, type: 'monthly', blocking_errors: ['No valid contribution month was selected.'], allocations: [] };
  }

  let remaining = Number(submission.amount || 0);
  const allocations = [];
  const warnings = [];

  for (const period of uniquePeriods) {
    const [rules, existing, existingFine] = await Promise.all([
      getRulesForFY(period.fy),
      Contribution.findOne({ member_id: submission.matched_member_id, month: period.month, year: period.year }).lean(),
      Fine.findOne(finePeriodQuery(submission.matched_member_id, period.month, period.year)).lean(),
    ]);
    const target = Number(rules.contribution_amount || 0);
    const existingAmount = Number(existing?.amount || 0);
    const due = Math.max(0, target - existingAmount);
    const applied = Math.min(remaining, due);
    remaining -= applied;

    let fineToCreate = null;
    if (applied > 0 && !existingFine && rules.late_fine_enabled && isContributionLate(period.month, period.year, submission.payment_date)) {
      fineToCreate = calculateOneTimeFine(rules, target, period.month, period.year, period.fy);
    }

    allocations.push({
      ...period,
      target,
      existing_contribution_id: existing?.id || null,
      existing_amount: existingAmount,
      amount_due_before: due,
      amount_applied: applied,
      amount_after: existingAmount + applied,
      status_after: existingAmount + applied >= target ? 'paid' : (existingAmount + applied > 0 ? 'partial' : existing?.status || 'missing'),
      existing_fine_id: existingFine?.id || null,
      fine_to_create: fineToCreate,
    });
  }

  const totalApplied = allocations.reduce((sum, item) => sum + item.amount_applied, 0);
  if (allocations.some((item) => item.amount_due_before === 0)) warnings.push('One or more selected months were already fully paid and receive no additional allocation.');
  const blockingErrors = [];
  if (remaining > 0) blockingErrors.push(`TZS ${remaining.toLocaleString('en-US')} remains unallocated. Select additional unpaid month(s) or correct the submitted amount before posting.`);
  if (totalApplied <= 0) blockingErrors.push('The selected contribution months have no outstanding contribution balance.');

  return {
    valid: blockingErrors.length === 0,
    type: 'monthly',
    amount_received: Number(submission.amount || 0),
    amount_allocated: totalApplied,
    unallocated_remainder: remaining,
    allocations,
    warnings,
    blocking_errors: blockingErrors,
  };
}

async function loanCandidates(memberId) {
  const loans = await Loan.find({ member_id: memberId, status: 'active' }).sort({ issued_date: 1 }).lean();
  const rows = [];
  for (const loan of loans) {
    const repayments = await Repayment.find({ loan_id: loan.id }).lean();
    const repaid = repayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const balance = Math.max(0, Number(loan.principal || 0) - repaid);
    if (balance > 0) rows.push({ loan_id: loan.id, loan_number: loan.loan_number || `Loan #${loan.id}`, principal: Number(loan.principal || 0), repaid, balance, due_date: loan.due_date || null });
  }
  return rows;
}

async function buildLoanPreview(submission, selection = {}) {
  const candidates = await loanCandidates(submission.matched_member_id);
  const requestedId = selection.loan_id != null ? Number(selection.loan_id) : null;
  const selected = requestedId ? candidates.find((item) => item.loan_id === requestedId) : (candidates.length === 1 ? candidates[0] : null);
  const blockingErrors = [];
  if (!candidates.length) blockingErrors.push('This member has no active loan with an outstanding principal balance.');
  else if (!selected) blockingErrors.push('Choose which active loan this repayment should be posted to.');
  else if (Number(submission.amount || 0) > selected.balance) blockingErrors.push(`Payment exceeds the selected loan balance by TZS ${(Number(submission.amount || 0) - selected.balance).toLocaleString('en-US')}.`);

  return {
    valid: blockingErrors.length === 0,
    type: 'loan_repayment',
    amount_received: Number(submission.amount || 0),
    candidates,
    selected: selected ? { ...selected, amount_applied: Number(submission.amount || 0), balance_after: selected.balance - Number(submission.amount || 0) } : null,
    blocking_errors: blockingErrors,
    warnings: [],
  };
}

async function fineCandidates(memberId) {
  return Fine.find({ member_id: memberId, status: 'unpaid' }).sort({ created_at: 1 }).lean();
}

async function buildFinePreview(submission, selection = {}) {
  const candidates = await fineCandidates(submission.matched_member_id);
  const requestedId = selection.fine_id != null ? Number(selection.fine_id) : null;
  const selected = requestedId ? candidates.find((item) => item.id === requestedId) : (candidates.length === 1 ? candidates[0] : null);
  const blockingErrors = [];
  if (!candidates.length) blockingErrors.push('This member has no unpaid fine.');
  else if (!selected) blockingErrors.push('Choose the exact unpaid fine this payment should settle.');
  else if (Number(submission.amount || 0) !== Number(selected.amount || 0)) blockingErrors.push(`Fine payments must settle the selected fine in full. Selected fine: TZS ${Number(selected.amount || 0).toLocaleString('en-US')}; submitted payment: TZS ${Number(submission.amount || 0).toLocaleString('en-US')}.`);

  return {
    valid: blockingErrors.length === 0,
    type: 'fine',
    amount_received: Number(submission.amount || 0),
    candidates: candidates.map((fine) => ({ id: fine.id, amount: fine.amount, reason: fine.reason, contribution_month: fine.contribution_month, contribution_year: fine.contribution_year, created_at: fine.created_at })),
    selected: selected ? { id: selected.id, amount: selected.amount, reason: selected.reason, contribution_month: selected.contribution_month, contribution_year: selected.contribution_year } : null,
    blocking_errors: blockingErrors,
    warnings: [],
  };
}

async function buildPostingPreview(submission, selection = {}) {
  const baseErrors = [];
  if (!submission) baseErrors.push('Submission not found.');
  if (submission?.match_status !== 'matched' || !submission?.matched_member_id) baseErrors.push('The submission must have an unambiguous member match before posting.');
  if (!normalize(submission?.mpesa_ref)) baseErrors.push('A payment reference is required before posting.');
  if (submission?.posted || submission?.posting_status === 'posted') baseErrors.push('This submission has already been posted.');

  const duplicates = submission?.mpesa_ref ? await duplicateEvidence(submission.mpesa_ref) : [];
  if (duplicates.length) baseErrors.push('The payment reference already exists in the financial ledger. Posting is blocked to prevent a duplicate receipt.');

  let detail = { valid: false, blocking_errors: [] };
  if (submission?.type === 'monthly') detail = await buildMonthlyPreview(submission);
  else if (submission?.type === 'loan_repayment') detail = await buildLoanPreview(submission, selection);
  else if (submission?.type === 'fine') detail = await buildFinePreview(submission, selection);

  const blockingErrors = [...baseErrors, ...(detail.blocking_errors || [])];
  return {
    ...detail,
    valid: blockingErrors.length === 0,
    blocking_errors: blockingErrors,
    duplicate_matches: duplicates,
    submission: submission ? {
      id: submission._id,
      member_id: submission.matched_member_id,
      member_name: submission.member_name,
      amount: submission.amount,
      payment_date: submission.payment_date,
      mpesa_ref: submission.mpesa_ref,
      type: submission.type,
      months: submission.months,
      review_status: submission.review_status,
    } : null,
    selection: {
      loan_id: selection.loan_id != null ? Number(selection.loan_id) : null,
      fine_id: selection.fine_id != null ? Number(selection.fine_id) : null,
    },
  };
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
  if (!['accepted', 'rejected', 'pending', 'needs_review'].includes(status)) return res.status(400).json({ error: 'status must be pending, accepted, needs_review, or rejected' });
  const current = await FormIntakeSubmission.findById(req.params.id).lean();
  if (!current) return res.status(404).json({ error: 'Submission not found' });
  if (current.posted || current.posting_status === 'posted') return res.status(409).json({ error: 'Posted submissions cannot be returned to review.' });
  if (status === 'accepted') {
    if (current.match_status !== 'matched' || !current.matched_member_id) return res.status(409).json({ error: 'Resolve the member match before accepting this submission.' });
    const duplicates = current.mpesa_ref ? await duplicateEvidence(current.mpesa_ref) : [];
    if (duplicates.length) return res.status(409).json({ error: 'This payment reference already exists in the ledger. Resolve the duplicate before accepting.' });
  }

  const updated = await FormIntakeSubmission.findByIdAndUpdate(
    req.params.id,
    { $set: {
      review_status: status,
      review_note: normalize(req.body.note) || null,
      reviewed_by: req.user.name || req.user.username || 'admin',
      reviewed_at: status === 'pending' ? null : new Date(),
      posting_status: status === 'pending' ? 'unposted' : current.posting_status,
    } },
    { new: true }
  ).lean();
  res.json(updated);
});

router.post('/:id/preview', authenticate, requireAdmin, async (req, res) => {
  const submission = await FormIntakeSubmission.findById(req.params.id).lean();
  if (!submission) return res.status(404).json({ error: 'Submission not found' });
  if (submission.review_status !== 'accepted') return res.status(409).json({ error: 'Accept the submission before reviewing its financial allocation.' });
  const preview = await buildPostingPreview(submission, req.body || {});
  res.json(preview);
});

router.post('/:id/post', authenticate, requireAdmin, async (req, res) => {
  const selection = req.body || {};
  const submission = await FormIntakeSubmission.findById(req.params.id).lean();
  if (!submission) return res.status(404).json({ error: 'Submission not found' });
  if (submission.posted || submission.posting_status === 'posted') return res.status(200).json({ success: true, already_posted: true, posting_result: submission.posting_result });
  if (submission.review_status !== 'accepted') return res.status(409).json({ error: 'Submission must be accepted before posting.' });

  const preview = await buildPostingPreview(submission, selection);
  if (!preview.valid) {
    await FormIntakeSubmission.findByIdAndUpdate(submission._id, { $set: { review_status: 'needs_review', allocation_snapshot: preview, posting_error: preview.blocking_errors.join(' ') } });
    return res.status(409).json({ error: 'Allocation cannot be posted yet.', preview });
  }

  const claimed = await FormIntakeSubmission.findOneAndUpdate(
    { _id: submission._id, posted: false, posting_status: { $ne: 'posting' } },
    { $set: { posting_status: 'posting', allocation_snapshot: preview, posting_error: null } },
    { new: true },
  ).lean();
  if (!claimed) return res.status(409).json({ error: 'This submission is already being posted. Refresh before trying again.' });

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const fresh = await FormIntakeSubmission.findById(submission._id, null, { session }).lean();
      if (!fresh || fresh.posted) {
        result = fresh?.posting_result || null;
        return;
      }

      const duplicateCheck = await duplicateEvidence(fresh.mpesa_ref, session);
      if (duplicateCheck.length) throw new Error('Payment reference was posted elsewhere before this confirmation completed. Posting stopped.');

      const memberId = fresh.matched_member_id;
      const paymentDate = fresh.payment_date;
      const reference = normalize(fresh.mpesa_ref).toUpperCase();
      const actor = req.user.name || req.user.username || 'admin';
      const noteBase = fresh.notes ? `${fresh.notes} | Form intake ${fresh.source_id}` : `Form intake ${fresh.source_id}`;
      const created = { contributions: [], fines: [], repayment: null, fine_payment: null, transaction: null };

      if (fresh.type === 'monthly') {
        for (const item of preview.allocations.filter((entry) => entry.amount_applied > 0)) {
          let contribution;
          if (item.existing_contribution_id) {
            contribution = await Contribution.findOneAndUpdate(
              { id: item.existing_contribution_id },
              { $set: {
                amount: item.amount_after,
                status: item.status_after,
                paid_date: paymentDate,
                mpesa_ref: reference,
                notes: noteBase,
              } },
              { new: true, session },
            );
          } else {
            [contribution] = await Contribution.create([{
              id: await getNextId('contribution_id'),
              member_id: memberId,
              amount: item.amount_applied,
              month: item.month,
              year: item.year,
              status: item.status_after,
              paid_date: paymentDate,
              mpesa_ref: reference,
              notes: noteBase,
            }], { session });
          }
          created.contributions.push({ id: contribution.id, month: item.month, year: item.year, amount_applied: item.amount_applied, amount_after: item.amount_after, status: item.status_after });

          if (item.fine_to_create && !item.existing_fine_id) {
            const exists = await Fine.findOne(finePeriodQuery(memberId, item.month, item.year), null, { session }).lean();
            if (!exists) {
              const [fine] = await Fine.create([{
                id: await getNextId('fine_id'),
                member_id: memberId,
                amount: item.fine_to_create.amount,
                reason: item.fine_to_create.reason,
                year: item.fy,
                contribution_month: item.month,
                contribution_year: item.year,
                status: 'unpaid',
                notes: `Generated from ${fresh.source_id}`,
              }], { session });
              created.fines.push({ id: fine.id, amount: fine.amount, month: item.month, year: item.year });
            }
          }
        }

        const labels = preview.allocations.filter((entry) => entry.amount_applied > 0).map((entry) => entry.label).join(', ');
        [created.transaction] = await Transaction.create([{
          id: await getNextId('transaction_id'),
          member_id: memberId,
          amount: Number(fresh.amount),
          type: 'contribution',
          description: `Form payment allocated to contributions: ${labels}`,
          reference,
          transaction_date: paymentDate,
        }], { session });
      }

      if (fresh.type === 'loan_repayment') {
        const selected = preview.selected;
        const [repayment] = await Repayment.create([{
          id: await getNextId('repayment_id'),
          loan_id: selected.loan_id,
          amount: Number(fresh.amount),
          repayment_date: paymentDate,
          mpesa_ref: reference,
          notes: noteBase,
        }], { session });
        created.repayment = { id: repayment.id, loan_id: selected.loan_id, amount: repayment.amount };

        if (selected.balance_after <= 0) {
          await Loan.updateOne({ id: selected.loan_id }, { $set: { status: 'repaid' } }, { session });
        }

        [created.transaction] = await Transaction.create([{
          id: await getNextId('transaction_id'),
          member_id: memberId,
          amount: Number(fresh.amount),
          type: 'loan_repayment',
          description: `Loan repayment — ${selected.loan_number} (Form intake)`,
          reference,
          transaction_date: paymentDate,
        }], { session });
      }

      if (fresh.type === 'fine') {
        const selected = preview.selected;
        const fine = await Fine.findOneAndUpdate(
          { id: selected.id, member_id: memberId, status: 'unpaid' },
          { $set: { status: 'paid', paid_date: paymentDate, notes: noteBase } },
          { new: true, session },
        );
        if (!fine) throw new Error('The selected fine is no longer unpaid. Refresh the allocation preview.');
        created.fine_payment = { id: fine.id, amount: fine.amount };

        [created.transaction] = await Transaction.create([{
          id: await getNextId('transaction_id'),
          member_id: memberId,
          amount: Number(fresh.amount),
          type: 'fine_payment',
          description: `Fine payment — ${fine.reason} (Form intake)`,
          reference,
          transaction_date: paymentDate,
        }], { session });
      }

      result = {
        intake_id: String(fresh._id),
        source_id: fresh.source_id,
        member_id: memberId,
        type: fresh.type,
        amount: Number(fresh.amount),
        reference,
        payment_date: paymentDate,
        posted_by: actor,
        records: created,
      };

      await FormIntakeSubmission.updateOne(
        { _id: fresh._id },
        { $set: {
          review_status: 'posted',
          posting_status: 'posted',
          posted: true,
          posted_by: actor,
          posted_at: new Date(),
          posting_result: result,
          posting_error: null,
        } },
        { session },
      );
    });

    res.json({ success: true, posted: true, result });
  } catch (error) {
    console.error('[forms/intake/post]', error);
    await FormIntakeSubmission.findByIdAndUpdate(submission._id, { $set: { posting_status: 'failed', review_status: 'needs_review', posting_error: error.message } });
    res.status(409).json({ error: error.message || 'Failed to post intake submission' });
  } finally {
    await session.endSession();
  }
});

module.exports = router;
