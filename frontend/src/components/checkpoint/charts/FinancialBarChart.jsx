import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { buildChartConfig, chartMargins } from './chart-config';
import { formatAxisTZS, formatTZS } from './chart-formatters';
import { ChartEmptyState } from './ChartStates';

export function FinancialBarChart({
  data = [],
  xKey = 'month',
  series = [],
  height = 270,
  valueFormatter = formatTZS,
  yTickFormatter = formatAxisTZS,
}) {
  if (!data.length) return <ChartEmptyState title="No comparison data yet" description="Comparison data will appear once prepared values are available." />;

  const chartConfig = buildChartConfig(series);

  return (
    <ChartContainer config={chartConfig} className="cp-financial-chart" style={{ height }}>
      <BarChart data={data} margin={chartMargins.bar} barGap={5} barCategoryGap="28%" accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} />
        <YAxis axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} tickFormatter={yTickFormatter} width={42} />
        <ChartTooltip content={<ChartTooltipContent formatter={valueFormatter} />} />
        {series.length > 1 && <Legend content={<ChartLegendContent />} />}
        {series.map((item) => (
          <Bar key={item.key} dataKey={item.key} fill={`var(--color-${item.key})`} radius={[4, 4, 0, 0]} maxBarSize={26} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
