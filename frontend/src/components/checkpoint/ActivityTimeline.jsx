import { cn } from '@/lib/utils';

export function ActivityTimeline({ items = [], className }) {
  return (
    <div className={cn('space-y-4', className)}>
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} className="relative pl-6">
          <div className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
          {index < items.length - 1 && <div className="absolute left-[4px] top-5 h-[calc(100%+0.5rem)] w-px bg-border" />}
          <div className="font-semibold text-foreground">{item.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.meta}</div>
          {item.description && <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>}
        </div>
      ))}
    </div>
  );
}
