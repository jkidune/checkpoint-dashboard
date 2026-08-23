const mongoose = require('mongoose');

const options = { versionKey: false };

const formIntakeSubmissionSchema = new mongoose.Schema({
  source: { type: String, default: 'google_forms' },
  source_id: { type: String, required: true, unique: true },
  submitted_at: { type: Date, default: Date.now },
  member_name: { type: String, required: true },
  matched_member_id: { type: Number, default: null },
  match_status: { type: String, enum: ['matched', 'ambiguous', 'unmatched'], default: 'unmatched' },
  amount: { type: Number, required: true },
  payment_date: { type: String, required: true },
  type: { type: String, enum: ['monthly', 'loan_repayment', 'fine'], required: true },
  months: { type: [String], default: [] },
  mpesa_ref: { type: String, default: null },
  notes: { type: String, default: null },
  duplicate_reference: { type: Boolean, default: false },
  duplicate_matches: { type: [mongoose.Schema.Types.Mixed], default: [] },
  review_status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  review_note: { type: String, default: null },
  reviewed_by: { type: String, default: null },
  reviewed_at: { type: Date, default: null },
  posted: { type: Boolean, default: false },
  source_payload: { type: mongoose.Schema.Types.Mixed, default: null },
  created_at: { type: Date, default: Date.now },
}, options);

formIntakeSubmissionSchema.index({ review_status: 1, created_at: -1 });
formIntakeSubmissionSchema.index({ mpesa_ref: 1, created_at: -1 });
formIntakeSubmissionSchema.index({ matched_member_id: 1, created_at: -1 });

const FormIntakeSubmission = mongoose.models.FormIntakeSubmission || mongoose.model('FormIntakeSubmission', formIntakeSubmissionSchema);

module.exports = { FormIntakeSubmission };
