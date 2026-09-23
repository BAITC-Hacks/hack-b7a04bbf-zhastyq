import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapAnalysis } from '../../shared/api/client.ts';
import { initialWorkspace, workspaceReducer as reduce } from './analysisState.ts';

const analysis = () => mapAnalysis(JSON.parse(readFileSync(new URL('../../shared/api/fixtures/synthetic-api.json', import.meta.url), 'utf8')));
const loaded = () => reduce(initialWorkspace(false), { type: 'analysis-ready', analysis: analysis() });

test('real mode initializes from actual data and keeps the full graph through any-gid selections and card failures', () => {
  let state = loaded();
  const graph = state.graph;
  assert.equal(state.selectedGid, '100000000000000001');
  for (const gid of ['9223372036854775807', 'not-found']) {
    state = reduce(state, { type: 'select', gid });
    state = reduce(state, { type: 'node-start', request: 1 });
    state = reduce(state, { type: 'node-error', request: 1, analysisId: state.analysisId, gid, error: 'Synthetic missing node' });
    assert.equal(state.graph, graph);
    assert.equal(state.loadingGraph, false);
    assert.equal(state.detail, null);
  }
});

test('late card results cannot overwrite a newer selection, request or analysis snapshot', () => {
  let state = loaded();
  const old = { type: 'node-ready', request: 1, analysisId: state.analysisId, gid: state.selectedGid, view: { detail: { gid: state.selectedGid }, graph: null } };
  state = reduce(state, { type: 'node-start', request: 1 });
  state = reduce(state, { type: 'select', gid: '9223372036854775807' });
  assert.equal(reduce(state, old), state);
  state = reduce(state, { type: 'select', gid: old.gid });
  state = reduce(state, { type: 'node-start', request: 2 });
  assert.equal(reduce(state, old), state);
  const next = analysis(); next.analysisId = 'synthetic-snapshot-2';
  state = reduce(state, { type: 'analysis-ready', analysis: next });
  assert.equal(reduce(state, old), state);
});

test('failed import/read retains valid data; same-version refresh preserves graph identity; replacement swaps atomically', () => {
  const old = loaded();
  const failed = reduce(old, { type: 'analysis-error', error: 'Synthetic rejected upload' });
  assert.equal(failed.nodes, old.nodes);
  assert.equal(failed.graph, old.graph);
  const refreshed = reduce(old, { type: 'analysis-ready', analysis: analysis() });
  assert.equal(refreshed.graph, old.graph);
  const next = analysis(); next.analysisId = 'synthetic-snapshot-2';
  next.graph.nodes = [next.graph.nodes[2]]; next.graph.edges = []; next.graph.center_gid = next.graph.nodes[0].gid; next.nodes = [];
  const replaced = reduce(old, { type: 'analysis-ready', analysis: next });
  assert.equal(replaced.graph, next.graph);
  assert.equal(replaced.selectedGid, '9223372036854775807');
  assert.equal(replaced.nodes.length, 0);
  assert.equal(replaced.detail, null);
});

test('demo outside-slice selection remains honest and a zero-node real snapshot has no made-up selection', () => {
  const demo = reduce(initialWorkspace(true), { type: 'analysis-ready', analysis: analysis() });
  assert.equal(reduce(demo, { type: 'select', gid: 'missing' }).graph, null);
  const empty = reduce(initialWorkspace(false), { type: 'analysis-ready', analysis: { analysisId: 'synthetic-empty', nodes: [], graph: { center_gid: '', nodes: [], edges: [] } } });
  assert.equal(empty.selectedGid, null);
  assert.equal(empty.loadingDetail, false);
});
