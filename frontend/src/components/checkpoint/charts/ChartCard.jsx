import { MoreHorizontal } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export function PeriodSelector({ value = 'fy2026', options = ['FY2026', 'FY2025', '12M'] }) {
  return (
    <Tabs value={value} className="cp-chart-period">
      <TabsList>
        {options.map((option) => (
          <TabsTrigger key={option} value={option.toLowerCase()}>{option}</TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function ChartCard({
  eyebrow,
  title,
  description,
  metric,
  trend,
  action,
  children,
  className,
}) {
  return (
    <Card className={cn('cp-chart-card', className)}>
      <CardHeader className="cp-chart-card-header">
        <div>
          {eyebrow && <div className="cp-chart-eyebrow">{eyebrow}</div>}
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
          {(metric || trend) && (
            <div className="cp-chart-headline">
              {metric && <strong>{metric}</strong>}
              {trend && <span>{trend}</span>}
            </div>
          )}
        </div>
        <div className="cp-chart-actions">
          {action || <PeriodSelector />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`${title} actions`}>
                <MoreHorizontal size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>View detail</DropdownMenuItem>
              <DropdownMenuItem>Export snapshot</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
