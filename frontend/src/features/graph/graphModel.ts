import type { GraphSlice, Role } from '../../shared/contracts';

export const roles: Role[] = ['consolidator', 'transit', 'distributor', 'terminal', 'coordinator', 'peripheral'];
export type GraphFilters = { seedOnly: boolean; isolated: boolean; role: string; cluster: string; depth: string };
export type GraphDisplay = { labels: boolean; arrows: boolean; color: 'role' | 'cluster'; nodeScale: number; edgeOpacity: number };
export type GraphForces = { center: number; repulsion: number; strength: number; distance: number };
export const defaultFilters: GraphFilters = { seedOnly: false, isolated: true, role: 'all', cluster: 'all', depth: 'all' };
export const defaultDisplay: GraphDisplay = { labels: true, arrows: true, color: 'role', nodeScale: 1, edgeOpacity: 0.5 };
export const defaultForces: GraphForces = { center: 0.45, repulsion: 1, strength: 1, distance: 1 };

export function graphIndex(graph: GraphSlice) {
  const nodes = new Map(graph.nodes.map(node => [node.gid, node]));
  const adjacency = new Map([...nodes.keys()].map(gid => [gid, new Set<string>()]));
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }
  return { nodes, adjacency };
}

export function visibleGids(graph: GraphSlice, filters: GraphFilters) {
  const { nodes } = graphIndex(graph);
  const visible = new Set([...nodes.values()].filter(node =>
    (!filters.seedOnly || node.is_seed) &&
    (filters.role === 'all' || node.role === filters.role) &&
    (filters.cluster === 'all' || String(node.cluster_id) === filters.cluster) &&
    (filters.depth === 'all' || String(node.depth) === filters.depth),
  ).map(node => node.gid));
  if (!filters.isolated) {
    const connected = new Set<string>();
    for (const edge of graph.edges) {
      if (visible.has(edge.source) && visible.has(edge.target)) {
        connected.add(edge.source); connected.add(edge.target);
      }
    }
    for (const gid of visible) if (!connected.has(gid)) visible.delete(gid);
  }
  return visible;
}

// Hash strings, never coerce int64 identifiers to JavaScript numbers.
export function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function initialPosition(gid: string, count: number) {
  const span = Math.max(80, Math.sqrt(count) * 24);
  return { x: (stableHash(gid + ':x') / 4294967296 - 0.5) * span,
    y: (stableHash(gid + ':y:layout') / 4294967296 - 0.5) * span };
}

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
  const denominator = Number.isFinite(p95) ? Math.max(p95, 1) : 1;
  return min + (max - min) * Math.min(1, Math.log1p(Math.max(0, amount)) / Math.log1p(denominator));
}

export function graphElements(graph: GraphSlice, sizes: {
  minNode: number; maxNode: number; minEdge: number; maxEdge: number; defaultEdge: number;
}) {
  const nodes = new Map(graph.nodes.map((node) => [node.gid, node]));
  const edges = graph.edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target));
  const p95 = percentile95(edges.map((edge) => edge.sum_kzt));
  const pairs = new Set(edges.map(edge => JSON.stringify([edge.source, edge.target])));
  const occurrences = new Map<string, number>();
  return [
    ...[...nodes.values()].map((node) => ({
      group: 'nodes' as const,
      data: { id: node.gid, label: (node.is_seed ? 'S ' : '') + node.gid, role: node.role, cluster: node.cluster_id,
        diameter: nodeDiameter(node.priority_score, sizes.minNode, sizes.maxNode) },
      classes: node.is_seed ? 'is-seed' : '',
    })),
    ...edges.map(edge => {
      const pair = JSON.stringify([edge.source, edge.target]);
      const ordinal = occurrences.get(pair) ?? 0;
      occurrences.set(pair, ordinal + 1);
      return {
        group: 'edges' as const,
        data: { id: edgeId(pair, ordinal, nodes), source: edge.source, target: edge.target,
          width: edgeWidth(edge.sum_kzt, p95, sizes.minEdge, sizes.maxEdge, sizes.defaultEdge),
          reciprocal: edge.source !== edge.target && pairs.has(JSON.stringify([edge.target, edge.source])),
          sameCluster: nodes.get(edge.source)!.cluster_id === nodes.get(edge.target)!.cluster_id },
      };
    }),
  ];
}

function edgeId(pair: string, ordinal: number, nodes: Map<string, unknown>) {
  // Pair-local occurrence survives unrelated node/edge reordering in API responses.
  let id = `transfer:${pair}:${ordinal}`;
  while (nodes.has(id)) id = ':' + id;
  return id;
}
