import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';
import { fmt } from './UI';

function DataRow({ label, value, strong = false, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '7px 0', borderBottom: '1px solid var(--admin-border)', fontSize: 11.5 }}>
      <span style={{ color: 'var(--admin-muted)' }}>{label}</span>
      <span style={{ fontWeight: strong ? 750 : 600, color: tone || 'var(--admin-text)', textAlign: 'right' }}>{value ?? '—'}</span>
    </div>
  );
}

function FlagList({ items = [], tone = 'error' }) {
  if (!items.length) return null;
  const error = tone === 'error';
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {items.map((item, index) => (
        <div
          key={`${item.code || 'flag'}-${index}`}
          style={{
            display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 10px', borderRadius: 8,
            border: `1px solid ${error ? '#fecaca' : '#fed7aa'}`,
            background: error ? '#fef2f2' : '#fff7ed',
            color: error ? '#991b1b' : '#9a3412', fontSize: 11.5, lineHeight: 1.45,
          }}
        >
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{item.message || item}</span>
        </div>
      ))}
    </div>
  );
}

export default function LoanApprovalAssessment({ assessment, loading = false, onRefresh, title = 'Live approval checks' }) {
  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--admin-muted)', fontSize: 12 }}>Checking live member records…</div>;
  }

  if (!assessment) {
    return <div style={{ padding: 18, textAlign: 'center', color: 'var(--admin-muted)', fontSize: 12 }}>Approval assessment is unavailable.</div>;
  }

  const member = assessment.member;
  const contribution = assessment.contribution_clearance;
  const eligibility = assessment.eligibility;
  const calc = assessment.loan_calculation;
  const blockers = assessment.blockers || [];
  const warnings = assessment.warnings || [];
  const eligible = assessment.eligible && blockers.length === 0;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap',
          border: `1px solid ${eligible ? '#bbf7d0' : '#fecaca'}`,
          background: eligible ? '#f0fdf4' : '#fef2f2', borderRadius: 11, padding: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          {eligible ? <CheckCircle2 size={18} color="#15803d" /> : <XCircle size={18} color="#dc2626" />}
          <div>
            <strong style={{ display: 'block', fontSize: 13, color: eligible ? '#166534' : '#991b1b' }}>
              {eligible ? 'Member currently clears all approval checks' : `${blockers.length} blocking item${blockers.length === 1 ? '' : 's'} must be cleared`}
            </strong>
            <span style={{ fontSize: 10.5, color: eligible ? '#166534' : '#991b1b' }}>
              {title} · assessed {assessment.assessment_date || 'today'} · FY{assessment.fiscal_year || '—'}
            </span>
          </div>
        </div>
        {onRefresh && (
          <button type="button" className="admin-btn-secondary" onClick={onRefresh}>
            <RefreshCw size={12} /> Refresh checks
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
        <section style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: 12, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>
            <UserRoundCheck size={14} /> Member & payment clearance
          </div>
          <DataRow label="Member" value={member ? `#${member.id} · ${member.name}` : 'Not verified'} strong />
          <DataRow label="Membership status" value={member?.status || '—'} strong tone={member?.status === 'active' ? '#166534' : '#b91c1c'} />
          <DataRow label="Join date" value={member?.join_date || '—'} />
          <DataRow label={`FY${assessment.fiscal_year} overdue contributions`} value={fmt(contribution?.arrears_total || 0)} strong tone={(contribution?.arrears_total || 0) > 0 ? '#b91c1c' : '#166534'} />
          <DataRow label="Overdue contribution periods" value={contribution?.arrears_count ?? '—'} />
          <DataRow label="Unpaid fines" value={fmt(assessment.unpaid_fines_total || 0)} strong tone={(assessment.unpaid_fines_total || 0) > 0 ? '#b91c1c' : '#166534'} />
          <DataRow label="Active / overdue loan balance" value={fmt(assessment.active_loan_balance || 0)} strong tone={(assessment.active_loan_balance || 0) > 0 ? '#b91c1c' : '#166534'} />
          <DataRow label="Other pending loan principal" value={fmt(assessment.pending_loan_principal || 0)} strong tone={(assessment.pending_loan_principal || 0) > 0 ? '#b91c1c' : '#166534'} />
        </section>

        <section style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: 12, background: '#fafafa' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>
            <CircleDollarSign size={14} /> Authoritative loan calculation
          </div>
          <DataRow label="Member net worth" value={eligibility ? fmt(eligibility.net_worth) : '—'} strong />
          <DataRow label="Total contributions" value={eligibility ? fmt(eligibility.total_contributions) : '—'} />
          <DataRow label="Realized loan interest" value={eligibility ? fmt(eligibility.total_loan_interest) : '—'} />
          <DataRow label="Paid fines included" value={eligibility ? fmt(eligibility.paid_fines) : '—'} />
          <DataRow label="Borrowing ceiling" value={eligibility?.max_eligible == null ? 'No cap' : fmt(eligibility.max_eligible)} strong />
          <DataRow label="Requested principal" value={calc ? fmt(calc.principal) : '—'} strong />
          <DataRow label={`Interest ${calc ? Math.round(Number(calc.interest_rate || 0) * 100) : 0}%`} value={calc ? fmt(calc.interest_amount) : '—'} />
          <DataRow label="Net amount to disburse" value={calc ? fmt(calc.net_disbursement) : '—'} strong />
          <DataRow label="Repayment term" value={calc?.repayment_months ? `${calc.repayment_months} months` : 'No fixed term'} />
          <DataRow label="Indicative monthly repayment" value={calc?.indicative_monthly_repayment == null ? '—' : fmt(calc.indicative_monthly_repayment)} />
          <DataRow label="Due date" value={calc?.due_date || '—'} />
          <DataRow label="Penalty per overdue month" value={calc?.overdue_penalty_enabled ? fmt(calc.overdue_penalty_per_month || 0) : 'Disabled'} />
        </section>
      </div>

      {contribution?.periods?.some((period) => period.outstanding > 0) && (
        <section style={{ border: '1px solid var(--admin-border)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--admin-border)', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700 }}>
            <Banknote size={13} /> Overdue contribution periods
          </div>
          <div style={{ display: 'grid' }}>
            {contribution.periods.filter((period) => period.outstanding > 0).map((period) => (
              <div key={`${period.year}-${period.month}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', fontSize: 11.5 }}>
                <span><strong>{period.label}</strong><span style={{ color: 'var(--admin-muted)', marginLeft: 6 }}>due {period.deadline}</span></span>
                <span>Paid {fmt(period.paid)}</span>
                <strong style={{ color: '#b91c1c' }}>Owes {fmt(period.outstanding)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {(assessment.unpaid_fines || []).length > 0 && (
        <section style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: 11, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, marginBottom: 7 }}><ShieldCheck size={13} /> Unpaid fines</div>
          {(assessment.unpaid_fines || []).map((fine) => (
            <div key={fine.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--admin-border)', fontSize: 11.5 }}>
              <span>Fine #{fine.id} · {fine.reason}</span><strong style={{ color: '#b91c1c' }}>{fmt(fine.amount)}</strong>
            </div>
          ))}
        </section>
      )}

      {(assessment.active_loans || []).length > 0 && (
        <section style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: 11, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, marginBottom: 7 }}><Banknote size={13} /> Existing active / overdue loans</div>
          {(assessment.active_loans || []).map((loan) => (
            <div key={loan.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--admin-border)', fontSize: 11.5 }}>
              <span><strong>{loan.loan_number || `Loan #${loan.id}`}</strong> · {loan.status}</span>
              <span>Repaid {fmt(loan.total_repaid || 0)}</span>
              <strong style={{ color: '#b91c1c' }}>Balance {fmt(loan.balance || 0)}</strong>
            </div>
          ))}
        </section>
      )}

      <FlagList items={blockers} tone="error" />
      <FlagList items={warnings} tone="warning" />

      {eligible && (
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11.5, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 9, padding: 10 }}>
          <CheckCircle2 size={14} /> <strong>No financial blocker is currently recorded. The server will run these checks again at the next approval gate.</strong>
        </div>
      )}
    </div>
  );
}
