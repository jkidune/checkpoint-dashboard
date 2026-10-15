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
// auto-increment hook, so the records are given an explicit `id` from the
// request tenant's OWN counters (models.getNextId) before they are inserted
// — member_id / contribution_id / loan_id for the imported records and
// transaction_id for the contribution / loan-disbursement transactions this
// route creates. The same tenant's Counter therefore advances; no other
// database's counters are read or written.

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
      for (const insert of inserts) insert.id = await models.getNextId('member_id');
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
      for (const insert of inserts) insert.id = await models.getNextId('contribution_id');
      await models.Contribution.insertMany(inserts);
      
      const txInserts = inserts.map(c => ({
        member_id: c.member_id,
        amount: c.amount,
        type: 'contribution',
        description: `Imported contribution`,
        transaction_date: c.paid_date || new Date().toISOString().split('T')[0]
      }));
      for (const txInsert of txInserts) txInsert.id = await models.getNextId('transaction_id');
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
      for (const insert of inserts) insert.id = await models.getNextId('loan_id');
      await models.Loan.insertMany(inserts);
      
      const txInserts = inserts.map(l => ({
        member_id: l.member_id,
        amount: l.principal,
        type: 'loan_disbursement',
        description: `Imported loan disbursement`,
        transaction_date: l.issued_date || new Date().toISOString().split('T')[0]
      }));
      for (const txInsert of txInserts) txInsert.id = await models.getNextId('transaction_id');
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
