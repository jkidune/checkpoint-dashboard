import { useState, useMemo } from 'react';
import { SectionHeader, StatusPill, Card, Table, Loading, useApi, fmt } from '../components/Primitives';
import { members, loans as loansApi } from '../../api';
import { buildActivityFeed } from '../lib/activityFeed';

const TABS = [['all', 'All'], ['contributions', 'Contributions'], ['loans', 'Loans'], ['fines', 'Fines']];

export default function MemberTransactionsPage() {
  const { data: me, loading: meLoading } = useApi(() => members.me());
  const { data: myLoans, loading: loansLoading } = useApi(() => loansApi.list());
  const [filter, setFilter] = useState('all');

  const feed = useMemo(() => buildActivityFeed(me, myLoans), [me, myLoans]);
  const filtered = filter === 'all' ? feed : feed.filter((r) => r.group === filter);
  const loading = meLoading || loansLoading;

  return (
    <div className="m-page">
      <SectionHeader
        title="My Activity"
        sub="Your own contributions, loans, and fines — not the club-wide ledger"
      />

      {loading ? <Loading /> : (
        <Card style={{ padding: 0 }}>
          <div style={{ display: 'flex', gap: 6, padding: '18px 20px 4px', flexWrap: 'wrap' }}>
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className="m-btn m-btn-sm"
                style={{
                  background: filter === key ? 'var(--m-accent-blue-bg)' : 'transparent',
                  color: filter === key ? 'var(--m-accent-blue)' : 'var(--m-text-muted)',
                  border: '1px solid ' + (filter === key ? 'var(--m-accent-blue-bg)' : 'var(--m-border)'),
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ padding: 16 }}>
            <Table
              columns={[
                { key: 'id', label: 'ID' },
                { key: 'item', label: 'Item' },
                { key: 'date', label: 'Date' },
                { key: 'amount', label: 'Amount', render: (r) => fmt(r.amount) },
                { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
              ]}
              rows={filtered}
              empty="No activity yet."
            />
          </div>
        </Card>
      )}
    </div>
  );
}
