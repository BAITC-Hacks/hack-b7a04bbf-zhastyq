import type { GraphSlice, NodeDetails, Role, TopNode } from '../../shared/contracts';

export type NodeFlow = Pick<NodeDetails, 'incoming_sum_kzt' | 'outgoing_sum_kzt' | 'unique_payers' | 'unique_recipients'>;
export type NodeFilters = { query: string; cluster: string; role: Role | 'all'; highOnly: boolean; order: 'priority' | 'rank' };

export function filterNodes(nodes: TopNode[], filters: NodeFilters) {
  const query = filters.query.trim().toLocaleLowerCase('ru');
  return nodes.filter((node) => (!query || node.gid.toLocaleLowerCase('ru').includes(query))
    && (filters.cluster === 'all' || String(node.cluster_id) === filters.cluster)
    && (filters.role === 'all' || node.role === filters.role)
    && (!filters.highOnly || node.priority_score >= 0.8))
    .sort((a, b) => filters.order === 'priority' ? b.priority_score - a.priority_score || a.rank - b.rank : a.rank - b.rank);
}

/** Totals cover only transfers present in the displayed slice. */
export function flowInSlice(graph: GraphSlice | null, gid: string): NodeFlow | null {
  if (!graph?.nodes.some((node) => node.gid === gid)) return null;
  const ids = new Set(graph.nodes.map((node) => node.gid));
  const edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const incoming = edges.filter((edge) => edge.target === gid);
  const outgoing = edges.filter((edge) => edge.source === gid);
  const sum = (items: typeof edges) => items.reduce((total, edge) => total + (Number.isFinite(edge.sum_kzt) ? Math.max(0, edge.sum_kzt) : 0), 0);
  return { incoming_sum_kzt: sum(incoming), outgoing_sum_kzt: sum(outgoing), unique_payers: new Set(incoming.map((edge) => edge.source)).size, unique_recipients: new Set(outgoing.map((edge) => edge.target)).size };
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  // Prevent spreadsheet formulas while preserving the original string gid.
  const safe = /^\s*[=+\-@]/u.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function topNodesCsv(nodes: TopNode[]) {
  const columns = ['rank', 'gid', 'role', 'role_score', 'priority_score', 'cluster_id', 'is_seed', 'depth', 'why', 'evidence'] as const;
  return '\uFEFF' + [columns.join(';'), ...nodes.map((node) => columns.map((key) => csvCell(node[key])).join(';'))].join('\r\n');
}
