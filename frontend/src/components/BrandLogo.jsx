const BRAND_ROOT = '/brand/logo';

export default function BrandLogo({ compact = false, onDark = false, alt, ...props }) {
  const file = compact
    ? (onDark ? 'checkpoint-icon-dark.svg' : 'checkpoint-icon.svg')
    : (onDark ? 'checkpoint-logo-dark.svg' : 'checkpoint-logo.svg');

  return (
    <img
      src={`${BRAND_ROOT}/${file}`}
      alt={alt ?? (compact ? '' : 'Checkpoint Investment Club')}
      {...props}
    />
  );
}
