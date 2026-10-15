const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const { authenticate, requireAdmin } = require('../middleware/auth');
const { buildQuarterlyReportSnapshot, fiscalQuarterPeriod } = require('../services/quarterlyReportSnapshot');

router.use(authenticate, requireAdmin);

function reportNumber(id, fiscalYear, quarter) {
  return `QR-FY${fiscalYear}-Q${quarter}-${String(id).padStart(3, '0')}`;
}

function snapshotHash(snapshot) {
  // generated_at is metadata, not financial source data. Excluding it makes
  // the hash stable when the exact same ledger state is regenerated.
  const stable = JSON.parse(JSON.stringify(snapshot));
  if (stable.report_basis) delete stable.report_basis.generated_at;
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function safeNarrative(input = {}, fallback = {}) {
  const executive = input.executive_summary;
  const notes = input.management_notes;
  return {
    executive_summary: typeof executive === 'string'
      ? executive.trim().slice(0, 4000)
      : String(fallback.executive_summary || ''),
    management_notes: typeof notes === 'string'
      ? notes.trim().slice(0, 6000)
      : String(fallback.management_notes || ''),
  };
}

async function loadReportWithLatest(models, id) {
  const report = await models.QuarterlyReport.findOne({ id: Number(id) }).lean();
  if (!report) return null;
  const version = report.latest_version_id
    ? await models.QuarterlyReportVersion.findById(report.latest_version_id).lean()
    : null;
  return { report, version };
}

router.get('/quarterly', async (req, res) => {
  try {
    const reports = await req.tenantModels.QuarterlyReport.find()
      .sort({ fiscal_year: -1, quarter: -1, created_at: -1 })
      .lean();
    res.json(reports);
  } catch (error) {
    console.error('[reports] list failed:', error);
    res.status(500).json({ error: 'Failed to load quarterly reports' });
  }
});

router.post('/quarterly/generate', async (req, res) => {
  const fiscalYear = Number(req.body?.fiscal_year);
  const quarter = Number(req.body?.quarter);
  let period;
  try {
    period = fiscalQuarterPeriod(fiscalYear, quarter);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const models = req.tenantModels;
  const reportKey = `FY${period.fiscal_year}-Q${period.quarter}`;

  try {
    const snapshot = await buildQuarterlyReportSnapshot(models, {
      fiscal_year: period.fiscal_year,
      quarter: period.quarter,
      organization_name: req.tenant?.name,
    });
    const hash = snapshotHash(snapshot);

    let report = await models.QuarterlyReport.findOne({ report_key: reportKey });
    if (report && report.status !== 'draft') {
      return res.status(409).json({ error: 'Only a draft quarterly report can be regenerated' });
    }

    if (!report) {
      const id = await models.getNextId('quarterly_report_id');
      report = await models.QuarterlyReport.create({
        id,
        report_key: reportKey,
        report_number: reportNumber(id, period.fiscal_year, period.quarter),
        fiscal_year: period.fiscal_year,
        quarter: period.quarter,
        period_start: period.period_start,
        period_end: period.period_end,
        source_cutoff: period.period_end,
        status: 'draft',
        current_version: 0,
        generated_by: req.user.name || req.user.username,
      });
    }

    const previousVersion = report.latest_version_id
      ? await models.QuarterlyReportVersion.findById(report.latest_version_id).lean()
      : null;
    const versionNumber = Number(report.current_version || 0) + 1;
    const narrative = safeNarrative(
      {
        executive_summary: snapshot.narrative_default.executive_summary,
        management_notes: previousVersion?.narrative?.management_notes || '',
      },
      snapshot.narrative_default,
    );

    const version = await models.QuarterlyReportVersion.create({
      report_id: report.id,
      version_number: versionNumber,
      status: 'draft',
      financial_snapshot: snapshot,
      narrative,
      source_snapshot_hash: hash,
      pdf_template_version: 'quarterly-v1',
      generated_by: req.user.name || req.user.username,
    });

    report.current_version = versionNumber;
    report.latest_version_id = version._id;
    report.updated_at = new Date();
    report.generated_by = req.user.name || req.user.username;
    await report.save();

    res.status(previousVersion ? 200 : 201).json({
      report: report.toObject(),
      version: version.toObject(),
    });
  } catch (error) {
    console.error('[reports] generate failed:', error);
    res.status(500).json({ error: 'Failed to generate quarterly report' });
  }
});

router.get('/quarterly/:id', async (req, res) => {
  try {
    const payload = await loadReportWithLatest(req.tenantModels, req.params.id);
    if (!payload) return res.status(404).json({ error: 'Quarterly report not found' });
    res.json(payload);
  } catch (error) {
    console.error('[reports] detail failed:', error);
    res.status(500).json({ error: 'Failed to load quarterly report' });
  }
});

router.get('/quarterly/:id/versions/:version', async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    const versionNumber = Number(req.params.version);
    const report = await req.tenantModels.QuarterlyReport.findOne({ id: reportId }).lean();
    if (!report) return res.status(404).json({ error: 'Quarterly report not found' });
    const version = await req.tenantModels.QuarterlyReportVersion.findOne({
      report_id: reportId,
      version_number: versionNumber,
    }).lean();
    if (!version) return res.status(404).json({ error: 'Quarterly report version not found' });
    res.json({ report, version });
  } catch (error) {
    console.error('[reports] version failed:', error);
    res.status(500).json({ error: 'Failed to load quarterly report version' });
  }
});

router.patch('/quarterly/:id/versions/:version/narrative', async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    const versionNumber = Number(req.params.version);
    const report = await req.tenantModels.QuarterlyReport.findOne({ id: reportId });
    if (!report) return res.status(404).json({ error: 'Quarterly report not found' });
    if (report.status !== 'draft' || Number(report.current_version) !== versionNumber) {
      return res.status(409).json({ error: 'Only the current draft version can be edited' });
    }

    const version = await req.tenantModels.QuarterlyReportVersion.findOne({
      report_id: reportId,
      version_number: versionNumber,
    });
    if (!version) return res.status(404).json({ error: 'Quarterly report version not found' });

    version.narrative = safeNarrative(req.body || {}, version.narrative || {});
    await version.save();
    res.json({ report: report.toObject(), version: version.toObject() });
  } catch (error) {
    console.error('[reports] narrative update failed:', error);
    res.status(500).json({ error: 'Failed to update report narrative' });
  }
});

module.exports = router;
