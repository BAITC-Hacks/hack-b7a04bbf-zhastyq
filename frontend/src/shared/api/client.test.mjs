import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient } from './client.ts';

const first = '100000000000000001';
const second = '100000000000000002';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const failure = (code, status = 404, details = {}) => json({ error: { code, message: `Ошибка ${code}`, details } }, status);
const makeNode = (id) => ({ gid: id, depth: 1, is_seed: false, role: 'transit', role_score: .6, cluster_id: 1,
  priority_score: .8, evidence: 'Наблюдаемые переводы', in_deg: 1, out_deg: 1, in_kzt: 5000, out_kzt: 5000, truncated_by_depth: false });
const edge = { src: first, dst: second, sum_kzt: 5000, n_tx: 1 };
const summary = { n_nodes: 2, n_edges: 1, n_transactions: 1, n_seed: 0, n_clusters: 1, edge_volume_kzt: 5000 };
const analysis = () => ({ analysis_id: 'analysis-1', summary: { ...summary }, nodes: [makeNode(first), makeNode(second)], edges: [{ ...edge }],
  clusters: [{ cluster_id: 1, n_nodes: 2, n_seed: 0, sum_kzt_internal: 5000, top_gids: [first, second], hypothesis: 'Гипотеза для проверки' }],
  top_nodes: [{ rank: 1, gid: first, role: 'transit', priority_score: .8, why: 'Переводы' }] });
const card = () => ({ analysis_id: 'analysis-1', node: makeNode(second), incoming: [{ ...edge }], outgoing: [],
  limitations: ['Полные остатки неизвестны'], data_gaps: [{ code: 'BALANCES_UNAVAILABLE', description: 'Остатки неизвестны', evidence: 'Нет данных об остатках' }],
  next_requests: [{ gap_code: 'BALANCES_UNAVAILABLE', request: 'Запросить остатки', reason: 'Проверить баланс' }] });
const answer = () => ({ analysis_id: 'analysis-1', answer: 'Наблюдаются переводы', references: [{ gid: first, facts: ['Оборот: 5000 KZT'] }], limitations: ['Гипотеза для проверки'] });
const question = { analysis_id: 'analysis-1', question: ' Почему этот узел? ', context_gids: [first] };

test('health uses configured origin and never reuses a cached snapshot', async () => {
  const api = createApiClient({ baseUrl: 'https://example.test/', fetcher: async (url, init) => {
    assert.equal(url, 'https://example.test/api/health');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    return json({ status: 'ok', analysis_ready: false, ai_configured: false });
  } });
  assert.deepEqual(await api.getHealth(), { status: 'ok', analysis_ready: false, ai_configured: false });
});

test('only a 404 NO_ANALYSIS becomes an empty initial workspace', async () => {
  let response = () => failure('NO_ANALYSIS');
  const api = createApiClient({ fetcher: async (url) => { assert.equal(url, '/api/analysis'); return response(); } });
  assert.equal(await api.getAnalysis(), null);
  response = () => failure('GID_NOT_FOUND');
  await assert.rejects(api.getAnalysis(), { code: 'GID_NOT_FOUND', status: 404 });
  response = () => failure('NO_ANALYSIS', 500);
  await assert.rejects(api.getAnalysis(), { code: 'NO_ANALYSIS', status: 500 });
});

test('analysis preserves distinct int64 strings and rejects numeric or dangling identifiers', async () => {
  let data = analysis();
  const api = createApiClient({ fetcher: async () => json(data) });
  const result = await api.getAnalysis();
  assert.equal(result.nodes[0].gid, first);
  assert.equal(result.nodes[1].gid, second);
  assert.notEqual(result.nodes[0].gid, result.nodes[1].gid);
  for (const mutate of [
    (value) => { value.nodes[0].gid = Number(first); },
    (value) => { value.edges[0].dst = Number(second); },
    (value) => { value.top_nodes[0].gid = '42'; },
    (value) => { value.clusters[0].top_gids[0] = Number(first); },
    (value) => { value.nodes[1].gid = first; },
    (value) => { value.summary.n_nodes = 99; },
  ]) {
    data = analysis(); mutate(data);
    await assert.rejects(api.getAnalysis(), { code: 'INVALID_RESPONSE' });
  }
});

test('node card validates direction and observation advice without dropping fields', async () => {
  let data = card();
  const api = createApiClient({ fetcher: async (url) => { assert.equal(url, `/api/nodes/${second}`); return json(data); } });
  assert.deepEqual(await api.getNodeCard(second), card());
  data.incoming[0].dst = first;
  await assert.rejects(api.getNodeCard(second), { code: 'INVALID_RESPONSE' });
  data = card(); data.next_requests[0].gap_code = 'OTHER';
  await assert.rejects(api.getNodeCard(second), { code: 'INVALID_RESPONSE' });
  data = card(); data.node.gid = first; data.incoming = [];
  await assert.rejects(api.getNodeCard(second), { code: 'INVALID_RESPONSE' });
});

test('invalid or numeric gid never reaches the network', async () => {
  const api = createApiClient({ fetcher: async () => assert.fail('Unexpected HTTP request') });
  for (const id of [Number(first), '9223372036854775808', '1005/../health', '', '1.2']) {
    await assert.rejects(api.getNodeCard(id), { code: 'INVALID_SCHEMA', status: 422 });
  }
});

