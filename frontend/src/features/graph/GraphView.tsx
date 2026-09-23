import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type StylesheetJson } from 'cytoscape';
import type { GraphViewProps, Role } from '../../shared/contracts';
import { graphElements } from './graphModel';
import { planGraphLabels, type GraphLabel } from './graphLabels';
import './GraphView.css';

const roles: { role: Role; label: string }[] = [
  { role: 'consolidator', label: 'Консолидация' },
  { role: 'transit', label: 'Транзит' },
  { role: 'distributor', label: 'Распределение' },
  { role: 'terminal', label: 'Конечный получатель' },
  { role: 'coordinator', label: 'Координация' },
  { role: 'peripheral', label: 'Периферия' },
];

function applySelection(cy: Core, gid: string | null) {
  cy.batch(() => {
    cy.elements().removeClass('is-selected is-neighbor is-dimmed is-path');
    if (gid === null) return;
    const selected = cy.getElementById(gid);
    if (!selected.length) return;
    cy.elements().addClass('is-dimmed');
    selected.removeClass('is-dimmed').addClass('is-selected');
    const neighbors = selected.neighborhood();
    neighbors.nodes().removeClass('is-dimmed').addClass('is-neighbor');
    neighbors.edges().removeClass('is-dimmed').addClass('is-path');
  });
}

function fitGraph(cy: Core, padding: number) {
  cy.resize();
  const bounds = cy.nodes().boundingBox({ includeLabels: false, includeOverlays: false, includeUnderlays: false });
  const inset = Math.min(padding, cy.height() / 8);
  const zoom = Math.max(cy.minZoom(), Math.min(1.4,
    (cy.width() - 2 * inset) / Math.max(bounds.w, 1),
    (cy.height() - 2 * inset) / Math.max(bounds.h, 1)));
  cy.viewport({ zoom, pan: {
    x: cy.width() / 2 - zoom * (bounds.x1 + bounds.x2) / 2,
    y: cy.height() / 2 - zoom * (bounds.y1 + bounds.y2) / 2,
  } });
}

