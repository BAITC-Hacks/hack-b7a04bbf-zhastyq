import type { AnalysisResponse, NodeResponse } from '../../shared/api/types';
import type { GraphSlice, NodeDetails, TopNode } from '../../shared/contracts';

export function nodeDetails(node: NodeResponse): NodeDetails {
  return { ...node, incoming_sum_kzt: node.in_kzt, outgoing_sum_kzt: node.out_kzt,
    unique_payers: node.in_deg, unique_recipients: node.out_deg };
}

export function rankedNodes(analysis: AnalysisResponse): TopNode[] {
  const top = new Map(analysis.top_nodes.map((node) => [node.gid, node]));
  const sorted = [...analysis.nodes].sort((a, b) => b.priority_score - a.priority_score
    || (BigInt(a.gid) < BigInt(b.gid) ? -1 : BigInt(a.gid) > BigInt(b.gid) ? 1 : 0));
  return sorted.map((node, index) => ({ ...node, rank: top.get(node.gid)?.rank ?? index + 1,
    why: top.get(node.gid)?.why ?? node.evidence }));
}

export function analysisGraph(analysis: AnalysisResponse): GraphSlice {
  return { center_gid: '', nodes: analysis.nodes, edges: analysis.edges.map(({ src, dst, ...edge }) => ({ ...edge, source: src, target: dst })) };
}

/** Render a bounded, directed one-hop neighborhood; totals always use the full snapshot. */
export function neighborhood(analysis: AnalysisResponse, gid: string, limit = 120) {
  const byId = new Map(analysis.nodes.map((node) => [node.gid, node]));
  if (!byId.has(gid)) return { graph: null, totalNeighbors: 0, shownNeighbors: 0 };
  const neighbors = new Map<string, number>();
  for (const edge of analysis.edges) {
    const other = edge.src === gid ? edge.dst : edge.dst === gid ? edge.src : null;
    if (other && other !== gid && byId.has(other)) neighbors.set(other, (neighbors.get(other) ?? 0) + edge.sum_kzt);
  }
  const selected = [...neighbors].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([id]) => id);
  const ids = new Set([gid, ...selected]);
  const graph: GraphSlice = { center_gid: gid, nodes: [gid, ...selected].map((id) => byId.get(id)!),
    edges: analysis.edges.filter((edge) => ids.has(edge.src) && ids.has(edge.dst))
      .map(({ src, dst, ...edge }) => ({ ...edge, source: src, target: dst })) };
  return { graph, totalNeighbors: neighbors.size, shownNeighbors: selected.length };
}
