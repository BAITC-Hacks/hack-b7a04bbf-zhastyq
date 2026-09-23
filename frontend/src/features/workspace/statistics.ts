import type { GraphSlice } from '../../shared/contracts';

export const HIGH_PRIORITY_THRESHOLD = 0.8;

/** Metrics describe only the supplied graph, including its isolated nodes. */
export function summarizeGraph(graph: GraphSlice) {
  const nodes = new Map(graph.nodes.map((node) => [node.gid, node]));
  const adjacency = new Map([...nodes.keys()].map((gid) => [gid, new Set<string>()]));
  let turnover = 0;
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    if (Number.isFinite(edge.sum_kzt)) turnover += Math.max(0, edge.sum_kzt);
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  const visited = new Set<string>();
  let largestComponent = 0;
  for (const gid of nodes.keys()) {
    if (visited.has(gid)) continue;
    const stack = [gid];
    visited.add(gid);
    let size = 0;
    while (stack.length) {
      const current = stack.pop()!;
      size += 1;
      for (const neighbor of adjacency.get(current)!) {
        if (!visited.has(neighbor)) { visited.add(neighbor); stack.push(neighbor); }
      }
    }
    largestComponent = Math.max(largestComponent, size);
  }

  const values = [...nodes.values()];
  const count = nodes.size;
  const highCount = values.filter((node) => node.priority_score >= HIGH_PRIORITY_THRESHOLD).length;
  const clusterCount = new Set(values.map((node) => node.cluster_id)).size;
  return {
    count, turnover, highCount, clusterCount,
    highShare: count ? highCount / count : null,
    averageClusterSize: clusterCount ? count / clusterCount : null,
    consolidators: values.filter((node) => node.role === 'consolidator').length,
    coordinators: values.filter((node) => node.role === 'coordinator').length,
    outsideCount: count - largestComponent,
    outsideShare: count ? (count - largestComponent) / count : null,
  };
}
