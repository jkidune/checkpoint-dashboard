import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Wallet, Banknote, Users, ArrowLeftRight,
  TrendingUp, Receipt, Settings, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react';

const NAV = [
  { to: '/',              Icon: LayoutDashboard, label: 'Overview'      },
  { to: '/contributions', Icon: Wallet,          label: 'Contributions'  },
  { to: '/loans',         Icon: Banknote,        label: 'Loans'          },
  { to: '/members',       Icon: Users,           label: 'Members'        },
  { to: '/transactions',  Icon: ArrowLeftRight,  label: 'Transactions', adminOnly: true },
  { to: '/investments',   Icon: TrendingUp,      label: 'Investments',  adminOnly: true },
  { to: '/expenses',      Icon: Receipt,         label: 'Expenses'       },
  { to: '/settings',      Icon: Settings,        label: 'Settings', adminOnly: true },
];

const BOTTOM_NAV_ITEMS = ['/', '/contributions', '/loans', '/members', '/expenses'];

function MobileBottomNav({ user }) {
  const items = NAV.filter(n =>
    BOTTOM_NAV_ITEMS.includes(n.to) && (!n.adminOnly || user?.role === 'admin')
  );
  return (
    <nav className="mobile-bottomnav">
      {items.map(({ to, Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}
        >
          <Icon size={19} strokeWidth={1.9}/>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function Sidebar({ user, onLogout, drawerOpen, onDrawerClose, appearance = 'dark' }) {
  const [collapsed, setCollapsed] = useState(false);
  const navItems = NAV.filter(n => !n.adminOnly || user?.role === 'admin');
  const light = appearance === 'light';

  const palette = light ? {
    background: '#f8fafc',
    border: '#e4e4e7',
    textPrimary: '#18181b',
    textMuted: '#71717a',
    textSecondary: '#52525b',
    card: '#ffffff',
    surface: '#ffffff',
    accentBlue: '#2563eb',
    accentTeal: '#0f766e',
    activeBg: '#ffffff',
    activeText: '#18181b',
    hoverBg: '#f4f4f5',
    logoBg: '#2563eb',
    logoSub: '#2563eb',
    activeShadow: '0 1px 2px rgba(24,24,27,0.05)',
  } : {
    background: 'linear-gradient(180deg, #1e3a8a 0%, #1e40af 54%, #172554 100%)',
    border: 'rgba(255,255,255,0.14)',
    textPrimary: '#ffffff',
    textMuted: 'rgba(255,255,255,0.72)',
    textSecondary: 'rgba(255,255,255,0.82)',
    card: 'rgba(255,255,255,0.09)',
    surface: 'rgba(255,255,255,0.08)',
    accentBlue: '#bfdbfe',
    accentTeal: '#5eead4',
    activeBg: 'rgba(255,255,255,0.14)',
    activeText: '#ffffff',
    hoverBg: 'rgba(255,255,255,0.08)',
    logoBg: 'linear-gradient(135deg, #38bdf8, #2dd4bf)',
    logoSub: '#bfdbfe',
    activeShadow: 'inset 3px 0 0 #5eead4',
  };

  const shellStyle = {
    width: collapsed ? 68 : 232,
    background: palette.background,
    borderRight: `1px solid ${palette.border}`,
    '--text-primary': palette.textPrimary,
    '--text-muted': palette.textMuted,
    '--text-secondary': palette.textSecondary,
    '--border': palette.border,
    '--bg-card': palette.card,
    '--bg-surface': palette.surface,
    '--accent-blue': palette.accentBlue,
    '--accent-teal': palette.accentTeal,
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 0',
    flexShrink: 0,
    height: '100vh',
    transition: 'width 0.22s ease',
    overflow: 'hidden',
    position: 'relative',
  };

  const navItemStyle = (isActive, mobile = false) => ({
    display: 'flex',
    alignItems: 'center',
    gap: collapsed && !mobile ? 0 : mobile ? 12 : 10,
    padding: mobile ? '10px 12px' : collapsed ? '9px 0' : '9px 11px',
    justifyContent: collapsed && !mobile ? 'center' : 'flex-start',
    borderRadius: 8,
    cursor: 'pointer',
    background: isActive ? palette.activeBg : 'transparent',
    color: isActive ? palette.activeText : palette.textMuted,
    border: light && isActive ? `1px solid ${palette.border}` : '1px solid transparent',
    boxShadow: isActive ? palette.activeShadow : 'none',
    fontWeight: isActive ? 600 : 500,
    fontSize: mobile ? 14 : 13,
    transition: 'background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s',
    whiteSpace: 'nowrap',
  });

  const sidebarContent = (
    <aside className={`sidebar-desktop${collapsed ? ' sidebar-collapsed' : ''}`} style={shellStyle}>
      <div style={{
        padding: collapsed ? '0 0 20px' : '0 18px 20px',
        borderBottom: `1px solid ${palette.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 10,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: palette.logoBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, color: '#fff', fontSize: 15, fontFamily: 'var(--font-display)',
        }}>C</div>
        {!collapsed && (
          <div>
            <div style={{ color: palette.textPrimary, fontWeight: 650, fontSize: 14, fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>Checkpoint</div>
            <div style={{ color: palette.logoSub, fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', marginTop: 2 }}>INVESTMENT CLUB</div>
          </div>
        )}
      </div>

      <nav style={{ padding: collapsed ? '14px 8px' : '14px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {navItems.map(({ to, Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} style={{ textDecoration: 'none' }} onClick={onDrawerClose}>
            {({ isActive }) => (
              <div
                title={collapsed ? label : undefined}
                style={navItemStyle(isActive)}
                onMouseEnter={(event) => { if (!isActive) event.currentTarget.style.background = palette.hoverBg; }}
                onMouseLeave={(event) => { if (!isActive) event.currentTarget.style.background = 'transparent'; }}
              >
                <Icon size={15} strokeWidth={isActive ? 2.2 : 1.9} style={{ flexShrink: 0 }}/>
                {!collapsed && label}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <div style={{ padding: '0 14px' }}>
          <div style={{ borderTop: `1px solid ${palette.border}`, paddingTop: 14 }}>
            <div style={{ background: palette.card, border: light ? `1px solid ${palette.border}` : 'none', borderRadius: 10, padding: 12, marginBottom: 12, boxShadow: light ? '0 1px 2px rgba(24,24,27,0.03)' : 'none' }}>
              <div style={{ color: palette.textMuted, fontSize: 10, marginBottom: 3, fontWeight: 500 }}>Club equity</div>
              <div style={{ color: palette.textPrimary, fontWeight: 600, fontSize: 17, fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums' }}>TZS 15.54M</div>
              <div style={{ color: light ? palette.accentTeal : palette.accentTeal, fontSize: 10, marginTop: 2 }}>FY2025 · 10 members</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: light ? '#f4f4f5' : 'rgba(255,255,255,0.1)',
                  border: `1px solid ${palette.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 11, color: palette.textPrimary,
                  flexShrink: 0,
                }}>
                  {(user?.name || user?.username || 'A').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: palette.textPrimary, fontSize: 12, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.name || user?.username}
                  </div>
                  <div style={{ color: palette.textMuted, fontSize: 10, marginTop: 1, textTransform: 'capitalize' }}>
                    {user?.role === 'admin' ? 'Administrator' : user?.role}
                  </div>
                </div>
              </div>
              <button
                onClick={onLogout}
                title="Logout"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 7, borderRadius: 8,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.textMuted,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <LogOut size={14}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {collapsed && (
        <div style={{ padding: '12px 8px', borderTop: `1px solid ${palette.border}`, display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={onLogout}
            title="Logout"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 8, borderRadius: 8,
              border: `1px solid ${palette.border}`,
              background: palette.surface,
              color: palette.textMuted,
              cursor: 'pointer',
            }}
          >
            <LogOut size={15}/>
          </button>
        </div>
      )}

      <button
        className="sidebar-collapse-btn"
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={14}/> : <ChevronLeft size={14}/>}
      </button>
    </aside>
  );

  return (
    <>
      <div className="sidebar-shell">{sidebarContent}</div>

      {drawerOpen && <div className="sidebar-overlay" onClick={onDrawerClose} />}

      <div className={`sidebar-drawer${drawerOpen ? ' open' : ''}`}>
        <aside style={{ ...shellStyle, width: 260, height: '100%' }}>
          <div style={{
            padding: '0 18px 20px',
            borderBottom: `1px solid ${palette.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9,
                background: palette.logoBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, color: '#fff', fontSize: 15, fontFamily: 'var(--font-display)',
              }}>C</div>
              <div>
                <div style={{ color: palette.textPrimary, fontWeight: 650, fontSize: 14, fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>Checkpoint</div>
                <div style={{ color: palette.logoSub, fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', marginTop: 2 }}>INVESTMENT CLUB</div>
              </div>
            </div>
            <button onClick={onDrawerClose} style={{ padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${palette.border}`, background: palette.surface, color: palette.textMuted }}>
              <ChevronLeft size={16}/>
            </button>
          </div>

          <nav style={{ padding: '14px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
            {navItems.map(({ to, Icon, label }) => (
              <NavLink key={to} to={to} end={to === '/'} style={{ textDecoration: 'none' }} onClick={onDrawerClose}>
                {({ isActive }) => (
                  <div style={navItemStyle(isActive, true)}>
                    <Icon size={17} strokeWidth={isActive ? 2.2 : 1.9}/>
                    {label}
                  </div>
                )}
              </NavLink>
            ))}
          </nav>

          <div style={{ padding: '0 14px' }}>
            <div style={{ borderTop: `1px solid ${palette.border}`, paddingTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ color: palette.textPrimary, fontSize: 13, fontWeight: 600 }}>{user?.name || user?.username}</div>
                  <div style={{ color: palette.textMuted, fontSize: 10, marginTop: 2, textTransform: 'capitalize' }}>{user?.role}</div>
                </div>
                <button
                  onClick={() => { onDrawerClose(); onLogout(); }}
                  title="Logout"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, fontSize: 12, border: `1px solid ${palette.border}`, background: palette.surface, color: palette.textMuted }}
                >
                  <LogOut size={14}/>
                  Logout
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <MobileBottomNav user={user} />
    </>
  );
}
