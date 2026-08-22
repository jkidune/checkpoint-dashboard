import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <Card className={cn('border-dashed', className)}>
      <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
        {Icon && <div className="mb-4 rounded-full border border-border bg-surface-muted p-3 text-muted-foreground"><Icon size={22} /></div>}
        <h3 className="font-display text-base font-bold">{title}</h3>
        {description && <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>}
        {action && <div className="mt-5">{typeof action === 'string' ? <Button variant="secondary">{action}</Button> : action}</div>}
      </CardContent>
    </Card>
  );
}
