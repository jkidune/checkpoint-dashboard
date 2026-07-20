import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, HelpCircle } from 'lucide-react';

// ── Formatters ─────────────────────────────────────────────────────────────
export const fmt = (n) => {
  if (!n && n !== 0) return '—';
  if (n >= 1_000_000) return `TZS ${(n / 1_000_000).toFixed(2)}M`;
  return `TZS ${Number(n).toLocaleString()}`;
};
export const fmtShort = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n;
};

// ── useApi ───────────────────────────────────────────────────────────────
export function useApi(apiFn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFn();
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, error, refetch: fetch };
}

// ── Loading ──────────────────────────────────────────────────────────────
export function Loading() {
  return <div className="m-loading"><div className="m-spinner" /></div>;
}

// ── SectionHeader ────────────────────────────────────────────────────────
export function SectionHeader({ title, sub, action }) {
  return (
    <div className="m-section-header">
      <div>
        <h2 className="m-section-title">{title}</h2>
        {sub && <p className="m-section-sub">{sub}</p>}
      </div>
      {action && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{action}</div>}
    </div>
  );
}

// ── HelpModal ────────────────────────────────────────────────────────────
function HelpModal({ title, body, onClose }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="m-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="m-modal-header">
          <div className="m-modal-title">{title}</div>
          <button type="button" className="m-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="m-modal-body">{body}</div>
      </div>
    </div>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────
// icon: lucide element; iconBg/iconColor: colors for the icon's square badge;
// trend: { value: '+12%', direction: 'up'|'down', label: 'from last month' } optional
// help: { title?: string, body: string } — renders a clickable "?" that opens
// an explanation modal. title defaults to `label` when omitted.
export function StatCard({ icon, iconBg = 'var(--m-accent-blue-bg)', iconColor = 'var(--m-accent-blue)', label, value, trend, help }) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="m-stat-card">
      <div className="m-stat-top">
        <div className="m-stat-icon" style={{ background: iconBg, color: iconColor }}>{icon}</div>
        {help && (
          <button
            type="button"
            className="m-stat-help-btn"
            onClick={() => setShowHelp(true)}
            aria-label={`About ${label}`}
          >
            <HelpCircle size={14} />
          </button>
        )}
      </div>
      <div className="m-stat-label">{label}</div>
      <div className="m-stat-value">{value}</div>
      {trend && (
        <div>
          <span className={`m-stat-trend ${trend.direction}`}>
            {trend.direction === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trend.value}
          </span>
          {trend.label && <span className="m-stat-trend-label"> {trend.label}</span>}
        </div>
      )}
      {help && showHelp && (
        <HelpModal title={help.title || label} body={help.body} onClose={() => setShowHelp(false)} />
      )}
    </div>
  );
}

// ── StatusPill ───────────────────────────────────────────────────────────
const PILL_COLOR_MAP = {
  pending: 'blue', paid: 'green', approved: 'green', active: 'green', paused: 'amber',
  unpaid: 'red', overdue: 'red', partial: 'amber', unread: 'blue', read: 'gray',
  former: 'gray', inactive: 'gray',
};
export function StatusPill({ status, color }) {
  const c = color || PILL_COLOR_MAP[String(status).toLowerCase()] || 'gray';
  return <span className={`m-pill m-pill-${c}`}>{status}</span>;
}

// ── Card ─────────────────────────────────────────────────────────────────
export function Card({ children, style }) {
  return <div className="m-card" style={style}>{children}</div>;
}

// ── Table ────────────────────────────────────────────────────────────────
export function Table({ columns, rows, empty = 'No data yet' }) {
  return (
    <div className="m-table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {columns.map((c) => (
                <td key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="m-table-empty">{empty}</div>}
    </div>
  );
}