test('upload sends exactly three file fields and waits for the completed analysis response', async () => {
  const files = Object.fromEntries(['nodes', 'edges', 'transactions'].map((name) => [name, new File(['PAR1'], `${name}.parquet`)]));
  const result = { analysis_id: 'analysis-2', status: 'ready', summary, analysis_url: '/api/analysis' };
  const api = createApiClient({ fetcher: async (url, init) => {
    assert.equal(url, '/api/analyze');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers, undefined, 'fetch must generate the multipart boundary');
    assert.deepEqual([...init.body.keys()], ['nodes', 'edges', 'transactions']);
    for (const name of Object.keys(files)) assert.equal(init.body.get(name).name, `${name}.parquet`);
    return json(result);
  } });
  assert.deepEqual(await api.uploadAnalysis(files), result);
});

test('backend validation errors keep the file-specific cause and details', async () => {
  const api = createApiClient({ fetcher: async () => json({ error: { code: 'INVALID_SCHEMA', message: 'nodes.parquet: нет gid', details: { file: 'nodes.parquet' } } }, 422) });
  await assert.rejects(api.getAnalysis(), (error) => error instanceof ApiError && error.code === 'INVALID_SCHEMA'
    && error.status === 422 && error.message === 'nodes.parquet: нет gid' && error.details.file === 'nodes.parquet');
});

test('all CSV exports require a matching analysis version and CSV content type', async () => {
  let version = 'analysis-1';
  let contentType = 'text/csv; charset=utf-8';
  const api = createApiClient({ fetcher: async (url) => {
    assert.match(url, /^\/api\/exports\/(nodes_roles|clusters|top_nodes)\.csv$/);
    return new Response(`gid\n${first}\n`, { headers: { ...(version && { 'X-Analysis-Id': version }), 'Content-Type': contentType } });
  } });
  for (const name of ['nodes_roles.csv', 'clusters.csv', 'top_nodes.csv']) {
    const file = await api.downloadExport(name, 'analysis-1');
    assert.equal(file.filename, name);
    assert.equal(await file.blob.text(), `gid\n${first}\n`);
  }
  version = 'analysis-2';
  await assert.rejects(api.downloadExport('top_nodes.csv', 'analysis-1'), { code: 'STALE_ANALYSIS', status: 409 });
  version = '';
  await assert.rejects(api.downloadExport('top_nodes.csv', 'analysis-1'), { code: 'INVALID_RESPONSE' });
  version = 'analysis-1'; contentType = 'text/html';
  await assert.rejects(api.downloadExport('top_nodes.csv', 'analysis-1'), { code: 'INVALID_RESPONSE' });
  await assert.rejects(api.downloadExport('../private', 'analysis-1'), { code: 'EXPORT_NOT_FOUND' });
});

test('AI request sends trimmed text and exact identifiers, and checks the returned version', async () => {
  let data = answer();
  let calls = 0;
  const api = createApiClient({ fetcher: async (url, init) => {
    calls++;
    assert.equal(url, '/api/ask');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { ...question, question: question.question.trim() });
    return json(data);
  } });
  assert.deepEqual(await api.askQuestion(question), answer());
  data.analysis_id = 'analysis-2';
  await assert.rejects(api.askQuestion(question), { code: 'STALE_ANALYSIS', status: 409 });
  assert.equal(calls, 2, 'there are no automatic model retries');
});

test('AI refuses empty context or malformed responses', async () => {
  let calls = 0;
  const api = createApiClient({ fetcher: async () => { calls++; return json({ ...answer(), references: [{ gid: Number(first), facts: [] }] }); } });
  await assert.rejects(api.askQuestion({ ...question, context_gids: [] }), { code: 'INVALID_QUESTION' });
  await assert.rejects(api.askQuestion({ ...question, context_gids: [first, first] }), { code: 'INVALID_QUESTION' });
  await assert.rejects(api.askQuestion({ ...question, question: ' ' }), { code: 'INVALID_QUESTION' });
  assert.equal(calls, 0);
  await assert.rejects(api.askQuestion(question), { code: 'INVALID_RESPONSE' });
});

test('abort and timeout stop requests with distinct errors and no retries', async () => {
  let calls = 0;
  const fetcher = async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const controller = new AbortController();
  const pending = createApiClient({ fetcher }).getHealth(controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(createApiClient({ fetcher, timeoutMs: 5 }).getHealth(), { code: 'TIMEOUT' });
  await assert.rejects(createApiClient({ fetcher }).getHealth(controller.signal), { name: 'AbortError' });
  assert.equal(calls, 2);
});

test('network, non-JSON success and configuration errors are readable API errors', async () => {
  await assert.rejects(createApiClient({ fetcher: async () => { throw new TypeError('fetch failed'); } }).getHealth(), { code: 'NETWORK_ERROR' });
  await assert.rejects(createApiClient({ fetcher: async () => new Response('<html>wrong server</html>') }).getHealth(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(createApiClient({ baseUrl: 'javascript:alert(1)', fetcher: async () => assert.fail('Unexpected HTTP request') }).getHealth(), { code: 'INVALID_CONFIG' });
});
