import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Wallet, Banknote, Users, UserRoundCog, ArrowLeftRight,
  TrendingUp, Receipt, Settings, LogOut, ChevronLeft, ChevronRight, ClipboardCheck,
} from 'lucide-react';

const NAV = [
  { to: '/', Icon: LayoutDashboard, label: 'Overview' },
  { to: '/contributions', Icon: Wallet, label: 'Contributions' },
  { to: '/loans', Icon: Banknote, label: 'Loans' },
  { to: '/members', Icon: Users, label: 'Members' },
  { to: '/member-accounts', Icon: UserRoundCog, label: 'Member Accounts', adminOnly: true },
  { to: '/form-intake', Icon: ClipboardCheck, label: 'Form Intake', adminOnly: true },
  { to: '/transactions', Icon: ArrowLeftRight, label: 'Transactions', adminOnly: true },
  { to: '/investments', Icon: TrendingUp, label: 'Investments', adminOnly: true },
  { to: '/expenses', Icon: Receipt, label: 'Expenses' },
  { to: '/settings', Icon: Settings, label: 'Settings', adminOnly: true },
];

const BOTTOM_NAV_ITEMS = ['/', '/contributions', '/loans', '/members', '/expenses'];

function MobileBottomNav({ user }) {
  const items = NAV.filter((item) => BOTTOM_NAV_ITEMS.includes(item.to) && (!item.adminOnly || user?.role === 'admin'));
  return (
    <nav className="mobile-bottomnav">
      {items.map(({ to, Icon, label }) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}>
          <Icon size={19} strokeWidth={1.9} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Logo({ collapsed, palette }) {
  return (
    <div style={{ padding: collapsed ? '0 0 18px' : '0 18px 18px', borderBottom: `1px solid ${palette.border}`, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: palette.logoBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', fontSize: 15 }}>C</div>
      {!collapsed && <div><div style={{ color: palette.textPrimary, fontWeight: 650, fontSize: 14, lineHeight: 1.1 }}>Checkpoint</div><div style={{ color: palette.logoSub, fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', marginTop: 2 }}>INVESTMENT CLUB</div></div>}
    </div>
  );
}

export default function Sidebar({ user, onLogout, drawerOpen, onDrawerClose, appearance = 'dark' }) {
  const [collapsed, setCollapsed] = useState(false);
  const navItems = NAV.filter((item) => !item.adminOnly || user?.role === 'admin');
  const light = appearance === 'light';
  const palette = light ? {
    background: '#f8fafc', border: '#e4e4e7', textPrimary: '#18181b', textMuted: '#71717a',
    card: '#ffffff', accentBlue: '#2563eb', accentTeal: '#0f766e', activeBg: '#ffffff',
    activeText: '#18181b', hoverBg: '#f4f4f5', logoBg: '#2563eb', logoSub: '#2563eb',
  } : {
    background: '#172554', border: 'rgba(255,255,255,0.14)', textPrimary: '#ffffff',
    textMuted: 'rgba(255,255,255,0.72)', card: 'rgba(255,255,255,0.09)', accentBlue: '#bfdbfe',
    accentTeal: '#5eead4', activeBg: 'rgba(255,255,255,0.14)', activeText: '#ffffff',
    hoverBg: 'rgba(255,255,255,0.08)', logoBg: '#2563eb', logoSub: '#bfdbfe',
  };

  const shellStyle = {
    width: collapsed ? 68 : 232,
    background: palette.background,
    borderRight: `1px solid ${palette.border}`,
    display: 'flex', flexDirection: 'column', padding: '20px 0', flexShrink: 0,
    height: '100vh', transition: 'width .2s ease', overflow: 'hidden', position: 'relative',
  };

  const navStyle = (active, mobile = false) => ({
    display: 'flex', alignItems: 'center', gap: collapsed && !mobile ? 0 : 10,
    padding: mobile ? '10px 12px' : collapsed ? '9px 0' : '9px 11px',
    justifyContent: collapsed && !mobile ? 'center' : 'flex-start', borderRadius: 8,
    background: active ? palette.activeBg : 'transparent', color: active ? palette.activeText : palette.textMuted,
    border: light && active ? `1px solid ${palette.border}` : '1px solid transparent',
    fontWeight: active ? 650 : 500, fontSize: mobile ? 14 : 13, whiteSpace: 'nowrap',
  });

  const Navigation = ({ mobile = false }) => (
    <nav style={{ padding: '14px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
      {navItems.map(({ to, Icon, label }) => (
        <NavLink key={to} to={to} end={to === '/'} style={{ textDecoration: 'none' }} onClick={onDrawerClose}>
          {({ isActive }) => <div title={!mobile && collapsed ? label : undefined} style={navStyle(isActive, mobile)}><Icon size={16} /><span style={{ display: !mobile && collapsed ? 'none' : 'inline' }}>{label}</span></div>}
        </NavLink>
      ))}
    </nav>
  );

  const AccountFooter = ({ mobile = false }) => (
    <div style={{ padding: '0 14px 14px' }}>
      <div style={{ borderTop: `1px solid ${palette.border}`, paddingTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: collapsed && !mobile ? 'none' : 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: palette.card, border: `1px solid ${palette.border}`, display: 'grid', placeItems: 'center', color: palette.textPrimary, fontSize: 11, fontWeight: 700 }}>{(user?.name || user?.username || 'A').slice(0, 2).toUpperCase()}</div>
          <div style={{ minWidth: 0 }}><div style={{ color: palette.textPrimary, fontSize: 12, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name || user?.username}</div><div style={{ color: palette.textMuted, fontSize: 10, marginTop: 1 }}>{user?.role === 'admin' ? 'Administrator' : 'Member'}</div></div>
        </div>
        <button onClick={onLogout} title="Log out" style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${palette.border}`, background: palette.card, color: palette.textMuted, display: 'grid', placeItems: 'center', cursor: 'pointer' }}><LogOut size={14} /></button>
      </div>
    </div>
  );

  return (
    <>
      <div className="sidebar-shell">
        <aside className={`sidebar-desktop${collapsed ? ' sidebar-collapsed' : ''}`} style={shellStyle}>
          <Logo collapsed={collapsed} palette={palette} />
          <Navigation />
          <AccountFooter />
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed((value) => !value)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </aside>
      </div>

      {drawerOpen && <div className="sidebar-overlay" onClick={onDrawerClose} />}
      <div className={`sidebar-drawer${drawerOpen ? ' open' : ''}`}>
        <aside style={{ ...shellStyle, width: 260, height: '100%' }}>
          <Logo collapsed={false} palette={palette} />
          <Navigation mobile />
          <AccountFooter mobile />
        </aside>
      </div>

      <MobileBottomNav user={user} />
    </>
  );
}
