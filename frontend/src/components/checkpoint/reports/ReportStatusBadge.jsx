import { Badge } from '@/components/ui/badge';

const STATUS_TONE = {
  draft: 'warning',
  published: 'success',
  archived: 'neutral',
  viewed: 'neutral',
  new: 'info',
};

export function ReportStatusBadge({ status, children }) {
  const normalized = String(status || '').toLowerCase();
  return <Badge variant={STATUS_TONE[normalized] || 'neutral'}>{children || status}</Badge>;
}
