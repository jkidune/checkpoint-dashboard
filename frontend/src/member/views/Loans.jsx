import { useMemo } from 'react';
import { Banknote, CircleDollarSign, CheckCircle2, CalendarDays, ArrowDownToLine } from 'lucide-react';
import { SectionHeader, StatCard, StatusPill, Card, Loading, useApi, fmt } from '../components/Primitives';
import { members } from '../../api';
import { loanBalance } from '../lib/finance';

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function MemberLoansPage() {
  const { data: me, loading } = useApi(() => members.me());

  const derived = useMemo(() => {
    const loans = me?.loans || [];
    const active = loans.filter((loan) => loan.status === 'active');
    const totalBalance = active.reduce((sum, loan) => sum + loanBalance(loan), 0);
    const totalRepaid = loans.reduce((sum, loan) => sum + Number(loan.total_repaid || 0), 0);
    const totalReceived = loans.filter((loan) => loan.disbursed !== false).reduce((sum, loan) => sum + Number(loan.amount_deposited || loan.principal || 0), 0);
    return { loans, active, totalBalance, totalRepaid, totalReceived };
  }, [me]);

  if (loading) return <Loading />;

  return (
    <div className="m-page">
      <SectionHeader title="My Loans" sub="Your loan history, repayments and current outstanding balance" />

      <div className="m-stats-grid">
        <StatCard icon={<Banknote size={17} />} iconBg="var(--m-accent-blue-bg)" iconColor="var(--m-accent-blue)" label="Active Loans" value={derived.active.length} />
        <StatCard icon={<CircleDollarSign size={17} />} iconBg="var(--m-accent-red-bg)" iconColor="var(--m-accent-red)" label="Outstanding Balance" value={fmt(derived.totalBalance)} />
        <StatCard icon={<CheckCircle2 size={17} />} iconBg="var(--m-accent-green-bg)" iconColor="var(--m-accent-green)" label="Total Repaid" value={fmt(derived.totalRepaid)} />
        <StatCard icon={<ArrowDownToLine size={17} />} iconBg="var(--m-accent-amber-bg)" iconColor="var(--m-accent-amber)" label="Cash Received" value={fmt(derived.totalReceived)} help={{ body: 'Net loan cash actually received after any upfront interest deduction recorded for the loan.' }} />
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        {derived.loans.length === 0 ? (
          <Card><div style={{ padding: 24, textAlign: 'center', color: 'var(--m-text-muted)', fontSize: 12.5 }}>No loans are linked to your member account.</div></Card>
        ) : derived.loans.map((loan) => {
          const balance = loanBalance(loan);
          const totalRepaid = Number(loan.total_repaid || 0);
          const principal = Number(loan.principal || 0);
          const progress = principal > 0 ? Math.min(100, Math.round((totalRepaid / principal) * 100)) : 0;
          const repayments = loan.repayments || [];
          return (
            <Card key={loan.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{loan.loan_number || `Loan #${loan.id}`}</div>
                    <StatusPill status={loan.status} />
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--m-text-muted)', marginTop: 5 }}>
                    Issued {dateLabel(loan.issued_date)}{loan.due_date ? ` · Due ${dateLabel(loan.due_date)}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)' }}>Outstanding</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: balance > 0 ? 'var(--m-accent-red)' : 'var(--m-accent-green)' }}>{fmt(balance)}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 18 }}>
                {[
                  ['Principal', fmt(principal)],
                  ['Interest', fmt(loan.interest_amount || 0)],
                  ['Cash received', fmt(loan.amount_deposited || principal)],
                  ['Total repaid', fmt(totalRepaid)],
                ].map(([label, value]) => (
                  <div key={label} style={{ border: '1px solid var(--m-border)', borderRadius: 10, padding: 11, background: '#fafafa' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)' }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 750, marginTop: 4 }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--m-text-muted)', marginBottom: 6 }}>
                  <span>Repayment progress</span><span>{progress}%</span>
                </div>
                <div style={{ height: 7, background: '#f4f4f5', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: 'var(--m-accent-green)', borderRadius: 99 }} />
                </div>
              </div>

              <div style={{ marginTop: 18, borderTop: '1px solid var(--m-border)', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 750, marginBottom: 10 }}><CalendarDays size={14} /> Repayment history</div>
                {repayments.length === 0 ? (
                  <div style={{ color: 'var(--m-text-muted)', fontSize: 11.5, padding: '8px 0' }}>No repayments recorded for this loan yet.</div>
                ) : repayments.map((repayment) => (
                  <div key={repayment.id} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--m-border)' }}>
                    <span style={{ fontSize: 11, color: 'var(--m-text-muted)' }}>{dateLabel(repayment.repayment_date)}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--m-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{repayment.mpesa_ref || repayment.notes || 'Repayment'}</span>
                    <strong style={{ fontSize: 12 }}>{fmt(repayment.amount)}</strong>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
