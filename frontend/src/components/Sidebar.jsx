import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Wallet, Banknote, Users, ArrowLeftRight,
  TrendingUp, Receipt, Settings, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react';

const NAV = [
  { to: '/',              Icon: LayoutDashboard, label: 'Overview'      },
  { to: '/contributions', Icon: Wallet,          label: 'Contribs'       },
  { to: '/loans',         Icon: Banknote,        label: 'Loans'          },
  { to: '/members',       Icon: Users,           label: 'Members'        },
  { to: '/transactions',  Icon: ArrowLeftRight,  label: 'Transactions'   },
  { to: '/investments',   Icon: TrendingUp,      label: 'Investments'    },
  { to: '/expenses',      Icon: Receipt,         label: 'Expenses'       },
  { to: '/settings',      Icon: Settings,        label: 'Settings', adminOnly: true },
];

// Items shown in bottom nav (most-used 5)
const BOTTOM_NAV_ITEMS = ['/', '/contributions', '/loans', '/members', '/expenses'];

// ── Mobile bottom navigation bar ────────────────────────────────────────────
function MobileBottomNav({ user, onLogout }) {
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

// ── Desktop/tablet sidebar (also used as mobile drawer) ──────────────────────
export default function Sidebar({ user, onLogout, drawerOpen, onDrawerClose }) {
  const [collapsed, setCollapsed] = useState(false);

  const navItems = NAV.filter(n => !n.adminOnly || user?.role === 'admin');

  const sidebarContent = (
    <aside
      className={`sidebar-desktop${collapsed ? ' sidebar-collapsed' : ''}`}
      style={{
        width: collapsed ? 64 : 220,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 0',
        flexShrink: 0,
        height: '100vh',
        transition: 'width 0.22s ease',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div style={{
        padding: collapsed ? '0 0 24px' : '0 20px 24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 10,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: 'linear-gradient(135deg, #0ea5e9, #14b8a6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 900, color: '#fff', fontSize: 16, fontFamily: 'var(--font-display)',
        }}>C</div>
        {!collapsed && (
          <div>
            <div style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: 14, fontFamily: 'var(--font-display)', lineHeight: 1 }}>Checkpoint</div>
            <div style={{ color: 'var(--accent-blue)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>INVESTMENT CLUB</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ padding: collapsed ? '16px 8px' : '16px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map(({ to, Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={{ textDecoration: 'none' }}
            onClick={onDrawerClose}
          >
            {({ isActive }) => (
              <div
                title={collapsed ? label : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: collapsed ? 0 : 10,
                  padding: collapsed ? '10px 0' : '10px 12px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: isActive ? 'linear-gradient(90deg, #0ea5e9, #14b8a6)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 13,
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon size={15} strokeWidth={isActive ? 2.5 : 2} style={{ flexShrink: 0 }}/>
                {!collapsed && label}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      {!collapsed && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Club Equity</div>
              <div style={{ color: 'var(--accent-blue)', fontWeight: 800, fontSize: 18, fontFamily: 'var(--font-display)' }}>TZS 15.54M</div>
              <div style={{ color: 'var(--accent-teal)', fontSize: 11, marginTop: 2 }}>FY2025 · 10 Members</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>{user?.name || user?.username}</div>
                <span style={{ fontSize: 10, fontWeight: 700 }} className={`badge badge-${user?.role}`}>{user?.role}</span>
              </div>
              <button
                onClick={onLogout}
                className="btn-ghost"
                title="Logout"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 7, borderRadius: 8 }}
              >
                <LogOut size={15}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapsed user logout */}
      {collapsed && (
        <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={onLogout}
            className="btn-ghost"
            title="Logout"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, borderRadius: 8 }}
          >
            <LogOut size={15}/>
          </button>
        </div>
      )}

      {/* Collapse toggle button (tablet only, hidden on mobile drawer) */}
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
      {/* Desktop/tablet sidebar */}
      <div className="sidebar-shell">
        {sidebarContent}
      </div>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="sidebar-overlay" onClick={onDrawerClose} />
      )}

      {/* Mobile drawer */}
      <div className={`sidebar-drawer${drawerOpen ? ' open' : ''}`}>
        <aside style={{
          width: 260,
          background: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 0',
          height: '100%',
          overflow: 'hidden',
        }}>
          {/* Drawer header */}
          <div style={{
            padding: '0 20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'linear-gradient(135deg, #0ea5e9, #14b8a6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, color: '#fff', fontSize: 16, fontFamily: 'var(--font-display)',
              }}>C</div>
              <div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: 14, fontFamily: 'var(--font-display)', lineHeight: 1 }}>Checkpoint</div>
                <div style={{ color: 'var(--accent-blue)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>INVESTMENT CLUB</div>
              </div>
            </div>
            <button
              onClick={onDrawerClose}
              className="btn-ghost"
              style={{ padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronLeft size={16}/>
            </button>
          </div>

          {/* Drawer nav — all items */}
          <nav style={{ padding: '16px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
            {navItems.map(({ to, Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                style={{ textDecoration: 'none' }}
                onClick={onDrawerClose}
              >
                {({ isActive }) => (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                    borderRadius: 10, cursor: 'pointer',
                    background: isActive ? 'linear-gradient(90deg, #0ea5e9, #14b8a6)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-muted)',
                    fontWeight: isActive ? 700 : 500, fontSize: 14, transition: 'all 0.15s',
                  }}>
                    <Icon size={17} strokeWidth={isActive ? 2.5 : 2}/>
                    {label}
                  </div>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Drawer user section */}
          <div style={{ padding: '0 16px' }}>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>{user?.name || user?.username}</div>
                  <span style={{ fontSize: 10, fontWeight: 700 }} className={`badge badge-${user?.role}`}>{user?.role}</span>
                </div>
                <button
                  onClick={() => { onDrawerClose(); onLogout(); }}
                  className="btn-ghost"
                  title="Logout"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}
                >
                  <LogOut size={14}/>
                  Logout
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile bottom nav (quick access) */}
      <MobileBottomNav user={user} onLogout={onLogout} />
    </>
  );
}
