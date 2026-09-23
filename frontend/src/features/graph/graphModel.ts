import type { GraphSlice } from '../../shared/contracts';

export function nodeDiameter(priority: number, min: number, max: number) {
  const score = Number.isFinite(priority) ? Math.max(0, Math.min(1, priority)) : 0;
  return Math.sqrt(min * min + (max * max - min * min) * score);
}

export function percentile95(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return 1;
  const index = (sorted.length - 1) * 0.95;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + fraction * (sorted[Math.ceil(index)] - sorted[lower]);
}

export function edgeWidth(amount: number, p95: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(amount)) return fallback;
  return min + (max - min) * Math.min(1, Math.log1p(Math.max(0, amount)) / Math.log1p(Math.max(p95, 1)));
}

export function graphElements(graph: GraphSlice, sizes: {
  minNode: number; maxNode: number; minEdge: number; maxEdge: number; defaultEdge: number;
}) {
  const nodes = new Map(graph.nodes.map((node) => [node.gid, node]));
  const edges = graph.edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target));
  const p95 = percentile95(edges.map((edge) => edge.sum_kzt));
  return [
    ...[...nodes.values()].map((node) => ({
      group: 'nodes' as const,
      data: { id: node.gid, label: node.gid, role: node.role, cluster: node.cluster_id,
        diameter: nodeDiameter(node.priority_score, sizes.minNode, sizes.maxNode) },
      classes: node.is_seed ? 'is-seed' : '',
    })),
    ...edges.map((edge, index) => ({
      group: 'edges' as const,
      data: { id: `transfer:${index}:${edge.source}:${edge.target}`, source: edge.source, target: edge.target,
        width: edgeWidth(edge.sum_kzt, p95, sizes.minEdge, sizes.maxEdge, sizes.defaultEdge),
        sameCluster: nodes.get(edge.source)!.cluster_id === nodes.get(edge.target)!.cluster_id },
    })),
  ];
}
