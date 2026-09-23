import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, mapAnalysis, nodeGraph, getNodeCard, getAnalysis, uploadAnalysis, askQuestion, getExport } from './workspace.ts';

const a = '100000000000000001', b = '100000000000000002', isolated = '100000000000000003';
const node = (gid) => ({ gid, role: 'peripheral', role_score: .5, priority_score: .2, cluster_id: 1, evidence: 'Наблюдение', depth: 1, is_seed: false, in_deg: 2, out_deg: 3, in_kzt: 10000, out_kzt: 20000, truncated_by_depth: false });
const raw = () => ({ analysis_id: 'first', summary: { n_nodes: 3, n_edges: 1 }, nodes: [node(a), node(b), node(isolated)],
  edges: [{ src: a, dst: b, sum_kzt: 5000, n_tx: 1 }], top_nodes: [{ gid: a, rank: 1, why: 'Причина приоритета' }], clusters: [], temporal_summary: {} });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('maps exact identifiers, direction, metrics and joins top with full node facts', () => {
  const mapped = mapAnalysis(raw());
  assert.equal(mapped.nodes[0].gid, a); assert.equal(mapped.nodes[1].gid, b);
  assert.equal(mapped.nodes[0].unique_payers, 2); assert.equal(mapped.nodes[0].outgoing_sum_kzt, 20000);
  assert.deepEqual(mapped.edges[0], { source: a, target: b, sum_kzt: 5000, n_tx: 1 });
  assert.equal(mapped.top_nodes[0].depth, 1); assert.equal(mapped.top_nodes[0].why, 'Причина приоритета');
});
test('full analysis finds non-top and isolated nodes; isolated graph contains its node', () => {
  const mapped = mapAnalysis(raw());
  assert.equal(mapped.nodes.find((n) => n.gid === b).gid, b);
  assert.deepEqual(nodeGraph(mapped, isolated).nodes.map((n) => n.gid), [isolated]);
  assert.deepEqual(nodeGraph(mapped, isolated).edges, []);
  assert.equal(nodeGraph(mapped, b).edges[0].source, a);
});
test('rejects numeric gids instead of coercing rounded identifiers', () => {
  const data = raw(); data.nodes[0].gid = Number(a);
  assert.throws(() => mapAnalysis(data), /идентификатор/);
});
test('card keeps all observations, maps links and checks snapshot version', async (t) => {
  const data = { analysis_id: 'first', node: node(a), incoming: [], outgoing: raw().edges, data_gaps: [{ code: 'SEED' }], next_requests: [], temporal_patterns: { items: [], total_count: 0, truncated: false }, limitations: ['Неполная выборка'] };
  t.mock.method(globalThis, 'fetch', async () => reply(data));
  const card = await getNodeCard(a, 'first');
  assert.equal(card.outgoing[0].target, b); assert.equal(card.data_gaps[0].code, 'SEED');
  await assert.rejects(getNodeCard(a, 'second'), (error) => error.code === 'STALE_ANALYSIS');
});
test('no analysis is a distinct empty state; network failure is never mock data', async (t) => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => reply({ error: { code: 'NO_ANALYSIS', message: 'Нет анализа' } }, 404));
  await assert.rejects(getAnalysis(), (e) => e.code === 'NO_ANALYSIS');
  mocked.mock.mockImplementation(async () => { throw new TypeError('offline'); });
  await assert.rejects(getAnalysis(), (e) => e.code === 'NETWORK_ERROR');
});
test('upload uses exact multipart fields and only returns a confirmed snapshot', async (t) => {
  const files = Object.fromEntries(['nodes', 'edges', 'transactions'].map((name) => [name, new File(['PAR1'], name + '.parquet')]));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(url);
    if (url === '/api/analyze') {
      assert.deepEqual([...init.body.keys()], ['nodes', 'edges', 'transactions']);
      return reply({ analysis_id: 'first', status: 'ready' });
    }
    return reply(raw());
  });
  assert.equal((await uploadAnalysis(files, new AbortController().signal)).analysis_id, 'first');
  assert.deepEqual(calls, ['/api/analyze', '/api/analysis']);
});
test('failed upload propagates server message without synthesizing success', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => reply({ error: { code: 'INVALID_SCHEMA', message: 'Отсутствует gid' } }, 422));
  await assert.rejects(uploadAnalysis({ nodes: new File([], 'nodes.parquet') }, new AbortController().signal), (e) => e.code === 'INVALID_SCHEMA');
});
test('AI request sends exact selected string and analysis id; returns references', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/ask'); assert.deepEqual(JSON.parse(init.body), { analysis_id: 'first', question: 'Почему?', context_gids: [a] });
    return reply({ analysis_id: 'first', answer: 'Гипотеза', references: [{ gid: a, facts: ['Роль: peripheral'] }], limitations: [] });
  });
  assert.equal((await askQuestion('first', 'Почему?', a)).references[0].gid, a);
});
test('AI unavailable and stale errors stay actionable', async (t) => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => reply({ error: { code: 'AI_UNAVAILABLE', message: 'AI недоступен' } }, 503));
  await assert.rejects(askQuestion('first', '?', a), (e) => e instanceof ApiError && e.code === 'AI_UNAVAILABLE');
  mocked.mock.mockImplementation(async () => reply({ error: { code: 'STALE_ANALYSIS', message: 'Снимок изменён' } }, 409));
  await assert.rejects(askQuestion('first', '?', a), (e) => e.code === 'STALE_ANALYSIS');
});
test('download checks version header and preserves server CSV bytes', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('gid\n' + a, { headers: { 'X-Analysis-Id': 'first' } }));
  assert.equal(await (await getExport('nodes_roles.csv', 'first')).text(), 'gid\n' + a);
  await assert.rejects(getExport('nodes_roles.csv', 'second'), (e) => e.code === 'STALE_ANALYSIS');
});
