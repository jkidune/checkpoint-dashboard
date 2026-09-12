// Default/legacy connection compatibility layer for Loan Request
// submissions. See db/models.js for the full explanation of this shape.

const mongoose = require('mongoose');

const options = { versionKey: false };

function createLoanRequestSchemas() {
  const loanRequestSubmissionSchema = new mongoose.Schema(
    {
      source: { type: String, default: 'google_forms' },
      source_id: { type: String, required: true, unique: true },
      submitted_at: { type: Date, default: Date.now },
      member_name: { type: String, required: true },
      matched_member_id: { type: Number, default: null },
      match_status: { type: String, enum: ['matched', 'ambiguous', 'unmatched'], default: 'unmatched' },
      amount_requested: { type: Number, required: true },
      requested_date: { type: String, required: true },
      purpose: { type: String, default: null },
      requested_term_months: { type: Number, default: null },

      // Values submitted in the existing Google loan request form.
      // Checkpoint's FY rules remain authoritative; these are retained for
      // review/audit comparison.
      submitted_interest_amount: { type: Number, default: null },
      submitted_monthly_repayment: { type: Number, default: null },
      has_other_debt: { type: Boolean, default: null },
      last_loan_month: { type: String, default: null },
      last_loan_amount: { type: Number, default: null },
      repayments_completed_by: { type: String, default: null },
      committee_approved: { type: Boolean, default: null },
      disbursement_phone: { type: String, default: null },
      oath_accepted: { type: Boolean, default: null },

      notes: { type: String, default: null },
      review_status: { type: String, enum: ['pending', 'accepted', 'rejected', 'converted'], default: 'pending' },
      review_note: { type: String, default: null },
      reviewed_by: { type: String, default: null },
      reviewed_at: { type: Date, default: null },
      linked_loan_id: { type: Number, default: null },
      source_payload: { type: mongoose.Schema.Types.Mixed, default: null },
      created_at: { type: Date, default: Date.now },
    },
    options
  );

  loanRequestSubmissionSchema.index({ review_status: 1, created_at: -1 });
  loanRequestSubmissionSchema.index({ matched_member_id: 1, created_at: -1 });

  return { loanRequestSubmissionSchema };
}

/**
 * @param {import('mongoose').Connection} connection
 */
function bindLoanRequestModels(connection) {
  const { loanRequestSubmissionSchema } = createLoanRequestSchemas();

  const LoanRequestSubmission =
    connection.models.LoanRequestSubmission ||
    connection.model('LoanRequestSubmission', loanRequestSubmissionSchema);

  return { LoanRequestSubmission };
}

const defaultModels = bindLoanRequestModels(mongoose.connection);

module.exports = {
  ...defaultModels,
  bindLoanRequestModels,
};
