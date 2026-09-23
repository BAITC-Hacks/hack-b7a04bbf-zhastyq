export interface LabelCandidate {
  gid: string;
  x: number;
  y: number;
  radius: number;
  priority: number;
}

export interface GraphLabel {
  gid: string;
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  kind: 'selected' | 'hovered' | 'context';
}

interface LabelOptions {
  selectedGid: string | null;
  hoveredGid: string | null;
  showContext: boolean;
}

const HEIGHT = 22;
const INSET = 6;
const NODE_GAP = 4;
const LABEL_GAP = 4;
const MAX_CONTEXT = 12;

function contextText(gid: string, gids: string[]): string {
  if (gid.length <= 9) return gid;
  let length = 6;
  while (length < gid.length && gids.some((other) => other !== gid && other.endsWith(gid.slice(-length)))) length += 1;
  return length >= gid.length - 1 ? gid : `…${gid.slice(-length)}`;
}

function overlapsLabel(a: GraphLabel, b: GraphLabel): boolean {
  return a.left < b.left + b.width + LABEL_GAP && a.left + a.width + LABEL_GAP > b.left
    && a.top < b.top + b.height + LABEL_GAP && a.top + a.height + LABEL_GAP > b.top;
}

function overlapsNode(label: GraphLabel, node: LabelCandidate): boolean {
  const nearestX = Math.max(label.left, Math.min(node.x, label.left + label.width));
  const nearestY = Math.max(label.top, Math.min(node.y, label.top + label.height));
  return (node.x - nearestX) ** 2 + (node.y - nearestY) ** 2 < (node.radius + NODE_GAP) ** 2;
}

/** Labels use viewport pixels, so zooming the graph never enlarges their type. */
export function planGraphLabels(
  nodes: LabelCandidate[],
  width: number,
  height: number,
  options: LabelOptions,
): GraphLabel[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= INSET * 2 || height <= INSET * 2) return [];
  const unique = new Map<string, LabelCandidate>();
  for (const node of nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.radius)) continue;
    if (!unique.has(node.gid)) unique.set(node.gid, { ...node, radius: Math.max(0, node.radius) });
  }
  const validNodes = [...unique.values()];
  const gids = validNodes.map((node) => node.gid);
  const kindFor = (gid: string): GraphLabel['kind'] => gid === options.selectedGid ? 'selected'
    : gid === options.hoveredGid ? 'hovered' : 'context';
  const order = { selected: 0, hovered: 1, context: 2 };
  const candidates = validNodes.filter((node) => node.x >= 0 && node.y >= 0 && node.x <= width && node.y <= height)
    .filter((node) => options.showContext || kindFor(node.gid) !== 'context')
    .sort((a, b) => order[kindFor(a.gid)] - order[kindFor(b.gid)]
      || (Number.isFinite(b.priority) ? b.priority : 0) - (Number.isFinite(a.priority) ? a.priority : 0)
      || (a.gid < b.gid ? -1 : a.gid > b.gid ? 1 : 0));
  const labels: GraphLabel[] = [];
  let contextCount = 0;
  for (const node of candidates) {
    const kind = kindFor(node.gid);
    if (kind === 'context' && contextCount >= MAX_CONTEXT) continue;
    const text = kind === 'context' ? contextText(node.gid, gids) : node.gid;
    const labelWidth = Math.ceil(text.length * 7.2 + 12);
    const fits = (label: GraphLabel) => label.left >= INSET && label.top >= INSET
      && label.left + label.width <= width - INSET && label.top + HEIGHT <= height - INSET
      && !labels.some((existing) => overlapsLabel(label, existing))
      && !validNodes.some((other) => overlapsNode(label, other));
    const makeLabel = (left: number, top: number): GraphLabel => ({
      gid: node.gid, text, left, top, width: labelWidth, height: HEIGHT,
      anchorX: node.x, anchorY: node.y, kind,
    });
    // A selected node in a dense hub may need a callout outside its immediate cluster.
    const gaps = kind === 'context' ? [6] : [6, 18, 34, 58, 90, 130, 180, 240];
    let placed: GraphLabel | undefined;
    for (const gap of gaps) {
      const positions = [
        { left: node.x - labelWidth / 2, top: node.y + node.radius + gap },
        { left: node.x - labelWidth / 2, top: node.y - node.radius - gap - HEIGHT },
        { left: node.x + node.radius + gap, top: node.y - HEIGHT / 2 },
        { left: node.x - node.radius - gap - labelWidth, top: node.y - HEIGHT / 2 },
      ];
      for (const position of positions) {
        const label = makeLabel(position.left, position.top);
        if (!fits(label)) continue;
        placed = label;
        break;
      }
      if (placed) break;
    }
    if (!placed && kind !== 'context' && labelWidth + INSET * 2 <= width && HEIGHT + INSET * 2 <= height) {
      // Look diagonally as well when all four cardinal directions are occupied.
      // The fixed grid stays deterministic; viewport edges are included explicitly.
      const xs = [width - INSET - labelWidth];
      const ys = [height - INSET - HEIGHT];
      for (let left = INSET; left <= width - INSET - labelWidth; left += 24) xs.push(left);
      for (let top = INSET; top <= height - INSET - HEIGHT; top += 24) ys.push(top);
      const alternatives = xs.flatMap((left) => ys.map((top) => ({
        left, top, distance: (left + labelWidth / 2 - node.x) ** 2 + (top + HEIGHT / 2 - node.y) ** 2,
      })));
      alternatives.sort((a, b) => a.distance - b.distance || a.top - b.top || a.left - b.left);
      for (const alternative of alternatives) {
        const label = makeLabel(alternative.left, alternative.top);
        if (!fits(label)) continue;
        placed = label;
        break;
      }
    }
    if (placed) {
      labels.push(placed);
      if (kind === 'context') contextCount += 1;
    }
  }
  return labels;
}
