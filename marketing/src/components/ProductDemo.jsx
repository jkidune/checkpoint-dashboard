import { useMemo, useState } from 'react';

const money = (value) => `TZS ${new Intl.NumberFormat('en-US').format(value)}`;

const months = [
  { name: 'April', value: 187250000, cash: 48100000, contributions: 122400000, loans: 28400000, progress: 82 },
  { name: 'May', value: 193800000, cash: 52350000, contributions: 127200000, loans: 26750000, progress: 88 },
  { name: 'June', value: 201450000, cash: 56650000, contributions: 132800000, loans: 24100000, progress: 94 },
];

const Icon = ({ name }) => {
  const paths = {
    trend: <><path d="M4 16l5-5 4 4 7-8"/><path d="M15 7h5v5"/></>,
    cash: <><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 9h.01M17 15h.01"/></>,
    users: <><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
    loan: <><path d="M4 19V8a2 2 0 012-2h12a2 2 0 012 2v11"/><path d="M2 19h20M8 10h8M8 14h5"/></>,
    check: <path d="M5 12l4 4L19 6"/>,
    wallet: <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></>,
    pie: <><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
    bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    arrowRight: <path d="M5 12h14M12 5l7 7-7 7"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
  };
  return (
    <svg className="demo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.check}
    </svg>
  );
};

