import { useState, useMemo } from 'react';
import { Sigma, Target, Gauge, ShieldCheck, Eye, Download } from 'lucide-react';
import { SectionHeader, StatCard, StatusPill, Card, Table, Loading, useApi, fmt } from '../components/Primitives';
import { contributions as contributionsApi, rules as rulesApi } from '../../api';

const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

function getElapsedMonthsInFY(fy) {
  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  let count = 0;
  for (const m of FY_MONTHS) {
    const y = m >= 3 ? fy : fy + 1;
    if (y < todayY || (y === todayY && m <= todayM)) count++;
  }
  return count;
}

export default function MemberContributionsPage() {
  const { data: allContribs, loading: contribsLoading } = useApi(() => contributionsApi.list());
  const now = new Date();
  const defaultFY = getFiscalYear(now.getMonth() + 1, now.getFullYear());
  const [fy, setFy] = useState(defaultFY);
  const { data: fyRules, loading: rulesLoading } = useApi(() => rulesApi.get(fy), [fy]);

  const fyOptions = useMemo(() => {
    const years = new Set([defaultFY]);
    (allContribs || []).forEach((c) => years.add(getFiscalYear(c.month, c.year)));
    return [...years].sort((a, b) => b - a);
  }, [allContribs, defaultFY]);

  const myFYContribs = useMemo(
    () => (allContribs || []).filter((c) => getFiscalYear(c.month, c.year) === fy).sort((a, b) => b.year - a.year || b.month - a.month),
    [allContribs, fy],
  );

  const totalContributed = myFYContribs.reduce((s, c) => s + c.amount, 0);
  const monthlyRate = fyRules?.contribution_amount || 0;
  const yearTarget = monthlyRate * 12;
  const monthsPaid = myFYContribs.filter((c) => c.status === 'paid').length;
  const monthsElapsed = getElapsedMonthsInFY(fy);
  const compliance = monthsElapsed > 0 ? Math.round((monthsPaid / monthsElapsed) * 100) : 0;

  const loading = contribsLoading || rulesLoading;

  return (
    <div className="m-page">
      <SectionHeader
        title="Contributions"
        sub="Your monthly deposits and compliance for the selected fiscal year"
        action={
          <select className="m-form-input" style={{ width: 140 }} value={fy} onChange={(e) => setFy(Number(e.target.value))}>
            {fyOptions.map((y) => <option key={y} value={y}>FY{String(y).slice(2)}/{String(y + 1).slice(2)}</option>)}
          </select>
        }
      />

      {loading ? <Loading /> : (
        <>
          <div className="m-stats-grid">
            <StatCard icon={<Sigma size={17} />} iconBg="var(--m-accent-blue-bg)" iconColor="var(--m-accent-blue)" label="Total Contributed" value={fmt(totalContributed)} help />
            <StatCard icon={<Target size={17} />} iconBg="var(--m-accent-green-bg)" iconColor="var(--m-accent-green)" label="Year Target" value={fmt(yearTarget)} help />
            <StatCard icon={<Gauge size={17} />} iconBg="var(--m-accent-amber-bg)" iconColor="var(--m-accent-amber)" label="Rate" value={`${fmt(monthlyRate)}/Month`} help />
            <StatCard
              icon={<ShieldCheck size={17} />} iconBg="var(--m-accent-blue-bg)" iconColor="var(--m-accent-blue)"
              label="Compliance" value={`${compliance}%`}
              trend={{ direction: compliance >= 90 ? 'up' : 'down', value: `${monthsPaid}/${monthsElapsed}`, label: 'months paid' }}
              help
            />
          </div>

          <Card style={{ padding: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px 4px' }}>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--m-font-display)' }}>All Contributions</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="m-btn m-btn-secondary m-btn-sm" style={{ cursor: 'default' }}><Eye size={12} /> View all</div>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              <Table
                columns={[
                  { key: 'month', label: 'Month', render: (r) => MONTH_NAMES[r.month] },
                  { key: 'amount', label: 'Amount', render: (r) => fmt(r.amount) },
                  { key: 'paid_date', label: 'Date' },
                  { key: 'id', label: 'ID', render: (r) => `CN-${r.id}` },
                  { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
                  { key: 'notes', label: 'Notes', render: (r) => r.notes || '—' },
                ]}
                rows={myFYContribs}
                empty="No contributions recorded for this fiscal year yet."
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
