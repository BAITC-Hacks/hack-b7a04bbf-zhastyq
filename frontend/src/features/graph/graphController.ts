import cytoscape, { type Core, type Position, type ElementDefinition } from 'cytoscape';
import type { GraphSlice, NodeSummary } from '../../shared/contracts';
import { defaultDisplay, defaultForces, graphElements, graphIndex, initialPosition, visibleGids,
  type GraphDisplay, type GraphFilters, type GraphForces } from './graphModel';
import { clusterColor, graphStyles, readGraphTokens, type GraphTokens } from './graphStyles';
import type { LayoutRequest, LayoutResult } from './graphLayout.worker';

export type HoverInfo = { node: NodeSummary; x: number; y: number } | null;
type Callbacks = { select: (gid: string) => void; hover: (value: HoverInfo) => void;
  layout: (busy: boolean, error?: string) => void };

/** Owns one renderer for the mounted block; React never handles simulation frames. */
export class GraphController {
  readonly cy: Core;
  private tokens: GraphTokens;
  private graph: GraphSlice | null = null;
  private index = graphIndex({ center_gid: '', nodes: [], edges: [] });
  private visible = new Set<string>();
  private display = defaultDisplay;
  private forces = defaultForces;
  private selected: string | null = null;
  private hovered: string | null = null;
  private topology = '';
  private worker: Worker | null = null;
  private layoutTimer = 0;
  private motionFrame = 0;
  private zoomFrame = 0;
  private resizeFrame = 0;
  private themeFrame = 0;
  private disposed = false;
  private suspended = false;
  private inView = true;
  private pendingLayout = false;
  private needsFit = false;
  private panelOpen = false;
  private detailedLabels = false;
  private motionMode = false;
  private resizeObserver: ResizeObserver;
  private themeObserver: MutationObserver;
  private visibilityObserver: IntersectionObserver;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private colorScheme = matchMedia('(prefers-color-scheme: dark)');

