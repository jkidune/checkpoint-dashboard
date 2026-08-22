import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './index.css';
import { Analytics } from "@vercel/analytics/react"
import { Menu, Bell } from 'lucide-react';

import Sidebar from './components/Sidebar';
import { Toast } from './components/UI';
import Login from './views/Login';
import SignUp from './views/SignUp';
import Overview from './views/Overview';
import Contributions from './views/Contributions';
import Loans from './views/Loans';
import Members from './views/Members';
import Transactions from './views/Transactions';
import Investments from './views/Investments';
import Expenses from './views/Expenses';
import Settings from './views/Settings';
import { auth, notifications as notificationsApi } from './api';

import MemberLayout from './member/components/Layout';
import MemberDashboardPage from './member/views/Dashboard';
import MemberContributionsPage from './member/views/Contributions';
import MemberLoansPage from './member/views/Loans';
import MemberMembersPage from './member/views/Members';
import MemberTransactionsPage from './member/views/Transactions';
import MemberExpensesPage from './member/views/Expenses';
import MemberInvestmentsPage from './member/views/Investments';
import MemberNotificationsPage from './member/views/Notifications';
import MemberHelpPage from './member/views/Help';
import MemberSettingsPage from './member/views/Settings';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ENABLE_DESIGN_SYSTEM = import.meta.env.VITE_ENABLE_DESIGN_SYSTEM === 'true';
const DesignSystem = lazy(() => import('./views/DesignSystem'));

// ── Notification bell ─────────────────────────────────────────────────────
// Unread count for the logged-in member. Admin accounts aren't usually linked
// to a member record, so the bell is only shown for member tokens — admins
// get the equivalent "members needing attention" digest on the Overview page.
function NotificationBell({ user }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user || user.member_id == null) return;
    notificationsApi.list({ member_id: user.member_id })
      .then(r => setUnread((r.data || []).filter(n => !n.read).length))
      .catch(() => {});
  }, [user]);

  if (!user || user.member_id == null) return null;

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }} title={`${unread} unread notification${unread === 1 ? '' : 's'}`}>
      <Bell size={16} color="var(--text-muted)" />
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: -6, right: -8, minWidth: 15, height: 15, borderRadius: 8,
          background: 'var(--accent-red)', color: '#fff', fontSize: 9, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
        }}>{unread}</span>
      )}
    </div>
  );
}

