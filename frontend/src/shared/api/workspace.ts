import type { GraphSlice, NodeDetails, TransferEdge } from '../contracts';
import type { Analysis, ApiAnalysis, ApiCard, ApiEdge, ApiNode, AiAnswer, NodeCardData } from './types';

const base = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
export const exportNames = ['nodes_roles.csv', 'clusters.csv', 'top_nodes.csv'] as const;
export type ExportName = typeof exportNames[number];
export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
function gid(value: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ApiError('INVALID_RESPONSE', 'API вернул неточный идентификатор.');
  return value;
}
export function mapNode(node: ApiNode): NodeDetails {
  return { ...node, gid: gid(node.gid), incoming_sum_kzt: node.in_kzt, outgoing_sum_kzt: node.out_kzt,
    unique_payers: node.in_deg, unique_recipients: node.out_deg };
}
export function mapEdge(edge: ApiEdge): TransferEdge {
  return { source: gid(edge.src), target: gid(edge.dst), sum_kzt: edge.sum_kzt, n_tx: edge.n_tx };
}
export function mapAnalysis(raw: ApiAnalysis): Analysis {
  const nodes = raw.nodes.map(mapNode);
  const byGid = new Map(nodes.map((node) => [node.gid, node]));
  const top_nodes = raw.top_nodes.map((top) => {
    const node = byGid.get(gid(top.gid));
    if (!node) throw new ApiError('INVALID_RESPONSE', 'Узел приоритета отсутствует в анализе.');
    return { ...node, rank: top.rank, why: top.why };
  });
  return { ...raw, nodes, edges: raw.edges.map(mapEdge), top_nodes };
}
export function nodeGraph(analysis: Analysis, selectedGid: string): GraphSlice {
  const incident = analysis.edges.filter((edge) => edge.source === selectedGid || edge.target === selectedGid);
  const ids = new Set([selectedGid, ...incident.flatMap((edge) => [edge.source, edge.target])]);
  return { center_gid: selectedGid, nodes: analysis.nodes.filter((node) => ids.has(node.gid)),
    edges: analysis.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
}
async function response(path: string, init?: RequestInit): Promise<Response> {
  let result: Response;
  try { result = await fetch(base + '/api' + path, init); }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'Нет связи с сервером. Проверьте подключение и повторите запрос.');
  }
  if (!result.ok) {
    const body = await result.json().catch(() => null);
    throw new ApiError(body?.error?.code || 'HTTP_ERROR', body?.error?.message || `Сервер вернул ошибку ${result.status}. Повторите запрос.`);
  }
  return result;
}
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await response(path, init);
  try { return await result.json() as T; }
  catch { throw new ApiError('INVALID_RESPONSE', 'Сервер вернул некорректный ответ. Повторите запрос.'); }
}
export async function getAnalysis(signal?: AbortSignal): Promise<Analysis> {
  return mapAnalysis(await json<ApiAnalysis>('/analysis', { signal }));
}
export async function getNodeCard(selectedGid: string, analysisId: string, signal?: AbortSignal): Promise<NodeCardData> {
  const raw = await json<ApiCard>('/nodes/' + encodeURIComponent(selectedGid), { signal });
  if (raw.analysis_id !== analysisId) throw new ApiError('STALE_ANALYSIS', 'Анализ изменился. Обновляем снимок.');
  return { ...raw, node: mapNode(raw.node), incoming: raw.incoming.map(mapEdge), outgoing: raw.outgoing.map(mapEdge) };
}
export async function uploadAnalysis(files: Record<'nodes' | 'edges' | 'transactions', File>, signal: AbortSignal): Promise<Analysis> {
  const body = new FormData();
  for (const key of ['nodes', 'edges', 'transactions'] as const) body.append(key, files[key]);
  const uploaded = await json<{ analysis_id: string; status: string }>('/analyze', { method: 'POST', body, signal });
  if (uploaded.status !== 'ready') throw new ApiError('INVALID_RESPONSE', 'Сервер не подтвердил завершение анализа.');
  const snapshot = await getAnalysis(signal);
  if (snapshot.analysis_id !== uploaded.analysis_id) throw new ApiError('STALE_ANALYSIS', 'Анализ уже заменён другим запросом. Обновите снимок.');
  return snapshot;
}
export async function askQuestion(analysisId: string, question: string, selectedGid: string, signal?: AbortSignal): Promise<AiAnswer> {
  return json<AiAnswer>('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_id: analysisId, question, context_gids: [selectedGid] }), signal });
}
export async function getExport(name: ExportName, analysisId: string): Promise<Blob> {
  const result = await response('/exports/' + name);
  if (result.headers.get('X-Analysis-Id') !== analysisId) throw new ApiError('STALE_ANALYSIS', 'Анализ изменился. Обновите снимок перед скачиванием.');
  return result.blob();
}
