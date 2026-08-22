import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from './StatusBadge';
import { ActivityTimeline } from './ActivityTimeline';

export function DetailSheet({
  trigger,
  title,
  subtitle,
  status,
  summary = [],
  sections = [],
  activity = [],
  footerActions,
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex items-start justify-between gap-4 pr-8">
            <div>
              <SheetTitle>{title}</SheetTitle>
              {subtitle && <SheetDescription>{subtitle}</SheetDescription>}
            </div>
            {status && <StatusBadge status={status}>{status}</StatusBadge>}
          </div>
        </SheetHeader>

        {summary.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {summary.map((item) => (
              <div key={item.label} className="rounded-md border border-border bg-surface-muted p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{item.label}</div>
                <div className="mt-1 font-display text-lg font-bold">{item.value}</div>
              </div>
            ))}
          </div>
        )}

        {sections.map((section) => (
          <div key={section.title} className="space-y-2">
            <Separator />
            <h4 className="font-display text-sm font-bold">{section.title}</h4>
            <div className="text-sm leading-6 text-muted-foreground">{section.content}</div>
          </div>
        ))}

        {activity.length > 0 && (
          <div className="space-y-3">
            <Separator />
            <h4 className="font-display text-sm font-bold">Activity</h4>
            <ActivityTimeline items={activity} />
          </div>
        )}

        <SheetFooter>
          {footerActions || <Button variant="secondary">Close preview</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
