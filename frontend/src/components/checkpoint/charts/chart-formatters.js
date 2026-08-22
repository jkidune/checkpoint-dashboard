const compactFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  notation: 'compact',
});

const wholeNumberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

export function formatTZS(value) {
  return `TZS ${wholeNumberFormatter.format(Number(value || 0))}`;
}

export function formatCompactTZS(value) {
  return `TZS ${compactFormatter.format(Number(value || 0))}`;
}

export function formatAxisTZS(value) {
  return compactFormatter.format(Number(value || 0));
}

export function formatPercent(value) {
  return `${Number(value || 0).toFixed(0)}%`;
}
