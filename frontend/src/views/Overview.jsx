import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Banknote, CheckCircle2, CircleAlert,
  Download, FileText, Landmark, Mail, MoreHorizontal, PiggyBank, RefreshCw,
  ShieldCheck, Users, WalletCards,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '../components/ui/chart';
import {
  FinancialTrendChart,
  formatAxisTZS,
  formatTZS,
} from '../components/checkpoint';
import { summary, mailer, admin, notifications as notificationsApi } from '../api';
import { exportSummaryCSV, exportSummaryPDF, getSummaryPDFBase64 } from '../utils/exporter';
import { fmtShort, showToast, useApi } from '../components/UI';

const ATTENTION_LABELS = {
  contribution_due: 'missed contribution',
  loan_due: 'overdue loan',
  fine_issued: 'fine issued',
  fine_overdue: 'overdue fine',
  custom: 'notice',
};

const ATTENTION_PRIORITY = {
  loan_due: 1,
  contribution_due: 2,
  fine_overdue: 3,
  fine_issued: 4,
  custom: 5,
};

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHART_COLORS = ['primary', 'secondary', 'reference', 'warning', 'success'];

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CM';
}

function plural(count, label) {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function loanOutstanding(loan = {}) {
  const principal = Number(loan.principal || 0);
  const totalRepaid = Number(loan.total_repaid || 0);
  const balance = loan.balance ?? (principal - totalRepaid);
  return Math.max(0, Number(balance || 0));
}

function compactDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function updatedLabel(value) {
  if (!value) return 'Updated just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Updated just now';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${compactDate(value)}`;
}

function aggregateAttention(list = []) {
  return list
    .map((member) => {
      const counts = (member.issues || []).reduce((acc, issue) => {
        acc[issue.type] = (acc[issue.type] || 0) + 1;
        return acc;
      }, {});
      const priority = Math.min(...Object.keys(counts).map((type) => ATTENTION_PRIORITY[type] || 9), 9);
      const issueText = Object.entries(counts)
        .sort(([a], [b]) => (ATTENTION_PRIORITY[a] || 9) - (ATTENTION_PRIORITY[b] || 9))
        .map(([type, count]) => plural(count, ATTENTION_LABELS[type] || type.replaceAll('_', ' ')))
        .join(' · ');

      return { ...member, counts, priority, issueText: issueText || 'Needs review' };
    })
    .sort((a, b) => a.priority - b.priority);
}

function OverviewSkeleton() {
  return (
    <div className="admin-overview-page">
      <div className="overview-skeleton-header">
        <div className="overview-skeleton-line is-title" />
        <div className="overview-skeleton-line" />
      </div>
      <div className="overview-metric-grid">{[1, 2, 3, 4, 5].map((item) => <div className="overview-skeleton-card" key={item} />)}</div>
      <div className="overview-main-grid"><div className="overview-skeleton-panel" /><div className="overview-skeleton-panel" /></div>
    </div>
  );
}

function MetricTile({ label, value, description, icon: Icon, tone = 'blue', primary = false, onClick }) {
  return (
    <section
      className={`overview-metric-card tone-${tone} ${primary ? 'is-primary' : ''}${onClick ? ' is-clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') onClick(); } : undefined}
    >
      <div className="overview-metric-top">
        <span>{label}</span>
        {Icon && <Icon size={16} />}
      </div>
      <strong>{value}</strong>
      {description && <p>{description}</p>}
    </section>
  );
}

function ActionMenu({ isAdmin, emailing, syncing, syncDone, onExportCSV, onExportPDF, onEmailSummary, onSyncCounters }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overview-actions-menu">
      <button className="overview-icon-button" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <MoreHorizontal size={17} />
        <span>More</span>
      </button>
      {open && (
        <div className="overview-menu-popover">
          <button type="button" onClick={() => { onExportCSV(); setOpen(false); }}><Download size={14} /> Export CSV</button>
          <button type="button" onClick={() => { onExportPDF(); setOpen(false); }}><FileText size={14} /> Export PDF</button>
          {isAdmin && <button type="button" disabled={emailing} onClick={() => { onEmailSummary(); setOpen(false); }}><Mail size={14} /> {emailing ? 'Sending…' : 'Email to Club'}</button>}
          {isAdmin && !syncDone && <button type="button" disabled={syncing} onClick={() => { onSyncCounters(); setOpen(false); }}><RefreshCw size={14} /> {syncing ? 'Syncing…' : 'Sync IDs'}</button>}
        </div>
      )}
    </div>
  );
}

