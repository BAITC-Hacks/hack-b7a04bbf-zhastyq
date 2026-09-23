import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeWidth, nodeDiameter, percentile95, graphElements, graphIndex, visibleGids, defaultFilters, initialPosition } from './graphModel.ts';
import { settleLayout } from './forceLayout.ts';

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

test('string ids, seed labels, reciprocal transfers and depth-four roles are preserved', () => {
  const a = '9223372036854775806'; const b = '9223372036854775807';
  const graph = { nodes: [
    { gid: a, role: 'transit', priority_score: 0.2, cluster_id: 1, is_seed: true, depth: 4 },
    { gid: b, role: 'peripheral', priority_score: 0.1, cluster_id: 2, is_seed: false, depth: 4 },
  ], edges: [{ source: a, target: b, sum_kzt: 0 }, { source: b, target: a, sum_kzt: 0 }] };
  const elements = graphElements(graph, { minNode: 4, maxNode: 12, minEdge: 0.35, maxEdge: 0.9, defaultEdge: 0.5 });
  assert.equal(elements[0].data.id, a);
  assert.equal(elements[0].data.label, `S ${a}`);
  assert.equal(elements[1].data.role, 'peripheral');
  assert.deepEqual(elements.slice(2).map(e => [e.data.source, e.data.target]), [[a, b], [b, a]]);
  assert.ok(elements.slice(2).every(e => e.data.width === 0.35));
  assert.deepEqual([...graphIndex(graph).adjacency.get(a)], [b]);
});

test('filters induce a subgraph and can reveal isolated exact-id matches', () => {
  const graph = { nodes: [
    { gid: '001', role: 'transit', cluster_id: 1, depth: 4, is_seed: true },
    { gid: '1', role: 'consolidator', cluster_id: 2, depth: 1, is_seed: false },
    { gid: 'isolated', role: 'peripheral', cluster_id: 3, depth: 4, is_seed: false },
  ], edges: [{ source: '001', target: '1' }] };
  assert.deepEqual([...visibleGids(graph, defaultFilters)], ['001', '1', 'isolated']);
  assert.deepEqual([...visibleGids(graph, { ...defaultFilters, isolated: false })], ['001', '1']);
  assert.deepEqual([...visibleGids(graph, { ...defaultFilters, cluster: '3' })], ['isolated']);
  assert.equal(visibleGids(graph, { ...defaultFilters, isolated: false, role: 'transit' }).size, 0);
  assert.deepEqual([...visibleGids(graph, { ...defaultFilters, seedOnly: true, depth: '4' })], ['001']);
  assert.equal(visibleGids(graph, { ...defaultFilters, depth: '0' }).size, 0);
});

test('positions are deterministic without grouping peripheral roles on a ring', () => {
  assert.deepEqual(initialPosition('001', 2248), initialPosition('001', 2248));
  assert.notDeepEqual(initialPosition('001', 2248), initialPosition('1', 2248));
  assert.ok(Object.values(initialPosition('9223372036854775807', 2248)).every(Number.isFinite));
});

test('identical amounts and extreme outliers never produce invalid widths', () => {
  for (const amounts of [[], [0, 0], [42, 42], [1, 2, Number.MAX_VALUE], [NaN, Infinity, -1]]) {
    for (const amount of [...amounts, 0]) {
      const width = edgeWidth(amount, percentile95(amounts), 0.35, 0.9, 0.5);
      assert.ok(Number.isFinite(width) && width >= 0.35 && width <= 0.9);
    }
  }
  assert.ok(Number.isFinite(edgeWidth(100, NaN, 0.35, 0.9, 0.5)));
});

test('increasing link distance expands warm-start positions instead of collapsing them', () => {
  const nodes = [{ id: '001', x: -50, y: 0, radius: 5 }, { id: '1', x: 50, y: 0, radius: 5 }];
  const links = [{ source: '001', target: '1', distance: 42 }];
  const settings = { center: 0.45, repulsion: 1, strength: 1, distance: 1 };
  const base = settleLayout(nodes, links, settings);
  const length = positions => Math.hypot(positions[0].x - positions[1].x, positions[0].y - positions[1].y);
  const warm = base.map(p => ({ ...p, radius: 5 }));
  assert.ok(length(settleLayout(warm, links, { ...settings, distance: 3 })) > length(base));
  assert.ok(length(settleLayout(warm, links, { ...settings, repulsion: 4 })) > length(base));
  assert.ok(length(settleLayout(warm, links, { ...settings, center: 2 })) < length(base));
  assert.ok(length(settleLayout(warm, links, { ...settings, strength: 3 })) < length(base));
  assert.deepEqual(settleLayout(nodes, links, settings), base);
});

test('force solver handles empty, coincident, disconnected and self-loop inputs', () => {
  const settings = { center: 0, repulsion: 1, strength: 1, distance: 1 };
  assert.deepEqual(settleLayout([], [], settings), []);
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: String(i), x: 0, y: 0, radius: 3 }));
  const positions = settleLayout(nodes, [{ source: '0', target: '0', distance: 42 }], settings);
  assert.ok(positions.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.equal(new Set(positions.map(p => `${p.x}:${p.y}`)).size, nodes.length);
});
