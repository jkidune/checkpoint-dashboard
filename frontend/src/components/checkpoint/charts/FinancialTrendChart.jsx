import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { buildChartConfig, chartMargins } from './chart-config';
import { formatAxisTZS, formatTZS } from './chart-formatters';
import { ChartEmptyState } from './ChartStates';

export function FinancialTrendChart({
  data = [],
  xKey = 'month',
  series = [],
  type = 'area',
  height = 270,
  valueFormatter = formatTZS,
  yTickFormatter = formatAxisTZS,
  showYAxis = true,
}) {
  if (!data.length) return <ChartEmptyState title="No trend data yet" description="Trend data will appear after monthly values are prepared." />;

  const chartConfig = buildChartConfig(series);
  const Chart = type === 'line' ? LineChart : AreaChart;

  return (
    <ChartContainer config={chartConfig} className="cp-financial-chart" style={{ height }}>
      <Chart data={data} margin={chartMargins.trend} accessibilityLayer>
        <defs>
          {series.map((item) => (
            <linearGradient key={item.key} id={`fill-${item.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${item.key})`} stopOpacity={0.22} />
              <stop offset="95%" stopColor={`var(--color-${item.key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} />
        {showYAxis && <YAxis axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} tickFormatter={yTickFormatter} width={42} />}
        <ChartTooltip content={<ChartTooltipContent formatter={valueFormatter} />} />
        {series.length > 1 && <Legend content={<ChartLegendContent />} />}
        {series.map((item) => (
          type === 'line' ? (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              stroke={`var(--color-${item.key})`}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
          ) : (
            <Area
              key={item.key}
              type="monotone"
              dataKey={item.key}
              stroke={`var(--color-${item.key})`}
              strokeWidth={1.8}
              fill={`url(#fill-${item.key})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
          )
        ))}
      </Chart>
    </ChartContainer>
  );
}
