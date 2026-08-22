import { AlertTriangle, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function ChartSkeleton({ className }) {
  return (
    <div className={cn('cp-chart-state', className)}>
      <div className="space-y-2">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-7 w-44" />
      </div>
      <Skeleton className="h-44 w-full" />
    </div>
  );
}

export function ChartEmptyState({ title = 'No chart data yet', description = 'Activity will appear here once records are available.' }) {
  return (
    <div className="cp-chart-empty">
      <BarChart3 size={22} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

export function ChartErrorState({ onRetry }) {
  return (
    <div className="cp-chart-empty">
      <AlertTriangle size={22} />
      <strong>Unable to load chart data.</strong>
      <span>Please try again when the data source is available.</span>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
