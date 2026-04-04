require('dotenv').config({ path: __dirname + '/../.env' });
const connectDB = require('../db/mongoose');
const { User, Member, Contribution, Loan, Repayment, Transaction, Fine } = require('../db/models');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const DB_PATH = path.join(__dirname, '../db/checkpoint.json');
const adapter = new FileSync(DB_PATH);
const db = low(adapter);

async function migrateData() {
  await connectDB();
  console.log('Starting migration...');

  try {
    const users = db.get('users').value() || [];
    const members = db.get('members').value() || [];
    const contributions = db.get('contributions').value() || [];
    const loans = db.get('loans').value() || [];
    const loan_repayments = db.get('loan_repayments').value() || [];
    const transactions = db.get('transactions').value() || [];
    const fines = db.get('fines').value() || [];

    // Migrate each collection
    console.log(`Migrating ${users.length} users...`);
    if (users.length) await User.insertMany(users);

    console.log(`Migrating ${members.length} members...`);
    if (members.length) await Member.insertMany(members);

    console.log(`Migrating ${contributions.length} contributions...`);
    if (contributions.length) await Contribution.insertMany(contributions);

    console.log(`Migrating ${loans.length} loans...`);
    if (loans.length) await Loan.insertMany(loans);

    console.log(`Migrating ${loan_repayments.length} loan repayments...`);
    if (loan_repayments.length) await Repayment.insertMany(loan_repayments);

    console.log(`Migrating ${transactions.length} transactions...`);
    if (transactions.length) await Transaction.insertMany(transactions);

    console.log(`Migrating ${fines.length} fines...`);
    if (fines.length) await Fine.insertMany(fines);

    console.log('Migration Completed Successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrateData();
