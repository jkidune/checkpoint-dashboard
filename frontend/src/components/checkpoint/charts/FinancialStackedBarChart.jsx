import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { buildChartConfig, chartMargins } from './chart-config';
import { formatAxisTZS, formatTZS } from './chart-formatters';
import { ChartEmptyState } from './ChartStates';

export function FinancialStackedBarChart({
  data = [],
  xKey = 'month',
  series = [],
  stackId = 'total',
  height = 260,
  valueFormatter = formatTZS,
}) {
  if (!data.length) return <ChartEmptyState title="No payment status yet" description="Payment status will appear after prepared totals are available." />;

  const chartConfig = buildChartConfig(series);

  return (
    <ChartContainer config={chartConfig} className="cp-financial-chart" style={{ height }}>
      <BarChart data={data} margin={chartMargins.bar} barCategoryGap="34%" accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} />
        <YAxis axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} tickFormatter={formatAxisTZS} width={42} />
        <ChartTooltip content={<ChartTooltipContent formatter={valueFormatter} />} />
        <Legend content={<ChartLegendContent />} />
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            stackId={stackId}
            fill={`var(--color-${item.key})`}
            radius={index === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            maxBarSize={30}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
