import BrandLogo from './BrandLogo';
import './CheckpointLoader.css';

export default function CheckpointLoader({ exiting = false }) {
  return (
    <div
      className={`checkpoint-loader${exiting ? ' is-exiting' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Loading Checkpoint"
    >
      <div className="checkpoint-loader__ambient" aria-hidden="true" />
      <div className="checkpoint-loader__content">
        <div className="checkpoint-loader__mark-wrap" aria-hidden="true">
          <span className="checkpoint-loader__halo" />
          <span className="checkpoint-loader__halo is-delayed" />
          <BrandLogo compact className="checkpoint-loader__mark" />
        </div>
        <div className="checkpoint-loader__wordmark">Checkpoint</div>
        <div className="checkpoint-loader__label">Loading…</div>
      </div>
    </div>
  );
}
