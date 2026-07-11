import { Receipt } from 'lucide-react';
import { SectionHeader, StatCard, Card, Table, Loading, useApi, fmt } from '../components/Primitives';
import { expenses as expensesApi } from '../../api';

export default function MemberExpensesPage() {
  const { data, loading } = useApi(() => expensesApi.list());

  if (loading) return <Loading />;
  const list = data || [];
  const total = list.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="m-page">
      <SectionHeader title="Group Expenses" sub="Outgoing club funds — AGM costs, registration fees, admin, and more" />

      <div className="m-stats-grid">
        <StatCard icon={<Receipt size={17} />} iconBg="var(--m-accent-amber-bg)" iconColor="var(--m-accent-amber)" label="Total Recorded" value={fmt(total)} />
      </div>

      <Card style={{ padding: 0 }}>
        <div style={{ padding: 16 }}>
          <Table
            columns={[
              { key: 'expense_date', label: 'Date' },
              { key: 'category', label: 'Category' },
              { key: 'description', label: 'Description' },
              { key: 'amount', label: 'Amount', render: (r) => fmt(r.amount) },
            ]}
            rows={list}
            empty="No expenses recorded yet."
          />
        </div>
      </Card>
    </div>
  );
}
