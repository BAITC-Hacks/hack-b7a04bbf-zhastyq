import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkspaceApi, mapAnalysis } from './client.ts';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/synthetic-api.json', import.meta.url), 'utf8'));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const files = () => Object.fromEntries(['nodes', 'edges', 'transactions'].map((key) => [key, new File(['synthetic request body'], key + '.parquet')]));

test('real HTTP mapping preserves exact int64 IDs, directed edges, isolated nodes and backend assignments', async () => {
  const source = fixture();
  let requested;
  const api = createWorkspaceApi('https://synthetic.invalid/', async (url) => { requested = url; return json(source); });
  const result = await api.getAnalysis();
  assert.equal(requested, 'https://synthetic.invalid/api/analysis');
  assert.equal(result.graph.nodes.length, 3);
  assert.equal(result.nodes.length, 1);
  assert.deepEqual(result.graph.nodes.map((node) => node.gid), source.nodes.map((node) => node.gid));
  assert.deepEqual(result.graph.edges, source.edges.map(({ src, dst, ...rest }) => ({ source: src, target: dst, ...rest })));
  assert.equal(result.nodes[0].evidence, source.nodes[0].evidence);
  assert.equal(result.nodes[0].cluster_id, 7);
  assert.equal(result.nodes[0].role, 'consolidator');
  assert.equal(result.graph.nodes[2].cluster_id, 8);
  assert.equal(result.graph.center_gid, source.nodes[0].gid);
});

test('card request sends exact gid and uses backend observed sums/degrees', async () => {
  const source = fixture();
  const node = source.nodes[1];
  const controller = new AbortController();
  const api = createWorkspaceApi('https://synthetic.invalid', async (url, init) => {
    assert.equal(url, 'https://synthetic.invalid/api/nodes/' + node.gid);
    assert.equal(init.signal, controller.signal);
    return json({ analysis_id: source.analysis_id, node, incoming: [], outgoing: [] });
  });
  const result = await api.getNodeView(node.gid, source.analysis_id, controller.signal);
  assert.equal(result.detail.gid, node.gid);
  assert.equal(result.detail.incoming_sum_kzt, 10000);
  assert.equal(result.detail.outgoing_sum_kzt, 5000);
  assert.equal(result.detail.unique_payers, 1);
  assert.equal(result.graph, null);
});

test('numeric gid values and foreign graph endpoints are rejected rather than rounded or dropped', () => {
  const numeric = fixture(); numeric.nodes[0].gid = 100000000000000001;
  assert.throws(() => mapAnalysis(numeric), { code: 'INVALID_RESPONSE' });
  const foreign = fixture(); foreign.edges[0].dst = '123';
  assert.throws(() => mapAnalysis(foreign), { code: 'INVALID_RESPONSE' });
});

test('node version mismatch and wrong returned gid never become a card for the selected snapshot', async () => {
  const source = fixture();
  const api = createWorkspaceApi('https://synthetic.invalid', async () => json({ analysis_id: source.analysis_id, node: source.nodes[0] }));
  await assert.rejects(api.getNodeView(source.nodes[0].gid, 'other-analysis'), { code: 'STALE_ANALYSIS' });
  await assert.rejects(api.getNodeView(source.nodes[1].gid, source.analysis_id), { code: 'INVALID_RESPONSE' });
});

test('structured not-found, no-analysis and validation errors remain distinguishable', async () => {
  for (const code of ['GID_NOT_FOUND', 'NO_ANALYSIS', 'INVALID_SCHEMA', 'ANALYSIS_BUSY']) {
    const api = createWorkspaceApi('https://synthetic.invalid', async () => json({ error: { code, message: 'Synthetic server error' } }, code === 'ANALYSIS_BUSY' ? 409 : 404));
    await assert.rejects(api.getNodeView('999', 'synthetic-snapshot-1'), { code });
  }
  await assert.rejects(createWorkspaceApi('').getAnalysis(), { code: 'CONFIGURATION' });
});

test('upload uses exactly three multipart fields, then reads the confirmed snapshot without invented progress', async () => {
  const events = [];
  const payload = files();
  const source = fixture();
  let calls = 0;
  const api = createWorkspaceApi('https://synthetic.invalid', async (url, init) => {
    calls++;
    if (url.endsWith('/api/analyze')) {
      assert.equal(init.method, 'POST');
      assert.deepEqual([...init.body.keys()], ['nodes', 'edges', 'transactions']);
      for (const key of Object.keys(payload)) assert.equal(init.body.get(key).name, key + '.parquet');
      assert.equal(events.filter((event) => event.status === 'ready').length, 0);
      return json({ analysis_id: source.analysis_id, status: 'ready' });
    }
    assert.ok(url.endsWith('/api/analysis'));
    return json(source);
  });
  const result = await api.importAnalysis(payload, (event) => events.push(event), new AbortController().signal);
  assert.equal(calls, 2);
  assert.equal(result.analysisId, source.analysis_id);
  assert.equal(events.filter((event) => event.status === 'ready').length, 3);
  assert.ok(events.every((event) => event.progress === undefined));
  // The workspace reports complete only after it commits this snapshot.
  assert.ok(events.every((event) => event.status !== 'complete'));
});

test('failed upload and replacement during refresh never report complete', async () => {
  const source = fixture();
  for (const failure of ['upload', 'version']) {
    const events = [];
    const api = createWorkspaceApi('https://synthetic.invalid', async (url) => {
      if (url.endsWith('/api/analyze')) return failure === 'upload'
        ? json({ error: { code: 'INVALID_SCHEMA', message: 'Synthetic invalid Parquet' } }, 422)
        : json({ analysis_id: 'previous-snapshot', status: 'ready' });
      return json(source);
    });
    await assert.rejects(api.importAnalysis(files(), (event) => events.push(event), new AbortController().signal), { code: failure === 'upload' ? 'INVALID_SCHEMA' : 'STALE_ANALYSIS' });
    assert.ok(events.every((event) => event.status !== 'complete'));
    if (failure === 'upload') assert.ok(events.every((event) => event.status !== 'ready'));
  }
});

test('aborted response cannot return data even when a transport ignores cancellation', async () => {
  const controller = new AbortController();
  let resolve;
  const api = createWorkspaceApi('https://synthetic.invalid', () => new Promise((done) => { resolve = done; }));
  const pending = api.getAnalysis(controller.signal);
  controller.abort();
  resolve(json(fixture()));
  await assert.rejects(pending, { name: 'AbortError' });
});
