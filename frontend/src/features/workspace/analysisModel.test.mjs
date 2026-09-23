import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisGraph, neighborhood, nodeDetails, rankedNodes } from './analysisModel.ts';
import { summarizeGraph } from './statistics.ts';

const ids = ['100000000000000001', '100000000000000002', '100000000000000003', '100000000000000004'];
const node = (gid, priority_score = 0.5, cluster_id = 1) => ({ gid, priority_score, cluster_id,
  role: 'transit', role_score: 0.5, depth: 1, is_seed: false, evidence: 'Наблюдаемые переводы',
  in_deg: 1, out_deg: 2, in_kzt: 5000, out_kzt: 15000, truncated_by_depth: false });
const analysis = { analysis_id: 'fixture', nodes: [node(ids[1], 0.8), node(ids[0], 0.8), node(ids[2]), node(ids[3], 0.1, 2)],
  edges: [{ src: ids[0], dst: ids[1], sum_kzt: 10000, n_tx: 2 },
    { src: ids[1], dst: ids[0], sum_kzt: 5000, n_tx: 1 },
    { src: ids[0], dst: ids[2], sum_kzt: 5000, n_tx: 1 }],
  top_nodes: [{ gid: ids[0], rank: 1, why: 'Причина из API' }], clusters: [], summary: {} };

test('all nodes remain searchable beyond the backend top; int64 IDs do not collide', () => {
  assert.equal(Number(ids[0]), Number(ids[1]));
  const ranked = rankedNodes(analysis);
  assert.deepEqual(ranked.map((item) => item.gid), ids);
  assert.equal(ranked[0].why, 'Причина из API');
  assert.equal(ranked[1].why, 'Наблюдаемые переводы');
  assert.equal(ranked[3].rank, 4);
});
test('neighborhood preserves transfer direction and prioritizes both incoming and outgoing volume', () => {
  const result = neighborhood(analysis, ids[0], 1);
  assert.deepEqual(result.graph.nodes.map((item) => item.gid), ids.slice(0, 2));
  assert.equal(result.totalNeighbors, 2);
  assert.equal(result.shownNeighbors, 1);
  assert.deepEqual(result.graph.edges.map((edge) => [edge.source, edge.target]), [[ids[0], ids[1]], [ids[1], ids[0]]]);
  assert.equal(neighborhood(analysis, ids[0], 120).graph.nodes.length, 3);
});
test('isolated nodes have a real single-node graph; unknown gid has no graph', () => {
  assert.equal(neighborhood(analysis, ids[3]).graph.nodes.length, 1);
  assert.deepEqual(neighborhood(analysis, ids[3]).graph.edges, []);
  assert.equal(neighborhood(analysis, '404').graph, null);
});
test('self transfers are retained without counting the node as its own neighbor', () => {
  const input = { ...analysis, edges: [{ src: ids[0], dst: ids[0], sum_kzt: 7, n_tx: 1 }] };
  const result = neighborhood(input, ids[0]);
  assert.equal(result.totalNeighbors, 0);
  assert.equal(result.graph.edges.length, 1);
});
test('statistics use the whole analysis including isolated nodes, independent of graph limit', () => {
  const stats = summarizeGraph(analysisGraph(analysis));
  assert.equal(stats.count, 4); assert.equal(stats.turnover, 20000);
  assert.equal(stats.highShare, 0.5); assert.equal(stats.outsideShare, 0.25);
  assert.equal(stats.averageClusterSize, 2);
  assert.equal(neighborhood(analysis, ids[0], 1).graph.nodes.length, 2);
  const details = nodeDetails(analysis.nodes[0]);
  assert.equal(details.incoming_sum_kzt, 5000); assert.equal(details.outgoing_sum_kzt, 15000);
  assert.equal(details.unique_payers, 1); assert.equal(details.unique_recipients, 2);
});
