const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { Contribution, Fine, Member, getNextId } = require('../db/models');
const { getRulesForFY } = require('./rules');
const {
  isContributionLate,
  isContributionOverdueAsOf,
  calculateOneTimeFine,
  fineMatchesContributionPeriod,
} = require('../services/contributionFinePolicy');

const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

function calendarYearForFYMonth(month, fy) {
  return month >= 3 ? fy : fy + 1;
}

async function buildFineCandidates(fy, rules) {
  const members = await Member.find({ status: 'active' }).lean();
  const contributions = await Contribution.find({
    $or: [
      { year: fy, month: { $gte: 3 } },
      { year: fy + 1, month: { $lte: 2 } },
    ],
  }).lean();
  const existingFines = await Fine.find({ year: fy }).lean();
  const target = Number(rules.contribution_amount || 75000);
  const now = new Date();
  const candidates = [];

  for (const member of members) {
    for (const month of FY_MONTHS) {
      const year = calendarYearForFYMonth(month, fy);
      const contribution = contributions.find(
        (item) => item.member_id === member.id && item.month === month && item.year === year,
      );
      const alreadyFined = existingFines.some(
        (fine) => fine.member_id === member.id && fineMatchesContributionPeriod(fine, month, year),
      );
      if (alreadyFined) continue;

      let late = false;
      let source = null;

      if (contribution?.status === 'paid' && contribution.paid_date) {
        late = isContributionLate(month, year, contribution.paid_date);
        source = late ? 'paid_late' : null;
      } else if (!contribution || Number(contribution.amount || 0) < target) {
        late = isContributionOverdueAsOf(month, year, now);
        source = late ? (contribution ? 'partial_overdue' : 'missing') : null;
      }

      if (!late) continue;
      const fine = calculateOneTimeFine(rules, target, month, year, fy);
      if (!fine) continue;

      candidates.push({
        member_id: member.id,
        member_name: member.name,
        month,
        year,
        fy,
        source,
        fine,
      });
    }
  }

  return candidates;
}

// Overrides legacy scan route. Safe to run repeatedly: one fine max per member +
// contribution month, regardless of how long that month remains unpaid.
router.post('/:fy/scan-fines', authenticate, requireAdmin, async (req, res) => {
  try {
    const fy = parseInt(req.params.fy, 10);
    const rules = await getRulesForFY(fy);
    if (!rules.late_fine_enabled) {
      return res.json({ ok: true, generated: 0, message: `Late fines are disabled for FY${fy}.` });
    }

    const candidates = await buildFineCandidates(fy, rules);
    const details = [];
    for (const item of candidates) {
      const fine = await Fine.create({
        id: await getNextId('fine_id'),
        member_id: item.member_id,
        amount: item.fine.amount,
        reason: item.fine.reason,
        year: fy,
        contribution_month: item.month,
        contribution_year: item.year,
        status: 'unpaid',
      });
      details.push({
        id: fine.id,
        member_id: item.member_id,
        member_name: item.member_name,
        month: item.month,
        year: item.year,
        fine: item.fine.amount,
        type: item.source,
      });
    }

    res.json({
      ok: true,
      generated: details.length,
      message: `Scan complete: ${details.length} one-time fine(s) generated for FY${fy}.`,
      details,
      policy: 'one_fine_per_contribution_month',
    });
  } catch (err) {
    console.error('scan-fines hotfix error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Recalculate ONLY unpaid auto late fines. Paid historical fines are immutable
// financial history here and are never deleted by this maintenance endpoint.
router.post('/:fy/recalculate-fines', authenticate, requireAdmin, async (req, res) => {
  try {
    const fy = parseInt(req.params.fy, 10);
    const rules = await getRulesForFY(fy);
    const target = Number(rules.contribution_amount || 75000);

    const existingAutoFines = await Fine.find({
      year: fy,
      reason: /^Late contribution/,
    });

    let updated = 0;
    for (const fine of existingAutoFines) {
      if (fine.status === 'paid') continue;
      const month = fine.contribution_month;
      const year = fine.contribution_year;
      if (!month || !year) continue;
      const corrected = calculateOneTimeFine(rules, target, month, year, fy);
      if (!corrected) continue;
      if (fine.amount !== corrected.amount || fine.reason !== corrected.reason) {
        fine.amount = corrected.amount;
        fine.reason = corrected.reason;
        await fine.save();
        updated += 1;
      }
    }

    const candidates = rules.late_fine_enabled ? await buildFineCandidates(fy, rules) : [];
    const created = [];
    for (const item of candidates) {
      const fine = await Fine.create({
        id: await getNextId('fine_id'),
        member_id: item.member_id,
        amount: item.fine.amount,
        reason: item.fine.reason,
        year: fy,
        contribution_month: item.month,
        contribution_year: item.year,
        status: 'unpaid',
      });
      created.push(fine.id);
    }

    res.json({
      ok: true,
      updated,
      generated: created.length,
      deleted: 0,
      message: `FY${fy}: corrected ${updated} unpaid fine(s) and generated ${created.length} missing one-time fine(s). Paid fine history was preserved.`,
      policy: 'one_fine_per_contribution_month',
    });
  } catch (err) {
    console.error('recalculate-fines hotfix error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
