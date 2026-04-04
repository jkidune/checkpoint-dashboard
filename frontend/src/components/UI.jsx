import { useState, useEffect, useCallback } from 'react';

// ── Avatar ─────────────────────────────────────────────────────────────────
export function Avatar({ name = '', size = 36 }) {
  const initials = name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </div>
  );
}

// ── StatCard ───────────────────────────────────────────────────────────────
export function StatCard({ icon, label, value, sub, subColor = 'var(--accent-teal)', accent = 'var(--accent-blue)' }) {
  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position:'absolute', top:0, right:0, width:80, height:80, background:`radial-gradient(circle at 100% 0%, ${accent}20 0%, transparent 70%)` }}/>
      <div style={{ fontSize: 22 }}>{icon}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: 'var(--text-primary)', fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{value}</div>
      {sub && <div style={{ color: subColor, fontSize: 12, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastListener = null;
export function showToast(msg, type = 'success') {
  if (toastListener) toastListener(msg, type);
}

export function Toast() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    toastListener = (msg, type) => {
      const id = Date.now();
      setToasts(t => [...t, { id, msg, type }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
    };
    return () => { toastListener = null; };
  }, []);
  return (
    <div className="toast-container" style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{t.type === 'success' ? '✅' : '❌'}</span>
          <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, maxWidth = 480 }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth }}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn-ghost" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── ProgressBar ────────────────────────────────────────────────────────────
export function ProgressBar({ value, max = 100, color }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const c = color || (pct >= 90 ? 'var(--accent-teal)' : pct >= 70 ? 'var(--accent-amber)' : 'var(--accent-red)');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="progress-wrap" style={{ flex: 1 }}>
        <div className="progress-bar" style={{ width: `${pct}%`, background: c }}/>
      </div>
      <span style={{ color: c, fontSize: 11, fontWeight: 700, minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

// ── Tooltip (custom recharts) ──────────────────────────────────────────────
export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 14px', fontSize:12 }}>
      <div style={{ color:'var(--text-primary)', fontWeight:700, marginBottom:6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight:600 }}>
          {p.name}: {formatter ? formatter(p.value) : p.value?.toLocaleString()}
        </div>
      ))}
    </div>
  );
}

// ── fmt helpers ────────────────────────────────────────────────────────────
export const fmt = (n) => {
  if (!n && n !== 0) return '—';
  if (n >= 1_000_000) return `TZS ${(n/1_000_000).toFixed(2)}M`;
  return `TZS ${Number(n).toLocaleString()}`;
};
export const fmtShort = (n) => {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n/1000).toFixed(0)}K`;
  return n;
};

// ── SectionHeader ──────────────────────────────────────────────────────────
export function SectionHeader({ title, sub, action }) {
  return (
    <div className="section-header-inner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
      <div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>{title}</h2>
        {sub && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</p>}
      </div>
      {action && <div className="section-header-actions">{action}</div>}
    </div>
  );
}

// ── Loading ────────────────────────────────────────────────────────────────
export function Loading() {
  return <div className="loading"><div className="spinner"/></div>;
}

// ── useApi hook ────────────────────────────────────────────────────────────
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
