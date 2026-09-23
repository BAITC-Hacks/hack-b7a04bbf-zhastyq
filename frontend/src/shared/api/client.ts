import type { GraphSlice, NodeDetails, NodeSummary, Role, TopNode, TransferEdge } from '../contracts';
import type { ImportEvent, ImportKey } from '../../features/workspace/importModel';

export interface WorkspaceAnalysis {
  analysisId: string;
  nodes: TopNode[];
  graph: GraphSlice;
}
export interface NodeView { detail: NodeDetails | null; graph: GraphSlice | null }
export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'ApiError'; this.code = code; }
}

type JsonObject = Record<string, unknown>;
const roles = new Set<Role>(['consolidator', 'transit', 'distributor', 'terminal', 'coordinator', 'peripheral']);
const invalid = () => new ApiError('INVALID_RESPONSE', 'Сервис вернул данные в неподдерживаемом формате.');
const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as JsonObject;
};
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw invalid(); return value; };
const string = (value: unknown): string => { if (typeof value !== 'string' || !value) throw invalid(); return value; };
const number = (value: unknown): number => { if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(); return value; };
const gid = (value: unknown): string => {
  const id = string(value);
  if (!/^-?\d+$/.test(id)) throw invalid();
  return id;
};
function mapNode(value: unknown): NodeSummary {
  const node = object(value);
  if (!roles.has(node.role as Role) || typeof node.is_seed !== 'boolean') throw invalid();
  return {
    gid: gid(node.gid), role: node.role as Role, role_score: number(node.role_score),
    priority_score: number(node.priority_score), cluster_id: number(node.cluster_id),
    evidence: string(node.evidence), is_seed: node.is_seed, depth: number(node.depth),
  };
}
function mapEdge(value: unknown): TransferEdge {
  const edge = object(value);
  return { source: gid(edge.src), target: gid(edge.dst), sum_kzt: number(edge.sum_kzt), n_tx: number(edge.n_tx) };
}
function sameAnalysis(actual: unknown, expected?: string | null): string {
  const id = string(actual);
  if (expected && id !== expected) throw new ApiError('STALE_ANALYSIS', 'Анализ на сервере изменился. Обновите анализ и повторите поиск.');
  return id;
}
export function mapAnalysis(value: unknown, expectedId?: string): WorkspaceAnalysis {
  const result = object(value);
  const analysisId = sameAnalysis(result.analysis_id, expectedId);
  const allNodes = array(result.nodes).map(mapNode);
  const byGid = new Map(allNodes.map((node) => [node.gid, node]));
  if (byGid.size !== allNodes.length) throw invalid();
  const edges = array(result.edges).map(mapEdge);
  if (edges.some((edge) => !byGid.has(edge.source) || !byGid.has(edge.target))) throw invalid();
  const nodes = array(result.top_nodes).map((value): TopNode => {
    const top = object(value);
    const summary = byGid.get(gid(top.gid));
    if (!summary || top.role !== summary.role || number(top.priority_score) !== summary.priority_score) throw invalid();
    return { ...summary, rank: number(top.rank), why: string(top.why) };
  });
  return { analysisId, nodes, graph: { center_gid: nodes[0]?.gid ?? allNodes[0]?.gid ?? '', nodes: allNodes, edges } };
}

/** The HTTP boundary preserves decimal string IDs and the server's role/cluster assignments. */
export function createWorkspaceApi(baseUrl: string | undefined, fetcher: typeof fetch = fetch) {
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!baseUrl?.trim()) throw new ApiError('CONFIGURATION', 'Не указан адрес сервиса анализа. Задайте VITE_API_BASE_URL.');
    let response: Response;
    try { response = await fetcher(baseUrl.replace(/\/+$/, '') + path, init); }
    catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      throw new ApiError('NETWORK_ERROR', 'Сервис анализа недоступен. Проверьте адрес сервиса и подключение.');
    }
    init.signal?.throwIfAborted();
    let payload: unknown;
    try { payload = await response.json(); }
    catch { init.signal?.throwIfAborted(); throw invalid(); }
    init.signal?.throwIfAborted();
    if (!response.ok) {
      const error = object(object(payload).error);
      const code = string(error.code);
      const messages: Record<string, string> = {
        NO_ANALYSIS: 'Анализ ещё не загружен. Выберите три файла Parquet и запустите расчёт.',
        GID_NOT_FOUND: 'Узел с таким gid не найден в текущем анализе.',
        ANALYSIS_BUSY: 'На сервере уже выполняется расчёт. Дождитесь его завершения и повторите загрузку.',
        STALE_ANALYSIS: 'Анализ на сервере изменился. Обновите анализ и повторите поиск.',
      };
      throw new ApiError(code, messages[code] ?? string(error.message));
    }
    return payload;
  }
  const getAnalysis = async (signal?: AbortSignal, expectedId?: string) => mapAnalysis(await request('/api/analysis', { signal }), expectedId);
  const getNodeView = async (selectedGid: string, analysisId: string | null, signal?: AbortSignal): Promise<NodeView> => {
    const payload = object(await request('/api/nodes/' + encodeURIComponent(selectedGid), { signal }));
    sameAnalysis(payload.analysis_id, analysisId);
    const node = object(payload.node);
    const summary = mapNode(node);
    if (summary.gid !== selectedGid) throw invalid();
    return {
      detail: { ...summary, incoming_sum_kzt: number(node.in_kzt), outgoing_sum_kzt: number(node.out_kzt), unique_payers: number(node.in_deg), unique_recipients: number(node.out_deg) },
      // Full graph is loaded once from /analysis and remains stable during card requests.
      graph: null,
    };
  };
  const importAnalysis = async (files: Record<ImportKey, File>, report: (event: ImportEvent) => void, signal: AbortSignal) => {
    signal.throwIfAborted();
    const form = new FormData();
    const keys: ImportKey[] = ['nodes', 'edges', 'transactions'];
    report({ type: 'pipeline', status: 'uploading' });
    for (const key of keys) { form.append(key, files[key], files[key].name); report({ type: 'file', key, status: 'uploading' }); }
    const result = object(await request('/api/analyze', { method: 'POST', body: form, signal }));
    if (result.status !== 'ready') throw invalid();
    const id = string(result.analysis_id);
    // This endpoint is synchronous: only its successful response confirms validation/calculation.
    for (const key of keys) report({ type: 'file', key, status: 'ready' });
    const analysis = await getAnalysis(signal, id);
    signal.throwIfAborted();
    return analysis;
  };
  return { getAnalysis, getNodeView, importAnalysis };
}
