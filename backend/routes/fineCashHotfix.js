const express = require('express');
const router = express.Router();

const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  Fine,
  Transaction,
  ReconciliationRun,
  getNextId,
} = require('../db/models');

function dateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function reconciliationCashDate(reconciliation) {
  return dateKey(reconciliation?.reporting_cutoff?.Y3_loans)
    || dateKey(reconciliation?.reporting_cutoff?.contributions)
    || dateKey(reconciliation?.source_generated_on)
    || dateKey(reconciliation?.applied_at);
}

function recordIsAfterReconciliation(financialDate, createdAt, cutoffDate, appliedAt) {
  const key = dateKey(financialDate);
  if (!key || !cutoffDate) return false;
  if (key > cutoffDate) return true;
  if (key < cutoffDate) return false;

  if (!appliedAt || !createdAt) return false;
  const created = new Date(createdAt);
  const applied = new Date(appliedAt);
  return !Number.isNaN(created.getTime())
    && !Number.isNaN(applied.getTime())
    && created > applied;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function sameReceipt(transaction, fine, effectiveDate) {
  return Number(transaction.member_id) === Number(fine.member_id)
    && Number(transaction.amount || 0) === Number(fine.amount || 0)
    && dateKey(transaction.transaction_date) === effectiveDate;
}

/**
 * Keep the transaction ledger complete for paid fines after the last verified
 * reconciliation snapshot.
 *
 * Form Intake already creates fine_payment transactions. The historical/manual
 * Admin "mark fine paid" flow used to update only the Fine document, leaving no
 * cash receipt for the Overview movement bridge. This sync uses the paid Fine
 * record as the authoritative fallback and creates only a missing receipt.
 */
async function syncPaidFineReceipts() {
  const reconciliation = await ReconciliationRun.findOne({
    status: { $in: ['applied', 'PARTIALLY_RECONCILED', 'partially_reconciled'] },
  })
    .sort({ applied_at: -1, created_at: -1 })
    .select('-backup')
    .lean();

  if (!reconciliation) return { created: 0, matched: 0 };

  const cutoffDate = reconciliationCashDate(reconciliation);
  if (!cutoffDate) return { created: 0, matched: 0 };

  const [paidFines, fineTransactions] = await Promise.all([
    Fine.find({ status: 'paid' }).sort({ paid_date: 1, created_at: 1, id: 1 }).lean(),
    Transaction.find({ type: 'fine_payment' }).sort({ transaction_date: 1, created_at: 1, id: 1 }).lean(),
  ]);

  const postReconciliationTransactions = fineTransactions.filter((transaction) => (
    recordIsAfterReconciliation(
      transaction.transaction_date,
      transaction.created_at,
      cutoffDate,
      reconciliation.applied_at,
    )
  ));

  const usedTransactionIds = new Set();
  let created = 0;
  let matched = 0;

  for (const fine of paidFines) {
    // Future clears always receive paid_date via middleware below. For older
    // post-reconciliation fines that were already marked paid without one, the
    // creation date is the safest available fallback. We never use that fallback
    // for a fine created on/before the verified reconciliation cutoff.
    const createdDate = dateKey(fine.created_at);
    const effectiveDate = dateKey(fine.paid_date)
      || (createdDate && createdDate > cutoffDate ? createdDate : null);

    if (!effectiveDate) continue;
    if (!recordIsAfterReconciliation(
      effectiveDate,
      fine.created_at,
      cutoffDate,
      reconciliation.applied_at,
    )) continue;

    const canonicalReference = `fine:${fine.id}`;

    let existing = postReconciliationTransactions.find((transaction) => (
      !usedTransactionIds.has(transaction.id)
      && transaction.reference === canonicalReference
    ));

    // Older Form Intake receipts use the member's M-Pesa reference rather than
    // fine:<id>. Match them by member + amount + payment date so the receipt is
    // not created twice. Each matched transaction can satisfy only one fine.
    if (!existing) {
      existing = postReconciliationTransactions.find((transaction) => (
        !usedTransactionIds.has(transaction.id)
        && sameReceipt(transaction, fine, effectiveDate)
        && (
          !fine.reason
          || normalizeText(transaction.description).includes(normalizeText(fine.reason))
          || normalizeText(transaction.description).includes('fine payment')
        )
      ));
    }

    if (existing) {
      usedTransactionIds.add(existing.id);
      matched += 1;
      continue;
    }

    const transaction = await Transaction.create({
      id: await getNextId('transaction_id'),
      member_id: fine.member_id,
      amount: Number(fine.amount || 0),
      type: 'fine_payment',
      description: `Fine payment — ${fine.reason || `Fine #${fine.id}`}`,
      reference: canonicalReference,
      transaction_date: effectiveDate,
    });

    usedTransactionIds.add(transaction.id);
    postReconciliationTransactions.push(transaction.toObject());
    created += 1;
  }

  return { created, matched };
}

// Future manual Fine creation/clearing must always carry a financial payment
// date. The main summary route performs the Fine mutation after next().
function ensurePaidDate(req, res, next) {
  if (String(req.body?.status || '').toLowerCase() === 'paid' && !req.body.paid_date) {
    req.body.paid_date = new Date().toISOString().slice(0, 10);
  }
  next();
}

// Once the main Fine endpoint has successfully written a Paid state, immediately
// repair/create its cash receipt. Overview also runs the sync again, making the
// workflow idempotent and safe if a response is retried.
function syncAfterSuccessfulResponse(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      syncPaidFineReceipts().catch((error) => {
        console.error('[fine-cash-hotfix] Post-write fine receipt sync failed:', error);
      });
    }
  });
  next();
}

router.post('/fines', authenticate, requireAdmin, ensurePaidDate, syncAfterSuccessfulResponse);
router.patch('/fines/:id', authenticate, requireAdmin, ensurePaidDate, syncAfterSuccessfulResponse);

// Before Overview/snapshot is calculated, repair any missing post-reconciliation
// fine receipts. This also picks up fines cleared before this hotfix was deployed
// when their payment date is known (or the fine itself was created after cutoff).
router.get('/', authenticate, async (req, res, next) => {
  try {
    await syncPaidFineReceipts();
    next();
  } catch (error) {
    console.error('[fine-cash-hotfix] Failed to sync paid fine receipts:', error);
    next(error);
  }
});

router.get('/snapshot', authenticate, async (req, res, next) => {
  try {
    await syncPaidFineReceipts();
    next();
  } catch (error) {
    console.error('[fine-cash-hotfix] Failed to sync paid fine receipts:', error);
    next(error);
  }
});

module.exports = router;
