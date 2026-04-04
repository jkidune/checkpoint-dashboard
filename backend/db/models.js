const mongoose = require('mongoose');

const options = { versionKey: false };

// ─── Auto-increment helper ────────────────────────────────────────────────────
// Replaces mongoose-sequence which is incompatible with Mongoose v7+.
// Uses a single "counters" collection to safely track the last ID per model.

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
}, { versionKey: false });

const Counter = mongoose.model('Counter', counterSchema);

async function getNextId(name) {
  const counter = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

function addAutoIncrement(schema, counterName) {
  schema.pre('save', async function () {
    if (this.isNew) {
      this.id = await getNextId(counterName);
    }
  });
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const memberSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  name: { type: String, required: true },
  email: { type: String, default: null },
  phone: { type: String, default: null },
  role: { type: String, default: 'member' },
  status: { type: String, default: 'active' },
  entry_fee: { type: Number, default: 500000 },
  join_date: { type: String },
  created_at: { type: Date, default: Date.now },
}, options);
addAutoIncrement(memberSchema, 'member_id');

const contributionSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  member_id: { type: Number, required: true },
  amount: { type: Number, required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  status: { type: String, default: 'paid' },
  paid_date: { type: String },
  mpesa_ref: { type: String, default: null },
  notes: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
addAutoIncrement(contributionSchema, 'contribution_id');

const loanSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  member_id: { type: Number, required: true },
  loan_number: { type: String },
  principal: { type: Number, required: true },
  interest_rate: { type: Number, default: 0.05 },
  interest_amount: { type: Number, default: 0 },
  amount_deposited: { type: Number, default: 0 },
  issued_date: { type: String },
  due_date: { type: String },
  status: { type: String, default: 'active' },
  fiscal_year: { type: Number },
  notes: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
addAutoIncrement(loanSchema, 'loan_id');

const repaymentSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  loan_id: { type: Number, required: true },
  amount: { type: Number, required: true },
  repayment_date: { type: String },
  mpesa_ref: { type: String, default: null },
  notes: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
addAutoIncrement(repaymentSchema, 'repayment_id');

const transactionSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  member_id: { type: Number, default: null },
  amount: { type: Number, required: true },
  type: { type: String, required: true },
  description: { type: String },
  reference: { type: String, default: null },
  transaction_date: { type: String },
  created_at: { type: Date, default: Date.now },
}, options);
addAutoIncrement(transactionSchema, 'transaction_id');

const userSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  member_id: { type: Number, default: null },
  username: { type: String, required: true, unique: true },
  email: { type: String, default: null },
  password_hash: { type: String, required: true },
  role: { type: String, default: 'member' },
  name: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
addAutoIncrement(userSchema, 'user_id');

const fineSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  member_id: { type: Number, required: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  year: { type: Number, required: true },
  status: { type: String, default: 'unpaid' },
  paid_date: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
addAutoIncrement(fineSchema, 'fine_id');

const welfareSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  member_id: { type: Number, required: true },
  event_type: { type: String, required: true },
  amount: { type: Number, default: 50000 },
  status: { type: String, default: 'pending' },
  approved_date: { type: String, default: null },
  notes: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
addAutoIncrement(welfareSchema, 'welfare_id');

module.exports = {
  Member: mongoose.model('Member', memberSchema),
  Contribution: mongoose.model('Contribution', contributionSchema),
  Loan: mongoose.model('Loan', loanSchema),
  Repayment: mongoose.model('LoanRepayment', repaymentSchema),
  Transaction: mongoose.model('Transaction', transactionSchema),
  User: mongoose.model('User', userSchema),
  Fine: mongoose.model('Fine', fineSchema),
  WelfareEvent: mongoose.model('WelfareEvent', welfareSchema),
};
