// Control-plane schemas and models.
//
// These models must NEVER be registered against the application's default
// Mongoose connection (the one backend/db/models.js uses for financial
// data). They exist only inside the control database, obtained via
// controlDb.js. Keeping them out of the global `mongoose.model(...)`
// registry is what guarantees an Organization document can never be
// accidentally queried through a tenant's own database context, and that a
// tenant's financial collections can never appear inside the control
// database.

const mongoose = require('mongoose');

const ORGANIZATION_STATUSES = ['active', 'suspended', 'provisioning', 'archived'];

const organizationSchema = new mongoose.Schema(
  {
    organization_id: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // The logical MongoDB database name this organization's financial
    // records live in. Only ever written by trusted control-plane code
    // (see ../scripts/bootstrap-legacy-organization.js) — never derived
    // from request input.
    database_name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ORGANIZATION_STATUSES,
      default: 'active',
    },
    // True only for the pre-existing Checkpoint Investors Club tenant,
    // whose data was never migrated — it is registered in place.
    legacy: { type: Boolean, default: false },
    schema_version: { type: String, default: '1' },
    // Optional minimal metadata. Financial configuration (contribution
    // amount, loan interest rate, entry fee, etc.) stays a tenant-level
    // concern (FyRules, inside the tenant database) and must never move
    // into the control database.
    country: { type: String, default: null },
    currency: { type: String, default: null },
    timezone: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

organizationSchema.pre('save', function touchUpdatedAt() {
  this.updated_at = new Date();
});

/**
 * Binds the control-plane schemas to the given control Connection and
 * returns the models. Reuses an already-registered model on that
 * connection instead of re-registering it, which avoids
 * OverwriteModelError across warm Vercel invocations (a fresh `require()`
 * of this module never happens on a warm instance, but the connection
 * object itself is cached and re-used, and this guard makes that safe even
 * if a future refactor changes that).
 *
 * @param {import('mongoose').Connection} controlConnection
 */
function getControlModels(controlConnection) {
  if (!controlConnection || typeof controlConnection.model !== 'function') {
    throw new Error('getControlModels requires a Mongoose Connection (see controlDb.getControlConnection()).');
  }

  const Organization =
    controlConnection.models.Organization ||
    controlConnection.model('Organization', organizationSchema);

  return { Organization };
}

module.exports = { getControlModels, ORGANIZATION_STATUSES };
