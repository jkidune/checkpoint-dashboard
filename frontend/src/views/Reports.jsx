import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileText,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { reports as reportsApi } from '../api';
import { showToast } from '../components/UI';
import { downloadQuarterlyReportPdf } from '../utils/quarterlyReportPdf';

const QUARTERS = [
  { value: 1, label: 'Q1 · Mar–May' },
  { value: 2, label: 'Q2 · Jun–Aug' },
  { value: 3, label: 'Q3 · Sep–Nov' },
  { value: 4, label: 'Q4 · Dec–Feb' },
];

function currentFiscalYear(date = new Date()) {
  const month = date.getMonth() + 1;
  return month >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}

function latestCompletedPeriod(date = new Date()) {
  const month = date.getMonth() + 1;
  const fy = currentFiscalYear(date);
  if (month >= 3 && month <= 5) return { fiscalYear: fy - 1, quarter: 4 };
  if (month >= 6 && month <= 8) return { fiscalYear: fy, quarter: 1 };
  if (month >= 9 && month <= 11) return { fiscalYear: fy, quarter: 2 };
  return { fiscalYear: fy, quarter: 3 };
}

function money(value) {
  return `TZS ${Math.round(Number(value || 0)).toLocaleString('en-US')}`;
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusClass(status) {
  if (status === 'published' || status === 'approved') return 'is-good';
  if (status === 'changes_requested') return 'is-danger';
  if (status === 'draft') return 'is-neutral';
  return 'is-info';
}

function ReportMetrics({ snapshot }) {
  const metrics = [
    ['Quarter contributions', money(snapshot?.headline?.contributions_quarter)],
    ['Closing cash', money(snapshot?.headline?.cash_position)],
    ['Loans outstanding', money(snapshot?.headline?.outstanding_loans)],
    ['Investment assets', money(snapshot?.headline?.investment_assets)],
    ['Net group position', money(snapshot?.headline?.net_group_position)],
    ['Active members', String(snapshot?.headline?.active_members || 0)],
  ];
  return (
    <div className="report-metric-grid">
      {metrics.map(([label, value]) => (
        <div className="report-metric-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export default function Reports() {
  const initial = latestCompletedPeriod();
  const [fiscalYear, setFiscalYear] = useState(initial.fiscalYear);
  const [quarter, setQuarter] = useState(initial.quarter);
  const [archive, setArchive] = useState([]);
  const [active, setActive] = useState(null);
  const [loadingArchive, setLoadingArchive] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [executiveSummary, setExecutiveSummary] = useState('');
  const [managementNotes, setManagementNotes] = useState('');

  const loadArchive = async () => {
    setLoadingArchive(true);
    try {
      const response = await reportsApi.list();
      setArchive(response.data || []);
    } catch (error) {
      showToast(error.response?.data?.error || 'Could not load reports', 'error');
    } finally {
      setLoadingArchive(false);
    }
  };

  useEffect(() => { loadArchive(); }, []);

  const loadReport = async (id) => {
    try {
      const response = await reportsApi.get(id);
      setActive(response.data);
      setExecutiveSummary(response.data?.version?.narrative?.executive_summary || '');
      setManagementNotes(response.data?.version?.narrative?.management_notes || '');
    } catch (error) {
      showToast(error.response?.data?.error || 'Could not open report', 'error');
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const response = await reportsApi.generate({ fiscal_year: Number(fiscalYear), quarter: Number(quarter) });
      setActive(response.data);
      setExecutiveSummary(response.data?.version?.narrative?.executive_summary || '');
      setManagementNotes(response.data?.version?.narrative?.management_notes || '');
      await loadArchive();
      showToast(response.data?.version?.version_number > 1 ? 'New frozen report version generated.' : 'Quarterly report draft generated.');
    } catch (error) {
      showToast(error.response?.data?.error || 'Could not generate report', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const narrativeDirty = Boolean(active?.version) && (
    executiveSummary !== (active.version.narrative?.executive_summary || '')
    || managementNotes !== (active.version.narrative?.management_notes || '')
  );

  const persistNarrative = async ({ announce = true } = {}) => {
    if (!active?.report || !active?.version) return null;
    setSaving(true);
    try {
      const response = await reportsApi.updateNarrative(
        active.report.id,
        active.version.version_number,
        { executive_summary: executiveSummary, management_notes: managementNotes },
      );
      setActive(response.data);
      if (announce) showToast('Report narrative saved.');
      return response.data;
    } catch (error) {
      showToast(error.response?.data?.error || 'Could not save narrative', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveNarrative = () => persistNarrative({ announce: true });

  const download = async () => {
    let payload = active;
    if (narrativeDirty) {
      payload = await persistNarrative({ announce: false });
      if (!payload) return;
    }
    try {
      downloadQuarterlyReportPdf(payload.report, payload.version);
      showToast(narrativeDirty ? 'Narrative saved and draft PDF downloaded.' : 'Draft PDF downloaded.');
    } catch (error) {
      showToast(error.message || 'Could not create PDF', 'error');
    }
  };

  const snapshot = active?.version?.financial_snapshot;
  const latestCompleted = useMemo(() => latestCompletedPeriod(), []);
  const yearOptions = useMemo(
    () => [latestCompleted.fiscalYear - 2, latestCompleted.fiscalYear - 1, latestCompleted.fiscalYear],
    [latestCompleted],
  );
  const availableQuarters = useMemo(
    () => QUARTERS.filter((item) => (
      fiscalYear < latestCompleted.fiscalYear || item.value <= latestCompleted.quarter
    )),
    [fiscalYear, latestCompleted],
  );

  useEffect(() => {
    if (!availableQuarters.some((item) => item.value === quarter) && availableQuarters.length) {
      setQuarter(availableQuarters[availableQuarters.length - 1].value);
    }
  }, [availableQuarters, quarter]);

  return (
    <div className="admin-page-container reports-page">
      <header className="admin-page-header reports-header">
        <div>
          <div className="admin-page-eyebrow">Governance & reporting</div>
          <h1>Quarterly Reports</h1>
          <p>Generate a frozen financial snapshot, review the narrative and download a professional draft PDF.</p>
        </div>
        <div className="report-header-badge"><ShieldCheck size={14} /> Financial figures are read-only</div>
      </header>

      <section className="report-builder-card">
        <div>
          <span className="report-builder-kicker"><Sparkles size={13} /> New quarterly draft</span>
          <h2>Generate from Checkpoint records</h2>
          <p>The reporting period follows the club fiscal year: March to February. Regenerating the same quarter creates a new frozen version.</p>
        </div>
        <div className="report-builder-controls">
          <label>
            <span>Fiscal year</span>
            <select className="admin-select" value={fiscalYear} onChange={(event) => setFiscalYear(Number(event.target.value))}>
              {yearOptions.map((year) => <option key={year} value={year}>FY{year}</option>)}
            </select>
          </label>
          <label>
            <span>Quarter</span>
            <select className="admin-select" value={quarter} onChange={(event) => setQuarter(Number(event.target.value))}>
              {availableQuarters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button className="admin-btn-primary report-generate-btn" type="button" onClick={generate} disabled={generating}>
            <RefreshCw size={14} className={generating ? 'is-spinning' : ''} />
            {generating ? 'Generating…' : 'Generate report'}
          </button>
        </div>
      </section>

      <div className="reports-layout">
        <aside className="report-archive-card">
          <div className="report-section-head">
            <div><h2>Report archive</h2><p>Draft versions are visible to administrators only.</p></div>
          </div>
          {loadingArchive ? (
            <div className="report-empty">Loading reports…</div>
          ) : archive.length === 0 ? (
            <div className="report-empty"><FileText size={20} /><strong>No quarterly reports yet.</strong><span>Generate the first draft above.</span></div>
          ) : (
            <div className="report-archive-list">
              {archive.map((report) => (
                <button
                  type="button"
                  key={report.id}
                  className={`report-archive-item${active?.report?.id === report.id ? ' active' : ''}`}
                  onClick={() => loadReport(report.id)}
                >
                  <span className="report-archive-icon"><FileText size={16} /></span>
                  <span className="report-archive-copy">
                    <strong>Q{report.quarter} · FY{report.fiscal_year}</strong>
                    <small>{report.report_number} · v{report.current_version}</small>
                  </span>
                  <span className={`admin-badge ${statusClass(report.status)}`}>{report.status}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="report-preview-card">
          {!active?.report || !snapshot ? (
            <div className="report-empty report-empty-large">
              <FileText size={28} />
              <strong>Select a report or generate a new quarterly draft.</strong>
              <span>The preview will show exactly the financial snapshot used to create the PDF.</span>
            </div>
          ) : (
            <>
              <div className="report-preview-head">
                <div>
                  <div className="report-preview-meta">
                    <span className={`admin-badge ${statusClass(active.report.status)}`}>{active.report.status}</span>
                    <span>{active.report.report_number}</span>
                    <span>Version {active.version.version_number}</span>
                  </div>
                  <h2>Q{active.report.quarter} FY{active.report.fiscal_year} Financial Report</h2>
                  <p>{dateLabel(active.report.period_start)} — {dateLabel(active.report.period_end)} · Generated {dateLabel(active.version.generated_at)}</p>
                </div>
                <button type="button" className="admin-btn-primary" onClick={download}><Download size={14} /> Download draft PDF</button>
              </div>

              <div className="report-freeze-notice">
                <ShieldCheck size={17} />
                <div><strong>This version is frozen.</strong><span>Financial numbers cannot be edited here. Correct source records and generate a new version if a figure needs to change.</span></div>
              </div>

              <ReportMetrics snapshot={snapshot} />

              <section className="report-narrative-card">
                <div className="report-section-head">
                  <div><h2>Treasurer narrative</h2><p>Only narrative text is editable in this draft.</p></div>
                  <button type="button" className="admin-btn-secondary" onClick={saveNarrative} disabled={saving}><Save size={13} /> {saving ? 'Saving…' : 'Save narrative'}</button>
                </div>
                <label>
                  <span>Executive summary</span>
                  <textarea value={executiveSummary} onChange={(event) => setExecutiveSummary(event.target.value)} rows={5} maxLength={4000} />
                </label>
                <label>
                  <span>Management notes</span>
                  <textarea value={managementNotes} onChange={(event) => setManagementNotes(event.target.value)} rows={4} maxLength={6000} placeholder="Add context, explanations or management notes for reviewers…" />
                </label>
              </section>

              <section className="report-preview-grid">
                <div className="report-mini-card">
                  <span>Contribution collection</span>
                  <strong>{snapshot.contributions?.collection_rate == null ? '—' : `${(snapshot.contributions.collection_rate * 100).toFixed(1)}%`}</strong>
                  <p>{money(snapshot.contributions?.quarter_received)} received against {money(snapshot.contributions?.quarter_expected)} expected.</p>
                </div>
                <div className="report-mini-card">
                  <span>Loan portfolio</span>
                  <strong>{money(snapshot.loans?.outstanding_balance)}</strong>
                  <p>{snapshot.loans?.outstanding_count || 0} outstanding balances · {money(snapshot.loans?.repayments_received)} repaid in the quarter.</p>
                </div>
                <div className="report-mini-card">
                  <span>Investments</span>
                  <strong>{money(snapshot.investments?.current_value)}</strong>
                  <p>{money(snapshot.investments?.gain_loss)} valuation movement against cost.</p>
                </div>
                <div className="report-mini-card">
                  <span>Operating activity</span>
                  <strong>{money(snapshot.expenses?.quarter_total)}</strong>
                  <p>Expenses · {money(snapshot.welfare?.quarter_total)} welfare · {money(snapshot.fines?.paid_quarter)} fines received.</p>
                </div>
              </section>

              {(snapshot.controls?.flags || []).length > 0 && (
                <section className="report-controls-card">
                  <div className="report-section-head"><div><h2>Controls & exceptions</h2><p>Items captured automatically from the frozen snapshot.</p></div></div>
                  {(snapshot.controls.flags || []).map((item, index) => (
                    <div className="report-control-row" key={`${item.type}-${index}`}>
                      <AlertTriangle size={14} />
                      <div><strong>{String(item.type || 'control').replaceAll('_', ' ')}</strong><span>{item.message}</span></div>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
