import { Badge } from '@/components/ui/badge';

const STATUS_MAP = {
  active: 'success',
  paid: 'success',
  good: 'success',
  verified: 'success',
  pending: 'warning',
  partial: 'warning',
  review: 'warning',
  overdue: 'danger',
  unpaid: 'danger',
  failed: 'danger',
  info: 'info',
  notice: 'info',
};

export function StatusBadge({ status, tone, children }) {
  const variant = tone || STATUS_MAP[String(status || '').toLowerCase()] || 'neutral';
  return <Badge variant={variant}>{children || status}</Badge>;
}
