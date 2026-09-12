// Default/legacy connection compatibility layer for admin notification
// read-state. See db/models.js for the full explanation of this shape.

const mongoose = require('mongoose');

const options = { versionKey: false };

function createAdminNotificationSchemas() {
  const adminNotificationStateSchema = new mongoose.Schema(
    {
      key: { type: String, required: true, unique: true },
      admin_key: { type: String, required: true, index: true },
      source: { type: String, required: true },
      source_id: { type: String, required: true },
      read_at: { type: Date, default: Date.now },
    },
    options
  );
  adminNotificationStateSchema.index({ admin_key: 1, read_at: -1 });

  return { adminNotificationStateSchema };
}

/**
 * @param {import('mongoose').Connection} connection
 */
function bindAdminNotificationModels(connection) {
  const { adminNotificationStateSchema } = createAdminNotificationSchemas();

  const AdminNotificationState =
    connection.models.AdminNotificationState ||
    connection.model('AdminNotificationState', adminNotificationStateSchema);

  return { AdminNotificationState };
}

const defaultModels = bindAdminNotificationModels(mongoose.connection);

module.exports = {
  ...defaultModels,
  bindAdminNotificationModels,
};
