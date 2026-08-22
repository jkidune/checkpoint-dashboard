import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Banknote, CheckCircle2, CircleAlert,
  Download, FileText, Landmark, Mail, MoreHorizontal, PiggyBank, RefreshCw,
  ShieldCheck, Users,
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
      <div className="overview-metric-grid">{[1, 2, 3, 4].map((item) => <div className="overview-skeleton-card" key={item} />)}</div>
      <div className="overview-main-grid"><div className="overview-skeleton-panel" /><div className="overview-skeleton-panel" /></div>
    </div>
  );
}


function MetricTile({ label, value, description, icon: Icon, tone = 'blue', primary = false }) {
  return (
    <section className={`overview-metric-card tone-${tone} ${primary ? 'is-primary' : ''}`}>
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

  return (
    <section className="overview-panel overview-attention-panel">
      <div className="overview-panel-header">
        <div><h2>Requires attention</h2><p>Grouped member issues from the existing notifications endpoint.</p></div>
        <button
          type="button"
          className="overview-link-button"
          onClick={() => navigate('/members?filter=attention')}
        >
          View all <ArrowRight size={13} />
        </button>
      </div>

      {loading && <div className="overview-row-skeletons">{[1, 2, 3].map((item) => <div key={item} />)}</div>}

      {!loading && error && (
        <div className="overview-empty-state is-error">
          <AlertTriangle size={18} />
          <strong>Unable to load attention items.</strong>
          <button type="button" onClick={refetch}>Try again</button>
        </div>
      )}

      {!loading && !error && attention.length === 0 && (
        <div className="overview-empty-state"><CheckCircle2 size={18} /><strong>No members currently require attention.</strong></div>
      )}

      {!loading && !error && attention.length > 0 && (
        <div className="overview-attention-list">
          {attention.slice(0, 6).map((member) => (
            <div
              className="overview-attention-row"
              key={member.member_id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/members?member=${member.member_id}`)}
              title="Click to view member financial details"
            >
              <div className="overview-member-cell">
                <div className="overview-avatar">{initials(member.name)}</div>
                <div><strong>{member.name}</strong><span>{member.issueText}</span></div>
              </div>
              <button
                type="button"
                className="overview-secondary-action"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/members?member=${member.member_id}`);
                }}
              >
                Review <ArrowRight size={13} />
              </button>
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
        <div className="overview-panel-header">
          <div><h2>Data reconciliation</h2><p>No reconciliation snapshot is attached to this summary.</p></div>
          <CircleAlert size={17} />
        </div>
        <div className="overview-reconciliation-state is-warning"><strong>Needs review</strong><span>Confirm the latest reconciliation state before publication.</span></div>
      </section>
    );
  }

  return (
    <section className="overview-panel overview-reconciliation">
      <div className="overview-panel-header">
        <div><h2>Data reconciliation</h2><p>Existing summary reconciliation metadata.</p></div>
        <ShieldCheck size={17} />
      </div>
      <div className="overview-reconciliation-state"><strong>Ledger reconciliation applied</strong><span>Reconciled through {reconciliation.reporting_cutoff?.Y3_loans || '—'}</span></div>
      <dl className="overview-definition-list">
        <div><dt>Source generated</dt><dd>{compactDate(reconciliation.source_generated_on)}</dd></div>
        <div><dt>Last applied</dt><dd>{compactDate(reconciliation.applied_at)}</dd></div>
        <div><dt>Source gross loan balance</dt><dd>{formatTZS(reconciliation.source_summary?.gross_current_loan_balance_tzs || 0)}</dd></div>
      </dl>
      <p className="overview-note">{reconciliation.note}</p>
    </section>
  );
}

function MonthlyContributionChart({ data, series }) {
  return (
    <section className="overview-panel overview-chart-panel">
      <div className="overview-panel-header">
        <div><h2>Financial position</h2><p>Monthly contributions using existing Overview summary data.</p></div>
      </div>
      <FinancialTrendChart data={data} xKey="month" series={series} height={280} valueFormatter={formatTZS} yTickFormatter={formatAxisTZS} />
    </section>
  );
}

function MemberInterestChart({ data, years }) {
  if (!data.length || !years.length) return null;
  const config = years.reduce((acc, year, index) => {
    acc[year] = {
      label: `FY${year}`,
      color: ['var(--chart-primary)', 'var(--chart-secondary)', 'var(--chart-reference)', 'var(--chart-warning)'][index % 4],
    };
    return acc;
  }, {});

  return (
    <section className="overview-panel overview-interest-panel">
      <div className="overview-panel-header">
        <div><h2>Interest by member</h2><p>Cumulative interest segmented by selected fiscal year.</p></div>
      </div>
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
    if (loanId) {
      navigate(`/loans?loan=${loanId}`);
    } else {
      navigate('/loans?status=active');
    }
  };

  return (
    <section className="overview-panel overview-loans-panel">
      <div className="overview-panel-header">
        <div><h2>Active loans</h2><p>{activeLoans} loans · {formatTZS(total)} in circulation</p></div>
        <button
          type="button"
          className="overview-link-button"
          onClick={() => navigate('/loans?status=active')}
        >
          View all <ArrowRight size={13} />
        </button>
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
                  <tr
                    key={loanId || loan.loan_number || loan.member_name}
                    onClick={() => handleRowClick(loan)}
                    style={{ cursor: 'pointer' }}
                    title="Click to view loan servicing drawer"
                  >
                    <td><div className="overview-member-cell"><div className="overview-avatar">{initials(loan.member_name)}</div><div><strong>{loan.member_name || 'Member'}</strong><span>Active borrower</span></div></div></td>
                    <td>{loan.loan_number || '—'}</td>
                    <td className="is-numeric">{formatTZS(loan.principal)}</td>
                    <td className="is-numeric is-danger">{formatTZS(loanOutstanding(loan))}</td>
                    <td>{compactDate(loan.issued_date)}</td>
                    <td><span className="overview-status is-active">Active</span></td>
                    <td className="is-action" style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="overview-icon-button"
                        aria-label={`Actions for ${loan.member_name || 'member loan'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(menuOpen ? null : loanId);
                        }}
                      >
                        <MoreHorizontal size={15} />
                      </button>

                      {menuOpen && (
                        <div
                          className="admin-menu-popover"
                          style={{ top: 'calc(100% + 2px)', right: 0, width: 180, zIndex: 60 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuId(null);
                              navigate(`/loans?loan=${loanId}`);
                            }}
                          >
                            View loan
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuId(null);
                              navigate(`/loans?loan=${loanId}`);
                            }}
                          >
                            Record repayment
                          </button>
                          {loan.member_id && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                navigate(`/members?member=${loan.member_id}`);
                              }}
                            >
                              View member
                            </button>
                          )}
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
  const { data, loading } = useApi(() => summary.get());
  const [selectedYears, setSelectedYears] = useState([]);
  const [emailing, setEmailing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (data && selectedYears.length === 0) {
      const allC = (data.monthly_stats || []).flatMap((month) => Object.keys(month).filter((key) => key.startsWith('contributions_')).map((key) => parseInt(key.replace('contributions_', ''), 10)));
      const cYears = [...new Set(allC)];
      const lYears = data.availableLoanYears || [];
      setSelectedYears([...new Set([...cYears, ...lYears])].sort());
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
  const currentY = new Date().getFullYear();
  const currentM = new Date().getMonth() + 1;

  const monthlyChart = (monthly_stats || []).map((month) => {
    const obj = { month: MONTHS[month.month] };
    contribYears.forEach((year) => {
      const value = month[`contributions_${year}`];
      obj[`fy${year}`] = year > currentY || (year === currentY && month.month > currentM) ? null : value || 0;
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
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to send emails', 'error');
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
    } catch (e) {
      showToast(e.response?.data?.error || 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="admin-overview-page">
      <header className="overview-page-header">
        <div>
          <div className="overview-eyebrow">Checkpoint Investment Club</div>
          <h1>Overview</h1>
          <p>Financial position and operational attention.</p>
        </div>
        <div className="overview-header-actions">
          <select className="overview-select" defaultValue={currentY}>{allBackendYears.map((year) => <option key={year} value={year}>FY{year}</option>)}</select>
          <ActionMenu isAdmin={isAdmin} emailing={emailing} syncing={syncing} syncDone={syncDone} onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} onEmailSummary={handleEmailSummary} onSyncCounters={handleSyncCounters} />
        </div>
      </header>

      <YearComparisonControl years={allBackendYears} selectedYears={selectedYears} onToggle={toggleYear} />

      <section className="overview-metric-grid">
        <MetricTile primary label="Club equity" value={formatTZS(equity.total)} description="Group capital, contributions and profit" icon={Landmark} tone="blue" />
        <MetricTile label="Cash at Bank" value={formatTZS(data.cash_at_bank)} description="M-Koba account" icon={PiggyBank} tone="green" />
        <MetricTile label="Loans Outstanding" value={formatTZS(liabilities.in_circulation)} description={`${active_loans} active loans`} icon={Banknote} tone="red" />
        <MetricTile label="Contributions YTD" value={formatTZS(data.contributions_this_fy || equity.member_contributions)} description={`${active_members} active members`} icon={Users} tone="teal" />
      </section>

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
