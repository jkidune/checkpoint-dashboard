import * as React from 'react';
import { ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { cn } from '@/lib/utils';

const ChartContext = React.createContext(null);

function useChart() {
  return React.useContext(ChartContext) || {};
}

function ChartContainer({ config = {}, className, children, style: styleProp, ...props }) {
  const style = React.useMemo(() => {
    return Object.entries(config).reduce((acc, [key, item]) => {
      if (item?.color) acc[`--color-${key}`] = item.color;
      return acc;
    }, { ...styleProp });
  }, [config, styleProp]);

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        className={cn('cp-chart-container min-h-[240px] w-full', className)}
        style={style}
        {...props}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsTooltip;

function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  formatter,
  labelFormatter,
  hideLabel = false,
  hideIndicator = false,
}) {
  const { config = {} } = useChart();
  const visiblePayload = (payload || []).filter((item) => item?.value != null);

  if (!active || visiblePayload.length === 0) return null;

  return (
    <div className={cn('cp-chart-tooltip', className)}>
      {!hideLabel && (
        <div className="cp-chart-tooltip-label">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <div className="cp-chart-tooltip-items">
        {visiblePayload.map((item) => {
          const dataKey = String(item.dataKey || item.name || '');
          const itemConfig = config[dataKey] || {};
          const color = item.color || itemConfig.color || `var(--color-${dataKey})`;
          const displayName = itemConfig.label || item.name || dataKey;
          const value = formatter ? formatter(item.value, item.name, item) : item.value;

          return (
            <div className="cp-chart-tooltip-row" key={`${dataKey}-${item.name}`}>
              <span className="cp-chart-tooltip-name">
                {!hideIndicator && <i style={{ background: color }} />}
                {displayName}
              </span>
              <strong>{value}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartLegendContent({ payload, className }) {
  const { config = {} } = useChart();
  const items = (payload || []).filter((item) => item?.value);

  if (items.length <= 1) return null;

  return (
    <div className={cn('cp-chart-legend', className)}>
      {items.map((item) => {
        const dataKey = String(item.dataKey || item.value);
        const itemConfig = config[dataKey] || {};
        return (
          <span key={dataKey}>
            <i style={{ background: item.color || itemConfig.color }} />
            {itemConfig.label || item.value}
          </span>
        );
      })}
    </div>
  );
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegendContent,
};
