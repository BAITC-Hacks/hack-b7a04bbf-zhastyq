import { useEffect, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import type { GraphSlice, GraphViewProps, Role } from '../../shared/contracts';
import './GraphView.css';

const roleLegend: { role: Role; label: string; color: string }[] = [
  { role: 'consolidator', label: 'Консолидация', color: '#0d9488' },
  { role: 'transit', label: 'Транзит', color: '#2563eb' },
  { role: 'distributor', label: 'Распределение', color: '#ea580c' },
  { role: 'terminal', label: 'Конечный получатель', color: '#7c3aed' },
  { role: 'coordinator', label: 'Координация', color: '#dc2626' },
  { role: 'peripheral', label: 'Периферия', color: '#64748b' },
];

function toElements(graph: GraphSlice) {
  const gids = new Set(graph.nodes.map((node) => node.gid));

  return [
    ...graph.nodes.map((node) => ({
      group: 'nodes' as const,
      data: { id: node.gid, label: node.gid, role: node.role },
    })),
    ...graph.edges
      .filter((edge) => gids.has(edge.source) && gids.has(edge.target))
      .map((edge, index) => ({
        group: 'edges' as const,
        data: {
          id: `transfer:${index}:${edge.source}:${edge.target}`,
          source: edge.source,
          target: edge.target,
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

    const cy = cytoscape({
      container: containerRef.current,
      elements: toElements(graph),
      layout: {
        name: 'breadthfirst',
        directed: true,
        padding: 48,
        spacingFactor: 1.3,
      },
      minZoom: 0.2,
      maxZoom: 2,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#64748b',
            'border-color': '#ffffff',
            'border-width': 2,
            color: '#172033',
            label: 'data(label)',
            'font-size': 11,
            'font-weight': 600,
            'text-margin-y': 5,
            'text-valign': 'bottom',
            'text-background-color': '#ffffff',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            width: 34,
            height: 34,
          },
        },
        ...roleLegend.map(({ role, color }) => ({
          selector: `node[role = "${role}"]`,
          style: { 'background-color': color },
        })),
        {
          selector: 'node.is-selected',
          style: {
            'border-color': '#111827',
            'border-width': 5,
            width: 44,
            height: 44,
            'font-weight': 700,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#94a3b8',
            'target-arrow-color': '#64748b',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.25,
            'curve-style': 'bezier',
          },
        },
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

    cy.nodes().removeClass('is-selected');
    if (selectedGid !== null) {
      cy.getElementById(selectedGid).addClass('is-selected');
    }
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
            {roleLegend.map(({ role, label, color }) => (
              <span className="aml-graph__legend-item" key={role}>
                <span className="aml-graph__swatch" style={{ backgroundColor: color }} aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
