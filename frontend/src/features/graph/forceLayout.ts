import type { GraphForces } from './graphModel';

export type ForceNode = { id: string; x: number; y: number; radius: number };
export type ForceLink = { source: string; target: string; distance: number };
type Particle = ForceNode & { vx: number; vy: number; fx: number; fy: number };
type Quad = { x: number; y: number; size: number; mass: number; sumX: number; sumY: number;
  points: number[]; children: (Quad | undefined)[] | null };

const cell = (x: number, y: number, size: number): Quad => ({ x, y, size, mass: 0, sumX: 0, sumY: 0, points: [], children: null });

function insertChild(quad: Quad, index: number, nodes: Particle[], depth: number) {
  const point = nodes[index]; const half = quad.size / 2;
  const right = point.x >= quad.x + half ? 1 : 0;
  const bottom = point.y >= quad.y + half ? 1 : 0;
  const slot = right + 2 * bottom;
  const child = quad.children![slot] ??= cell(quad.x + right * half, quad.y + bottom * half, half);
  insert(child, index, nodes, depth + 1);
}

function insert(quad: Quad, index: number, nodes: Particle[], depth = 0) {
  const node = nodes[index];
  quad.mass++; quad.sumX += node.x; quad.sumY += node.y;
  if (!quad.children && (!quad.points.length || depth >= 20)) { quad.points.push(index); return; }
  if (!quad.children) {
    quad.children = new Array(4);
    for (const i of quad.points) insertChild(quad, i, nodes, depth);
    quad.points = [];
  }
  insertChild(quad, index, nodes, depth);
}

function buildTree(nodes: Particle[]) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const n of nodes) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); }
  const root = cell(minX - 1, minY - 1, Math.max(maxX - minX, maxY - minY, 1) + 2);
  nodes.forEach((_, i) => insert(root, i, nodes));
  return root;
}

function repel(node: Particle, index: number, quad: Quad, nodes: Particle[], strength: number) {
  if (!quad.mass) return;
  if (!quad.children) {
    for (const other of quad.points) {
      if (other === index) continue;
      const point = nodes[other];
      let dx = node.x - point.x; let dy = node.y - point.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.01) {
        // Antisymmetric deterministic jitter for coincident user-dragged nodes.
        const sign = index < other ? -1 : 1;
        const angle = (Math.min(index, other) + 1) * 2.399963;
        dx = sign * Math.cos(angle) * 0.1; dy = sign * Math.sin(angle) * 0.1;
      }
      const distance = Math.hypot(dx, dy);
      const radius = node.radius + point.radius + 3;
      const force = strength / Math.max(distance * distance, 16)
        + (distance < radius ? (radius - distance) * 0.35 / distance : 0);
      node.fx += dx * force; node.fy += dy * force;
    }
    return;
  }
  const dx = node.x - quad.sumX / quad.mass; const dy = node.y - quad.sumY / quad.mass;
  const squared = dx * dx + dy * dy;
  const contains = node.x >= quad.x && node.x <= quad.x + quad.size && node.y >= quad.y && node.y <= quad.y + quad.size;
  // Barnes–Hut theta=0.8; never aggregate the cell containing the current node.
  if (!contains && quad.size * quad.size < 0.64 * squared) {
    const force = strength * quad.mass / Math.max(squared, 16);
    node.fx += dx * force; node.fy += dy * force;
  } else for (const child of quad.children) if (child) repel(node, index, child, nodes, strength);
}

/** Display-only deterministic force solver: O(iterations × (N log N + E)).
 * Signed Hooke springs are intentional: the installed CoSE implementation squares
 * length error and can attract already-short links when its ideal length increases.
 */
export function settleLayout(input: ForceNode[], inputLinks: ForceLink[], forces: GraphForces, iterations = 300,
  progress?: (positions: { id: string; x: number; y: number }[]) => void) {
  if (!input.length) return [];
  const nodes: Particle[] = input.map(n => ({ ...n, vx: 0, vy: 0, fx: 0, fy: 0 }));
  const indices = new Map(nodes.map((node, i) => [node.id, i]));
  const degrees = new Uint32Array(nodes.length);
  const links = inputLinks.flatMap(link => {
    const source = indices.get(link.source); const target = indices.get(link.target);
    if (source === undefined || target === undefined || source === target) return [];
    degrees[source]++; degrees[target]++;
    return [{ source, target, distance: link.distance }];
  });
  const origin = nodes.reduce((p, node) => ({ x: p.x + node.x / nodes.length, y: p.y + node.y / nodes.length }), { x: 0, y: 0 });
  let quiet = 0;
  const steps = Math.max(1, Math.min(iterations, nodes.length > 1000 ? 200 : 360));
  for (let step = 0; step < steps; step++) {
    const alpha = Math.max(0.06, (1 - step / steps) ** 1.4);
    const tree = buildTree(nodes);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]; n.fx = 0; n.fy = 0;
      repel(n, i, tree, nodes, 80 * forces.repulsion);
      n.fx -= (n.x - origin.x) * forces.center * 0.004;
      n.fy -= (n.y - origin.y) * forces.center * 0.004;
    }
    for (const link of links) {
      const a = nodes[link.source]; const b = nodes[link.target];
      const dx = b.x - a.x; const dy = b.y - a.y; const distance = Math.max(0.01, Math.hypot(dx, dy));
      const spring = (distance - link.distance * forces.distance) * forces.strength * 0.045
        / Math.sqrt(Math.max(degrees[link.source], degrees[link.target], 1));
      const fx = spring * dx / distance; const fy = spring * dy / distance;
      a.fx += fx; a.fy += fy; b.fx -= fx; b.fy -= fy;
    }
    let movement = 0;
    for (const n of nodes) {
      n.vx = (n.vx + n.fx * alpha) * 0.76;
      n.vy = (n.vy + n.fy * alpha) * 0.76;
      const speed = Math.hypot(n.vx, n.vy); const limit = 4 + alpha * 14;
      if (speed > limit) { n.vx *= limit / speed; n.vy *= limit / speed; }
      n.x += n.vx; n.y += n.vy; movement = Math.max(movement, Math.hypot(n.vx, n.vy));
    }
    if (movement < 0.025) quiet++; else quiet = 0;
    if (quiet >= 12) break;
    if (step % 40 === 39 && step + 1 < steps) progress?.(nodes.map(({ id, x, y }) => ({ id, x, y })));
  }
  return nodes.map(({ id, x, y }) => ({ id, x, y }));
}
