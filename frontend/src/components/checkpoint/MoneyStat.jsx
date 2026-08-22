import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function MoneyStat({ title, value, trend, supportingText, icon: Icon, tone = 'neutral', className }) {
  const positive = trend?.direction === 'up';
  const negative = trend?.direction === 'down';

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-5">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="cp-label text-muted-foreground">{title}</div>
            <div className="cp-money mt-3 break-words">{value}</div>
          </div>
          {Icon && (
            <div className={cn('rounded-md border border-border bg-surface-muted p-2 text-muted-foreground', tone === 'primary' && 'text-primary')}>
              <Icon size={18} />
            </div>
          )}
        </div>
        {(trend || supportingText) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            {trend && (
              <span className={cn('inline-flex items-center gap-1 font-semibold', positive && 'text-success', negative && 'text-danger', !positive && !negative && 'text-muted-foreground')}>
                {positive ? <TrendingUp size={13} /> : negative ? <TrendingDown size={13} /> : null}
                {trend.value}
              </span>
            )}
            {supportingText && <span className="text-muted-foreground">{supportingText}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
