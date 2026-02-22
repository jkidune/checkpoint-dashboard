const { db, nextId } = require('./database');
const bcrypt = require('bcryptjs');

console.log('🌱 Seeding Checkpoint database with real data...');

// Clear existing data
db.set('members', []).set('contributions', []).set('fines', [])
  .set('loans', []).set('loan_repayments', []).set('transactions', [])
  .set('users', [])
  .set('_counters', { members:0, contributions:0, fines:0, loans:0, loan_repayments:0, transactions:0, users:0 })
  .write();

// ── MEMBERS ───────────────────────────────────────────────────────────────
const membersList = [
  { name:'Ansgar Thomas Kabutelana', phone:null, role:'member',    status:'active', entry_fee:100000, join_date:'2020-08-02' },
  { name:'Elias Prosper Wakara',     phone:null, role:'member',    status:'active', entry_fee:100000, join_date:'2020-08-02' },
  { name:'Emmanuel Giddamis',        phone:null, role:'member',    status:'active', entry_fee:100000, join_date:'2020-08-02' },
  { name:'Gibson Gosbert Mulokozi',  phone:null, role:'secretary', status:'active', entry_fee:100000, join_date:'2020-08-02' },
  { name:'Ignas Lukanga',            phone:null, role:'member',    status:'active', entry_fee:100000, join_date:'2020-08-02' },
  { name:'Jakob Shauri Daniel',      phone:null, role:'member',    status:'active', entry_fee:100000, join_date:'2020-08-02' },
  { name:'Joseph Masonda',           phone:null, role:'member',    status:'active', entry_fee:100000, join_date:'2020-08-02' },
  { name:'Peter Lema',               phone:null, role:'member',    status:'active', entry_fee:100000, join_date:'2020-08-02' },
  { name:'Samwel Lembele',           phone:null, role:'chair',     status:'active', entry_fee:100000, join_date:'2020-08-02' },
  { name:'William George Mattao',    phone:null, role:'treasurer', status:'active', entry_fee:100000, join_date:'2020-08-02' },
];

const members = membersList.map(m => ({ id: nextId('members'), ...m, created_at: new Date().toISOString() }));
db.set('members', members).write();
console.log('✅ Members inserted:', members.length);

// Helper: find member id by partial name
function memberId(partial) {
  const m = db.get('members').find(m => m.name.toLowerCase().includes(partial.toLowerCase())).value();
  if (!m) throw new Error('Member not found: ' + partial);
  return m.id;
}

// ── FY2024 CONTRIBUTIONS (50,000/month, Jan–Dec 2024 + Jan–Feb 2025) ─────
const names2024 = ['Ansgar','Elias','Emmanuel','Gibson','Ignas','Jakob','Joseph','Peter','Samwel','William'];
const contribs = [];

for (const name of names2024) {
  const mid = memberId(name);
  // Jan 2024 – Dec 2024
  for (let month = 1; month <= 12; month++) {
    contribs.push({ id: nextId('contributions'), member_id: mid, amount: 50000, month, year: 2024,
      status:'paid', paid_date:`2024-${String(month).padStart(2,'0')}-05`, mpesa_ref:null, notes:null, created_at:new Date().toISOString() });
  }
  // Jan + Feb 2025 (still part of FY2024 sheet)
  for (const month of [1, 2]) {
    contribs.push({ id: nextId('contributions'), member_id: mid, amount: 50000, month, year: 2025,
      status:'paid', paid_date:`2025-${String(month).padStart(2,'0')}-05`, mpesa_ref:null, notes:null, created_at:new Date().toISOString() });
  }
}

