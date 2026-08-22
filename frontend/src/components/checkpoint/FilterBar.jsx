import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function FilterBar({ children, className }) {
  return <Card className={cn('flex flex-wrap items-center gap-2 p-2', className)}>{children}</Card>;
}
