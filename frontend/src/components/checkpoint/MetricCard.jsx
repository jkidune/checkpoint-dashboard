import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function MetricCard({ label, value, description, icon: Icon, className }) {
  return (
    <Card className={cn('bg-surface/95', className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-muted-foreground">{label}</div>
            <div className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground">{value}</div>
          </div>
          {Icon && <Icon className="mt-1 h-5 w-5 text-primary" />}
        </div>
        {description && <p className="mt-3 text-sm text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
}