function YearComparisonControl({ years, selectedYears, onToggle }) {
  if (!years.length) return null;
  return (
    <div className="overview-year-control" aria-label="Fiscal year comparison">
      <span>Compare</span>
      {years.map((year) => (
        <label key={year}>
          <input type="checkbox" checked={selectedYears.includes(year)} onChange={() => onToggle(year)} />
          FY{year}
        </label>
      ))}
    </div>
  );
}

function AttentionWidget() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApi(() => notificationsApi.attention());
  const attention = useMemo(() => aggregateAttention(data || []), [data]);

  useEffect(() => {
    const timer = window.setInterval(() => refetch(), 60000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  return (
    <section className="overview-panel overview-attention-panel">
      <div className="overview-panel-header">
        <div><h2>Requires attention</h2><p>Grouped member issues from live notification records.</p></div>
        <button type="button" className="overview-link-button" onClick={() => navigate('/members?filter=attention')}>View all <ArrowRight size={13} /></button>
      </div>
      {loading && <div className="overview-row-skeletons">{[1, 2, 3].map((item) => <div key={item} />)}</div>}
      {!loading && error && (
        <div className="overview-empty-state is-error"><AlertTriangle size={18} /><strong>Unable to load attention items.</strong><button type="button" onClick={refetch}>Try again</button></div>
      )}
      {!loading && !error && attention.length === 0 && (
        <div className="overview-empty-state"><CheckCircle2 size={18} /><strong>No members currently require attention.</strong></div>
      )}
      {!loading && !error && attention.length > 0 && (
        <div className="overview-attention-list">
          {attention.slice(0, 6).map((member) => (
            <div className="overview-attention-row" key={member.member_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/members?member=${member.member_id}`)} title="Click to view member financial details">
              <div className="overview-member-cell"><div className="overview-avatar">{initials(member.name)}</div><div><strong>{member.name}</strong><span>{member.issueText}</span></div></div>
              <button type="button" className="overview-secondary-action" onClick={(event) => { event.stopPropagation(); navigate(`/members?member=${member.member_id}`); }}>Review <ArrowRight size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReconciliationStatus({ reconciliation }) {
  if (!reconciliation) {
    return (
      <section className="overview-panel overview-reconciliation">
        <div className="overview-panel-header"><div><h2>Data reconciliation</h2><p>No reconciliation snapshot is attached to this summary.</p></div><CircleAlert size={17} /></div>
        <div className="overview-reconciliation-state is-warning"><strong>Needs review</strong><span>Confirm the latest reconciliation state before publication.</span></div>
      </section>
    );
  }

  return (
    <section className="overview-panel overview-reconciliation">
      <div className="overview-panel-header"><div><h2>Data reconciliation</h2><p>Verified reconciliation metadata remains separate from the live ledger estimate.</p></div><ShieldCheck size={17} /></div>
      <div className="overview-reconciliation-state"><strong>Ledger reconciliation applied</strong><span>Reconciled through {reconciliation.reporting_cutoff?.Y3_loans || '—'}</span></div>
      <dl className="overview-definition-list">
        <div><dt>Source generated</dt><dd>{compactDate(reconciliation.source_generated_on)}</dd></div>
        <div><dt>Last applied</dt><dd>{compactDate(reconciliation.applied_at)}</dd></div>
        <div><dt>Source gross loan balance</dt><dd>{formatTZS(reconciliation.source_summary?.gross_current_loan_balance_tzs || 0)}</dd></div>
      </dl>
    </section>
  );
}

function CashPositionPanel({ cash }) {
  if (!cash || cash.reconciled_balance == null) {
    return (
      <section className="overview-panel overview-cash-bridge">
        <div className="overview-panel-header"><div><h2>M-Koba movement bridge</h2><p>No verified opening cash balance is available yet.</p></div><WalletCards size={17} /></div>
        <div className="overview-empty-state"><CircleAlert size={18} /><strong>Live cash is using the fallback calculated position.</strong></div>
      </section>
    );
  }

  const rows = [
    { label: 'Reconciled opening cash', amount: cash.reconciled_balance, kind: 'opening' },
    { label: 'Contributions received', amount: cash.contributions_received, kind: 'in' },
    { label: 'Loan repayments received', amount: cash.loan_repayments_received, kind: 'in' },
    { label: 'Fines received', amount: cash.fines_received, kind: 'in' },
    { label: 'Loan disbursements', amount: cash.loan_disbursements, kind: 'out' },
    { label: 'Expenses', amount: cash.expenses_paid, kind: 'out' },
    { label: 'Investment transfers', amount: cash.investment_transfers, kind: 'out' },
  ];

  return (
    <section className="overview-panel overview-cash-bridge">
      <div className="overview-panel-header">
        <div><h2>M-Koba movement bridge</h2><p>Verified opening balance plus cash movements recorded after {compactDate(cash.reconciled_as_of)}.</p></div>
        <WalletCards size={17} />
      </div>
      <div className="overview-cash-bridge-rows">
        {rows.map((row) => (
          <div className={`overview-cash-bridge-row is-${row.kind}`} key={row.label}>
            <span>{row.kind === 'in' ? '+' : row.kind === 'out' ? '−' : ''} {row.label}</span>
            <strong>{formatTZS(row.amount || 0)}</strong>
          </div>
        ))}
        <div className="overview-cash-bridge-total"><span>Current calculated M-Koba balance</span><strong>{formatTZS(cash.live_balance || 0)}</strong></div>
      </div>
      <p className="overview-note">Loan outflows use the actual amount deposited to the borrower where available, so upfront-retained interest is not counted as cash leaving M-Koba.</p>
    </section>
  );
}

function MonthlyContributionChart({ data, series }) {
  return (
    <section className="overview-panel overview-chart-panel">
      <div className="overview-panel-header"><div><h2>Monthly contributions</h2><p>True fiscal-year view: March through February.</p></div></div>
      <FinancialTrendChart data={data} xKey="month" series={series} height={280} valueFormatter={formatTZS} yTickFormatter={formatAxisTZS} />
    </section>
  );
}

function MemberInterestChart({ data, years }) {
  if (!data.length || !years.length) return null;
  const config = years.reduce((acc, year, index) => {
    acc[year] = { label: `FY${year}`, color: ['var(--chart-primary)', 'var(--chart-secondary)', 'var(--chart-reference)', 'var(--chart-warning)'][index % 4] };
    return acc;
  }, {});

  return (
    <section className="overview-panel overview-interest-panel">
      <div className="overview-panel-header"><div><h2>Interest by member</h2><p>Cumulative interest segmented by selected fiscal year.</p></div></div>
      <ChartContainer config={config} className="overview-bar-chart" style={{ height: 250 }}>
        <BarChart data={data} barSize={16} margin={{ top: 12, right: 12, bottom: 0, left: -12 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} tickFormatter={fmtShort} width={42} />
          {years.map((year) => <Bar key={year} dataKey={year} name={`FY${year}`} fill={config[year].color} radius={[4, 4, 0, 0]} />)}
          <Legend content={<ChartLegendContent />} />
          <ChartTooltip content={<ChartTooltipContent formatter={formatTZS} />} cursor={false} wrapperStyle={{ outline: 'none' }} />
        </BarChart>
      </ChartContainer>
    </section>
  );
}

function ActiveLoansTable({ loans = [], activeLoans, total }) {
  const navigate = useNavigate();
  const [activeMenuId, setActiveMenuId] = useState(null);

  const handleRowClick = (loan) => {
    const loanId = loan.id || loan.loan_id;
    if (loanId) navigate(`/loans?loan=${loanId}`);
    else navigate('/loans?status=active');
  };

  return (
    <section className="overview-panel overview-loans-panel">
      <div className="overview-panel-header">
        <div><h2>Active loans</h2><p>{activeLoans} loans · {formatTZS(total)} in circulation</p></div>
        <button type="button" className="overview-link-button" onClick={() => navigate('/loans?status=active')}>View all <ArrowRight size={13} /></button>
      </div>
      {loans.length === 0 ? (
        <div className="overview-empty-state"><Banknote size={18} /><strong>No active loans currently recorded.</strong></div>
      ) : (
        <div className="overview-table-wrap">
          <table className="overview-table">
            <thead><tr><th>Member</th><th>Loan #</th><th className="is-numeric">Principal</th><th className="is-numeric">Outstanding</th><th>Issued</th><th>Status</th><th className="is-action">Action</th></tr></thead>
            <tbody>
              {loans.map((loan) => {
                const loanId = loan.id || loan.loan_id;
                const menuOpen = activeMenuId === loanId;
                return (
                  <tr key={loanId || loan.loan_number || loan.member_name} onClick={() => handleRowClick(loan)} style={{ cursor: 'pointer' }} title="Click to view loan servicing drawer">
                    <td><div className="overview-member-cell"><div className="overview-avatar">{initials(loan.member_name)}</div><div><strong>{loan.member_name || 'Member'}</strong><span>Active borrower</span></div></div></td>
                    <td>{loan.loan_number || '—'}</td>
                    <td className="is-numeric">{formatTZS(loan.principal)}</td>
                    <td className="is-numeric is-danger">{formatTZS(loanOutstanding(loan))}</td>
                    <td>{compactDate(loan.issued_date)}</td>
                    <td><span className="overview-status is-active">Active</span></td>
                    <td className="is-action" style={{ position: 'relative' }}>
                      <button type="button" className="overview-icon-button" aria-label={`Actions for ${loan.member_name || 'member loan'}`} onClick={(event) => { event.stopPropagation(); setActiveMenuId(menuOpen ? null : loanId); }}><MoreHorizontal size={15} /></button>
                      {menuOpen && (
                        <div className="admin-menu-popover" style={{ top: 'calc(100% + 2px)', right: 0, width: 180, zIndex: 60 }} onClick={(event) => event.stopPropagation()}>
                          <button type="button" onClick={() => { setActiveMenuId(null); navigate(`/loans?loan=${loanId}`); }}>View loan</button>
                          <button type="button" onClick={() => { setActiveMenuId(null); navigate(`/loans?loan=${loanId}`); }}>Record repayment</button>
                          {loan.member_id && <button type="button" onClick={() => { setActiveMenuId(null); navigate(`/members?member=${loan.member_id}`); }}>View member</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Overview({ user }) {
  const navigate = useNavigate();
  const { data, loading, refetch } = useApi(() => summary.get());
  const [selectedYears, setSelectedYears] = useState([]);
  const [emailing, setEmailing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clockTick, setClockTick] = useState(0);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    const timer = window.setInterval(() => refetch(), 60000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 10000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (data && selectedYears.length === 0) {
      const contributionYears = (data.monthly_stats || []).flatMap((month) => Object.keys(month).filter((key) => key.startsWith('contributions_')).map((key) => parseInt(key.replace('contributions_', ''), 10)));
      const loanYears = data.availableLoanYears || [];
      setSelectedYears([...new Set([...contributionYears, ...loanYears])].sort());
    }
  }, [data, selectedYears.length]);

  if (loading) return <OverviewSkeleton />;
  if (!data) return null;

  const { equity, liabilities, active_members, active_loans, monthly_stats, interest_by_member, availableLoanYears } = data;
  const allBackendYears = [...new Set([
    ...((monthly_stats || []).flatMap((month) => Object.keys(month).filter((key) => key.startsWith('contributions_')).map((key) => parseInt(key.replace('contributions_', ''), 10)))),
    ...(availableLoanYears || []),
  ])].sort();

  const contribYears = allBackendYears.filter((year) => selectedYears.includes(year)).filter((year) => (monthly_stats || []).some((month) => Object.prototype.hasOwnProperty.call(month, `contributions_${year}`)));
  const now = new Date();
  const currentDateKey = now.toISOString().slice(0, 10);
  const monthlyChart = (monthly_stats || []).map((month) => {
    const obj = { month: MONTHS[month.month] };
    contribYears.forEach((fy) => {
      const calendarYear = month[`calendar_year_${fy}`] || (month.month >= 3 ? fy : fy + 1);
      const periodDate = `${calendarYear}-${String(month.month).padStart(2, '0')}-01`;
      obj[`fy${fy}`] = periodDate > currentDateKey ? null : (month[`contributions_${fy}`] || 0);
    });
    return obj;
  });

  const contributionSeries = contribYears.map((year, index) => ({ key: `fy${year}`, label: `FY${year}`, color: CHART_COLORS[index % CHART_COLORS.length] }));
  const activeLoanYears = (availableLoanYears || []).filter((year) => selectedYears.includes(year));
  const memberInterest = (interest_by_member || []).map((member) => {
    const obj = { name: (member.name || 'Member').split(' ')[0] };
    activeLoanYears.forEach((year) => { obj[year] = member[`interest_${year}`] || 0; });
    return obj;
  });
  const activeLoanOutstanding = (data.active_loan_list || []).reduce((sum, loan) => sum + loanOutstanding(loan), 0);

  const toggleYear = (year) => {
    if (selectedYears.includes(year)) setSelectedYears(selectedYears.filter((selected) => selected !== year));
    else setSelectedYears([...selectedYears, year].sort());
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
      showToast('Overview refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleExportCSV = () => {
    try { exportSummaryCSV(data); showToast('CSV downloaded!'); }
    catch { showToast('Failed to export CSV', 'error'); }
  };

  const handleExportPDF = () => {
    try { exportSummaryPDF(data); showToast('PDF downloaded!'); }
    catch { showToast('Failed to export PDF', 'error'); }
  };

  const handleEmailSummary = async () => {
    setEmailing(true);
    try {
      const { base64, filename } = getSummaryPDFBase64(data);
      const res = await mailer.broadcastStatement({ base64_pdf: base64, filename });
      const { sent, skipped, mock_mode } = res.data;
      const mockNote = mock_mode ? ' (mock — check backend logs)' : '';
      showToast(`Statement dispatched to ${sent} member${sent !== 1 ? 's' : ''}${skipped ? `, ${skipped} skipped (no email)` : ''}${mockNote}`);
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to send emails', 'error');
    } finally {
      setEmailing(false);
    }
  };

  const handleSyncCounters = async () => {
    setSyncing(true);
    try {
      const res = await admin.syncCounters();
      setSyncDone(true);
      showToast('Counters synced! All IDs are now aligned with the database.');
      console.log('Sync result:', res.data.counters);
    } catch (error) {
      showToast(error.response?.data?.error || 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const cash = data.cash_position || {};
  const lastUpdated = cash.updated_at || new Date().toISOString();
  void clockTick;

  return (
    <div className="admin-overview-page">
      <header className="overview-page-header">
        <div>
          <div className="overview-eyebrow">Checkpoint Investment Club</div>
          <h1>Overview</h1>
          <p>Financial position and operational attention · {updatedLabel(lastUpdated)}</p>
        </div>
        <div className="overview-header-actions">
          <button type="button" className="overview-icon-button" onClick={handleRefresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh data'}</button>
          <ActionMenu isAdmin={isAdmin} emailing={emailing} syncing={syncing} syncDone={syncDone} onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} onEmailSummary={handleEmailSummary} onSyncCounters={handleSyncCounters} />
        </div>
      </header>

      <YearComparisonControl years={allBackendYears} selectedYears={selectedYears} onToggle={toggleYear} />

      <section className="overview-metric-grid overview-metric-grid-five">
        <MetricTile primary label="Club equity" value={formatTZS(equity.total)} description="Group capital, contributions and profit" icon={Landmark} tone="blue" onClick={() => navigate('/transactions')} />
        <MetricTile label="M-Koba Balance" value={formatTZS(cash.live_balance ?? data.cash_at_bank)} description="Live ledger balance" icon={PiggyBank} tone="green" onClick={() => navigate('/transactions')} />
        <MetricTile label="Reconciled Balance" value={cash.reconciled_balance == null ? 'Not available' : formatTZS(cash.reconciled_balance)} description={cash.reconciled_as_of ? `As of ${compactDate(cash.reconciled_as_of)}` : 'No reconciliation date'} icon={ShieldCheck} tone="blue" />
        <MetricTile label="Loans Outstanding" value={formatTZS(liabilities.in_circulation)} description={`${active_loans} active loans`} icon={Banknote} tone="red" onClick={() => navigate('/loans?status=active')} />
        <MetricTile label={`Contributions FY${data.current_fiscal_year}`} value={formatTZS(data.contributions_this_fy || 0)} description={`${active_members} active members`} icon={Users} tone="teal" onClick={() => navigate('/contributions')} />
      </section>

      <CashPositionPanel cash={cash} />

      <section className="overview-main-grid">
        <MonthlyContributionChart data={monthlyChart} series={contributionSeries} />
        <ReconciliationStatus reconciliation={data.reconciliation} />
      </section>

      <AttentionWidget />
      <ActiveLoansTable loans={data.active_loan_list || []} activeLoans={active_loans} total={activeLoanOutstanding || liabilities.in_circulation} />
      <MemberInterestChart data={memberInterest} years={activeLoanYears} />
    </div>
  );
}
