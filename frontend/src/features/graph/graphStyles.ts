import type { StylesheetJson, Css } from 'cytoscape';
import { roles, stableHash, type GraphDisplay } from './graphModel';

const shapes = new Set(['ellipse', 'hexagon', 'triangle', 'round-rectangle', 'diamond', 'octagon']);

export function readGraphTokens(container: HTMLElement) {
  const root = getComputedStyle(document.documentElement);
  const local = getComputedStyle(container);
  // Root owns the design system. Local overrides are limited to this graph block.
  const token = (name: string) => local.getPropertyValue(name).trim() || root.getPropertyValue(name).trim();
  const number = (name: string, fallback: number, min = 0, max = 10000) => {
    const value = Number.parseFloat(token(name));
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));
  };
  const color = (name: string) => {
    const value = token(name);
    return CSS.supports('color', value) && !value.includes('var(') ? value : token('--color-text');
  };
  const shape = (role: string) => {
    const value = token('--role-' + role + '-shape');
    return (shapes.has(value) ? value : 'ellipse') as Css.NodeShape;
  };
  const scale = number('--graph-overview-node-scale', 1, 0.1, 2);
  const edgeScale = number('--graph-overview-edge-scale', 1, 0.1, 2);
  const minNode = number('--graph-node-min-size', 1, 1, 40) * scale;
  const minEdge = number('--graph-edge-min-width', 0.1, 0.1, 4) * edgeScale;
  return { token, number, color, shape, sizes: {
    minNode, maxNode: Math.max(minNode, number('--graph-node-max-size', minNode, 1, 40) * scale),
    minEdge, maxEdge: Math.max(minEdge, number('--graph-edge-max-width', minEdge, 0.1, 4) * edgeScale),
    defaultEdge: number('--graph-edge-default-width', minEdge, 0.1, 4) * edgeScale,
  } };
}

export type GraphTokens = ReturnType<typeof readGraphTokens>;

// Separate palette: cluster colors never borrow a role swatch. Generated only from cluster id.
export function clusterColor(cluster: number) {
  return `hsl(${stableHash('cluster:' + String(cluster)) % 360}, 42%, 56%)`;
}

export function graphStyles(t: GraphTokens, display: GraphDisplay): StylesheetJson {
  const { token, number, color } = t;
  return [
    { selector: 'node', style: {
      shape: 'ellipse', width: 'data(renderDiameter)', height: 'data(renderDiameter)',
      'background-color': color('--role-peripheral'), opacity: number('--graph-node-opacity', 1, 0, 1),
      'border-color': color('--graph-node-border'), 'border-width': number('--graph-node-border-width', 0),
      label: '', color: color('--graph-label-color'), 'font-family': token('--font-ui'),
      'font-size': number('--graph-label-size', 12, 8, 24), 'text-valign': 'bottom', 'text-margin-y': 5,
      'text-background-color': color('--graph-label-bg'), 'text-background-opacity': 0.94,
      'text-background-padding': '2px', 'min-zoomed-font-size': 9, 'overlay-opacity': 0,
      'transition-property': 'opacity, border-width', 'transition-duration': '120ms',
    } },
    ...roles.map(role => ({ selector: `node[role = "${role}"]`, style: {
      shape: t.shape(role), 'background-color': color('--role-' + role),
    } })),
    ...(display.color === 'cluster' ? [{ selector: 'node', style: {
      'background-color': 'data(clusterColor)',
    } }] : []),
    { selector: 'node.is-seed', style: {
      'border-style': 'double', 'border-width': number('--graph-seed-border-width', 1) * 2.5,
      'border-color': color('--graph-seed-border-color'),
    } },
    { selector: 'node.is-neighbor', style: {
      'border-width': number('--graph-neighbor-border-width', 1), 'border-color': color('--graph-neighbor-color'),
    } },
    { selector: 'node.is-selected, node.is-hovered', style: {
      'border-width': number('--graph-selected-border-width', 1), 'border-color': color('--graph-selected-color'),
      'underlay-color': color('--graph-selected-halo-color'), 'underlay-opacity': number('--graph-selected-halo-opacity', 0.1, 0, 1),
      'underlay-padding': number('--graph-selected-halo-padding', 3), 'underlay-shape': 'ellipse', 'z-index': 5,
    } },
    { selector: 'node.is-seed.is-selected, node.is-seed.is-hovered, node.is-seed.is-neighbor', style: {
      'border-width': number('--graph-seed-border-width', 1) * 2.5,
    } },
    { selector: 'node.show-label', style: { label: display.labels ? 'data(label)' : '' } },
    { selector: 'node.is-selected, node.is-hovered', style: { label: 'data(label)', 'min-zoomed-font-size': 0 } },
    { selector: 'node.is-dimmed', style: { opacity: number('--graph-dimmed-node-opacity', 0.2, 0, 1) } },
    { selector: 'edge', style: {
      width: 'data(width)', 'line-color': color('--graph-edge-color'),
      opacity: display.edgeOpacity * number('--graph-edge-opacity', 1, 0, 1),
      'target-arrow-color': color('--graph-arrow-color'), 'target-arrow-shape': display.arrows ? 'triangle' : 'none',
      'arrow-scale': number('--graph-arrow-scale', 0.5, 0.1, 2), 'curve-style': 'straight',
      'control-point-step-size': 24, 'overlay-opacity': 0,
    } },
    { selector: 'edge[?reciprocal]', style: { 'curve-style': 'bezier' } },
    // While moving thousands of nodes, avoid per-frame boundary/arrow intersections.
    // Focused edges keep their direction; all other arrows return as soon as motion settles.
    { selector: 'edge.is-moving', style: { 'curve-style': 'haystack', 'haystack-radius': 0, 'target-arrow-shape': 'none' } },
    { selector: 'edge.is-path', style: {
      'curve-style': 'bezier', 'target-arrow-shape': display.arrows ? 'triangle' : 'none',
      'line-color': color('--graph-path-color'), 'target-arrow-color': color('--graph-path-color'),
      opacity: number('--graph-path-opacity', 1, 0, 1),
      'arrow-scale': Math.max(0.85, number('--graph-arrow-scale', 0.5, 0.1, 2)),
      width: 'data(focusWidth)', 'z-index': 3,
    } },
    { selector: 'edge.is-dimmed', style: { opacity: display.edgeOpacity * number('--graph-edge-opacity', 1, 0, 1) * number('--graph-dimmed-edge-opacity', 0.15, 0, 1) } },
    { selector: '.is-filtered', style: { display: 'none' } },
    ...(matchMedia('(prefers-reduced-motion: reduce)').matches
      ? [{ selector: 'node', style: { 'transition-duration': '0ms' } }] : []),
  ] as StylesheetJson;
}
