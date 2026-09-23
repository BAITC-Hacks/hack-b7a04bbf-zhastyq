import type { ElementDefinition } from 'cytoscape';
import type { GraphForces } from './graphModel';
import { settleLayout } from './forceLayout';

export type LayoutRequest = {
  elements: ElementDefinition[]; forces: GraphForces;
  intra: number; inter: number; iterations: number;
};
export type LayoutResult = { positions: { id: string; x: number; y: number }[]; elapsed: number; done: boolean };

self.onmessage = ({ data }: MessageEvent<LayoutRequest>) => {
  const start = performance.now();
  const nodes = data.elements.filter(e => e.group === 'nodes').map(e => ({
    id: e.data.id!, x: e.position!.x, y: e.position!.y, radius: Math.max(2, e.data.diameter / 2),
  }));
  const links = data.elements.filter(e => e.group === 'edges').map(e => ({
    source: e.data.source!, target: e.data.target!, distance: e.data.sameCluster ? data.intra : data.inter,
  }));
  const positions = settleLayout(nodes, links, data.forces, data.iterations, positions => {
    self.postMessage({ positions, elapsed: performance.now() - start, done: false } satisfies LayoutResult);
  });
  if (positions.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid layout');
  self.postMessage({ positions, elapsed: performance.now() - start, done: true } satisfies LayoutResult);
};
