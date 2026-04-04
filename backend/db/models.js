const mongoose = require('mongoose');
const AutoIncrement = require('mongoose-sequence')(mongoose);

const options = { versionKey: false };

const memberSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, default: null },
  phone: { type: String, default: null },
  role: { type: String, default: 'member' },
  status: { type: String, default: 'active' },
  entry_fee: { type: Number, default: 500000 },
  join_date: { type: String },
  created_at: { type: Date, default: Date.now },
}, options);
memberSchema.plugin(AutoIncrement, { inc_field: 'id', id: 'member_id_counter' });

const contributionSchema = new mongoose.Schema({
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
contributionSchema.plugin(AutoIncrement, { inc_field: 'id', id: 'contribution_id_counter' });

const loanSchema = new mongoose.Schema({
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
loanSchema.plugin(AutoIncrement, { inc_field: 'id', id: 'loan_id_counter' });

const repaymentSchema = new mongoose.Schema({
  loan_id: { type: Number, required: true },
  amount: { type: Number, required: true },
  repayment_date: { type: String },
  mpesa_ref: { type: String, default: null },
  notes: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
repaymentSchema.plugin(AutoIncrement, { inc_field: 'id', id: 'repayment_id_counter' });

const transactionSchema = new mongoose.Schema({
  member_id: { type: Number, default: null },
  amount: { type: Number, required: true },
  type: { type: String, required: true },
  description: { type: String },
  reference: { type: String, default: null },
  transaction_date: { type: String },
  created_at: { type: Date, default: Date.now },
}, options);
transactionSchema.plugin(AutoIncrement, { inc_field: 'id', id: 'transaction_id_counter' });

const userSchema = new mongoose.Schema({
  member_id: { type: Number, default: null },
  username: { type: String, required: true, unique: true },
  email: { type: String, default: null },
  password_hash: { type: String, required: true },
  role: { type: String, default: 'member' },
  created_at: { type: Date, default: Date.now },
}, options);
userSchema.plugin(AutoIncrement, { inc_field: 'id', id: 'user_id_counter' });

const fineSchema = new mongoose.Schema({
  member_id: { type: Number, required: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  year: { type: Number, required: true },
  status: { type: String, default: 'unpaid' },
  paid_date: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
fineSchema.plugin(AutoIncrement, { inc_field: 'id', id: 'fine_id_counter' });

const welfareSchema = new mongoose.Schema({
  member_id: { type: Number, required: true },
  event_type: { type: String, required: true },
  amount: { type: Number, default: 50000 },
  status: { type: String, default: 'pending' },
  approved_date: { type: String, default: null },
  notes: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, options);
welfareSchema.plugin(AutoIncrement, { inc_field: 'id', id: 'welfare_id_counter' });

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