// ── FY2025 CONTRIBUTIONS (75,000/month, Mar–Dec 2025) ────────────────────
// [name, [Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec]]
const fy2025 = [
  ['Ansgar',   [75000,75000,75000,75000,75000,75000,75000,75000,75000,null]],
  ['Elias',    [null, null, null, null, null, null, null, null, null, null]],
  ['Emmanuel', [75000,75000,75000,75000,75000,75000,75000,75000,75000,null]],
  ['Gibson',   [75000,75000,75000,75000,75000,75000,75000,75000,75000,75000]],
  ['Ignas',    [75000,75000,75000,75000,75000,75000,75000,75000,75000,null]],
  ['Jakob',    [75000,75000,75000,75000,75000,75000,75000,75000,75000,75000]],
  ['Joseph',   [75000,75000,75000,75000,75000,75000,75000,75000,75000,75000]],
  ['Peter',    [75000,75000,75000,75000,75000,75000,75000,75000,50000,null]],
  ['Samwel',   [75000,75000,75000,75000,75000,75000,75000,75000,75000,75000]],
  ['William',  [75000,75000,75000,25000,0,    null, null, null, null, null]],
];
const months2025 = [3,4,5,6,7,8,9,10,11,12];

for (const [name, payments] of fy2025) {
  const mid = memberId(name);
  for (let i = 0; i < months2025.length; i++) {
    const amount = payments[i];
    if (amount && amount > 0) {
      const m = months2025[i];
      contribs.push({ id: nextId('contributions'), member_id: mid, amount, month: m, year: 2025,
        status:'paid', paid_date:`2025-${String(m).padStart(2,'0')}-05`, mpesa_ref:null, notes:null, created_at:new Date().toISOString() });
    }
  }
}

db.set('contributions', contribs).write();
console.log('✅ Contributions inserted:', contribs.length);

// ── FINES ─────────────────────────────────────────────────────────────────
const finesData = [
  ['Ansgar',   22500, 'paid',   '2025-12-01'],
  ['Elias',    25000, 'unpaid',  null],
  ['Emmanuel', 17500, 'paid',   '2025-11-01'],
  ['Gibson',   12500, 'paid',   '2025-10-01'],
  ['Ignas',    60000, 'paid',   '2025-09-01'],
  ['Jakob',    17500, 'paid',   '2025-08-01'],
  ['Joseph',    5000, 'paid',   '2025-07-01'],
  ['Peter',     7500, 'unpaid',  null],
  ['Samwel',   15000, 'paid',   '2025-11-15'],
  ['William',  30000, 'unpaid',  null],
];

const fines = finesData.filter(f => f[1] > 0).map(([name, amount, status, paid_date]) => ({
  id: nextId('fines'),
  member_id: memberId(name),
  amount, reason: 'Late contribution fines', year: 2025, status, paid_date,
  created_at: new Date().toISOString()
}));
db.set('fines', fines).write();
console.log('✅ Fines inserted:', fines.length);

// ── LOANS 2025 ────────────────────────────────────────────────────────────
const loansRaw = [
  ['William',  'Loan 1', 1400000, '2025-06-01',  'active'],
  ['Ignas',    'Loan 1', 1000000, '2025-02-21',  'paid'],
  ['Ignas',    'Loan 2', 2000000, '2025-05-13',  'paid'],
  ['Ignas',    'Loan 3', 2500000, '2025-12-26',  'active'],
  ['Joseph',   'Loan 1', 1000000, '2025-01-14',  'paid'],
  ['Joseph',   'Loan 2', 1000000, '2025-12-23',  'active'],
  ['Elias',    'Loan 1', 1000000, '2025-01-14',  'paid'],
  ['Gibson',   'Loan 1', 1000000, '2025-02-19',  'paid'],
  ['Gibson',   'Loan 2', 1000000, '2025-04-28',  'paid'],
  ['Gibson',   'Loan 3',  400000, '2025-10-20',  'paid'],
  ['Gibson',   'Loan 4', 1000000, '2025-11-12',  'paid'],
  ['Gibson',   'Loan 5', 2000000, '2025-12-22',  'active'],
  ['Peter',    'Loan 1', 1000000, '2025-01-18',  'paid'],
  ['Peter',    'Loan 2', 1500000, '2025-05-22',  'active'],
  ['Jakob',    'Loan 1',  500000, '2025-05-06',  'paid'],
  ['Jakob',    'Loan 2',  850000, '2025-06-18',  'active'],
  ['Ansgar',   'Loan 1',  750000, '2025-06-18',  'active'],
  ['Emmanuel', 'Loan 1',  400000, '2025-02-01',  'paid'],
  ['Emmanuel', 'Loan 2', 1000000, '2025-04-03',  'paid'],
  ['Emmanuel', 'Loan 3', 1200000, '2025-12-24',  'active'],
];

