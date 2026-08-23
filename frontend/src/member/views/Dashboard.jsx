import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet2, Landmark, ShieldAlert, PiggyBank, ArrowRight, CheckCircle2,
  Clock3, AlertCircle, ReceiptText, TrendingUp, Banknote,
} from 'lucide-react';
import { SectionHeader, StatCard, Card, Loading, useApi, fmt } from '../components/Primitives';
import { members, summary, loans as loansApi, transactions as transactionsApi, rules as rulesApi, memberFinance } from '../../api';
import {
  FY_MONTHS,
  fiscalPeriodLabel,
  getCurrentFiscalYear,
  contributionAmountForPeriod,
  elapsedFiscalMonths,
  loanBalance,
} from '../lib/finance';

function shortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function transactionLabel(type, description) {
  if (description) return description;
  const labels = {
    contribution: 'Contribution',
    contribution_payment: 'Contribution',
    loan_repayment: 'Loan repayment',
    loan_disbursement: 'Loan disbursement',
    fine_payment: 'Fine payment',
    unapplied_member_credit: 'Member credit',
  };
  return labels[type] || String(type || 'Transaction').replaceAll('_', ' ');
}

export default function MemberDashboardPage() {
  const currentFY = getCurrentFiscalYear();
  const { data: me, loading: meLoading } = useApi(() => members.me());
  const { data: snapshot, loading: snapshotLoading } = useApi(() => summary.snapshot());
  const { data: myLoans, loading: loansLoading } = useApi(() => loansApi.list());
  const { data: txResponse, loading: txLoading } = useApi(() => transactionsApi.list({ limit: 8 }));
  const { data: fyRules, loading: rulesLoading } = useApi(() => rulesApi.get(currentFY), [currentFY]);
  const { data: eligibility, loading: eligibilityLoading } = useApi(
    () => memberFinance.loanEligibility({ fiscal_year: currentFY }),
    [currentFY],
  );

  const derived = useMemo(() => {
    if (!me) return null;
    const target = Number(fyRules?.contribution_amount || 0);
    const elapsed = elapsedFiscalMonths(currentFY);
    const periods = FY_MONTHS.map((month, index) => {
      const amount = contributionAmountForPeriod(me.contributions || [], month, currentFY);
      const elapsedPeriod = index < elapsed;
      const paid = target > 0 && amount >= target;
      const partial = amount > 0 && !paid;
      return { month, amount, paid, partial, elapsed: elapsedPeriod };
    });
    const paidToDate = periods.reduce((sum, period) => sum + period.amount, 0);
    const expectedToDate = target * elapsed;
    const fullyPaidMonths = periods.filter((period) => period.elapsed && period.paid).length;
    const activeLoans = (myLoans || []).filter((loan) => loan.status === 'active');
    const activeLoanBalance = activeLoans.reduce((sum, loan) => sum + loanBalance(loan), 0);
    const unpaidFines = (me.fines || []).filter((fine) => fine.status === 'unpaid');
    const unpaidFineTotal = unpaidFines.reduce((sum, fine) => sum + Number(fine.amount || 0), 0);

    let accountStatus = 'On track';
    let accountTone = 'good';
    if (unpaidFineTotal > 0 || periods.some((period) => period.elapsed && !period.paid)) {
      accountStatus = 'Needs attention';
      accountTone = 'attention';
    }

    return {
      target,
      elapsed,
      periods,
      paidToDate,
      expectedToDate,
      fullyPaidMonths,
      activeLoans,
      activeLoanBalance,
      unpaidFineTotal,
      accountStatus,
      accountTone,
    };
  }, [me, myLoans, fyRules, currentFY]);

  const transactions = txResponse?.transactions || [];
  const loading = meLoading || snapshotLoading || loansLoading || txLoading || rulesLoading || eligibilityLoading;

  if (loading) return <Loading />;
  if (!me || !derived) return null;

  const firstName = String(me.name || '').split(' ')[0] || 'Member';
  const loanRatioLabel = eligibility?.loan_max_ratio == null
    ? 'No FY cap'
    : `${Math.round(Number(eligibility.loan_max_ratio || 0) * 100)}% of net worth`;
  const maxLoanValue = eligibility?.max_eligible == null ? 'No cap' : fmt(eligibility.max_eligible);

  return (
    <div className="m-page">
      <SectionHeader
        title={`Welcome, ${firstName}`}
        sub={`Your Checkpoint position for FY${currentFY} · March ${currentFY} to February ${currentFY + 1}`}
        action={
          <Link to="/transactions" className="m-btn m-btn-secondary">
            View activity <ArrowRight size={13} />
          </Link>
        }
      />

      <div className="m-stats-grid">
        <StatCard
          icon={<Wallet2 size={17} />}
          iconBg="var(--m-accent-green-bg)"
          iconColor="var(--m-accent-green)"
          label={`My Contributions · FY${currentFY}`}
          value={fmt(derived.paidToDate)}
          help={{ body: `Expected to date: ${fmt(derived.expectedToDate)} based on the club's current monthly rule.` }}
        />
        <StatCard
          icon={<TrendingUp size={17} />}
          iconBg="var(--m-accent-blue-bg)"
          iconColor="var(--m-accent-blue)"
          label="My Net Worth"
          value={fmt(eligibility?.net_worth || 0)}
          help={{ body: `Net worth = lifetime contributions (${fmt(eligibility?.total_contributions || 0)}) + historical loan interest (${fmt(eligibility?.total_loan_interest || 0)}) + paid fines (${fmt(eligibility?.paid_fines || 0)}).` }}
        />
        <StatCard
          icon={<Banknote size={17} />}
          iconBg="var(--m-accent-green-bg)"
          iconColor="var(--m-accent-green)"
          label={`My Loan Access · FY${currentFY}`}
          value={maxLoanValue}
          help={{ body: `Current FY borrowing rule: ${loanRatioLabel}. A new FY${currentFY} loan carries ${((eligibility?.interest_rate || 0) * 100).toFixed(0)}% interest under the current rules. Final loan approval remains subject to the club's approval process.` }}
        />
        <StatCard
          icon={<Landmark size={17} />}
          iconBg="var(--m-accent-amber-bg)"
          iconColor="var(--m-accent-amber)"
          label="My Active Loan Balance"
          value={fmt(derived.activeLoanBalance)}
          help={{ body: 'The current outstanding balance from the same loan records used by the Admin portal.' }}
        />
        <StatCard
          icon={<ShieldAlert size={17} />}
          iconBg="var(--m-accent-red-bg)"
          iconColor="var(--m-accent-red)"
          label="My Unpaid Fines"
          value={fmt(derived.unpaidFineTotal)}
          help={{ body: 'Only fines currently recorded as unpaid on your member account.' }}
        />
        <StatCard
          icon={<PiggyBank size={17} />}
          iconBg="var(--m-accent-blue-bg)"
          iconColor="var(--m-accent-blue)"
          label="Club Cash Balance"
          value={fmt(snapshot?.cash_at_bank || 0)}
          help={{ body: snapshot?.cash_source === 'reconciled_physical' ? `Physical M-Koba control${snapshot.cash_as_of ? ` as of ${shortDate(snapshot.cash_as_of)}` : ''}.` : 'Calculated club cash based on the latest reconciled M-Koba opening balance and subsequent ledger movements.' }}
        />
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--m-text-primary)' }}>My borrowing position</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--m-text-muted)' }}>
              Your current member value and the FY{currentFY} maximum loan calculation.
            </div>
          </div>
          <Link to="/loans" className="m-btn m-btn-secondary m-btn-sm">My loans <ArrowRight size={12} /></Link>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 16 }}>
          <div style={{ border: '1px solid var(--m-border)', borderRadius: 11, padding: 14, background: '#fafafa' }}>
            <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Lifetime contributions</div>
            <strong style={{ display: 'block', marginTop: 5, fontSize: 16 }}>{fmt(eligibility?.total_contributions || 0)}</strong>
          </div>
          <div style={{ border: '1px solid var(--m-border)', borderRadius: 11, padding: 14, background: '#fafafa' }}>
            <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Historical loan interest</div>
            <strong style={{ display: 'block', marginTop: 5, fontSize: 16 }}>{fmt(eligibility?.total_loan_interest || 0)}</strong>
          </div>
          <div style={{ border: '1px solid var(--m-border)', borderRadius: 11, padding: 14, background: '#fafafa' }}>
            <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Paid fines</div>
            <strong style={{ display: 'block', marginTop: 5, fontSize: 16 }}>{fmt(eligibility?.paid_fines || 0)}</strong>
          </div>
          <div style={{ border: '1px solid var(--m-border)', borderRadius: 11, padding: 14, background: 'var(--m-accent-blue-bg)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Member net worth</div>
            <strong style={{ display: 'block', marginTop: 5, fontSize: 16, color: 'var(--m-accent-blue)' }}>{fmt(eligibility?.net_worth || 0)}</strong>
          </div>
          <div style={{ border: '1px solid var(--m-border)', borderRadius: 11, padding: 14, background: 'var(--m-accent-green-bg)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Maximum loan access</div>
            <strong style={{ display: 'block', marginTop: 5, fontSize: 16, color: 'var(--m-accent-green)' }}>{maxLoanValue}</strong>
            <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--m-text-muted)' }}>{loanRatioLabel}</div>
          </div>
          <div style={{ border: '1px solid var(--m-border)', borderRadius: 11, padding: 14, background: '#fafafa' }}>
            <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>FY{currentFY} loan terms</div>
            <strong style={{ display: 'block', marginTop: 5, fontSize: 16 }}>{((eligibility?.interest_rate || 0) * 100).toFixed(0)}% interest</strong>
            <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--m-text-muted)' }}>{eligibility?.repayment_months ? `${eligibility.repayment_months}-month repayment term` : 'Repayment term per approved loan'}</div>
          </div>
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--m-border)', fontSize: 11.5, color: 'var(--m-text-muted)', lineHeight: 1.6 }}>
          This is the maximum principal indicated by your current Checkpoint records and FY{currentFY} rules. It is not an automatic loan approval; requests still follow the club approval and disbursement process.
        </div>
      </Card>

      <div className="m-grid-2">
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--m-text-primary)' }}>Contribution progress</div>
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--m-text-muted)' }}>
                {derived.fullyPaidMonths} of {derived.elapsed} elapsed months paid in full
              </div>
            </div>
            <Link to="/contributions" className="m-btn m-btn-secondary m-btn-sm">Details <ArrowRight size={12} /></Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
            {derived.periods.map((period) => {
              const future = !period.elapsed;
              const background = future ? '#fafafa' : period.paid ? 'var(--m-accent-green-bg)' : period.partial ? '#fff7ed' : '#fff7f7';
              const border = future ? 'var(--m-border)' : period.paid ? '#bbf7d0' : period.partial ? '#fed7aa' : '#fecaca';
              const color = future ? 'var(--m-text-muted)' : period.paid ? 'var(--m-accent-green)' : period.partial ? '#c2410c' : 'var(--m-accent-red)';
              return (
                <div key={period.month} style={{ background, border: `1px solid ${border}`, borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--m-text-muted)' }}>{fiscalPeriodLabel(period.month, currentFY, true).split(' ')[0]}</div>
                  <div style={{ display: 'grid', placeItems: 'center', height: 22, marginTop: 4, color }}>
                    {future ? <Clock3 size={14} /> : period.paid ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color, marginTop: 2 }}>
                    {future ? 'Upcoming' : period.paid ? 'Paid' : period.partial ? 'Partial' : 'Missing'}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--m-border)', display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12 }}>
            <span style={{ color: 'var(--m-text-muted)' }}>Monthly contribution</span>
            <strong>{fmt(derived.target)}</strong>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>My account</div>
              <div style={{ fontSize: 12, color: 'var(--m-text-muted)', marginTop: 4 }}>A simple view of what needs your attention.</div>
            </div>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 999,
              padding: '5px 9px',
              background: derived.accountTone === 'good' ? 'var(--m-accent-green-bg)' : '#fff7ed',
              color: derived.accountTone === 'good' ? 'var(--m-accent-green)' : '#c2410c',
            }}>
              {derived.accountStatus}
            </span>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <Link to="/loans" style={{ color: 'inherit', textDecoration: 'none', border: '1px solid var(--m-border)', borderRadius: 11, padding: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Active loans</div>
                <div style={{ fontSize: 11, color: 'var(--m-text-muted)', marginTop: 2 }}>{derived.activeLoans.length} active · {fmt(derived.activeLoanBalance)} outstanding</div>
              </div>
              <ArrowRight size={14} color="var(--m-text-muted)" />
            </Link>
            <Link to="/contributions" style={{ color: 'inherit', textDecoration: 'none', border: '1px solid var(--m-border)', borderRadius: 11, padding: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Contribution standing</div>
                <div style={{ fontSize: 11, color: 'var(--m-text-muted)', marginTop: 2 }}>{fmt(derived.paidToDate)} paid in FY{currentFY}</div>
              </div>
              <ArrowRight size={14} color="var(--m-text-muted)" />
            </Link>
            <Link to="/notifications" style={{ color: 'inherit', textDecoration: 'none', border: '1px solid var(--m-border)', borderRadius: 11, padding: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Fines & reminders</div>
                <div style={{ fontSize: 11, color: 'var(--m-text-muted)', marginTop: 2 }}>{derived.unpaidFineTotal ? `${fmt(derived.unpaidFineTotal)} unpaid` : 'No unpaid fines'}</div>
              </div>
              <ArrowRight size={14} color="var(--m-text-muted)" />
            </Link>
          </div>
        </Card>
      </div>

      <Card style={{ padding: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px 12px' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Recent activity</div>
            <div style={{ fontSize: 11.5, color: 'var(--m-text-muted)', marginTop: 3 }}>Your own ledger records only.</div>
          </div>
          <Link to="/transactions" className="m-btn m-btn-secondary m-btn-sm">View all <ArrowRight size={12} /></Link>
        </div>
        <div style={{ borderTop: '1px solid var(--m-border)' }}>
          {transactions.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--m-text-muted)', fontSize: 12.5 }}>No ledger activity recorded yet.</div>
          ) : transactions.map((transaction) => (
            <div key={transaction.id} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--m-border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: '#f4f4f5', display: 'grid', placeItems: 'center', color: 'var(--m-text-muted)' }}>
                <ReceiptText size={14} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{transactionLabel(transaction.type, transaction.description)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', marginTop: 2 }}>{shortDate(transaction.transaction_date)}{transaction.reference ? ` · ${transaction.reference}` : ''}</div>
              </div>
              <strong style={{ fontSize: 12.5 }}>{fmt(transaction.amount)}</strong>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
