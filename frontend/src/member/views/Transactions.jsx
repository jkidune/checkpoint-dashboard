import { useMemo, useState } from 'react';
import { Search, ReceiptText } from 'lucide-react';
import { SectionHeader, Card, Loading, useApi, fmt } from '../components/Primitives';
import { transactions as transactionsApi } from '../../api';

const TABS = [
  ['all', 'All'],
  ['contribution', 'Contributions'],
  ['loan', 'Loans'],
  ['fine', 'Fines'],
];

function groupFor(type = '') {
  if (type.includes('contribution')) return 'contribution';
  if (type.includes('loan')) return 'loan';
  if (type.includes('fine')) return 'fine';
  return 'other';
}

function labelFor(transaction) {
  if (transaction.description) return transaction.description;
  return String(transaction.type || 'Transaction').replaceAll('_', ' ');
}

export default function MemberTransactionsPage() {
  const { data, loading } = useApi(() => transactionsApi.list({ limit: 200 }));
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const list = data?.transactions || [];
    return list.filter((transaction) => {
      const matchesType = filter === 'all' || groupFor(transaction.type) === filter;
      const needle = query.trim().toLowerCase();
      const matchesQuery = !needle || [transaction.description, transaction.reference, transaction.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
      return matchesType && matchesQuery;
    });
  }, [data, filter, query]);

  return (
    <div className="m-page">
      <SectionHeader title="My Transactions" sub="Your own Checkpoint ledger — contributions, loan movements, repayments and fines" />

      {loading ? <Loading /> : (
        <Card style={{ padding: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '16px 20px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className="m-btn m-btn-sm"
                  style={{
                    background: filter === key ? 'var(--m-accent-blue-bg)' : 'transparent',
                    color: filter === key ? 'var(--m-accent-blue)' : 'var(--m-text-muted)',
                    border: `1px solid ${filter === key ? '#bfdbfe' : 'var(--m-border)'}`,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ position: 'relative', minWidth: 230, flex: '0 1 300px' }}>
              <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--m-text-muted)' }} />
              <input
                className="m-form-input"
                style={{ width: '100%', paddingLeft: 32 }}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reference or activity…"
              />
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--m-border)' }}>
            {rows.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--m-text-muted)', fontSize: 12.5 }}>No matching ledger activity.</div>
            ) : rows.map((transaction) => (
              <div key={transaction.id} style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1.5fr) minmax(110px,.7fr) auto', gap: 12, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--m-border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: '#f4f4f5', display: 'grid', placeItems: 'center', color: 'var(--m-text-muted)' }}>
                  <ReceiptText size={14} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 650, textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelFor(transaction)}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', marginTop: 2 }}>{transaction.transaction_date || '—'}</div>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{transaction.reference || 'No reference'}</div>
                <strong style={{ fontSize: 12.5 }}>{fmt(transaction.amount)}</strong>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