function Layout({ user, onLogout, children }) {
  const now = new Date();
  const initial = (user?.name || user?.username || '?').charAt(0).toUpperCase();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const isLightOverview = user?.role === 'admin' && location.pathname === '/';

  const mainTheme = isLightOverview ? {
    background: '#fafafa',
    '--bg-base': '#fafafa',
    '--bg-surface': '#ffffff',
    '--bg-card': '#ffffff',
    '--bg-input': '#ffffff',
    '--border': '#e4e4e7',
    '--border-hover': '#d4d4d8',
    '--text-primary': '#18181b',
    '--text-secondary': '#52525b',
    '--text-muted': '#71717a',
    '--accent-blue': '#2563eb',
    '--accent-teal': '#0f766e',
    '--shadow': '0 1px 2px rgba(24,24,27,0.04)',
  } : {
    background: 'var(--bg-base)',
  };

  return (
    <div className="app-layout">
      <Analytics />
      <Sidebar
        user={user}
        onLogout={onLogout}
        drawerOpen={drawerOpen}
        onDrawerClose={() => setDrawerOpen(false)}
        appearance={isLightOverview ? 'light' : 'dark'}
      />
      <main
        className={`app-main${isLightOverview ? ' app-main-overview-light' : ''}`}
        style={{ flex: 1, overflow: 'auto', ...mainTheme }}
      >

        {/* ── Mobile sticky header (hidden on desktop via CSS) ── */}
        <div className="topbar-mobile">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* Hamburger button */}
            <button
              className="btn-ghost hamburger-btn"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              style={{ padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Menu size={20}/>
            </button>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: isLightOverview ? '#2563eb' : 'linear-gradient(135deg, #0ea5e9, #14b8a6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, color: '#fff', fontSize: 14, fontFamily: 'var(--font-display)', flexShrink: 0,
            }}>C</div>
            <div>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-display)', lineHeight: 1 }}>Checkpoint</div>
              <div style={{ color: 'var(--accent-blue)', fontSize: 9, fontWeight: 500, letterSpacing: '0.04em' }}>INVESTMENT CLUB</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NotificationBell user={user} />
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: isLightOverview ? '#f4f4f5' : '#0ea5e922', border: `1px solid ${isLightOverview ? '#e4e4e7' : '#0ea5e955'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: isLightOverview ? '#52525b' : 'var(--accent-blue)',
              fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-display)',
            }}>{initial}</div>
            <span className={`badge badge-${user?.role}`} style={{ fontSize: 10 }}>{user?.role}</span>
          </div>
        </div>

        {/* ── Scrollable content area ── */}
        <div className="app-main-scroll">
          {/* Desktop top bar (hidden on mobile via CSS) */}
          <div className="topbar-desktop">
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-muted)', fontSize: 12 }}>
              📅 {MONTHS[now.getMonth()]} {now.getFullYear()}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px',
            }}>
              <NotificationBell user={user} />
              <div style={{
                width: 28, height: 28, borderRadius: '50%', background: isLightOverview ? '#f4f4f5' : '#0ea5e922', border: `1px solid ${isLightOverview ? '#e4e4e7' : '#0ea5e955'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: isLightOverview ? '#52525b' : 'var(--accent-blue)',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-display)',
              }}>{initial}</div>
              <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>{user?.name || user?.username}</span>
              <span className={`badge badge-${user?.role}`}>{user?.role}</span>
            </div>
          </div>

          {children}

          {/* ── Footer ── */}
          <div style={{
            marginTop: 40, paddingTop: 16,
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 11,
          }}>
            Built by{' '}
            <a
              href="https://baronsdigital.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-blue)', fontWeight: 600, textDecoration: 'none' }}
            >
              Barons Digital
            </a>
          </div>
        </div>
      </main>
      <Toast />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authView, setAuthView] = useState('login');

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

  if (ENABLE_DESIGN_SYSTEM && window.location.pathname === '/design-system') {
    return (
      <BrowserRouter>
        <Routes>
          <Route
            path="/design-system"
            element={(
              <Suspense fallback={<div style={{ minHeight: '100vh', background: '#020617' }} />}>
                <DesignSystem />
              </Suspense>
            )}
          />
          <Route path="*" element={<Navigate to="/design-system" />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (!user) {
    return authView === 'signup'
      ? <SignUp onLogin={setUser} onSwitchToLogin={() => setAuthView('login')} />
      : <Login onLogin={setUser} onSwitchToSignup={() => setAuthView('signup')} />;
  }

  const isAdmin = user.role === 'admin';

  // Admin routes retain the legacy shell except for the Overview route,
  // which now opts into the light design-system canvas during migration.
  if (isAdmin) {
    return (
      <BrowserRouter>
        <Layout user={user} onLogout={handleLogout}>
          <Routes>
            <Route path="/" element={<Overview user={user} />} />
            <Route path="/contributions" element={<Contributions user={user} />} />
            <Route path="/loans" element={<Loans user={user} />} />
            <Route path="/members" element={<Members user={user} />} />
            <Route path="/expenses" element={<Expenses user={user} />} />
            <Route path="/settings" element={<Settings user={user} />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/investments" element={<Investments />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    );
  }

  // Member: separate light-theme shell (frontend/src/member/), zero shared
  // components with the admin tree above.
  return (
    <BrowserRouter>
      <MemberLayout user={user} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<MemberDashboardPage user={user} />} />
          <Route path="/contributions" element={<MemberContributionsPage />} />
          <Route path="/loans" element={<MemberLoansPage />} />
          <Route path="/members" element={<MemberMembersPage user={user} />} />
          <Route path="/transactions" element={<MemberTransactionsPage />} />
          <Route path="/expenses" element={<MemberExpensesPage />} />
          <Route path="/investments" element={<MemberInvestmentsPage />} />
          <Route path="/notifications" element={<MemberNotificationsPage />} />
          <Route path="/help" element={<MemberHelpPage />} />
          <Route path="/settings" element={<MemberSettingsPage user={user} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </MemberLayout>
    </BrowserRouter>
  );
}
