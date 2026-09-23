import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeWidth, nodeDiameter, percentile95, graphElements } from './graphModel.ts';

test('node area scales with priority and clamps invalid scores', () => {
  assert.equal(nodeDiameter(-1, 6, 18), 6);
  assert.equal(nodeDiameter(2, 6, 18), 18);
  assert.equal(nodeDiameter(NaN, 6, 18), 6);
  assert.ok(Math.abs(nodeDiameter(0.5, 6, 18) ** 2 - 180) < 1e-10);
});

test('P95 normalization bounds outliers and handles empty or zero transfers', () => {
  assert.equal(percentile95([]), 1);
  assert.equal(percentile95([0, 100]), 95);
  assert.equal(edgeWidth(0, 0, 0.7, 1.8, 1), 0.7);
  assert.equal(edgeWidth(1000000, 95, 0.7, 1.8, 1), 1.8);
  assert.equal(edgeWidth(NaN, 95, 0.7, 1.8, 1), 1);
  assert.ok(edgeWidth(10, 95, 0.7, 1.8, 1) < edgeWidth(50, 95, 0.7, 1.8, 1));
});

test('seed status does not change size; directions and cluster membership survive', () => {
  const graph = { nodes: [
    { gid: 'a', priority_score: 0.8, cluster_id: 1, is_seed: true },
    { gid: 'b', priority_score: 0.8, cluster_id: 2, is_seed: false },
  ], edges: [{ source: 'a', target: 'b', sum_kzt: 50 }, { source: 'x', target: 'a', sum_kzt: 10 }] };
  const elements = graphElements(graph, { minNode: 6, maxNode: 18, minEdge: 0.7, maxEdge: 1.8, defaultEdge: 1 });
  assert.equal(elements.length, 3);
  assert.equal(elements[0].data.diameter, elements[1].data.diameter);
  assert.equal(elements[2].data.source, 'a');
  assert.equal(elements[2].data.target, 'b');
  assert.equal(elements[2].data.sameCluster, false);
});
