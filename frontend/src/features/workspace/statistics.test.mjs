import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeGraph } from './statistics.ts';

test('demo slice totals are computed from transfers and roles', () => {
  const graph = JSON.parse(readFileSync(new URL('../../shared/api/fixtures/graph-slice.json', import.meta.url), 'utf8'));
  const stats = summarizeGraph(graph);
  assert.equal(stats.turnover, 2390000);
  assert.equal(stats.count, 6);
  assert.equal(stats.highShare, 5 / 6);
  assert.equal(stats.clusterCount, 1);
  assert.equal(stats.averageClusterSize, 6);
  assert.equal(stats.consolidators, 2);
  assert.equal(stats.coordinators, 1);
  assert.equal(stats.outsideShare, 0);
});

test('weak connectivity includes reverse directions and isolated nodes', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((gid, i) => ({ gid, cluster_id: i % 2, priority_score: i === 0 ? 0.8 : 0, role: 'transit' }));
  const edges = [{ source: 'b', target: 'a', sum_kzt: 10 }, { source: 'b', target: 'c', sum_kzt: 20 }];
  const stats = summarizeGraph({ nodes, edges });
  assert.equal(stats.outsideShare, 0.25);
  assert.equal(stats.highCount, 1);
  assert.equal(stats.averageClusterSize, 2);
  assert.equal(stats.turnover, 30);
});

test('empty slice uses unavailable ratios without NaN', () => {
  const stats = summarizeGraph({ nodes: [], edges: [] });
  assert.equal(stats.highShare, null);
  assert.equal(stats.outsideShare, null);
  assert.equal(stats.averageClusterSize, null);
  assert.equal(stats.turnover, 0);
});
