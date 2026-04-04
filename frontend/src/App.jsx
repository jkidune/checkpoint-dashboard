import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { Analytics } from "@vercel/analytics/react"

import Sidebar from './components/Sidebar';
import { Toast } from './components/UI';
import Login from './views/Login';
import Overview from './views/Overview';
import Contributions from './views/Contributions';
import Loans from './views/Loans';
import Members from './views/Members';
import Transactions from './views/Transactions';
import Investments from './views/Investments';
import Expenses from './views/Expenses';
import Settings from './views/Settings';
import { auth } from './api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Layout({ user, onLogout, children }) {
  const now = new Date();
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Analytics />
      <Sidebar user={user} onLogout={onLogout} />
      <main style={{ flex: 1, overflow: 'auto', padding: '28px 32px', background: 'var(--bg-base)' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 24, gap: 12 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-muted)', fontSize: 12 }}>
            📅 {MONTHS[now.getMonth()]} {now.getFullYear()}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: '#0ea5e922', border: '1.5px solid #0ea5e955',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-blue)',
              fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-display)',
            }}>
              {(user?.name || user?.username || '?').charAt(0).toUpperCase()}
            </div>
            <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>{user?.name || user?.username}</span>
            <span className={`badge badge-${user?.role}`}>{user?.role}</span>
          </div>
        </div>
        {children}
      </main>
      <Toast />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cp_token');
    if (token) {
      auth.me().then(r => { setUser(r.data); setLoading(false); })
        .catch(() => { localStorage.removeItem('cp_token'); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('cp_token');
    setUser(null);
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #0ea5e9, #14b8a6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 900,
          color: '#fff', margin: '0 auto 16px', fontFamily: 'var(--font-display)',
        }}>C</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading Checkpoint…</div>
      </div>
    </div>
  );

  if (!user) return <Login onLogin={setUser} />;

  return (
    <BrowserRouter>
      <Layout user={user} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<Overview user={user} />} />
          <Route path="/contributions" element={<Contributions user={user} />} />
          <Route path="/loans" element={<Loans user={user} />} />
          <Route path="/members" element={<Members user={user} />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/investments" element={<Investments />} />
          <Route path="/expenses" element={<Expenses user={user} />} />
          <Route path="/settings" element={<Settings user={user} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
