const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const DB_PATH = path.join(__dirname, 'checkpoint.json');
const adapter = new FileSync(DB_PATH);
const db = low(adapter);

// Set default structure
db.defaults({
  members: [],
  contributions: [],
  fines: [],
  loans: [],
  loan_repayments: [],
  transactions: [],
  users: [],
  _counters: {
    members: 0, contributions: 0, fines: 0,
    loans: 0, loan_repayments: 0, transactions: 0, users: 0,
  }
}).write();

// Auto-increment ID helper
function nextId(table) {
  const current = db.get('_counters.' + table).value();
  const next = current + 1;
  db.set('_counters.' + table, next).write();
  return next;
}

module.exports = { db, nextId };
