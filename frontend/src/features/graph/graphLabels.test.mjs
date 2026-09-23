import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGraphLabels } from './graphLabels.ts';

const options = { selectedGid: null, hoveredGid: null, showContext: true };
const node = (gid, x, y, radius = 8, priority = 0.5) => ({ gid, x, y, radius, priority });
const rectanglesOverlap = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left
  && a.top < b.top + b.height && a.top + a.height > b.top;

function assertClear(labels, nodes, width, height) {
  for (const [index, label] of labels.entries()) {
    assert.ok(label.left >= 6 && label.top >= 6);
    assert.ok(label.left + label.width <= width - 6 && label.top + label.height <= height - 6);
    for (const other of labels.slice(index + 1)) assert.equal(rectanglesOverlap(label, other), false);
    for (const candidate of nodes) {
      const x = Math.max(label.left, Math.min(candidate.x, label.left + label.width));
      const y = Math.max(label.top, Math.min(candidate.y, label.top + label.height));
      assert.ok(Math.hypot(candidate.x - x, candidate.y - y) >= candidate.radius);
    }
  }
}

test('dense eighty-neighbor slice keeps a bounded, collision-free set and the full selected int64 ID', () => {
  const selectedGid = '100000003684369100';
  const nodes = [node(selectedGid, 450, 320, 12, 0.99), ...Array.from({ length: 80 }, (_, i) => {
    const angle = i * Math.PI * 2 / 80;
    return node(`100000${String(i).padStart(12, '0')}`, 450 + Math.cos(angle) * 190, 320 + Math.sin(angle) * 190, 7, i / 80);
  })];
  const labels = planGraphLabels(nodes, 900, 640, { ...options, selectedGid });
  assert.equal(labels[0].gid, selectedGid);
  assert.equal(labels[0].text, selectedGid);
  assert.equal(labels[0].kind, 'selected');
  assert.ok(labels.filter((label) => label.kind === 'context').length <= 12);
  assert.ok(labels.length > 1);
  assertClear(labels, nodes, 900, 640);
  assert.deepEqual(planGraphLabels([...nodes].reverse(), 900, 640, { ...options, selectedGid }), labels);
});

test('panning or zooming offscreen does not pin invisible node labels to the viewport edge', () => {
  const nodes = [node('100000000000000001', -20, 200), node('100000000000000002', 820, 200),
    node('100000000000000003', 400, -1), node('100000000000000004', 400, 601), node('100000000000000005', 400, 300)];
  const labels = planGraphLabels(nodes, 800, 600, { ...options, selectedGid: nodes[0].gid, hoveredGid: nodes[1].gid });
  assert.deepEqual(labels.map((label) => label.gid), [nodes[4].gid]);
});

test('selected and hovered labels preserve exact strings and remain the same pixel size as node radii grow', () => {
  const selectedGid = '9223372036854775806';
  const hoveredGid = '9223372036854775807';
  const config = { selectedGid, hoveredGid, showContext: false };
  const nodes = [node(selectedGid, 220, 220), node(hoveredGid, 650, 420), node('other', 100, 100)];
  const first = planGraphLabels(nodes, 900, 640, config);
  const enlarged = planGraphLabels(nodes.map((value) => ({ ...value, radius: value.radius * 4 })), 900, 640, config);
  assert.deepEqual(first.map(({ text, kind, width, height }) => ({ text, kind, width, height })), enlarged.map(({ text, kind, width, height }) => ({ text, kind, width, height })));
  assert.deepEqual(first.map((label) => label.text), [selectedGid, hoveredGid]);
  assert.ok(first.every((label) => label.height === 22));
  assertClear(enlarged, nodes.map((value) => ({ ...value, radius: value.radius * 4 })), 900, 640);
});

test('context suffixes expand to disambiguate IDs, including an offscreen node with the same suffix', () => {
  const nodes = [node('100000001123456', 150, 150), node('100000002123456', 500, 150), node('100000003123456', -100, 100)];
  const labels = planGraphLabels(nodes, 800, 500, options);
  assert.deepEqual(labels.map((label) => label.text), ['…1123456', '…2123456']);
  assert.equal(new Set(labels.map((label) => label.text)).size, labels.length);
});

test('hovering the selected node yields one label and context toggling suppresses unrelated labels', () => {
  const nodes = [node('100000000000000001', 350, 250), node('100000000000000002', 150, 100)];
  const labels = planGraphLabels(nodes, 800, 600, { selectedGid: nodes[0].gid, hoveredGid: nodes[0].gid, showContext: false });
  assert.equal(labels.length, 1);
  assert.equal(labels[0].kind, 'selected');
  assert.deepEqual(planGraphLabels(nodes, 800, 600, { ...options, showContext: false }), []);
});

test('hidden or invalid viewport geometry yields no labels instead of invalid CSS coordinates', () => {
  const nodes = [node('a', 20, 20), node('b', NaN, 100), node('c', 100, Infinity)];
  assert.deepEqual(planGraphLabels(nodes, 0, 0, options), []);
  assert.deepEqual(planGraphLabels(nodes, NaN, 300, options), []);
  assert.deepEqual(planGraphLabels(nodes, 8, 8, options), []);
});

test('selected and hovered callouts escape a dense core and retain their source anchors', () => {
  const selected = node('100000003684369100', 450, 320, 12, 0.9);
  const hovered = node('100000003684369101', 476, 320, 12, 0.8);
  const core = Array.from({ length: 81 }, (_, i) => node(
    `200000${String(i).padStart(12, '0')}`, 450 + (i % 9 - 4) * 26, 320 + (Math.floor(i / 9) - 4) * 26, 15,
  ));
  const nodes = [selected, hovered, ...core];
  const labels = planGraphLabels(nodes, 900, 640, { selectedGid: selected.gid, hoveredGid: hovered.gid, showContext: false });
  assert.equal(labels.length, 2);
  assert.deepEqual(labels.map(({ anchorX, anchorY }) => [anchorX, anchorY]), [[selected.x, selected.y], [hovered.x, hovered.y]]);
  for (const label of labels) {
    assert.ok(Math.hypot(label.left + label.width / 2 - label.anchorX, label.top + label.height / 2 - label.anchorY) > 100);
  }
  assertClear(labels, nodes, 900, 640);
});

test('selected callout finds diagonal free space when extended cardinal positions remain blocked', () => {
  const selected = node('9223372036854775807', 700, 500, 12, 1);
  const obstacles = Array.from({ length: 15 }, (_, i) => [
    node(`horizontal-${i}`, 280 + i * 60, 500, 42),
    node(`vertical-${i}`, 700, 80 + i * 60, 42),
  ]).flat();
  const nodes = [selected, ...obstacles];
  const labels = planGraphLabels(nodes, 1400, 1000, { ...options, selectedGid: selected.gid, showContext: false });
  assert.equal(labels.length, 1);
  assert.equal(labels[0].text, selected.gid);
  assert.ok(Math.abs(labels[0].left + labels[0].width / 2 - selected.x) > 50);
  assert.ok(Math.abs(labels[0].top + labels[0].height / 2 - selected.y) > 40);
  assertClear(labels, nodes, 1400, 1000);
});
