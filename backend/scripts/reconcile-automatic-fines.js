require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../db/mongoose');
const { Member, Contribution, Fine } = require('../db/models');

const APPLY = process.argv.includes('--apply');

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

  // A record may have been entered after the fine scan even though its stored
  // payment date shows that the contribution had already happened. Treat that as
  // delayed data entry, not a genuinely missing contribution month.
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

function fineSnapshot(fine, member, assessment) {
  return {
    fine_id: fine.id,
    mongo_id: String(fine._id),
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
    notes: fine.notes,
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

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  await connectDB();

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
      snapshot: fineSnapshot(fine, memberMap.get(Number(fine.member_id)), assessment),
    };
  });

  const erroneous = assessed.filter((item) => item.assessment.erroneous);
  const safeToRemove = erroneous.filter((item) => item.fine.status === 'unpaid');
  const paidNeedsReview = erroneous.filter((item) => item.fine.status === 'paid');
  const otherStatusNeedsReview = erroneous.filter((item) => !['paid', 'unpaid'].includes(item.fine.status));
  const keep = assessed.filter((item) => !item.assessment.erroneous);

  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    policy: 'fine only when contribution month was completely missing after deadline',
    generated_at: new Date().toISOString(),
    automatic_fines_scanned: automaticFines.length,
    erroneous_identified: erroneous.length,
    unpaid_safe_to_remove: safeToRemove.length,
    paid_manual_review: paidNeedsReview.length,
    other_status_manual_review: otherStatusNeedsReview.length,
    valid_or_uncertain_kept: keep.length,
    candidates_to_remove: safeToRemove.map((item) => item.snapshot),
    paid_fines_requiring_manual_reconciliation: paidNeedsReview.map((item) => item.snapshot),
    other_status_requiring_manual_review: otherStatusNeedsReview.map((item) => item.snapshot),
    fines_kept: keep.map((item) => item.snapshot),
  };

  console.log(JSON.stringify(report, null, 2));

  if (!APPLY) {
    console.log('\nDRY RUN ONLY — no fines were changed. Review the report, then run with --apply.');
    return;
  }

  if (!safeToRemove.length) {
    console.log('\nNo unpaid erroneous automatic fines were eligible for removal.');
    return;
  }

  const backupDir = path.join(process.cwd(), 'fine-reconciliation-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `automatic-fines-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    removed_fines: safeToRemove.map((item) => item.snapshot),
    paid_fines_not_removed: paidNeedsReview.map((item) => item.snapshot),
  }, null, 2));

  const ids = safeToRemove.map((item) => item.fine._id);
  const deletion = await Fine.deleteMany({
    _id: { $in: ids },
    status: 'unpaid',
    reconciliation_key: /^auto-late:/,
  });

  console.log(`\nRemoved ${deletion.deletedCount} unpaid erroneous automatic fine(s).`);
  console.log(`Backup written before deletion: ${backupPath}`);
  if (paidNeedsReview.length) {
    console.log(`${paidNeedsReview.length} paid erroneous fine(s) were NOT deleted and require financial reconciliation.`);
  }
}

main()
  .catch((error) => {
    console.error('[reconcile-automatic-fines] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
