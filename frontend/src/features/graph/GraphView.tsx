import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import type { GraphViewProps } from '../../shared/contracts';
import { roleLabels } from '../workspace/labels';
import { defaultDisplay, defaultFilters, defaultForces, roles, visibleGids } from './graphModel';
import { GraphController, type HoverInfo } from './graphController';
import { clusterColor } from './graphStyles';
import { GraphControls, GraphIcon } from './GraphControls';
import './GraphView.css';

export default function GraphView({ graph, selectedGid, loading, onSelectGid }: GraphViewProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const controller = useRef<GraphController | null>(null);
  const selectRef = useRef(onSelectGid);
  selectRef.current = onSelectGid;
  const pendingFocus = useRef<string | null>(null);
  const localSelection = useRef<string | null>(null);
  const selectionContext = useRef({ graph, gid: selectedGid });
  const [filters, setFilters] = useState(defaultFilters);
  const [display, setDisplay] = useState(defaultDisplay);
  const [forces, setForces] = useState(defaultForces);
  const [panelOpen, setPanelOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [searchMessage, setSearchMessage] = useState('');
  const [hiddenMatch, setHiddenMatch] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo>(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const id = useId();
  const visible = useMemo(() => graph ? visibleGids(graph, filters) : new Set<string>(), [graph, filters]);
  const clusters = useMemo(() => [...new Set(graph?.nodes.map(n => n.cluster_id) ?? [])].sort((a, b) => a - b), [graph]);
  const depths = useMemo(() => [...new Set(graph?.nodes.map(n => n.depth) ?? [])].sort((a, b) => a - b), [graph]);
  const selected = graph?.nodes.find(node => node.gid === selectedGid);
  const edgeCount = useMemo(() => graph?.edges.filter(e => visible.has(e.source) && visible.has(e.target)).length ?? 0, [graph, visible]);

  useEffect(() => {
    if (!canvasRef.current || !sectionRef.current) return;
    const instance = new GraphController(canvasRef.current, {
      select: gid => { localSelection.current = gid; selectRef.current(gid); }, hover: setHover,
      layout: (busy, error) => { setLayoutBusy(busy); setLayoutError(error ?? ''); },
    });
    controller.current = instance;
    let wasNarrow: boolean | undefined;
    const resize = new ResizeObserver(([entry]) => {
      const narrow = entry.contentRect.width < 640;
      if (narrow !== wasNarrow) { setPanelOpen(!narrow); wasNarrow = narrow; }
    });
    resize.observe(sectionRef.current);
    return () => { resize.disconnect(); instance.destroy(); controller.current = null; };
  }, []);
  useEffect(() => {
    controller.current?.setGraph(graph, filters);
    if (pendingFocus.current && visible.has(pendingFocus.current)) {
      controller.current?.focus(pendingFocus.current); pendingFocus.current = null;
    }
  }, [graph, filters, visible]);
  useEffect(() => {
    controller.current?.setSelected(selectedGid);
    const previous = selectionContext.current;
    selectionContext.current = { graph, gid: selectedGid };
    const fromGraph = localSelection.current === selectedGid;
    localSelection.current = null;
    // The first graph keeps its overview. Later external searches may select a node
    // outside the viewport; card refreshes and visible graph clicks keep manual framing.
    if (graph && previous.graph === graph && previous.gid !== selectedGid && selectedGid && !fromGraph) {
      controller.current?.focusIfOutside(selectedGid);
    }
  }, [selectedGid, graph]);
  useEffect(() => { controller.current?.setDisplay(display); }, [display]);
  useEffect(() => { controller.current?.setForces(forces); }, [forces]);
  useEffect(() => { controller.current?.setPanel(panelOpen); }, [panelOpen]);
  useEffect(() => { setSearchMessage(''); setHiddenMatch(null); }, [graph]);

  const reveal = (gid: string) => {
    if (!graph?.nodes.some(node => node.gid === gid)) return;
    pendingFocus.current = gid;
    setFilters({ ...defaultFilters }); setHiddenMatch(null);
    setSearchMessage(`Узел ${gid} показан. Фильтры сброшены.`); localSelection.current = gid; onSelectGid(gid);
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    const gid = query.trim(); setHiddenMatch(null);
    if (!gid) { setSearchMessage('Введите полный gid.'); return; }
    if (!graph?.nodes.some(node => node.gid === gid)) {
      setSearchMessage('Узел не найден в загруженном графе. Проверьте полный gid.'); return;
    }
    if (!visible.has(gid)) {
      setHiddenMatch(gid); setSearchMessage(`Узел ${gid} найден, но скрыт фильтрами.`); return;
    }
    controller.current?.focus(gid); localSelection.current = gid; onSelectGid(gid); setSearchMessage(`Найден узел ${gid}.`);
  };
  const reset = () => {
    setFilters({ ...defaultFilters }); setDisplay({ ...defaultDisplay }); setForces({ ...defaultForces });
    setQuery(''); setSearchMessage(''); setHiddenMatch(null); controller.current?.resetLayout();
  };
  const state = loading ? 'Загрузка графа…' : !graph ? 'Граф пока не загружен'
    : !graph.nodes.length ? 'В этом срезе нет узлов' : !visible.size ? 'Нет узлов по выбранным фильтрам' : null;

  return <section ref={sectionRef} className="aml-graph" aria-label="Граф денежных переводов" aria-busy={loading}>
    <div ref={canvasRef} className="aml-graph__canvas" tabIndex={0} role="group"
      aria-label="Граф переводов. Для выбора узла используйте поиск по gid. Клавиши плюс и минус изменяют масштаб, 0 показывает весь срез."
      onKeyDown={event => {
        if (event.key === '+' || event.key === '=') { event.preventDefault(); controller.current?.zoomBy(1.3); }
        if (event.key === '-') { event.preventDefault(); controller.current?.zoomBy(1 / 1.3); }
        if (event.key === '0') { event.preventDefault(); controller.current?.fit(); }
      }} />
    {state && <div className="aml-graph__state" role="status"><span>{state}</span>
      {!!graph?.nodes.length && !visible.size && !loading && <button onClick={() => setFilters({ ...defaultFilters })}>Сбросить фильтры</button>}
    </div>}
    <div className="aml-graph__meta" role="status">
      {graph && !loading && <span>{visible.size} / {graph.nodes.length} узлов · {edgeCount} связей</span>}
      {layoutBusy && <span className="aml-graph__settling">Раскладка…</span>}
    </div>
    {!panelOpen && <button className="aml-graph__open" title="Настройки графа" aria-label="Открыть настройки графа"
      aria-expanded={false} aria-controls={`${id}-controls`} onClick={() => setPanelOpen(true)}><GraphIcon name="settings" /></button>}
    <aside id={`${id}-controls`} className="aml-graph__controls" aria-label="Настройки графа" hidden={!panelOpen}>
      <div className="aml-graph__controls-header"><span>Настройки графа</span><div>
        <button title="Сбросить настройки" aria-label="Сбросить настройки графа" onClick={reset}><GraphIcon name="reset" /></button>
        <button title="Скрыть панель" aria-label="Скрыть настройки графа" aria-expanded={true} aria-controls={`${id}-controls`}
          onClick={() => setPanelOpen(false)}><GraphIcon name="close" /></button>
      </div></div>
      <form className="aml-graph__search" onSubmit={search}>
        <div><input aria-label="Найти узел по gid" placeholder="Найти по gid…" value={query} spellCheck={false}
          aria-describedby={searchMessage ? `${id}-search-status` : undefined}
          onChange={event => { setQuery(event.target.value); setSearchMessage(''); setHiddenMatch(null); }} />
          <button type="submit" title="Найти узел" aria-label="Найти узел"><GraphIcon name="search" /></button></div>
        {searchMessage && <p id={`${id}-search-status`} role="status">{searchMessage}</p>}
        {hiddenMatch && <button className="aml-graph__text-action" type="button" onClick={() => reveal(hiddenMatch)}>Показать узел</button>}
      </form>
      <GraphControls filters={filters} onFilters={setFilters} display={display} onDisplay={setDisplay}
        forces={forces} onForces={setForces} clusters={clusters} depths={depths} />
      <details className="aml-graph__section aml-graph__legend" open>
        <summary>Легенда · {display.color === 'role' ? 'роли' : 'кластеры'}</summary>
        <div className="aml-graph__legend-grid">
          {display.color === 'role' ? roles.map(role => <span key={role}>
            <i className={`aml-graph__swatch aml-graph__swatch--${role}`} style={{ backgroundColor: `var(--role-${role})` }} />{roleLabels[role]}</span>)
            : clusters.map(cluster => <span key={cluster}><i className="aml-graph__swatch" style={{ backgroundColor: clusterColor(cluster) }} />Кластер {cluster}</span>)}
          <span><i className="aml-graph__seed-swatch" />S · исходный узел</span>
        </div>
        {display.color === 'cluster' && <p className="aml-graph__hint">Цвет — кластер. Форма — роль.</p>}
        <p className="aml-graph__hint">Стрелка → получатель. Роли — гипотезы для проверки.</p>
      </details>
    </aside>
    {hover && !state && <div className="aml-graph__tooltip" role="tooltip" style={{
      left: Math.max(8, Math.min(hover.x + 14, (canvasRef.current?.clientWidth ?? 320) - 240)),
      top: Math.max(34, Math.min(hover.y + 14, (canvasRef.current?.clientHeight ?? 200) - 140)),
    }}><strong>{hover.node.is_seed ? 'S ' : ''}{hover.node.gid}</strong>
      <span>{roleLabels[hover.node.role]}</span><span>Кластер {hover.node.cluster_id} · глубина {hover.node.depth}</span>
      <span>Приоритет {Number.isFinite(hover.node.priority_score) ? hover.node.priority_score.toFixed(2) : '—'}</span>
    </div>}
    {selected && !state && <div className="aml-graph__selection" aria-label="Выбранный узел">
      <span>{selected.is_seed ? 'S ' : ''}<strong>{selected.gid}</strong> · {roleLabels[selected.role]} · кластер {selected.cluster_id}</span>
      {!visible.has(selected.gid) && <button onClick={() => reveal(selected.gid)}>Показать скрытый узел</button>}
    </div>}
    {selectedGid && graph && !selected && !loading && <p className="aml-graph__notice" role="status">Выбранный gid отсутствует в этом срезе.</p>}
    {layoutError && <p className="aml-graph__notice" role="alert">{layoutError}</p>}
    <nav className="aml-graph__navigation" aria-label="Навигация по графу">
      <button title="Приблизить" aria-label="Приблизить граф" disabled={!visible.size} onClick={() => controller.current?.zoomBy(1.35)}>+</button>
      <button title="Отдалить" aria-label="Отдалить граф" disabled={!visible.size} onClick={() => controller.current?.zoomBy(1 / 1.35)}>−</button>
      <button title="Весь срез" aria-label="Показать весь срез" disabled={!visible.size} onClick={() => controller.current?.fit()}><GraphIcon name="fit" /></button>
      <button title="Сбросить вид" aria-label="Сбросить вид графа" disabled={!visible.size} onClick={() => controller.current?.resetView()}><GraphIcon name="reset" /></button>
      <button title="К выбранному узлу" aria-label="Фокус на выбранном узле" disabled={!selected || !visible.has(selected.gid)}
        onClick={() => selected && controller.current?.focus(selected.gid)}><GraphIcon name="focus" /></button>
    </nav>
  </section>;
}
