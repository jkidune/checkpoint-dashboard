import { Cell, Pie, PieChart } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { checkpointChartColors } from './chart-config';
import { formatTZS } from './chart-formatters';
import { ChartEmptyState } from './ChartStates';

const donutColors = [
  checkpointChartColors.primary,
  checkpointChartColors.secondary,
  checkpointChartColors.reference,
  checkpointChartColors.success,
  checkpointChartColors.warning,
];

export function FinancialDonutChart({
  data = [],
  valueKey = 'value',
  nameKey = 'name',
  total,
  totalLabel = 'Total capital',
  height = 260,
}) {
  if (!data.length) return <ChartEmptyState title="No composition data yet" description="Composition will appear after prepared categories are available." />;

  const config = data.reduce((acc, item, index) => {
    acc[item[nameKey]] = {
      label: item[nameKey],
      color: item.color || donutColors[index % donutColors.length],
    };
    return acc;
  }, {});

  return (
    <div className="cp-donut-layout">
      <div className="cp-donut-chart-wrap">
        <ChartContainer config={config} className="cp-financial-chart" style={{ height }}>
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }} accessibilityLayer>
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={nameKey}
              innerRadius="64%"
              outerRadius="86%"
              paddingAngle={2}
              stroke="transparent"
            >
              {data.map((item, index) => (
                <Cell key={item[nameKey]} fill={item.color || donutColors[index % donutColors.length]} />
              ))}
            </Pie>
            <ChartTooltip content={<ChartTooltipContent formatter={formatTZS} />} />
          </PieChart>
        </ChartContainer>
        <div className="cp-donut-center">
          <strong>{formatTZS(total)}</strong>
          <span>{totalLabel}</span>
        </div>
      </div>
      <div className="cp-donut-legend">
        {data.map((item, index) => (
          <div key={item[nameKey]}>
            <span><i style={{ background: item.color || donutColors[index % donutColors.length] }} />{item[nameKey]}</span>
            <strong>{item.percent}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