const loans = loansRaw.map(([name, loan_number, principal, issued_date, status]) => {
  const interest_amount = Math.round(principal * 0.05);
  return {
    id: nextId('loans'),
    member_id: memberId(name),
    loan_number, principal, interest_rate: 0.05,
    interest_amount, amount_deposited: principal - interest_amount,
    issued_date, due_date: null, status, fiscal_year: 2025, notes: null,
    created_at: new Date().toISOString()
  };
});
db.set('loans', loans).write();
console.log('✅ Loans inserted:', loans.length);

// ── REPAYMENTS ────────────────────────────────────────────────────────────
function getLoanId(namePartial, loanNum) {
  const mid = memberId(namePartial);
  const loan = db.get('loans').find(l => l.member_id === mid && l.loan_number === loanNum).value();
  return loan ? loan.id : null;
}

const repaymentsRaw = [
  ['Ignas',   'Loan 1', [[700000,'2025-07-25'],[300000,'2025-08-25']]],
  ['Ignas',   'Loan 2', [[390000,'2025-10-25'],[1610000,'2025-12-25']]],
  ['Joseph',  'Loan 1', [[125000,'2025-03-25'],[25000,'2025-04-25'],[25000,'2025-05-25'],[500000,'2025-08-25'],[325000,'2025-12-25']]],
  ['Elias',   'Loan 1', [[1000000,'2025-01-25']]],
  ['Gibson',  'Loan 1', [[1000000,'2025-03-25']]],
  ['Gibson',  'Loan 2', [[1050000,'2025-09-25']]],
  ['Gibson',  'Loan 3', [[350000,'2025-10-25'],[50000,'2025-11-25']]],
  ['Gibson',  'Loan 4', [[100000,'2025-11-25'],[900000,'2025-12-25']]],
  ['Gibson',  'Loan 5', [[200000,'2025-12-25']]],
  ['Peter',   'Loan 1', [[150000,'2025-03-25'],[125000,'2025-04-25'],[225000,'2025-05-25'],[500000,'2025-06-25']]],
  ['Peter',   'Loan 2', [[1500000,'2025-12-25']]],
  ['Jakob',   'Loan 1', [[500000,'2025-06-25']]],
  ['Jakob',   'Loan 2', [[50000,'2025-07-25'],[110000,'2025-11-25'],[690000,'2025-12-25']]],
  ['Ansgar',  'Loan 1', [[157500,'2025-12-25']]],
  ['Emmanuel','Loan 1', [[170000,'2025-02-25'],[230000,'2025-04-25']]],
  ['Emmanuel','Loan 2', [[300000,'2025-04-25'],[200000,'2025-07-25'],[500000,'2025-12-25']]],
];

const repayments = [];
for (const [name, num, payments] of repaymentsRaw) {
  const lid = getLoanId(name, num);
  if (lid) {
    for (const [amount, repayment_date] of payments) {
      repayments.push({ id: nextId('loan_repayments'), loan_id: lid, amount, repayment_date, mpesa_ref: null, notes: null, created_at: new Date().toISOString() });
    }
  }
}
db.set('loan_repayments', repayments).write();
console.log('✅ Repayments inserted:', repayments.length);

