const express = require('express');
const router = express.Router();
const { runAutomaticFineIssuance } = require('../services/automaticMissingFineIssuance');

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.get('authorization') || '') === `Bearer ${secret}`;
}

function portalUrl(req) {
  return process.env.PORTAL_URL || process.env.WEB_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

router.get('/', async (req, res) => {
  if (!authorized(req)) {
    return res.status(process.env.CRON_SECRET ? 401 : 503).json({
      error: process.env.CRON_SECRET ? 'Unauthorized' : 'CRON_SECRET is not configured',
    });
  }

  try {
    const result = await runAutomaticFineIssuance({
      now: new Date(),
      portalUrl: portalUrl(req),
      source: 'vercel-cron:auto-missing-fines',
    });
    res.json(result);
  } catch (error) {
    console.error('[automatic-fine-cron]', error);
    res.status(500).json({ error: 'Automatic missing-contribution fine scan failed' });
  }
});

module.exports = router;
