// Merges a member's own contributions, loans, and fines into one activity
// feed, sorted newest first. Members don't have raw transaction-ledger
// access (GET /api/transactions is admin-only), so this is assembled
// client-side from data already scoped to the caller by the backend.
export function buildActivityFeed(me, myLoans) {
  if (!me) return [];
  const rows = [];

  (me.contributions || []).forEach((c) => rows.push({
    key: `c-${c.id}`, id: `CN-${c.id}`, item: 'Contribution', date: c.paid_date,
    amount: c.amount, status: c.status, group: 'contributions',
  }));
  (myLoans || []).forEach((l) => rows.push({
    key: `l-${l.id}`, id: `LN-${l.id}`, item: 'Loan', date: l.issued_date,
    amount: l.principal, status: l.status, group: 'loans',
  }));
  (me.fines || []).forEach((f) => rows.push({
    key: `f-${f.id}`, id: `FN-${f.id}`, item: 'Fine', date: f.paid_date || f.created_at?.slice(0, 10),
    amount: f.amount, status: f.status, group: 'fines',
  }));

  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
