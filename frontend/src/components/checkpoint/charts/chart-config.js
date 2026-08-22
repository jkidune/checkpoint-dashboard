export const checkpointChartColors = {
  primary: 'var(--chart-primary)',
  secondary: 'var(--chart-secondary)',
  reference: 'var(--chart-reference)',
  success: 'var(--chart-success)',
  warning: 'var(--chart-warning)',
  danger: 'var(--chart-danger)',
};

export function buildChartConfig(series = []) {
  return series.reduce((acc, item) => {
    acc[item.key] = {
      label: item.label,
      color: checkpointChartColors[item.color] || item.color || checkpointChartColors.primary,
    };
    return acc;
  }, {});
}

export const chartMargins = {
  trend: { top: 12, right: 16, bottom: 0, left: -12 },
  bar: { top: 12, right: 12, bottom: 0, left: -12 },
  donut: { top: 4, right: 4, bottom: 4, left: 4 },
};
