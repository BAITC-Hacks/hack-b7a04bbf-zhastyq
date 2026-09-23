import type {
  AnalysisResponse, AskRequest, AskResponse, ExportName, HealthResponse,
  NodeCardResponse, UploadResponse,
} from './types';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status = 0, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown): value is number => amount(value) && Number.isSafeInteger(value);
const score = (value: unknown) => amount(value) && value <= 1;
const roles = new Set(['consolidator', 'transit', 'distributor', 'terminal', 'coordinator', 'peripheral']);
const role = (value: unknown) => typeof value === 'string' && roles.has(value);
const list = (value: unknown, check: (entry: unknown) => boolean): value is unknown[] => Array.isArray(value) && value.every(check);
const strings = (value: unknown) => list(value, text);

function gid(value: unknown): value is string {
  if (typeof value !== 'string' || !/^-?[0-9]{1,19}$/.test(value)) return false;
  const integer = BigInt(value);
  return integer >= -(2n ** 63n) && integer < 2n ** 63n;
}

function summary(value: unknown) {
  return object(value) && ['n_nodes', 'n_edges', 'n_transactions', 'n_seed', 'n_clusters'].every((key) => count(value[key])) && amount(value.edge_volume_kzt);
}

function node(value: unknown) {
  return object(value) && gid(value.gid) && role(value.role)
    && score(value.role_score) && score(value.priority_score) && text(value.evidence)
    && ['depth', 'cluster_id', 'in_deg', 'out_deg'].every((key) => count(value[key]))
    && amount(value.in_kzt) && amount(value.out_kzt)
    && typeof value.is_seed === 'boolean' && typeof value.truncated_by_depth === 'boolean';
}

function edge(value: unknown) {
  return object(value) && gid(value.src) && gid(value.dst) && amount(value.sum_kzt) && count(value.n_tx);
}

function cluster(value: unknown) {
  return object(value) && ['cluster_id', 'n_nodes', 'n_seed'].every((key) => count(value[key]))
    && amount(value.sum_kzt_internal) && list(value.top_gids, gid) && text(value.hypothesis);
}

function topNode(value: unknown) {
  return object(value) && count(value.rank) && value.rank > 0 && gid(value.gid)
    && role(value.role) && score(value.priority_score) && text(value.why);
}

function validAnalysis(value: unknown) {
  if (!(object(value) && text(value.analysis_id) && summary(value.summary)
    && list(value.nodes, node) && list(value.edges, edge)
    && list(value.clusters, cluster) && list(value.top_nodes, topNode))) return false;
  const result = value as unknown as AnalysisResponse;
  const ids = new Set(result.nodes.map((entry) => entry.gid));
  return ids.size === result.nodes.length && result.summary.n_nodes === result.nodes.length
    && result.summary.n_edges === result.edges.length
    && result.edges.every((entry) => ids.has(entry.src) && ids.has(entry.dst))
    && result.top_nodes.every((entry) => ids.has(entry.gid))
    && result.clusters.every((entry) => entry.top_gids.every((id) => ids.has(id)));
}

function validCard(value: unknown) {
  if (!(object(value) && text(value.analysis_id) && node(value.node)
    && list(value.incoming, edge) && list(value.outgoing, edge) && strings(value.limitations)
    && list(value.data_gaps, (entry) => object(entry) && text(entry.code) && text(entry.description) && text(entry.evidence))
    && list(value.next_requests, (entry) => object(entry) && text(entry.gap_code) && text(entry.request) && text(entry.reason)))) return false;
  const result = value as unknown as NodeCardResponse;
  const codes = new Set(result.data_gaps.map((entry) => entry.code));
  return result.incoming.every((entry) => entry.dst === result.node.gid)
    && result.outgoing.every((entry) => entry.src === result.node.gid)
    && codes.size === result.data_gaps.length && result.next_requests.length === result.data_gaps.length
    && result.next_requests.every((entry, index) => entry.gap_code === result.data_gaps[index].code);
}

function invalidResponse(): never {
  throw new ApiError('INVALID_RESPONSE', 'Сервис вернул данные неожиданного формата. Обновите анализ или повторите запрос.');
}

function parse<T>(value: unknown, validator: (input: unknown) => boolean): T {
  if (!validator(value)) return invalidResponse();
  return value as T;
}

const defaultErrors: Record<string, string> = {
  NO_ANALYSIS: 'Сначала загрузите три файла и выполните анализ.',
  GID_NOT_FOUND: 'Клиент не найден в текущем анализе.',
  EXPORT_NOT_FOUND: 'Этот файл экспорта недоступен.',
  FILE_TOO_LARGE: 'Размер файла превышает 25 МиБ или общий размер запроса превышает 76 МиБ.',
  ANALYSIS_BUSY: 'На сервере уже выполняется расчёт. Повторите загрузку после его завершения.',
  STALE_ANALYSIS: 'На сервере появился новый анализ. Обновите данные и повторите действие.',
  AI_UNAVAILABLE: 'AI-помощник временно недоступен. Анализ и экспорт остаются доступны.',
  INTERNAL_ERROR: 'Сервис не смог обработать запрос. Повторите попытку.',
};

async function responseError(response: Response): Promise<ApiError> {
  const payload: unknown = await response.json().catch(() => null);
  const error = object(payload) && object(payload.error) ? payload.error : null;
  const code = error && text(error.code) ? error.code : response.status === 413 ? 'FILE_TOO_LARGE' : 'HTTP_ERROR';
  const message = error && text(error.message) ? error.message
    : defaultErrors[code] ?? `Сервис вернул ошибку HTTP ${response.status}. Повторите запрос.`;
  return new ApiError(code, message, response.status, error && object(error.details) ? error.details : {});
}

