import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/',              icon: '◉',  label: 'Overview'      },
  { to: '/contributions', icon: '💰', label: 'Contributions'  },
  { to: '/loans',         icon: '📋', label: 'Loans'          },
  { to: '/members',       icon: '👥', label: 'Members'        },
  { to: '/transactions',  icon: '↔️', label: 'Transactions'   },
  { to: '/investments',   icon: '📈', label: 'Investments'    },
];

export default function Sidebar({ user, onLogout }) {
  return (
    <aside style={{
      width: 220, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', padding: '24px 0', flexShrink: 0, height: '100vh',
    }}>
      {/* Logo */}
      <div style={{ padding: '0 20px 24px', borderBottom: '1px solid var(--border)' }}>
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
      </div>

      {/* Nav */}
      <nav style={{ padding: '16px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 10, cursor: 'pointer',
                background: isActive ? 'linear-gradient(90deg, #0ea5e9, #14b8a6)' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-muted)',
                fontWeight: isActive ? 700 : 500, fontSize: 13, transition: 'all 0.15s',
              }}>
                <span style={{ fontSize: 14 }}>{n.icon}</span>
                {n.label}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div style={{ padding: '0 16px' }}>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          {/* Equity mini widget */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Club Equity</div>
            <div style={{ color: 'var(--accent-blue)', fontWeight: 800, fontSize: 18, fontFamily: 'var(--font-display)' }}>TZS 15.54M</div>
            <div style={{ color: 'var(--accent-teal)', fontSize: 11, marginTop: 2 }}>FY2025 · 10 Members</div>
          </div>

          {/* User info */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>{user?.name || user?.username}</div>
              <span style={{ fontSize: 10, fontWeight: 700 }} className={`badge badge-${user?.role}`}>{user?.role}</span>
            </div>
            <button onClick={onLogout} className="btn-ghost" title="Logout" style={{ fontSize: 16 }}>⏻</button>
          </div>
        </div>
      </div>
    </aside>
  );
}