// ── TRANSACTIONS ──────────────────────────────────────────────────────────
const txRaw = [
  ['Gibson',   1200000, 'contribution',    '2025-09-22'],
  ['Emmanuel',  200000, 'contribution',    '2025-07-27'],
  ['Jakob',     125000, 'contribution',    '2025-07-03'],
  ['Joseph',     75000, 'contribution',    '2025-06-26'],
  ['Ansgar',    750000, 'group_transfer',  '2025-06-18'],
  ['Jakob',     807500, 'group_transfer',  '2025-06-18'],
  ['Jakob',     500000, 'contribution',    '2025-06-18'],
  ['Ansgar',    200000, 'contribution',    '2025-06-16'],
  ['Joseph',    100000, 'contribution',    '2025-06-03'],
  ['Samwel',     50000, 'contribution',    '2025-06-02'],
  ['Jakob',      75000, 'contribution',    '2025-06-02'],
  ['William',  1330000, 'group_transfer',  '2025-06-01'],
  ['William',    50000, 'contribution',    '2025-06-01'],
  ['William',   550000, 'contribution',    '2025-05-31'],
  ['Peter',    1425000, 'group_transfer',  '2025-05-22'],
  ['Peter',     500000, 'contribution',    '2025-05-19'],
  ['Ignas',    1900000, 'group_transfer',  '2025-05-13'],
  ['Ignas',     525000, 'contribution',    '2025-05-09'],
  ['Jakob',     475000, 'group_transfer',  '2025-05-06'],
  ['Peter',     300000, 'contribution',    '2025-05-01'],
  ['Jakob',      75000, 'contribution',    '2025-05-01'],
  ['Ignas',     700000, 'contribution',    '2025-05-01'],
  ['Gibson',   1000000, 'group_transfer',  '2025-04-28'],
  ['Joseph',    100000, 'contribution',    '2025-04-27'],
  ['Emmanuel',  300000, 'contribution',    '2025-04-26'],
  ['Emmanuel',  950000, 'group_transfer',  '2025-04-03'],
  ['Emmanuel',  500000, 'contribution',    '2025-04-02'],
  ['Jakob',      75000, 'contribution',    '2025-04-01'],
  ['Ansgar',    300000, 'contribution',    '2025-03-29'],
  ['Peter',     200000, 'contribution',    '2025-03-29'],
  ['Gibson',   1150000, 'contribution',    '2025-03-29'],
  ['Joseph',    100000, 'contribution',    '2025-03-28'],
  ['William',   200000, 'contribution',    '2025-03-27'],
  ['William',   400000, 'group_transfer',  '2025-03-20'],
  ['Jakob',     152500, 'contribution',    '2025-03-02'],
  ['Peter',     200000, 'contribution',    '2025-03-01'],
  ['Joseph',    100000, 'contribution',    '2025-03-01'],
];

const transactions = txRaw.map(([name, amount, type, transaction_date]) => {
  let mid = null;
  try { mid = memberId(name); } catch(e) {}
  return { id: nextId('transactions'), member_id: mid, amount, type, description: `${type} - ${name}`, reference: null, transaction_date, created_at: new Date().toISOString() };
});
db.set('transactions', transactions).write();
console.log('✅ Transactions inserted:', transactions.length);

// ── USERS ─────────────────────────────────────────────────────────────────
const adminHash = bcrypt.hashSync('admin123', 10);
const memberHash = bcrypt.hashSync('checkpoint2025', 10);

const allMembers = db.get('members').value();
const users = [
  { id: nextId('users'), member_id: null, username: 'admin', password_hash: adminHash, role: 'admin', created_at: new Date().toISOString() },
  ...allMembers.map(m => ({
    id: nextId('users'),
    member_id: m.id,
    username: m.name.split(' ')[0].toLowerCase(),
    password_hash: memberHash,
    role: 'member',
    created_at: new Date().toISOString()
  }))
];
db.set('users', users).write();
console.log('✅ Users created');

console.log('\n🎉 Database seeded successfully!');
console.log('📊 Summary:');
console.log('   Members:      ', db.get('members').value().length);
console.log('   Contributions:', db.get('contributions').value().length);
console.log('   Loans:        ', db.get('loans').value().length);
console.log('   Repayments:   ', db.get('loan_repayments').value().length);
console.log('   Transactions: ', db.get('transactions').value().length);
console.log('   Users:        ', db.get('users').value().length);
console.log('\n🔑 Login: admin / admin123');
console.log('🔑 Members: firstname / checkpoint2025');
