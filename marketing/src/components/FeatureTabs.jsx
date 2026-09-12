import { useState } from 'react';
import ProductDemo from './ProductDemo.jsx';

const features = [
  {
    id: 'intake',
    title: 'Instant payment intake & allocation',
    subtitle: 'From mobile money declaration to an audited, balanced group record in seconds.',
    tag: 'Live workflow',
    demoType: 'payment',
  },
  {
    id: 'portfolio',
    title: 'Group portfolio & asset distribution',
    subtitle: 'Track liquid reserves, member contributions, active loans and group enterprises together.',
    tag: 'Total visibility',
    demoType: 'group',
  },
  {
    id: 'member',
    title: 'Transparent personal member positions',
    subtitle: 'Give each member complete clarity on their savings, loan balance, and group equity.',
    tag: 'Member access',
    demoType: 'member',
  },
  {
    id: 'loans',
    title: 'Track repayments with complete history',
    subtitle: 'Principal, recorded interest, penalties, and payment installments tied to every member.',
    tag: 'Connected ledger',
    demoType: 'loan',
  },
  {
    id: 'roles',
    title: 'Dedicated admin & member experiences',
    subtitle: 'Admins get deep operational verification; members get clean, trusted personal dashboards.',
    tag: 'Role-based',
    demoType: 'roles',
  },
];

export default function FeatureTabs() {
  const [activeId, setActiveId] = useState('intake');
  const activeFeature = features.find((f) => f.id === activeId) || features[0];

  return (
    <div className="feature-tabs-container">
      {/* Left Column: Feature Selector List */}
      <div className="feature-nav-list" role="tablist" aria-label="Checkpoint core capabilities">
        {features.map((feature, idx) => {
          const isActive = feature.id === activeId;
          return (
            <button
              key={feature.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`feature-panel-${feature.id}`}
              id={`feature-tab-${feature.id}`}
              className={`feature-nav-item ${isActive ? 'is-active' : ''}`}
              onClick={() => setActiveId(feature.id)}
            >
              <div className="feature-nav-header">
                <span className="feature-nav-index">0{idx + 1}</span>
                <span className="feature-nav-title">{feature.title}</span>
                <span className="feature-nav-tag">{feature.tag}</span>
              </div>
              <p className="feature-nav-desc">{feature.subtitle}</p>
            </button>
          );
        })}
      </div>

      {/* Right Column: Premium Glowing Card with Embedded Interactive Demo */}
      <div
        className="feature-preview-panel"
        id={`feature-panel-${activeFeature.id}`}
        role="tabpanel"
        aria-labelledby={`feature-tab-${activeFeature.id}`}
      >
        <div className="feature-preview-frame">
          <div className="feature-preview-aura" aria-hidden="true" />
          <div className="feature-preview-inner">
            <div className="feature-preview-header">
              <div className="feature-preview-pill">
                <span className="pulsing-dot" />
                <span>{activeFeature.tag}</span>
              </div>
              <span className="feature-preview-sub">Interactive simulator</span>
            </div>

            <div className="feature-preview-body" key={activeFeature.id}>
              <ProductDemo variant={activeFeature.demoType} compact={true} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
