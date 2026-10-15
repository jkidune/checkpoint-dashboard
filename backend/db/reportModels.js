// Tenant-owned quarterly financial report records.
//
// These schemas intentionally live outside tenantSchemas.js because reports are
// a feature domain, not part of the legacy/core financial model set. They still
// follow the same binding rule: one canonical schema definition, bound to the
// caller's Mongoose connection. Runtime report routes obtain these models only
// through req.tenantModels.

const mongoose = require('mongoose');

const options = { versionKey: false };

const REPORT_STATUSES = [
  'draft',
  'ready_for_review',
  'in_review',
  'changes_requested',
  'approved',
  'published',
  'withdrawn',
  'superseded',
  'archived',
];

function createReportSchemas() {
  const quarterlyReportSchema = new mongoose.Schema(
    {
      id: { type: Number, required: true, unique: true, immutable: true },
      report_key: { type: String, required: true, unique: true, immutable: true },
      report_number: { type: String, required: true, unique: true, immutable: true },
      report_type: { type: String, default: 'quarterly_financial' },
      fiscal_year: { type: Number, required: true, immutable: true },
      quarter: { type: Number, required: true, min: 1, max: 4, immutable: true },
      period_start: { type: String, required: true, immutable: true },
      period_end: { type: String, required: true, immutable: true },
      source_cutoff: { type: String, required: true, immutable: true },
      status: { type: String, enum: REPORT_STATUSES, default: 'draft' },
      current_version: { type: Number, default: 0 },
      latest_version_id: { type: mongoose.Schema.Types.ObjectId, default: null },
      generated_by: { type: String, default: null },
      published_by: { type: String, default: null },
      published_at: { type: Date, default: null },
      created_at: { type: Date, default: Date.now },
      updated_at: { type: Date, default: Date.now },
    },
    { ...options, collection: 'quarterlyreports' }
  );
  quarterlyReportSchema.index({ fiscal_year: -1, quarter: -1 });

  const quarterlyReportVersionSchema = new mongoose.Schema(
    {
      report_id: { type: Number, required: true, immutable: true },
      version_number: { type: Number, required: true, immutable: true },
      status: { type: String, enum: REPORT_STATUSES, default: 'draft' },
      financial_snapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
      narrative: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({ executive_summary: '', management_notes: '' }),
      },
      source_snapshot_hash: { type: String, required: true, immutable: true },
      pdf_template_version: { type: String, default: 'quarterly-v1', immutable: true },
      generated_by: { type: String, default: null },
      generated_at: { type: Date, default: Date.now },
      submitted_at: { type: Date, default: null },
      approved_at: { type: Date, default: null },
    },
    { ...options, collection: 'quarterlyreportversions' }
  );
  quarterlyReportVersionSchema.index({ report_id: 1, version_number: 1 }, { unique: true });

  return { quarterlyReportSchema, quarterlyReportVersionSchema };
}

/**
 * @param {import('mongoose').Connection} connection
 */
function bindReportModels(connection) {
  const { quarterlyReportSchema, quarterlyReportVersionSchema } = createReportSchemas();

  const QuarterlyReport =
    connection.models.QuarterlyReport ||
    connection.model('QuarterlyReport', quarterlyReportSchema);
  const QuarterlyReportVersion =
    connection.models.QuarterlyReportVersion ||
    connection.model('QuarterlyReportVersion', quarterlyReportVersionSchema);

  return { QuarterlyReport, QuarterlyReportVersion };
}

const defaultModels = bindReportModels(mongoose.connection);

module.exports = {
  ...defaultModels,
  bindReportModels,
  REPORT_STATUSES,
};
