import { Area, AreaChart } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { buildChartConfig } from './chart-config';
import { cn } from '@/lib/utils';

export function MetricSparkline({
  label,
  value,
  trend,
  data = [],
  xKey = 'month',
  dataKey = 'value',
  color = 'primary',
  className,
}) {
  const series = [{ key: dataKey, label, color }];
  const config = buildChartConfig(series);

  return (
    <div className={cn('cp-sparkline-card', className)}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {trend && <em>{trend}</em>}
      </div>
      <ChartContainer config={config} className="cp-sparkline-chart">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 4, left: 0 }} accessibilityLayer>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={`var(--color-${dataKey})`}
            strokeWidth={1.7}
            fill={`var(--color-${dataKey})`}
            fillOpacity={0.08}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
      <span className="sr-only">{xKey} trend for {label}</span>
    </div>
  );
}
