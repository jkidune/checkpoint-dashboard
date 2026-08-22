import { useMemo, useState } from 'react';
import { CheckCircle2, Clock3, AlertCircle, ShieldAlert, Target, Wallet2 } from 'lucide-react';
import { SectionHeader, StatCard, Card, Loading, useApi, fmt } from '../components/Primitives';
import { members, rules as rulesApi } from '../../api';
import {
  FY_MONTHS,
  getCurrentFiscalYear,
  fiscalPeriodLabel,
  contributionForPeriod,
  contributionAmountForPeriod,
  elapsedFiscalMonths,
  getFiscalYear,
} from '../lib/finance';

function periodStatus(amount, target, elapsed) {
  if (!elapsed) return { label: 'Upcoming', tone: 'future' };
  if (target > 0 && amount >= target) return { label: 'Paid', tone: 'paid' };
  if (amount > 0) return { label: 'Partial', tone: 'partial' };
  return { label: 'Missing', tone: 'missing' };
}

export default function MemberContributionsPage() {
  const { data: me, loading: memberLoading } = useApi(() => members.me());
  const defaultFY = getCurrentFiscalYear();
  const [fy, setFy] = useState(defaultFY);
  const { data: fyRules, loading: rulesLoading } = useApi(() => rulesApi.get(fy), [fy]);

  const fyOptions = useMemo(() => {
    const years = new Set([defaultFY]);
    (me?.contributions || []).forEach((item) => years.add(getFiscalYear(item.month, item.year)));
    return [...years].sort((a, b) => b - a);
  }, [me, defaultFY]);

  const derived = useMemo(() => {
    const target = Number(fyRules?.contribution_amount || 0);
    const elapsed = elapsedFiscalMonths(fy);
    const periods = FY_MONTHS.map((month, index) => {
      const records = contributionForPeriod(me?.contributions || [], month, fy);
      const amount = contributionAmountForPeriod(me?.contributions || [], month, fy);
      const status = periodStatus(amount, target, index < elapsed);
      return { month, records, amount, ...status, elapsed: index < elapsed };
    });

    const total = periods.reduce((sum, period) => sum + period.amount, 0);
    const expected = target * elapsed;
    const fullMonths = periods.filter((period) => period.elapsed && period.tone === 'paid').length;
    const missingMonths = periods.filter((period) => period.elapsed && period.tone === 'missing').length;
    const partialMonths = periods.filter((period) => period.elapsed && period.tone === 'partial').length;
    const fines = (me?.fines || []).filter((fine) => Number(fine.year) === fy || Number(fine.contribution_year) === fy || getFiscalYear(fine.contribution_month || 3, fine.contribution_year || fy) === fy);
    const unpaidFines = fines.filter((fine) => fine.status === 'unpaid');
    return { target, elapsed, periods, total, expected, fullMonths, missingMonths, partialMonths, fines, unpaidFines };
  }, [me, fyRules, fy]);

  const loading = memberLoading || rulesLoading;

  return (
    <div className="m-page">
      <SectionHeader
        title="Contributions"
        sub={`Your monthly contribution schedule · March ${fy} to February ${fy + 1}`}
        action={
          <select className="m-form-input" style={{ width: 150 }} value={fy} onChange={(event) => setFy(Number(event.target.value))}>
            {fyOptions.map((year) => <option key={year} value={year}>FY{year}</option>)}
          </select>
        }
      />

      {loading ? <Loading /> : (
        <>
          <div className="m-stats-grid">
            <StatCard icon={<Wallet2 size={17} />} iconBg="var(--m-accent-green-bg)" iconColor="var(--m-accent-green)" label="Paid in this FY" value={fmt(derived.total)} />
            <StatCard icon={<Target size={17} />} iconBg="var(--m-accent-blue-bg)" iconColor="var(--m-accent-blue)" label="Expected to date" value={fmt(derived.expected)} />
            <StatCard icon={<CheckCircle2 size={17} />} iconBg="var(--m-accent-green-bg)" iconColor="var(--m-accent-green)" label="Months paid in full" value={`${derived.fullMonths}/${derived.elapsed}`} />
            <StatCard icon={<ShieldAlert size={17} />} iconBg="var(--m-accent-red-bg)" iconColor="var(--m-accent-red)" label="Unpaid fines" value={fmt(derived.unpaidFines.reduce((sum, fine) => sum + Number(fine.amount || 0), 0))} />
          </div>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>FY{fy} monthly schedule</div>
                <div style={{ fontSize: 11.5, color: 'var(--m-text-muted)', marginTop: 3 }}>Monthly rule: {fmt(derived.target)}</div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--m-text-muted)' }}>
                {derived.partialMonths} partial · {derived.missingMonths} missing
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              {derived.periods.map((period) => {
                const palette = {
                  paid: { bg: 'var(--m-accent-green-bg)', border: '#bbf7d0', color: 'var(--m-accent-green)', icon: CheckCircle2 },
                  partial: { bg: '#fff7ed', border: '#fed7aa', color: '#c2410c', icon: AlertCircle },
                  missing: { bg: '#fff7f7', border: '#fecaca', color: 'var(--m-accent-red)', icon: AlertCircle },
                  future: { bg: '#fafafa', border: 'var(--m-border)', color: 'var(--m-text-muted)', icon: Clock3 },
                }[period.tone];
                const Icon = palette.icon;
                const primaryRecord = period.records[0];
                return (
                  <div key={period.month} style={{ background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 12, padding: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 12.5 }}>{fiscalPeriodLabel(period.month, fy)}</strong>
                      <Icon size={15} color={palette.color} />
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, marginTop: 9 }}>{period.amount ? fmt(period.amount) : '—'}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 7, fontSize: 10.5 }}>
                      <span style={{ color: palette.color, fontWeight: 700 }}>{period.label}</span>
                      <span style={{ color: 'var(--m-text-muted)' }}>{primaryRecord?.paid_date || ''}</span>
                    </div>
                    {primaryRecord?.mpesa_ref && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${palette.border}`, color: 'var(--m-text-muted)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        Ref: {primaryRecord.mpesa_ref}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card style={{ padding: 0 }}>
            <div style={{ padding: '18px 20px 12px' }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Fines & late-payment history</div>
              <div style={{ fontSize: 11.5, color: 'var(--m-text-muted)', marginTop: 3 }}>A fine is shown separately from the monthly contribution it relates to.</div>
            </div>
            <div style={{ borderTop: '1px solid var(--m-border)' }}>
              {derived.fines.length === 0 ? (
                <div style={{ padding: 26, textAlign: 'center', color: 'var(--m-text-muted)', fontSize: 12.5 }}>No fines recorded for FY{fy}.</div>
              ) : derived.fines.map((fine) => (
                <div key={fine.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 16, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--m-border)' }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 650 }}>{fine.reason || 'Late contribution fine'}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--m-text-muted)', marginTop: 2 }}>
                      {fine.contribution_month ? fiscalPeriodLabel(fine.contribution_month, getFiscalYear(fine.contribution_month, fine.contribution_year || fine.year)) : `FY${fine.year}`}
                      {fine.paid_date ? ` · paid ${fine.paid_date}` : ''}
                    </div>
                  </div>
                  <strong style={{ fontSize: 12.5 }}>{fmt(fine.amount)}</strong>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'capitalize', color: fine.status === 'paid' ? 'var(--m-accent-green)' : 'var(--m-accent-red)' }}>{fine.status}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