/* --- Near-style Dashboard Shell for Hero --- */
function NearDashboardHero() {
  const [monthIndex, setMonthIndex] = useState(2);
  const current = months[monthIndex];

  const breakdown = [
    { label: 'Member Contributions', value: money(current.contributions), pct: '66%', tone: 'emerald' },
    { label: 'Liquid Cash Reserves', value: money(current.cash), pct: '28%', tone: 'blue' },
    { label: 'Active Member Loans', value: money(current.loans), pct: '12%', tone: 'amber' },
    { label: 'Group Enterprises', value: 'TZS 36,200,000', pct: '18%', tone: 'purple' },
  ];

  return (
    <div className="near-dashboard-window">
      {/* Dark Navigation Sidebar */}
      <aside className="near-sidebar">
        <div className="near-sidebar-logo">
          <img src="/brand/logo/checkpoint-icon-dark.svg" alt="" width="26" height="26" />
          <span>Checkpoint</span>
        </div>

        <nav className="near-sidebar-nav">
          <div className="near-nav-item is-active"><Icon name="pie" /><span>Portfolio</span></div>
          <div className="near-nav-item"><Icon name="users" /><span>Members</span></div>
          <div className="near-nav-item"><Icon name="loan" /><span>Loans</span></div>
          <div className="near-nav-item"><Icon name="wallet" /><span>Intake</span></div>
          <div className="near-nav-item"><Icon name="shield" /><span>Audit Log</span></div>
        </nav>

        <div className="near-sidebar-bottom">
          <div className="near-user-avatar">AM</div>
          <div className="near-user-info">
            <span className="near-user-name">Asha Mrema</span>
            <span className="near-user-role">Administrator</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="near-main-panel">
        {/* Top bar with quick actions */}
        <div className="near-topbar">
          <div className="near-topbar-left">
            <span className="near-group-name">Umoja Investment Group</span>
            <span className="near-live-pill"><span className="pulsing-dot" /> Live record</span>
          </div>

          <div className="near-topbar-actions">
            <div className="near-month-segmented" role="tablist" aria-label="Reporting month">
              {months.map((m, idx) => (
                <button
                  key={m.name}
                  type="button"
                  role="tab"
                  aria-selected={idx === monthIndex}
                  className={idx === monthIndex ? 'is-active' : ''}
                  onClick={() => setMonthIndex(idx)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Big Balance Row */}
        <div className="near-hero-balance-block">
          <div className="near-balance-col">
            <span className="near-balance-label">Total Recorded Group Position</span>
            <h2 className="near-balance-number">{money(current.value)}</h2>
            <div className="near-balance-sub">
              <span className="near-delta-positive">↑ {current.progress}% collection complete</span>
              <span className="near-dim-text">· 47 of 50 members verified</span>
            </div>
          </div>

          <div className="near-quick-actions">
            <button type="button" className="near-action-btn near-action-primary">
              <Icon name="plus" /> New Intake
            </button>
            <button type="button" className="near-action-btn near-action-secondary">
              Export Audit
            </button>
          </div>
        </div>

        {/* Modern Asset Breakdown Table / Rows */}
        <div className="near-asset-list">
          <div className="near-asset-list-head">
            <span>Asset Category</span>
            <span>Allocation</span>
            <span style={{ textAlign: 'right' }}>Total Value</span>
          </div>

          {breakdown.map((item) => (
            <div className="near-asset-row" key={item.label}>
              <div className="near-asset-info">
                <span className={`near-asset-dot tone-${item.tone}`} />
                <strong>{item.label}</strong>
              </div>
              <div className="near-asset-alloc">
                <div className="near-mini-track">
                  <span className={`tone-${item.tone}`} style={{ width: item.pct }} />
                </div>
                <span className="near-alloc-pct">{item.pct}</span>
              </div>
              <div className="near-asset-amount">{item.value}</div>
            </div>
          ))}
        </div>

        {/* Live Transaction Strip at Bottom */}
        <div className="near-audit-strip">
          <div className="near-audit-left">
            <span className="near-check-bubble"><Icon name="check" /></span>
            <span><strong>Neema Juma</strong> — Payment allocation verified (3 months contribution)</span>
          </div>
          <time className="near-audit-time">12 min ago</time>
        </div>
      </main>
    </div>
  );
}

/* --- Standard Component Frame for Feature Tabs --- */
function DemoShell({ eyebrow, title, children, footer }) {
  return (
    <div className="demo-window">
      <div className="demo-topbar">
        <div className="demo-brand">
          <img src="/brand/logo/checkpoint-icon.svg" alt="" width="20" height="20" />
          <span>Umoja Investment Group</span>
        </div>
        <div className="demo-avatar" aria-label="Demo profile for Asha Mrema">AM</div>
      </div>
      <div className="demo-heading">
        <div>
          <span>{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <span className="demo-badge">Live interactive</span>
      </div>
      {children}
      {footer && <div className="demo-footer">{footer}</div>}
    </div>
  );
}

function GroupDemo({ compact = false }) {
  const [monthIndex, setMonthIndex] = useState(2);
  const current = months[monthIndex];
  const metrics = [
    { label: 'Total group value', value: money(current.value), icon: 'trend', tone: 'blue' },
    { label: 'Available cash', value: money(current.cash), icon: 'cash', tone: 'mint' },
    { label: 'Member contributions', value: money(current.contributions), icon: 'users', tone: 'sky' },
    { label: 'Outstanding loans', value: money(current.loans), icon: 'loan', tone: 'amber' },
  ];
  return (
    <DemoShell eyebrow="Group overview" title="A clear view of today">
      <div className="demo-period" aria-label="Choose reporting month">
        {months.map((month, index) => (
          <button
            type="button"
            className={index === monthIndex ? 'active' : ''}
            aria-pressed={index === monthIndex}
            onClick={() => setMonthIndex(index)}
            key={month.name}
          >
            {month.name}
          </button>
        ))}
      </div>
      <div className={`metric-grid ${compact ? 'compact' : ''}`}>
        {metrics.map((metric) => (
          <div className="metric-card" key={metric.label}>
            <span className={`icon-box ${metric.tone}`}><Icon name={metric.icon} /></span>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>
      <div className="collection-card">
        <div><span>Monthly collection progress</span><strong>{current.progress}%</strong></div>
        <div className="progress-track"><span style={{ width: `${current.progress}%` }} /></div>
        <div className="collection-meta"><span>47 of 50 member records complete</span><span>{current.name} 2027</span></div>
      </div>
      {!compact && (
        <div className="activity-row">
          <span className="activity-mark"><Icon name="check" /></span>
          <div><strong>Payment verified</strong><span>Neema Juma · contribution record</span></div>
          <time>12 min ago</time>
        </div>
      )}
    </DemoShell>
  );
}

function MemberDemo() {
  const [view, setView] = useState('position');
  return (
    <DemoShell eyebrow="Member view" title="Your position">
      <div className="segmented" aria-label="Choose member summary">
        <button type="button" aria-pressed={view === 'position'} className={view === 'position' ? 'active' : ''} onClick={() => setView('position')}>Position</button>
        <button type="button" aria-pressed={view === 'activity'} className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}>Recent activity</button>
      </div>
      {view === 'position' ? (
        <>
          <div className="member-total">
            <span>Recorded net position</span>
            <strong>{money(4390000)}</strong>
            <small>Inside Umoja Investment Group</small>
          </div>
          <div className="member-grid">
            <div><span>Contributions</span><strong>{money(5400000)}</strong><small>12 months current</small></div>
            <div><span>Loan outstanding</span><strong>{money(1850000)}</strong><small>62% repaid</small></div>
            <div><span>Investment value</span><strong>{money(840000)}</strong><small>Recorded group value</small></div>
          </div>
          <div className="repayment">
            <div><span>Loan repayment progress</span><strong>62%</strong></div>
            <div className="progress-track"><span style={{ width: '62%' }} /></div>
          </div>
        </>
      ) : (
        <div className="activity-list">
          {[['Contribution recorded', '+ TZS 75,000', '08 Jun'], ['Loan repayment', '− TZS 260,000', '03 Jun'], ['Investment value updated', '+ TZS 42,000', '28 May']].map(([label, amount, date]) => (
            <div key={label}>
              <span className="activity-mark"><Icon name="check" /></span>
              <div><strong>{label}</strong><span>{date} 2027</span></div>
              <b>{amount}</b>
            </div>
          ))}
        </div>
      )}
    </DemoShell>
  );
}

function PaymentDemo() {
  const [posted, setPosted] = useState(false);
  const allocations = [
    ['March contribution', 75000],
    ['April contribution', 75000],
    ['Existing fine', 11250],
    ['Loan repayment', 10750],
  ];
  const total = useMemo(() => allocations.reduce((sum, item) => sum + item[1], 0), []);
  if (posted) {
    return (
      <DemoShell eyebrow="Payment verification" title="Payment posted">
        <div className="success-state">
          <span><Icon name="check" /></span>
          <h4>Clean record created</h4>
          <p>The contribution months, existing fine and loan repayment are now reflected in this demo member’s record.</p>
          <button className="button button-secondary" type="button" onClick={() => setPosted(false)}>Replay demo</button>
        </div>
      </DemoShell>
    );
  }
  return (
    <DemoShell eyebrow="Payment verification" title="Allocate incoming payment">
      <div className="payment-received">
        <div><span>Payment received</span><strong>{money(total)}</strong></div>
        <span className="status-pill">Ready to verify</span>
      </div>
      <blockquote>“Two months contribution”</blockquote>
      <div className="allocation-list">
        {allocations.map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{money(value)}</strong></div>
        ))}
      </div>
      <div className="allocation-total">
        <span>Allocated</span>
        <strong>{money(total)} / {money(total)}</strong>
      </div>
      <button className="button demo-submit" type="button" onClick={() => setPosted(true)}>
        <Icon name="check" /> Verify &amp; post
      </button>
    </DemoShell>
  );
}

function RoleDemo() {
  const [role, setRole] = useState('admin');
  const items = role === 'admin'
    ? [['Group overview', 'Complete group position'], ['Form intake', '3 payments ready to verify'], ['Contributions', '94% recorded this month'], ['Loan management', '8 active loans']]
    : [['My position', 'TZS 4,390,000 recorded'], ['Contributions', '12 months current'], ['My loan', '62% repaid'], ['Notifications', '1 new group update']];
  return (
    <DemoShell eyebrow="Role-based experience" title={role === 'admin' ? 'Administrator workspace' : 'Member workspace'}>
      <div className="role-switch" aria-label="Choose workspace role">
        <button type="button" aria-pressed={role === 'admin'} className={role === 'admin' ? 'active' : ''} onClick={() => setRole('admin')}>Administrator</button>
        <button type="button" aria-pressed={role === 'member'} className={role === 'member' ? 'active' : ''} onClick={() => setRole('member')}>Member</button>
      </div>
      <div className="role-layout" key={role}>
        <aside><span>Workspace</span>{items.map(([label], index) => <div className={index === 0 ? 'selected' : ''} key={label}><i></i>{label}</div>)}</aside>
        <div className="role-content"><p>{role === 'admin' ? 'Manage the shared record' : 'Understand your own record'}</p>{items.map(([label, detail], index) => <div className="role-row" key={label}><span className={`role-dot dot-${index}`}></span><div><strong>{label}</strong><span>{detail}</span></div><b>→</b></div>)}</div>
      </div>
    </DemoShell>
  );
}

function LoanDemo() {
  const payments = [0, 1, 2, 3];
  const [step, setStep] = useState(2);
  const paid = 650000 * step;
  const outstanding = 3900000 - paid;
  return (
    <DemoShell eyebrow="Loan record" title="Every repayment keeps its context">
      <div className="loan-summary">
        <div><span>Original principal</span><strong>{money(3900000)}</strong></div>
        <div><span>Amount repaid</span><strong>{money(paid)}</strong></div>
        <div><span>Outstanding</span><strong>{money(outstanding)}</strong></div>
      </div>
      <div className="loan-timeline" aria-label="Explore repayment history">
        {payments.map((payment) => (
          <button
            type="button"
            key={payment}
            aria-label={`Show loan after ${payment} repayments`}
            aria-pressed={step === payment}
            onClick={() => setStep(payment)}
          >
            <span className={payment <= step ? 'complete' : ''}>{payment < step ? '✓' : payment + 1}</span>
            <small>{payment === 0 ? 'Issued' : `Payment ${payment}`}</small>
          </button>
        ))}
      </div>
      <div className="repayment">
        <div><span>Repayment progress</span><strong>{Math.round((paid / 3900000) * 100)}%</strong></div>
        <div className="progress-track"><span style={{ width: `${(paid / 3900000) * 100}%` }} /></div>
        <small>Choose a point above to review the balance after each demo payment.</small>
      </div>
    </DemoShell>
  );
}

export default function ProductDemo({ variant = 'group', compact = false }) {
  if (variant === 'hero') return <NearDashboardHero />;
  if (variant === 'member') return <MemberDemo />;
  if (variant === 'payment') return <PaymentDemo />;
  if (variant === 'roles') return <RoleDemo />;
  if (variant === 'loan') return <LoanDemo />;
  return <GroupDemo compact={compact} />;
}
