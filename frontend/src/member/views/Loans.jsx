import { Banknote, CircleDollarSign, CheckCircle2 } from 'lucide-react';
import { SectionHeader, StatCard, StatusPill, Card, Table, Loading, useApi, fmt } from '../components/Primitives';
import { loans as loansApi } from '../../api';

export default function MemberLoansPage() {
  const { data: myLoans, loading } = useApi(() => loansApi.list());

  if (loading) return <Loading />;

  const loans = myLoans || [];
  const active = loans.filter((l) => l.status === 'active');
  const totalBalance = active.reduce((s, l) => s + (l.balance ?? (l.principal - l.total_repaid)), 0);
  const totalRepaid = loans.reduce((s, l) => s + (l.total_repaid || 0), 0);

  return (
    <div className="m-page">
      <SectionHeader title="My Loans" sub="Every loan you've taken, balances, and due dates" />

      <div className="m-stats-grid">
        <StatCard icon={<Banknote size={17} />} iconBg="var(--m-accent-blue-bg)" iconColor="var(--m-accent-blue)" label="Active Loans" value={active.length} />
        <StatCard icon={<CircleDollarSign size={17} />} iconBg="var(--m-accent-red-bg)" iconColor="var(--m-accent-red)" label="Outstanding Balance" value={fmt(totalBalance)} />
        <StatCard icon={<CheckCircle2 size={17} />} iconBg="var(--m-accent-green-bg)" iconColor="var(--m-accent-green)" label="Total Repaid (all-time)" value={fmt(totalRepaid)} />
      </div>

      <Card style={{ padding: 0 }}>
        <div style={{ padding: '18px 20px 4px', fontSize: 16, fontWeight: 800, fontFamily: 'var(--m-font-display)' }}>Loan History</div>
        <div style={{ padding: 16 }}>
          <Table
            columns={[
              { key: 'loan_number', label: 'Loan #' },
              { key: 'principal', label: 'Principal', render: (r) => fmt(r.principal) },
              { key: 'balance', label: 'Balance', render: (r) => fmt(r.balance ?? (r.principal - r.total_repaid)) },
              { key: 'issued_date', label: 'Issued' },
              { key: 'due_date', label: 'Due', render: (r) => r.due_date || '—' },
              { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            ]}
            rows={loans}
            empty="No loans on record."
          />
        </div>
      </Card>
    </div>
  );
}