interface ClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  /** Tests can shorten the deadline without waiting for production timeouts. */
  timeoutMs?: number;
}

/** No retries: uploading or asking the model twice can start duplicate work. */
export function createApiClient({ baseUrl = '', fetcher = globalThis.fetch, timeoutMs }: ClientOptions = {}) {
  function endpoint(path: string) {
    const base = baseUrl.trim().replace(/\/+$/, '');
    if (!base) return path;
    try {
      const url = new URL(base);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
      return `${base}${path}`;
    } catch {
      throw new ApiError('INVALID_CONFIG', 'Адрес API некорректен. Укажите HTTP(S)-адрес сервиса в VITE_API_BASE_URL.');
    }
  }

  async function request<T>(path: string, init: RequestInit, signal: AbortSignal | undefined, duration: number, read: (response: Response) => Promise<T>): Promise<T> {
    const url = endpoint(path);
    signal?.throwIfAborted();
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs ?? duration);
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw await responseError(response);
      return await read(response);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Запрос отменён', 'AbortError');
      if (timedOut) throw new ApiError('TIMEOUT', 'Сервис не ответил вовремя. Расчёт на сервере мог продолжиться — обновите данные перед повторной загрузкой.');
      if (error instanceof ApiError) throw error;
      throw new ApiError('NETWORK_ERROR', 'Нет связи с сервисом анализа. Проверьте, что бэкенд запущен, и повторите запрос.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function json<T>(path: string, validator: (value: unknown) => boolean, signal?: AbortSignal, init: RequestInit = {}, duration = 30_000): Promise<T> {
    return request(path, init, signal, duration, async (response) => {
      let value: unknown;
      try { value = await response.json(); } catch { return invalidResponse(); }
      return parse<T>(value, validator);
    });
  }

  return {
    getHealth(signal?: AbortSignal): Promise<HealthResponse> {
      return json('/api/health', (value) => object(value) && value.status === 'ok'
        && typeof value.analysis_ready === 'boolean' && typeof value.ai_configured === 'boolean', signal);
    },

    async getAnalysis(signal?: AbortSignal): Promise<AnalysisResponse | null> {
      try { return await json<AnalysisResponse>('/api/analysis', validAnalysis, signal); }
      catch (error) {
        if (error instanceof ApiError && error.status === 404 && error.code === 'NO_ANALYSIS') return null;
        throw error;
      }
    },

    async getNodeCard(id: string, signal?: AbortSignal): Promise<NodeCardResponse> {
      if (!gid(id)) throw new ApiError('INVALID_SCHEMA', 'gid должен быть десятичной строкой int64.', 422, { field: 'gid' });
      const result = await json<NodeCardResponse>(`/api/nodes/${encodeURIComponent(id)}`, validCard, signal);
      if (result.node.gid !== BigInt(id).toString()) return invalidResponse();
      return result;
    },

    uploadAnalysis(files: Record<'nodes' | 'edges' | 'transactions', File>, signal?: AbortSignal): Promise<UploadResponse> {
      const body = new FormData();
      for (const name of ['nodes', 'edges', 'transactions'] as const) body.append(name, files[name], files[name].name);
      // Let fetch set Content-Type and the multipart boundary together.
      return json('/api/analyze', (value) => object(value) && text(value.analysis_id)
        && value.status === 'ready' && value.analysis_url === '/api/analysis' && summary(value.summary),
      signal, { method: 'POST', body }, 180_000);
    },

    downloadExport(name: ExportName, expectedAnalysisId: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
      if (!['nodes_roles.csv', 'clusters.csv', 'top_nodes.csv'].includes(name)) {
        return Promise.reject(new ApiError('EXPORT_NOT_FOUND', defaultErrors.EXPORT_NOT_FOUND, 404));
      }
      return request(`/api/exports/${name}`, {}, signal, 30_000, async (response) => {
        const version = response.headers.get('X-Analysis-Id');
        if (!text(version)) return invalidResponse();
        if (version !== expectedAnalysisId) throw new ApiError('STALE_ANALYSIS', defaultErrors.STALE_ANALYSIS, 409);
        if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/csv')) return invalidResponse();
        return { blob: await response.blob(), filename: name };
      });
    },

    async askQuestion(input: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
      const question = typeof input.question === 'string' ? input.question.trim() : '';
      if (!text(input.analysis_id) || input.analysis_id.length > 128 || !question || question.length > 2000
        || !list(input.context_gids, gid) || input.context_gids.length < 1 || input.context_gids.length > 5
        || new Set(input.context_gids).size !== input.context_gids.length) {
        throw new ApiError('INVALID_QUESTION', 'Введите вопрос до 2000 символов и выберите от 1 до 5 разных клиентов.', 422);
      }
      const result = await json<AskResponse>('/api/ask', (value) => object(value) && text(value.analysis_id) && text(value.answer)
        && list(value.references, (entry) => object(entry) && gid(entry.gid) && strings(entry.facts))
        && value.references.length > 0 && strings(value.limitations), signal,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, question }) }, 90_000);
      if (result.analysis_id !== input.analysis_id) throw new ApiError('STALE_ANALYSIS', defaultErrors.STALE_ANALYSIS, 409);
      return result;
    },
  };
}
