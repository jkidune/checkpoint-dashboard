require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { Member, Contribution, Loan, Repayment, Transaction, User, Fine } = require('../db/models');

async function initCounters() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const collections = [
    { model: Member, id: 'member_id_counter' },
    { model: Contribution, id: 'contribution_id_counter' },
    { model: Loan, id: 'loan_id_counter' },
    { model: Repayment, id: 'repayment_id_counter' },
    { model: Transaction, id: 'transaction_id_counter' },
    { model: User, id: 'user_id_counter' },
    { model: Fine, id: 'fine_id_counter' }
  ];

  for (const col of collections) {
    const lastDoc = await col.model.findOne().sort({ id: -1 });
    const maxSeq = lastDoc && lastDoc.id ? lastDoc.id : 0;
    
    await mongoose.connection.collection('counters').updateOne(
      { id: col.id },
      { $set: { seq: maxSeq } },
      { upsert: true }
    );
    console.log(`Set ${col.id} to ${maxSeq}`);
  }

  console.log('Counters initialized!');
  process.exit(0);
}

initCounters();