export default function GraphView({ graph, selectedGid, loading, onSelectGid }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [labels, setLabels] = useState<GraphLabel[]>([]);
  const [showContext, setShowContext] = useState(true);
  const [zoomPercent, setZoomPercent] = useState(100);
  const labelOptionsRef = useRef(showContext);
  labelOptionsRef.current = showContext;
  const refreshLabelsRef = useRef<(() => void) | null>(null);
  const selectRef = useRef(onSelectGid);
  selectRef.current = onSelectGid;
  const selectionRef = useRef(selectedGid);
  selectionRef.current = selectedGid;
  const hasNodes = !loading && graph !== null && graph.nodes.length > 0;
  const selectedMissing = hasNodes && selectedGid !== null && !graph.nodes.some((node) => node.gid === selectedGid);

  useEffect(() => {
    const container = containerRef.current;
    if (!hasNodes || !container || !graph) return;
    const root = getComputedStyle(document.documentElement);
    const token = (name: string) => root.getPropertyValue(name).trim();
    const number = (name: string) => Number.parseFloat(token(name));

    const style: StylesheetJson = [
      { selector: 'node', style: {
        shape: 'ellipse', width: 'data(diameter)', height: 'data(diameter)',
        'background-color': token('--role-peripheral'), opacity: number('--graph-node-opacity'),
        'border-color': token('--graph-node-border'), 'border-width': number('--graph-node-border-width'),
        // Labels live in a fixed-size screen overlay, independent of camera zoom.
        label: '', 'overlay-opacity': 0,
      } },
      ...roles.map(({ role }) => ({ selector: 'node[role = "' + role + '"]', style: { 'background-color': token('--role-' + role) } })),
      { selector: 'node.is-seed', style: {
        'border-width': number('--graph-seed-border-width'), 'border-color': token('--graph-seed-border-color'),
      } },
      { selector: 'node.is-neighbor', style: {
        'border-width': number('--graph-neighbor-border-width'), 'border-color': token('--graph-neighbor-color'),
      } },
      { selector: 'node.is-selected', style: {
        'border-width': number('--graph-selected-border-width'), 'border-color': token('--graph-selected-color'),
        'underlay-color': token('--graph-selected-halo-color'), 'underlay-opacity': number('--graph-selected-halo-opacity'),
        'underlay-padding': number('--graph-selected-halo-padding'), 'underlay-shape': 'ellipse',
      } },
      { selector: 'node.is-hovered', style: {
        'border-width': 2, 'border-color': token('--graph-selected-color'),
      } },
      { selector: 'node.is-dimmed', style: { opacity: number('--graph-dimmed-node-opacity') } },
      { selector: 'edge', style: {
        width: 'data(width)', 'line-color': token('--graph-edge-color'), opacity: number('--graph-edge-opacity'),
        'target-arrow-color': token('--graph-arrow-color'), 'target-arrow-shape': 'triangle',
        'arrow-scale': number('--graph-arrow-scale'), 'curve-style': 'bezier', 'overlay-opacity': 0,
      } },
      { selector: 'edge.is-path', style: {
        'line-color': token('--graph-path-color'), 'target-arrow-color': token('--graph-path-color'),
        opacity: graph.edges.length > 40 ? 0.55 : number('--graph-path-opacity'),
      } },
      { selector: 'edge.is-dimmed', style: { opacity: number('--graph-dimmed-edge-opacity') } },
      { selector: 'edge.is-hover-path', style: {
        opacity: 1, 'line-color': token('--graph-selected-color'), 'target-arrow-color': token('--graph-selected-color'),
      } },
    ];

    const cy = cytoscape({
      container,
      elements: graphElements(graph, {
        minNode: number('--graph-node-min-size'), maxNode: number('--graph-node-max-size'),
        minEdge: number('--graph-edge-min-width'), maxEdge: number('--graph-edge-max-width'),
        defaultEdge: number('--graph-edge-default-width'),
      }),
      style, minZoom: 0.08, maxZoom: 4, boxSelectionEnabled: false,
      autounselectify: true, layout: { name: 'preset' },
    });
    cyRef.current = cy;

    let labelFrame = 0;
    let hoveredGid: string | null = null;
    let strokeScale = 1;
    const priorities = new Map(graph.nodes.map((node) => [node.gid, node.priority_score]));
    const updateLabels = () => {
      cancelAnimationFrame(labelFrame);
      labelFrame = requestAnimationFrame(() => {
        if (cy.destroyed()) return;
        const nextScale = Math.max(1, cy.zoom());
        if (nextScale !== strokeScale) {
          strokeScale = nextScale;
          cy.batch(() => cy.edges().forEach((edge) => {
            edge.style({ width: edge.data('width') / strokeScale, 'arrow-scale': number('--graph-arrow-scale') / strokeScale });
          }));
        }
        const next = planGraphLabels(cy.nodes().map((node) => {
          const point = node.renderedPosition();
          return { gid: node.id(), x: point.x, y: point.y, radius: node.renderedWidth() / 2 + 3,
            priority: priorities.get(node.id()) ?? 0 };
        }), cy.width(), cy.height(), { selectedGid: selectionRef.current, hoveredGid,
          showContext: labelOptionsRef.current });
        setLabels(next);
        setZoomPercent(Math.round(cy.zoom() * 100));
      });
    };
    refreshLabelsRef.current = updateLabels;
    const fit = () => {
      fitGraph(cy, number('--graph-layout-padding'));
      updateLabels();
    };
    cy.on('tap', 'node', (event) => selectRef.current(event.target.id()));
    cy.on('mouseover', 'node', (event) => {
      hoveredGid = event.target.id(); event.target.addClass('is-hovered');
      event.target.connectedEdges().addClass('is-hover-path'); container.style.cursor = 'pointer'; updateLabels();
    });
    cy.on('mouseout', 'node', (event) => {
      hoveredGid = null; event.target.removeClass('is-hovered');
      cy.edges().removeClass('is-hover-path'); container.style.cursor = ''; updateLabels();
    });
    cy.on('zoom pan position', updateLabels);
    const density = Math.min(2.4, Math.max(1, Math.sqrt(graph.nodes.length / 24)));
    const layout = cy.layout({
      name: token('--graph-layout'), animate: false, fit: false, randomize: true,
      padding: number('--graph-layout-padding'),
      componentSpacing: number('--graph-component-spacing'),
      idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
        const base = number(edge.data('sameCluster') ? '--graph-edge-length-intra' : '--graph-edge-length-inter');
        const degree = Math.max(edge.source().degree(false), edge.target().degree(false));
        return base * density + Math.sqrt(degree) * 5;
      },
      nodeRepulsion: () => 4500 * density, nodeOverlap: 12,
      numIter: number('--graph-layout-iterations'),
      stop: () => { fit(); applySelection(cy, selectionRef.current); },
    } as cytoscape.CoseLayoutOptions);
    layout.run();
    applySelection(cy, selectionRef.current);

    let resizeFrame = 0;
    const resize = new ResizeObserver(() => {
      // Dock resizing changes the viewport, never the node positions.
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    });
    resize.observe(container);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(labelFrame);
      refreshLabelsRef.current = null;
      layout.stop();
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [graph, hasNodes]);

  useEffect(() => {
    if (cyRef.current) applySelection(cyRef.current, selectedGid);
    refreshLabelsRef.current?.();
  }, [graph, hasNodes, selectedGid, showContext]);

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  const stateMessage = loading ? 'Загрузка графа…' : !graph ? 'Граф пока не загружен'
    : !graph.nodes.length ? 'Для выбранного клиента связи не найдены' : null;

  return (
    <section className="aml-graph" aria-label="Граф денежных переводов">
      <div className="aml-graph__header">
        <p>Стрелка → получатель<span className="aml-graph__label-hint"> · Полный gid при наведении</span></p>
        {hasNodes && <div className="aml-graph__controls">
          <label className="aml-graph__label-toggle" title="Дополнительные подписи без пересечений. Выбранный узел и узел под курсором подписаны всегда, когда есть место."><input type="checkbox" checked={showContext} onChange={(event) => setShowContext(event.target.checked)} />Подписи</label>
          <div className="aml-graph__zoom"><button type="button" aria-label="Уменьшить граф" disabled={zoomPercent <= 8} onClick={() => zoomBy(1 / 1.35)}>−</button><output aria-label="Масштаб графа">{zoomPercent}%</output><button type="button" aria-label="Увеличить граф" disabled={zoomPercent >= 400} onClick={() => zoomBy(1.35)}>+</button></div>
          <button type="button" className="aml-graph__fit" onClick={() => {
          const cy = cyRef.current;
          if (!cy) return;
          fitGraph(cy, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--graph-layout-padding')));
        }}>Весь срез</button></div>}
      </div>
      {stateMessage ? <div className="aml-graph__state" role="status">{stateMessage}</div> : <>
        {selectedMissing && <p className="aml-graph__notice" role="status">Выбранный gid отсутствует в показанном срезе.</p>}
        <div className="aml-graph__viewport">
          <div ref={containerRef} className="aml-graph__canvas" aria-label="Ориентированный граф переводов" />
          <svg className="aml-graph__leaders" aria-hidden="true">{labels.filter((label) => label.kind !== 'context' && Number.isFinite(label.anchorX) && Number.isFinite(label.anchorY)).map((label) => <line key={label.gid}
            x1={label.anchorX} y1={label.anchorY}
            x2={Math.max(label.left, Math.min(label.anchorX, label.left + label.width))}
            y2={Math.max(label.top, Math.min(label.anchorY, label.top + label.height))} />)}</svg>
          <div className="aml-graph__labels" aria-hidden="true">{labels.map((label) => <span key={label.gid}
            className={'aml-graph__label aml-graph__label--' + label.kind}
            style={{ left: label.left, top: label.top, width: label.width, height: label.height }}>{label.text}</span>)}</div>
        </div>
        <div className="aml-graph__legend" aria-label="Легенда ролей">
          {roles.map(({ role, label }) => <span className="aml-graph__legend-item" key={role}>
            <span className="aml-graph__swatch" style={{ backgroundColor: 'var(--role-' + role + ')' }} aria-hidden="true" />{label}
          </span>)}
        </div>
      </>}
    </section>
  );
}
