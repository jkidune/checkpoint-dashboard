const mongoose = require('mongoose');

const options = { versionKey: false };

const communicationLogSchema = new mongoose.Schema({
  member_id: { type: Number, default: null },
  recipient_email: { type: String, required: true },
  type: {
    type: String,
    required: true,
    enum: [
      'account_invitation',
      'contribution_reminder',
      'loan_reminder',
      'fine_notice',
      'statement',
      'password_reset',
      'admin_test',
      'member_message',
    ],
  },
  period_key: { type: String, default: null },
  subject: { type: String, default: null },
  status: { type: String, enum: ['sent', 'failed', 'skipped', 'mocked'], required: true },
  provider_message_id: { type: String, default: null },
  source_entity_type: { type: String, default: null },
  source_entity_id: { type: String, default: null },
  sent_at: { type: Date, default: null },
  failure_reason: { type: String, default: null },
  created_by: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);

communicationLogSchema.index({ member_id: 1, type: 1, period_key: 1, created_at: -1 });
communicationLogSchema.index({ recipient_email: 1, created_at: -1 });

const passwordResetTokenSchema = new mongoose.Schema({
  user_id: { type: Number, required: true },
  token_hash: { type: String, required: true, unique: true },
  expires_at: { type: Date, required: true },
  used_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
passwordResetTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const CommunicationLog = mongoose.models.CommunicationLog || mongoose.model('CommunicationLog', communicationLogSchema);
const PasswordResetToken = mongoose.models.PasswordResetToken || mongoose.model('PasswordResetToken', passwordResetTokenSchema);

module.exports = { CommunicationLog, PasswordResetToken };
