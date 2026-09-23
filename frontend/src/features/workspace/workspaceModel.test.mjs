import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterNodes, flowInSlice, topNodesCsv } from './workspaceModel.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL('../../shared/api/fixtures/' + name + '.json', import.meta.url), 'utf8'));
const filters = { query: '', cluster: 'all', role: 'all', highOnly: false, order: 'priority' };

test('combined filters find clients without mutating the ranked source', () => {
  const nodes = fixture('top-nodes');
  const original = structuredClone(nodes);
  const result = filterNodes(nodes, { ...filters, query: ' 100 ', cluster: '1', role: 'consolidator', highOnly: true });
  assert.deepEqual(result.map((node) => node.gid), ['1001', '1005']);
  assert.deepEqual(nodes, original);
  assert.deepEqual(filterNodes(nodes, { ...filters, query: 'unknown' }), []);
});

test('high priority includes exactly 0.8 and sorts equal scores by rank', () => {
  const nodes = [{ gid: 'a', rank: 3, priority_score: .8 }, { gid: 'b', rank: 2, priority_score: .79 }, { gid: 'c', rank: 1, priority_score: .8 }];
  assert.deepEqual(filterNodes(nodes, { ...filters, highOnly: true }).map((node) => node.gid), ['c', 'a']);
  assert.deepEqual(filterNodes(nodes, { ...filters, order: 'rank' }).map((node) => node.gid), ['c', 'b', 'a']);
});

test('slice flow counts directed transfers and distinct counterparties', () => {
  const graph = fixture('graph-slice');
  assert.deepEqual(flowInSlice(graph, '1005'), { incoming_sum_kzt: 1500000, outgoing_sum_kzt: 890000, unique_payers: 3, unique_recipients: 2 });
  assert.deepEqual(flowInSlice(graph, '1001'), { incoming_sum_kzt: 0, outgoing_sum_kzt: 600000, unique_payers: 0, unique_recipients: 1 });
  graph.edges.push({ source: '1001', target: '1005', sum_kzt: 10, n_tx: 1 }, { source: 'outside', target: '1005', sum_kzt: 200, n_tx: 1 });
  assert.equal(flowInSlice(graph, '1005').incoming_sum_kzt, 1500010);
  assert.equal(flowInSlice(graph, '1005').unique_payers, 3);
});

test('unavailable clients have no flow, while a present isolated node has zero slice flow', () => {
  assert.equal(flowInSlice(null, '1005'), null);
  assert.equal(flowInSlice(fixture('graph-slice'), '1002'), null);
  assert.deepEqual(flowInSlice({ nodes: [{ gid: 'alone' }], edges: [] }, 'alone'), { incoming_sum_kzt: 0, outgoing_sum_kzt: 0, unique_payers: 0, unique_recipients: 0 });
});

test('CSV escapes separators, quotes, multiline text and formula prefixes; gid stays a string', () => {
  const node = { ...fixture('top-nodes')[0], gid: '9223372036854775807', why: ' +SUM(1;2)', evidence: 'Перевод; "описание"\nвторая строка' };
  const csv = topNodesCsv([node]);
  assert.ok(csv.startsWith('\uFEFFrank;gid;role;'));
  assert.ok(csv.includes('"9223372036854775807"'));
  assert.ok(csv.includes('"\' +SUM(1;2)"'));
  assert.ok(csv.includes('"Перевод; ""описание""\nвторая строка"'));
  assert.equal(topNodesCsv([]).split('\r\n').length, 1);
});
