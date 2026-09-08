const express = require('express');
const router = express.Router();

function periodKey(item) {
  return `${Number(item.year)}-${Number(item.month)}`;
}

function requireContributionForNewLateFine(req, res, next) {
  const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
  const contributionPeriods = new Set(
    allocations
      .filter((item) => item.kind === 'contribution')
      .map(periodKey),
  );

  const orphanLateFine = allocations.find((item) => (
    item.kind === 'late_fine' && !contributionPeriods.has(periodKey(item))
  ));

  if (orphanLateFine) {
    return res.status(400).json({
      error: 'A newly assessed late fine can only be paid in the same receipt allocation as the contribution period that triggers it. Add that monthly contribution first, or choose an existing unpaid fine instead.',
    });
  }

  next();
}

router.post('/:id/allocation-preview', requireContributionForNewLateFine);
router.post('/:id/allocation-post', requireContributionForNewLateFine);

module.exports = router;
