const mongoose = require('mongoose');

const options = { versionKey: false };

const adminNotificationStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  admin_key: { type: String, required: true, index: true },
  source: { type: String, required: true },
  source_id: { type: String, required: true },
  read_at: { type: Date, default: Date.now },
}, options);

adminNotificationStateSchema.index({ admin_key: 1, read_at: -1 });

const AdminNotificationState = mongoose.models.AdminNotificationState
  || mongoose.model('AdminNotificationState', adminNotificationStateSchema);

module.exports = { AdminNotificationState };
