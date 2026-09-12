const express = require('express');
const crypto = require('crypto');
const { Member, Contribution, Fine } = require('../db/models');

const router = express.Router();
const TOKEN_SHA256 = '7e849dedbdc57ee0b195eb57c44794d2000f5b285c1f603a4c3358c30f5469b2';

function authorized(req) {
  const token = String(req.query.token || '');
  if (!token) return false;
  const actual = crypto.createHash('sha256').update(token).digest('hex');
  const expectedBuffer = Buffer.from(TOKEN_SHA256, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function dateValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(value) {
  const date = dateValue(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function periodLabel(month, year) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function parsePeriodFromKey(key) {
  const match = String(key || '').match(/^auto-late:\d+:(\d{4})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function contributionExistedWhenFineIssued(row, fineCreatedAt) {
  const createdAt = dateValue(row.created_at);
  if (createdAt && fineCreatedAt && createdAt <= fineCreatedAt) return true;

  const paidAt = row.paid_date ? dateValue(`${row.paid_date}T12:00:00Z`) : null;
  return Boolean(paidAt && fineCreatedAt && paidAt <= fineCreatedAt);
}

function classifyFine(fine, contributions) {
  const period = fine.contribution_month && fine.contribution_year
    ? { month: Number(fine.contribution_month), year: Number(fine.contribution_year) }
    : parsePeriodFromKey(fine.reconciliation_key);

  if (!period) {
    return {
      classification: 'manual_review_no_period',
      erroneous: false,
      period: null,
      contributions: [],
      reason: 'Automatic fine has no usable contribution period.',
    };
  }

  const rows = contributions.filter((row) => Number(row.member_id) === Number(fine.member_id)
    && Number(row.month) === period.month
    && Number(row.year) === period.year);

  if (!rows.length) {
    return {
      classification: 'keep_missing_month',
      erroneous: false,
      period,
      contributions: [],
      reason: 'No contribution record currently exists for this period.',
    };
  }

  const fineCreatedAt = dateValue(fine.created_at);
  const oldDateBasedMarker = String(fine.notes || '').includes('Contribution was completed after the deadline');
  const existedAtIssue = rows.some((row) => contributionExistedWhenFineIssued(row, fineCreatedAt));

  if (oldDateBasedMarker) {
    return {
      classification: 'remove_false_date_based',
      erroneous: true,
      period,
      contributions: rows,
      reason: 'Old automation explicitly fined a contribution that was already complete because of paid_date.',
    };
  }

  if (existedAtIssue) {
    return {
      classification: 'remove_contribution_already_existed',
      erroneous: true,
      period,
      contributions: rows,
      reason: 'A contribution record/payment already existed when the automatic fine was issued.',
    };
  }

  return {
    classification: 'keep_contribution_added_after_fine',
    erroneous: false,
    period,
    contributions: rows,
    reason: 'Contribution appears to have been recorded/paid after the fine was issued; fine may have been valid at issuance.',
  };
}

function snapshot(fine, member, assessment) {
  return {
    fine_id: fine.id,
    member_id: fine.member_id,
    member_name: member?.name || null,
    amount: Number(fine.amount || 0),
    status: fine.status,
    paid_date: fine.paid_date || null,
    period: assessment.period
      ? periodLabel(assessment.period.month, assessment.period.year)
      : null,
    created_at: dateKey(fine.created_at),
    reconciliation_key: fine.reconciliation_key,
    reason: fine.reason,
    classification: assessment.classification,
    assessment_reason: assessment.reason,
    contribution_evidence: assessment.contributions.map((row) => ({
      contribution_id: row.id,
      amount: Number(row.amount || 0),
      status: row.status,
      paid_date: row.paid_date || null,
      created_at: dateKey(row.created_at),
      mpesa_ref: row.mpesa_ref || null,
    })),
  };
}

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (process.env.VERCEL_ENV !== 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [members, contributions, automaticFines] = await Promise.all([
      Member.find().lean(),
      Contribution.find().lean(),
      Fine.find({ reconciliation_key: /^auto-late:/ }).sort({ created_at: 1 }).lean(),
    ]);

    const memberMap = new Map(members.map((member) => [Number(member.id), member]));
    const assessed = automaticFines.map((fine) => {
      const assessment = classifyFine(fine, contributions);
      return {
        fine,
        assessment,
        snapshot: snapshot(fine, memberMap.get(Number(fine.member_id)), assessment),
      };
    });

    const erroneous = assessed.filter((item) => item.assessment.erroneous);
    const unpaid = erroneous.filter((item) => item.fine.status === 'unpaid');
    const paid = erroneous.filter((item) => item.fine.status === 'paid');
    const other = erroneous.filter((item) => !['paid', 'unpaid'].includes(item.fine.status));
    const kept = assessed.filter((item) => !item.assessment.erroneous);

    return res.json({
      mode: 'dry-run',
      policy: 'fine only when contribution month was completely missing after deadline',
      generated_at: new Date().toISOString(),
      automatic_fines_scanned: automaticFines.length,
      erroneous_identified: erroneous.length,
      unpaid_safe_to_remove: unpaid.length,
      paid_manual_review: paid.length,
      other_status_manual_review: other.length,
      valid_or_uncertain_kept: kept.length,
      candidates_to_remove: unpaid.map((item) => item.snapshot),
      paid_fines_requiring_manual_reconciliation: paid.map((item) => item.snapshot),
      other_status_requiring_manual_review: other.map((item) => item.snapshot),
      kept_classification_counts: kept.reduce((counts, item) => {
        const key = item.assessment.classification;
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
    });
  } catch (error) {
    console.error('[fine-reconciliation-dry-run]', error);
    return res.status(500).json({ error: 'Fine reconciliation dry run failed' });
  }
});

module.exports = router;
