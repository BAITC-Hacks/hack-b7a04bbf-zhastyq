import type { GraphSlice } from '../../shared/contracts';

/** Linear interpolation between adjacent sorted values; invalid amounts are excluded. */
export function getSliceP95(edges: GraphSlice['edges']): number {
  const amounts = edges.map((edge) => edge.sum_kzt)
    .filter((amount) => Number.isFinite(amount) && amount >= 0)
    .sort((a, b) => a - b);
  if (amounts.length === 0) return 0;
  const index = (amounts.length - 1) * 0.95;
  const lower = Math.floor(index);
  return amounts[lower] + (amounts[Math.ceil(index)] - amounts[lower]) * (index - lower);
}

export function getEdgeWidth(sumKzt: number, p95: number, minWidth: number, maxWidth: number): number {
  const amount = Number.isFinite(sumKzt) && sumKzt >= 0 ? sumKzt : 0;
  const percentile = Number.isFinite(p95) && p95 >= 0 ? p95 : 0;
  // Design tokens supply 1 and 5: exactly 1 + 4 * min(1, ln(1 + amount) / ln(1 + max(P95, 1))).
  return minWidth + (maxWidth - minWidth) * Math.min(
    1, Math.log(1 + amount) / Math.log(1 + Math.max(percentile, 1)),
  );
}
