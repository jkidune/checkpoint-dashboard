const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Phase 4F-A: this route no longer imports the default/legacy model
// registry. Every database read/write below comes from req.tenantModels,
// established by `authenticate` from the verified JWT's organization_id.
// There is no fallback to a default/global model set — if authenticate
// succeeded, req.tenantModels is expected to exist, and a missing bundle
// throws (property access on undefined) rather than quietly using another
// database.
//
// Numeric ids: Model.insertMany() never runs the schemas' pre('save')
// auto-increment hook, so the records are given an explicit `id` before they
// are inserted. The ids are RESERVED IN BULK from the request tenant's OWN
// counters (models.Counter, via reserveIdRange below): ONE atomic `$inc` per
// counter and range — N records cost one counter write, not N sequential
// round trips — and are then assigned locally, in CSV order. The counter
// documents and the counter state left behind are exactly what N sequential
// models.getNextId() calls would have produced: member_id / contribution_id /
// loan_id for the imported records, transaction_id for the contribution /
// loan-disbursement transactions this route creates. No other database's
// counters are read or written.

// The only counters an import may draw from. A fixed list on purpose: the
// counter name is never derived from the request.
const IMPORT_COUNTERS = new Set(['member_id', 'contribution_id', 'loan_id', 'transaction_id']);

/**
 * Reserves `count` consecutive ids from the request tenant's own counter with
 * ONE atomic increment and returns them in ascending order. Model-explicit:
 * it reads the Counter ONLY from the tenant model bundle it is given
 * (models.Counter) - there is no default connection, no fallback and no
 * counter model or database taken from anywhere else.
 *
 * Same counter documents, same upsert/seed behaviour as models.getNextId():
 * `findByIdAndUpdate(name, { $inc }, { returnDocument: 'after', upsert: true })`
 * on the tenant's `auto_counters`. Reserving N ids therefore yields the very
 * ids and the very counter state that N sequential getNextId() calls would
 * (an absent counter is seeded: ids 1..N, counter N) - but in a single
 * round trip, and under concurrency as a contiguous block that no other
 * allocation can interleave with.
 *
 * count === 0 reserves nothing: no counter write, empty range.
 *
 * @param {object} models   the request's tenant bundle (req.tenantModels)
 * @param {string} counterName one of IMPORT_COUNTERS
 * @param {number} count    number of ids to reserve (non-negative integer)
 * @returns {Promise<number[]>}
 */
async function reserveIdRange(models, counterName, count) {
  if (!IMPORT_COUNTERS.has(counterName)) throw new Error(`reserveIdRange: unsupported counter "${counterName}"`);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('reserveIdRange: count must be a non-negative integer');
  if (count === 0) return [];

  const counter = await models.Counter.findByIdAndUpdate(
    counterName,
    { $inc: { seq: count } },
    { returnDocument: 'after', upsert: true }
  );
  const first = counter.seq - count + 1;
  return Array.from({ length: count }, (_, index) => first + index);
}

const upload = multer({ storage: multer.memoryStorage() });

router.post('/:type', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const models = req.tenantModels;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const type = req.params.type; // 'members', 'contributions', 'loans'
    const csvData = req.file.buffer.toString('utf-8');
    const records = parse(csvData, { columns: true, skip_empty_lines: true });
    
    if (records.length === 0) return res.status(400).json({ error: 'CSV file is empty' });

    let count = 0;
    
    if (type === 'members') {
      const inserts = records.map(r => ({
        name: r.name,
        phone: r.phone || null,
        office: r.office || 'member',
        status: r.status || 'active',
        entry_fee: r.entry_fee ? parseInt(r.entry_fee) : 100000,
        join_date: r.join_date || null
      }));
      const memberIds = await reserveIdRange(models, 'member_id', inserts.length);
      inserts.forEach((insert, index) => { insert.id = memberIds[index]; });
      await models.Member.insertMany(inserts);
      count = inserts.length;
    } 
    else if (type === 'contributions') {
      const inserts = records.map(r => ({
        member_id: parseInt(r.member_id),
        amount: parseInt(r.amount),
        month: parseInt(r.month),
        year: parseInt(r.year),
        status: r.status || 'paid',
        paid_date: r.paid_date || null,
        mpesa_ref: r.mpesa_ref || null,
        notes: r.notes || null,
      }));
      const contributionIds = await reserveIdRange(models, 'contribution_id', inserts.length);
      inserts.forEach((insert, index) => { insert.id = contributionIds[index]; });
      await models.Contribution.insertMany(inserts);
      
      const txInserts = inserts.map(c => ({
        member_id: c.member_id,
        amount: c.amount,
        type: 'contribution',
        description: `Imported contribution`,
        transaction_date: c.paid_date || new Date().toISOString().split('T')[0]
      }));
      const contributionTransactionIds = await reserveIdRange(models, 'transaction_id', txInserts.length);
      txInserts.forEach((txInsert, index) => { txInsert.id = contributionTransactionIds[index]; });
      await models.Transaction.insertMany(txInserts);
      
      count = inserts.length;
    } 
    else if (type === 'loans') {
      const inserts = records.map(r => {
        const principal = parseInt(r.principal);
        const interest_amount = Math.round(principal * 0.05);
        return {
          member_id: parseInt(r.member_id),
          loan_number: r.loan_number || `Imported Loan`,
          principal,
          interest_rate: 0.05,
          interest_amount,
          amount_deposited: principal - interest_amount,
          issued_date: r.issued_date || null,
          due_date: r.due_date || null,
          status: r.status || 'active',
          fiscal_year: r.fiscal_year ? parseInt(r.fiscal_year) : new Date().getFullYear(),
          notes: r.notes || null
        };
      });
      const loanIds = await reserveIdRange(models, 'loan_id', inserts.length);
      inserts.forEach((insert, index) => { insert.id = loanIds[index]; });
      await models.Loan.insertMany(inserts);
      
      const txInserts = inserts.map(l => ({
        member_id: l.member_id,
        amount: l.principal,
        type: 'loan_disbursement',
        description: `Imported loan disbursement`,
        transaction_date: l.issued_date || new Date().toISOString().split('T')[0]
      }));
      const loanTransactionIds = await reserveIdRange(models, 'transaction_id', txInserts.length);
      txInserts.forEach((txInsert, index) => { txInsert.id = loanTransactionIds[index]; });
      await models.Transaction.insertMany(txInserts);

      count = inserts.length;
    }
    else {
      return res.status(400).json({ error: `Invalid import type: ${type}` });
    }

    res.json({ success: true, imported: count });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Failed to process CSV file. Ensure you are using the correct headers.' });
  }
});

module.exports = router;
// Model-explicit helper, exported so the Phase 4F-A tests can exercise it directly (count 0, invalid input, concurrency).
module.exports.reserveIdRange = reserveIdRange;
