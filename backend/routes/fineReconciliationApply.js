const express = require('express');
const crypto = require('crypto');
const { Fine } = require('../db/models');

const router = express.Router();
const TOKEN_SHA256 = '607d9b3d5ee80b2fde677950649ce905fd24db05068e624d7608abd26386a840';

const TARGETS = [
  { id: 161, reconciliation_key: 'auto-late:4:2026-04' },
  { id: 162, reconciliation_key: 'auto-late:9:2026-03' },
  { id: 163, reconciliation_key: 'auto-late:9:2026-04' },
  { id: 164, reconciliation_key: 'auto-late:9:2026-05' },
  { id: 165, reconciliation_key: 'auto-late:9:2026-06' },
  { id: 172, reconciliation_key: 'auto-late:1:2026-03' },
  { id: 173, reconciliation_key: 'auto-late:1:2026-04' },
  { id: 174, reconciliation_key: 'auto-late:1:2026-05' },
  { id: 181, reconciliation_key: 'auto-late:5:2026-04' },
  { id: 182, reconciliation_key: 'auto-late:5:2026-05' },
  { id: 183, reconciliation_key: 'auto-late:5:2026-06' },
  { id: 185, reconciliation_key: 'auto-late:8:2026-04' },
  { id: 186, reconciliation_key: 'auto-late:8:2026-05' },
  { id: 187, reconciliation_key: 'auto-late:8:2026-06' },
];

function authorized(req) {
  const token = String(req.query.token || '');
  if (!token) return false;
  const actual = crypto.createHash('sha256').update(token).digest('hex');
  const expectedBuffer = Buffer.from(TOKEN_SHA256, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
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
    const query = { $or: TARGETS.map((target) => ({ id: target.id, reconciliation_key: target.reconciliation_key })) };
    const matches = await Fine.find(query).lean();

    const mismatches = [];
    for (const target of TARGETS) {
      const match = matches.find((fine) => Number(fine.id) === target.id
        && fine.reconciliation_key === target.reconciliation_key);
      if (!match) {
        mismatches.push({ ...target, issue: 'missing' });
      } else if (match.status !== 'unpaid') {
        mismatches.push({ ...target, issue: `status_${match.status}` });
      }
    }

    if (mismatches.length || matches.length !== TARGETS.length) {
      return res.status(409).json({
        error: 'Cleanup aborted because target fines changed since dry run.',
        target_count: TARGETS.length,
        matched_count: matches.length,
        mismatches,
      });
    }

    const totalAmount = matches.reduce((sum, fine) => sum + Number(fine.amount || 0), 0);
    const deletion = await Fine.deleteMany({ status: 'unpaid', ...query });
    const remaining = await Fine.countDocuments(query);

    return res.json({
      mode: 'apply',
      deleted_count: deletion.deletedCount,
      deleted_total_amount: totalAmount,
      expected_count: TARGETS.length,
      remaining_target_records: remaining,
      deleted_fine_ids: TARGETS.map((target) => target.id),
    });
  } catch (error) {
    console.error('[fine-reconciliation-apply]', error);
    return res.status(500).json({ error: 'Fine reconciliation apply failed' });
  }
});

module.exports = router;
