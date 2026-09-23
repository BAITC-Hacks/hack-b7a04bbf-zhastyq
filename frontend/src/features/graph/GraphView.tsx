import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type StylesheetJson } from 'cytoscape';
import type { GraphViewProps, Role } from '../../shared/contracts';
import { graphElements } from './graphModel';
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
        label: '', color: token('--graph-label-color'),
        'font-family': token('--font-ui'), 'font-size': number('--graph-label-size'),
        'font-weight': 400, 'text-valign': 'bottom', 'text-margin-y': 5,
        'text-background-color': token('--graph-label-bg'), 'text-background-opacity': 0.95,
        'text-background-padding': '2px', 'min-zoomed-font-size': 8, 'overlay-opacity': 0,
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
      { selector: 'node.is-selected, node.is-hovered, node.show-label', style: { label: 'data(label)' } },
      { selector: 'node.is-dimmed', style: { opacity: number('--graph-dimmed-node-opacity') } },
      { selector: 'edge', style: {
        width: 'data(width)', 'line-color': token('--graph-edge-color'), opacity: number('--graph-edge-opacity'),
        'target-arrow-color': token('--graph-arrow-color'), 'target-arrow-shape': 'triangle',
        'arrow-scale': number('--graph-arrow-scale'), 'curve-style': 'bezier', 'overlay-opacity': 0,
      } },
      { selector: 'edge.is-path', style: {
        'line-color': token('--graph-path-color'), 'target-arrow-color': token('--graph-path-color'),
        opacity: number('--graph-path-opacity'),
      } },
      { selector: 'edge.is-dimmed', style: { opacity: number('--graph-dimmed-edge-opacity') } },
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

    const updateLabels = () => cy.nodes().toggleClass('show-label', cy.zoom() >= 1.6);
    const fit = () => {
      fitGraph(cy, number('--graph-layout-padding'));
      updateLabels();
    };
    cy.on('tap', 'node', (event) => selectRef.current(event.target.id()));
    cy.on('mouseover', 'node', (event) => { event.target.addClass('is-hovered'); container.style.cursor = 'pointer'; });
    cy.on('mouseout', 'node', (event) => { event.target.removeClass('is-hovered'); container.style.cursor = ''; });
    cy.on('zoom', updateLabels);
    const layout = cy.layout({
      name: token('--graph-layout'), animate: false, fit: false, randomize: true,
      padding: number('--graph-layout-padding'),
      componentSpacing: number('--graph-component-spacing'),
      idealEdgeLength: (edge: cytoscape.EdgeSingular) => number(edge.data('sameCluster') ? '--graph-edge-length-intra' : '--graph-edge-length-inter'),
      nodeRepulsion: () => 2048,
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
      layout.stop();
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [graph, hasNodes]);

  useEffect(() => {
    if (cyRef.current) applySelection(cyRef.current, selectedGid);
  }, [graph, hasNodes, selectedGid]);

  const stateMessage = loading ? 'Загрузка графа…' : !graph ? 'Граф пока не загружен'
    : !graph.nodes.length ? 'Для выбранного клиента связи не найдены' : null;

  return (
    <section className="aml-graph" aria-label="Граф денежных переводов">
      <div className="aml-graph__header">
        <p>Стрелка указывает получателя</p>
        {hasNodes && <button type="button" className="aml-graph__fit" onClick={() => {
          const cy = cyRef.current;
          if (!cy) return;
          fitGraph(cy, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--graph-layout-padding')));
        }}>Весь срез</button>}
      </div>
      {stateMessage ? <div className="aml-graph__state" role="status">{stateMessage}</div> : <>
        {selectedMissing && <p className="aml-graph__notice" role="status">Выбранный gid отсутствует в показанном срезе.</p>}
        <div ref={containerRef} className="aml-graph__canvas" aria-label="Ориентированный граф переводов" />
        <div className="aml-graph__legend" aria-label="Легенда ролей">
          {roles.map(({ role, label }) => <span className="aml-graph__legend-item" key={role}>
            <span className="aml-graph__swatch" style={{ backgroundColor: 'var(--role-' + role + ')' }} aria-hidden="true" />{label}
          </span>)}
        </div>
      </>}
    </section>
  );
}
