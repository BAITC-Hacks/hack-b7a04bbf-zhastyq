import { useEffect, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import type { GraphSlice, GraphViewProps, Role } from '../../shared/contracts';
import { getEdgeWidth, getSliceP95 } from './graphUtils';
import './GraphView.css';

const roleLegend: { role: Role; label: string }[] = [
  { role: 'consolidator', label: 'Консолидация' },
  { role: 'transit', label: 'Транзит' },
  { role: 'distributor', label: 'Распределение' },
  { role: 'terminal', label: 'Конечный получатель' },
  { role: 'coordinator', label: 'Координация' },
  { role: 'peripheral', label: 'Периферия' },
];

function toElements(graph: GraphSlice, minWidth: number, maxWidth: number) {
  const gids = new Set(graph.nodes.map((node) => node.gid));
  const p95 = getSliceP95(graph.edges);

  return [
    ...graph.nodes.map((node) => ({
      group: 'nodes' as const,
      classes: node.is_seed ? 'is-seed' : '',
      data: { id: node.gid, label: node.is_seed ? `S ${node.gid}` : node.gid, role: node.role },
    })),
    ...graph.edges
      .filter((edge) => gids.has(edge.source) && gids.has(edge.target))
      .map((edge, index) => ({
        group: 'edges' as const,
        data: {
          id: `transfer:${index}:${edge.source}:${edge.target}`,
          source: edge.source,
          target: edge.target,
          width: getEdgeWidth(edge.sum_kzt, p95, minWidth, maxWidth),
        },
      })),
  ];
}

export default function GraphView({
  graph,
  selectedGid,
  loading,
  onSelectGid,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelectGid);
  onSelectRef.current = onSelectGid;

  const hasNodes = !loading && graph !== null && graph.nodes.length > 0;
  const selectedMissing =
    hasNodes &&
    selectedGid !== null &&
    !graph.nodes.some((node) => node.gid === selectedGid);

  useEffect(() => {
    if (!hasNodes || !containerRef.current || !graph) return;

    const computedStyles = getComputedStyle(document.documentElement);
    const readToken = (name: string) => computedStyles.getPropertyValue(name).trim();
    const readNumber = (name: string) => Number.parseFloat(readToken(name));

    const cy = cytoscape({
      container: containerRef.current,
      elements: toElements(graph, readNumber('--graph-edge-min-width'), readNumber('--graph-edge-max-width')),
      layout: {
        name: 'breadthfirst',
        directed: true,
        padding: 2 * readNumber('--space-6'),
        spacingFactor: 2,
        nodeDimensionsIncludeLabels: true,
      },
      minZoom: 0.2,
      maxZoom: 2,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': readToken('--role-peripheral'),
            'border-color': readToken('--graph-node-border'),
            'border-width': readNumber('--graph-node-border-width'),
            'border-style': readToken('--graph-nonseed-border-style') as cytoscape.Css.Node['border-style'],
            color: readToken('--graph-label-color'),
            label: 'data(label)',
            'font-size': readNumber('--graph-label-size'),
            'font-family': readToken('--font-data'),
            'font-weight': readNumber('--weight-emphasis'),
            'text-margin-y': readNumber('--space-1'),
            'text-valign': 'bottom',
            'text-background-color': readToken('--graph-label-bg'),
            'text-background-opacity': 1,
            'text-background-padding': readToken('--space-1'),
            width: readNumber('--graph-node-size'),
            height: readNumber('--graph-node-size'),
          },
        },
        ...roleLegend.map(({ role }) => ({
          selector: `node[role = "${role}"]`,
          style: {
            'background-color': readToken(`--role-${role}`),
            shape: readToken(`--role-${role}-shape`) as cytoscape.Css.NodeShape,
          },
        })),
        {
          selector: 'node.is-seed',
          style: {
            'border-width': readNumber('--graph-seed-border-width'),
            'border-style': readToken('--graph-seed-border-style') as cytoscape.Css.Node['border-style'],
          },
        },
        {
          selector: 'node.is-neighbor',
          style: {
            'border-color': readToken('--graph-neighbor-color'),
            'border-width': readNumber('--graph-neighbor-border-width'),
          },
        },
        {
          selector: 'node.is-selected',
          style: {
            'border-color': readToken('--graph-selected-color'),
            'border-width': readNumber('--graph-selected-border-width'),
            width: readNumber('--graph-node-selected-size'),
            height: readNumber('--graph-node-selected-size'),
          },
        },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': readToken('--graph-edge-color'),
            'target-arrow-color': readToken('--graph-edge-color'),
            'target-arrow-shape': 'triangle',
            'arrow-scale': readNumber('--graph-arrow-scale'),
            opacity: readNumber('--graph-edge-opacity'),
            'curve-style': 'bezier',
          },
        },
        { selector: 'edge.is-path', style: { opacity: readNumber('--graph-path-opacity') } },
        { selector: 'node.is-dimmed', style: { opacity: readNumber('--graph-dimmed-node-opacity') } },
        { selector: 'edge.is-dimmed', style: { opacity: readNumber('--graph-dimmed-edge-opacity') } },
      ],
    });

    cy.on('tap', 'node', (event) => {
      const gid = event.target.id();
      onSelectRef.current(gid);
    });
    cyRef.current = cy;

    return () => {
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [graph, hasNodes]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().removeClass('is-selected is-neighbor is-dimmed is-path');
      if (selectedGid === null) return;
      const selected = cy.getElementById(selectedGid);
      if (selected.empty() || !selected.isNode()) return;
      cy.elements().addClass('is-dimmed');
      selected.removeClass('is-dimmed').addClass('is-selected');
      selected.neighborhood('node').not(selected).removeClass('is-dimmed').addClass('is-neighbor');
      selected.connectedEdges().removeClass('is-dimmed').addClass('is-path');
    });
  }, [graph, hasNodes, selectedGid]);

  let stateMessage: string | null = null;
  if (loading) stateMessage = 'Загрузка графа…';
  else if (!graph) stateMessage = 'Граф пока не загружен';
  else if (graph.nodes.length === 0) {
    stateMessage = 'Для выбранного клиента связи не найдены';
  }

  return (
    <section className="aml-graph" aria-label="Граф денежных переводов">
      <div className="aml-graph__header">
        <div>
          <h2 className="aml-graph__title">Граф переводов</h2>
          <p className="aml-graph__hint">Стрелка указывает получателя перевода</p>
        </div>
        {hasNodes && (
          <span className="aml-graph__count">
            {graph.nodes.length} узлов · {graph.edges.length} связей
          </span>
        )}
      </div>

      {stateMessage ? (
        <div className="aml-graph__state" role="status">
          {stateMessage}
        </div>
      ) : (
        <>
          {selectedMissing && (
            <p className="aml-graph__notice" role="status">
              Выбранный gid отсутствует в показанном срезе графа.
            </p>
          )}
          <div ref={containerRef} className="aml-graph__canvas" aria-label="Ориентированный граф переводов" />
          <div className="aml-graph__legend" aria-label="Легенда ролей">
            {roleLegend.map(({ role, label }) => (
              <span className="aml-graph__legend-item" key={role}>
                <span className="aml-graph__swatch" style={{ backgroundColor: `var(--role-${role})` }} aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