  constructor(private container: HTMLElement, private callbacks: Callbacks) {
    this.tokens = readGraphTokens(container.parentElement!);
    this.cy = cytoscape({ container, elements: [], style: graphStyles(this.tokens, this.display),
      minZoom: 0.025, maxZoom: 6, layout: { name: 'preset' },
      boxSelectionEnabled: false, autounselectify: true, pixelRatio: Math.min(devicePixelRatio, 2) });
    this.cy.on('tap', 'node', event => callbacks.select(event.target.id()));
    this.cy.on('mouseover', 'node', event => {
      this.hovered = event.target.id();
      const node = this.index.nodes.get(this.hovered!);
      if (node) callbacks.hover({ node, ...event.target.renderedPosition() });
      container.style.cursor = 'pointer'; this.highlight();
    });
    this.cy.on('mouseout', 'node', () => this.clearHover());
    this.cy.on('grab', 'node', () => { this.cancelLayout(); this.needsFit = false; this.clearHover(); });
    this.cy.on('tapstart', event => { if (event.target === this.cy) this.needsFit = false; });
    this.cy.on('pan zoom', () => {
      if (this.hovered !== null) this.clearHover();
      this.updateLabels();
    });
    // Do not rebuild the force model for dragging, selecting, resizing or styling.
    this.resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => { this.cy.resize(); });
    });
    this.resizeObserver.observe(container);
    this.themeObserver = new MutationObserver(this.refreshTheme);
    for (const element of [document.documentElement, document.body, container.parentElement!]) {
      this.themeObserver.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    }
    this.visibilityObserver = new IntersectionObserver(entries => {
      this.inView = entries[0]?.isIntersecting ?? true; this.visibilityChanged();
    });
    this.visibilityObserver.observe(container);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.reduced.addEventListener('change', this.refreshTheme);
    this.colorScheme.addEventListener('change', this.refreshTheme);
    container.addEventListener('wheel', this.wheel, { passive: false, capture: true });
  }

  private clearHover() {
    this.hovered = null; this.callbacks.hover(null); this.container.style.cursor = ''; this.highlight();
  }

  private refreshTheme = () => {
    cancelAnimationFrame(this.themeFrame);
    this.themeFrame = requestAnimationFrame(() => {
      this.tokens = readGraphTokens(this.container.parentElement!);
      if (this.graph) this.cy.batch(() => {
        for (const element of graphElements(this.graph!, this.tokens.sizes)) {
          this.cy.getElementById(element.data.id).data(this.renderData(element));
        }
      });
      this.setDisplay(this.display);
    });
  };

  private renderData(element: ElementDefinition) {
    const data = element.data;
    return { ...data, ...(element.group === 'nodes'
      ? { renderDiameter: data.diameter * this.display.nodeScale, clusterColor: clusterColor(data.cluster) }
      : { focusWidth: Math.max(0.85, data.width * 1.4) }) };
  }

  private visibilityChanged = () => {
    const paused = document.hidden || !this.inView;
    if (paused === this.suspended) return;
    this.suspended = paused;
    if (paused) {
      const pending = !!this.worker || !!this.layoutTimer || !!this.motionFrame;
      this.cancelLayout(); this.pendingLayout ||= pending;
      cancelAnimationFrame(this.zoomFrame);
    } else if (this.pendingLayout) this.scheduleLayout();
  };

  setGraph(graph: GraphSlice | null, filters: GraphFilters) {
    this.graph = graph;
    this.index = graphIndex(graph ?? { center_gid: '', nodes: [], edges: [] });
    const elements = graph ? graphElements(graph, this.tokens.sizes) : [];
    const topology = JSON.stringify(elements.map(e => e.group === 'nodes' ? e.data.id : [e.data.id, e.data.source, e.data.target]));
    const changed = topology !== this.topology;
    const nextVisible = graph ? visibleGids(graph, filters) : new Set<string>();
    const filtersChanged = nextVisible.size !== this.visible.size || [...nextVisible].some(id => !this.visible.has(id));
    this.visible = nextVisible;
    if (changed) { this.cancelLayout(); this.topology = topology; }
    const hadNodes = this.cy.nodes().length > 0;
    this.cy.batch(() => {
      const ids = new Set(elements.map(element => element.data.id));
      this.cy.elements().filter(element => !ids.has(element.id())).remove();
      const additions: ElementDefinition[] = [];
      for (const element of elements) {
        const data = this.renderData(element);
        const current = this.cy.getElementById(element.data.id);
        if (current.length) current.data(data);
        else additions.push({ ...element, data, ...(element.group === 'nodes'
          ? { position: initialPosition(element.data.id, this.index.nodes.size) } : {}) });
        if (element.group === 'nodes' && current.length) current.toggleClass('is-seed', element.classes === 'is-seed');
      }
      this.cy.add(additions);
      this.cy.nodes().forEach(node => { node.toggleClass('is-filtered', !this.visible.has(node.id())); });
      this.cy.edges().forEach(edge => {
        edge.toggleClass('is-filtered', !this.visible.has(edge.source().id()) || !this.visible.has(edge.target().id()));
      });
    });
    this.clearHover(); this.updateLabels(true);
    if ((changed || filtersChanged) && this.visible.size) {
      this.needsFit ||= !hadNodes || changed;
      if (changed) this.fit(false);
      this.scheduleLayout();
    } else if (!this.visible.size) this.cancelLayout();
  }

  setSelected(gid: string | null) { this.selected = gid; this.highlight(); }
  setPanel(open: boolean) { this.panelOpen = open; }
  setDisplay(display: GraphDisplay) {
    this.display = display;
    this.cy.batch(() => {
      this.cy.nodes().forEach(node => { node.data('renderDiameter', node.data('diameter') * display.nodeScale); });
      this.cy.style(graphStyles(this.tokens, display));
    });
    this.updateLabels(true);
  }
  setForces(forces: GraphForces) {
    if (JSON.stringify(forces) === JSON.stringify(this.forces)) return;
    this.forces = forces; this.scheduleLayout();
  }

  private updateLabels(force = false) {
    const show = this.cy.zoom() >= 1.7;
    if (force || show !== this.detailedLabels) {
      this.detailedLabels = show; this.cy.nodes().toggleClass('show-label', this.display.labels && show);
    }
  }

  private highlight() {
    const active = this.hovered ?? this.selected;
    this.cy.batch(() => {
      this.cy.elements().removeClass('is-selected is-hovered is-neighbor is-dimmed is-path');
      if (this.selected && this.visible.has(this.selected)) this.cy.getElementById(this.selected).addClass('is-selected');
      if (!active || !this.visible.has(active)) return;
      this.cy.elements().addClass('is-dimmed');
      const node = this.cy.getElementById(active);
      node.removeClass('is-dimmed').toggleClass('is-hovered', active === this.hovered);
      for (const id of this.index.adjacency.get(active) ?? []) {
        if (this.visible.has(id)) this.cy.getElementById(id).removeClass('is-dimmed').addClass('is-neighbor');
      }
      node.connectedEdges().removeClass('is-dimmed').addClass('is-path');
    });
  }

  private cancelLayout() {
    window.clearTimeout(this.layoutTimer); this.layoutTimer = 0;
    this.worker?.terminate(); this.worker = null;
    cancelAnimationFrame(this.motionFrame); this.motionFrame = 0;
    this.setMotionMode(false);
    this.pendingLayout = false;
    if (!this.disposed) this.callbacks.layout(false);
  }

  private setMotionMode(active: boolean) {
    if (active === this.motionMode) return;
    this.motionMode = active;
    this.cy.edges().toggleClass('is-moving', active);
  }

  private scheduleLayout() {
    this.cancelLayout();
    if (!this.visible.size) return;
    if (this.suspended) { this.pendingLayout = true; return; }
    this.callbacks.layout(true);
    this.layoutTimer = window.setTimeout(() => {
      this.layoutTimer = 0;
      this.setMotionMode(this.visible.size > 1000 && !this.reduced.matches);
      const elements = this.cy.elements().not('.is-filtered').map(element => ({
        group: element.group(), data: { ...element.data() },
        ...(element.isNode() ? { position: { ...element.position() } } : {}),
      }));
      try {
        const worker = new Worker(new URL('./graphLayout.worker.ts', import.meta.url), { type: 'module' });
        this.worker = worker;
        worker.onmessage = ({ data }: MessageEvent<LayoutResult>) => {
          if (this.worker !== worker || this.disposed) return;
          if (data.done) { worker.terminate(); this.worker = null; }
          if (data.done || !this.reduced.matches) this.moveToLayout(data.positions, data.done);
        };
        worker.onerror = () => {
          if (this.worker !== worker) return;
          worker.terminate(); this.worker = null;
          this.setMotionMode(false);
          this.callbacks.layout(false, 'Не удалось рассчитать раскладку. Сохранены текущие позиции.');
        };
        worker.postMessage({ elements, forces: this.forces,
          intra: this.tokens.number('--graph-edge-length-intra', 40, 1),
          inter: this.tokens.number('--graph-edge-length-inter', 80, 1),
          iterations: this.tokens.number('--graph-layout-iterations', 400, 1),
        } satisfies LayoutRequest);
      } catch {
        this.worker?.terminate(); this.worker = null;
        this.setMotionMode(false);
        this.callbacks.layout(false, 'Раскладка недоступна в этом браузере. Доступны навигация и перетаскивание.');
      }
    }, 180);
  }

  private moveToLayout(positions: LayoutResult['positions'], done: boolean) {
    cancelAnimationFrame(this.motionFrame);
    const starts = new Map(positions.map(p => [p.id, { ...this.cy.getElementById(p.id).position() }]));
    const target = new Map(positions.map(p => [p.id, p]));
    // Keep the current visual center on adjustment, independent of solver drift.
    let dx = 0; let dy = 0;
    for (const p of positions) { dx += starts.get(p.id)!.x - p.x; dy += starts.get(p.id)!.y - p.y; }
    dx /= Math.max(positions.length, 1); dy /= Math.max(positions.length, 1);
    const start = performance.now();
    const duration = this.reduced.matches ? 0 : done ? 650 : 400;
    const tick = (now: number) => {
      const progress = duration && !this.reduced.matches ? Math.min(1, (now - start) / duration) : 1;
      const ease = progress * progress * (3 - 2 * progress);
      this.cy.nodes().positions(node => {
        const end = target.get(node.id()); const begin = starts.get(node.id());
        if (!end || !begin || node.grabbed()) return node.position();
        return { x: begin.x + (end.x + dx - begin.x) * ease, y: begin.y + (end.y + dy - begin.y) * ease };
      });
      if (progress < 1) this.motionFrame = requestAnimationFrame(tick);
      else {
        this.motionFrame = 0;
        if (done) {
          this.setMotionMode(false);
          this.callbacks.layout(false);
          if (this.needsFit) { this.needsFit = false; this.fit(false); }
        }
      }
    };
    this.motionFrame = requestAnimationFrame(tick);
  }

  private availableWidth() {
    return this.cy.width() - (this.panelOpen && this.cy.width() >= 640 ? 264 : 0);
  }

  fit(animate = true) {
    const nodes = this.cy.nodes().not('.is-filtered');
    if (!nodes.length) return;
    this.cy.resize();
    const bounds = nodes.boundingBox({ includeLabels: false, includeOverlays: false, includeUnderlays: false });
    const width = this.availableWidth(); const height = this.cy.height();
    const padding = Math.min(this.tokens.number('--graph-layout-padding', 32), height / 6);
    const zoom = Math.max(this.cy.minZoom(), Math.min(1.25, (width - 2 * padding) / Math.max(bounds.w, 1),
      (height - 2 * padding - 52) / Math.max(bounds.h, 1)));
    this.viewport(zoom, { x: width / 2 - zoom * (bounds.x1 + bounds.x2) / 2,
      y: (height - 40) / 2 - zoom * (bounds.y1 + bounds.y2) / 2 }, animate);
  }

  focus(gid: string) {
    if (!this.visible.has(gid)) return;
    // A search must not be displaced by a pending layout completion.
    this.cancelLayout(); this.needsFit = false;
    const node = this.cy.getElementById(gid); const zoom = Math.max(1.8, this.cy.zoom());
    this.viewport(zoom, { x: this.availableWidth() / 2 - node.position('x') * zoom,
      y: (this.cy.height() - 40) / 2 - node.position('y') * zoom });
  }

  zoomBy(factor: number) {
    this.needsFit = false;
    this.zoomAt(factor, { x: this.availableWidth() / 2, y: this.cy.height() / 2 });
  }

  private wheel = (event: WheelEvent) => {
    this.needsFit = false;
    event.preventDefault(); event.stopImmediatePropagation();
    const rect = this.container.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    this.zoomAt(Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.0025),
      { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  private zoomAt(factor: number, point: Position) {
    const old = this.cy.zoom(); const pan = this.cy.pan();
    const zoom = Math.max(this.cy.minZoom(), Math.min(this.cy.maxZoom(), old * factor));
    this.viewport(zoom, { x: point.x - (point.x - pan.x) * zoom / old,
      y: point.y - (point.y - pan.y) * zoom / old });
  }

  private viewport(zoom: number, pan: Position, animate = true) {
    cancelAnimationFrame(this.zoomFrame);
    const oldZoom = this.cy.zoom(); const oldPan = { ...this.cy.pan() }; const start = performance.now();
    const duration = animate && !this.reduced.matches ? 170 : 0;
    const tick = (now: number) => {
      const progress = duration ? Math.min(1, (now - start) / duration) : 1;
      const ease = 1 - (1 - progress) ** 3;
      this.cy.viewport({ zoom: oldZoom + (zoom - oldZoom) * ease,
        pan: { x: oldPan.x + (pan.x - oldPan.x) * ease, y: oldPan.y + (pan.y - oldPan.y) * ease } });
      if (progress < 1) this.zoomFrame = requestAnimationFrame(tick);
      else this.zoomFrame = 0;
    };
    this.zoomFrame = requestAnimationFrame(tick);
  }

  resetView() { this.cancelLayout(); this.needsFit = false; this.fit(); }
  resetLayout() {
    // React applies reset filters before the debounced worker starts; fit the resulting graph.
    this.needsFit = true; this.forces = defaultForces; this.scheduleLayout();
  }
  destroy() {
    this.disposed = true; this.cancelLayout();
    for (const frame of [this.zoomFrame, this.resizeFrame, this.themeFrame]) cancelAnimationFrame(frame);
    this.resizeObserver.disconnect(); this.themeObserver.disconnect(); this.visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.reduced.removeEventListener('change', this.refreshTheme);
    this.colorScheme.removeEventListener('change', this.refreshTheme);
    this.container.removeEventListener('wheel', this.wheel, true);
    this.cy.destroy();
  }
}
