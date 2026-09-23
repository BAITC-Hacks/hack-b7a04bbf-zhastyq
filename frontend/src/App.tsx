import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import NodeCard from './features/workspace/NodeCard';
import PriorityIndicator from './features/workspace/PriorityIndicator';
import GraphStatistics from './features/workspace/GraphStatistics';
import AgentDock from './features/workspace/AgentDock';
import DataImport from './features/workspace/DataImport';
import WorkspaceState from './features/workspace/WorkspaceState';
import WorkspaceDock from './features/workspace/WorkspaceDock';
import Icon from './features/workspace/Icon';
import { roleLabels } from './features/workspace/labels';
import { useWorkspace } from './features/workspace/useWorkspace';
import { filterNodes, type NodeFilters } from './features/workspace/workspaceModel';
import { ApiError, exportNames, getExport, type ExportName } from './shared/api/workspace';
import type { Role } from './shared/contracts';

const GraphView = lazy(() => import('./features/graph/GraphView'));
const initialFilters: NodeFilters = { query: '', cluster: 'all', role: 'all', highOnly: false, order: 'priority' };
const compactWorkspace = () => window.matchMedia('(max-width: 1100px)').matches;

export default function App() {
  const workspace = useWorkspace();
  const { nodes, selectedGid, selectedNode, detail, graph, loadingTop, loadingGraph, loadingDetail, topError, nodeError } = workspace;
  const [filters, setFilters] = useState(initialFilters);
  const [searchError, setSearchError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [compact, setCompact] = useState(compactWorkspace);
  const [leftOpen, setLeftOpen] = useState(() => !compactWorkspace());
  const [rightOpen, setRightOpen] = useState(() => !compactWorkspace());
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchPending = useRef(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const clusters = useMemo(() => [...new Set(nodes.map((node) => node.cluster_id))].sort((a, b) => a - b), [nodes]);
  const visible = useMemo(() => filterNodes(nodes, filters), [nodes, filters]);
  const filtered = filters.query !== '' || filters.cluster !== 'all' || filters.role !== 'all' || filters.highOnly;
  const highCount = nodes.filter((node) => node.priority_score >= 0.8).length;

  useEffect(() => { setFilters(initialFilters); setSearchError(''); }, [workspace.analysis?.analysis_id]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1100px)');
    const resize = () => {
      setCompact(query.matches);
      if (query.matches) { setLeftOpen(false); setRightOpen(false); }
    };
    query.addEventListener('change', resize);
    return () => query.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (leftOpen && focusSearchPending.current) {
      searchRef.current?.focus();
      focusSearchPending.current = false;
    }
  }, [leftOpen]);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !target.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        event.preventDefault();
        if (leftOpen) searchRef.current?.focus();
        else { focusSearchPending.current = true; setLeftOpen(true); }
        if (compact) setRightOpen(false);
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [leftOpen, compact]);
  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(''), 5000);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  const select = (gid: string) => { workspace.selectNode(gid); setSearchError(''); setRightOpen(true); if (compact) setLeftOpen(false); };
  const search = (event: FormEvent) => {
    event.preventDefault();
    const gid = filters.query.trim();
    if (!gid) { searchRef.current?.focus(); return; }
    if (!workspace.allNodes.some((node) => node.gid === gid)) {
      setSearchError('Точный gid не найден в доступном наборе. Ниже показаны совпадения.');
      return;
    }
    select(gid);
    setFilters({ ...initialFilters, query: gid });
  };
  const resetFilters = () => { setFilters(initialFilters); setSearchError(''); };
  const closeOverlay = () => {
    const side = leftOpen ? 'left' : 'right';
    setLeftOpen(false); setRightOpen(false);
    requestAnimationFrame(() => workspaceRef.current?.querySelector<HTMLButtonElement>(`.workspace-dock--${side} .workspace-rail`)?.focus());
  };
  const download = async (name: ExportName) => {
    if (!workspace.analysis) return;
    try {
      const blob = await getExport(name, workspace.analysis.analysis_id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setAnnouncement('Скачан ' + name);
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : 'Не удалось скачать CSV. Повторите попытку.');
      if (error instanceof ApiError && error.code === 'STALE_ANALYSIS') void workspace.refreshTop();
    }
  };

  return <main className="app-shell">
    <a href="#workspace" className="skip-link">Перейти к анализу</a>
    <header className="app-header">
      <a className="brand" href="#workspace" aria-label="Zhastyq — рабочее пространство">
        <span className="brand__symbol"><Icon name="network" size={22} /></span>
        <span>zhastyq<span className="brand__suffix"> / intelligence</span></span>
      </a>
      <div className="app-header__meta"><span className="workspace-label"><Icon name="shield" size={15} /> AML workspace</span><span className="mode-status"><i />Реальный анализ</span></div>
    </header>

    <div className="workspace-title">
      <div><p className="eyebrow">АНАЛИЗ ТРАНЗАКЦИОННОЙ СЕТИ</p><h1>За переводами — связи.</h1><p className="workspace-title__description">Находите ключевых участников и исследуйте движение средств.</p></div>
      <div className="export-actions">{exportNames.map((name) => <button key={name} type="button" className="export-button" disabled={!workspace.analysis || loadingTop} onClick={() => { void download(name); }}><Icon name="download" />{name}</button>)}</div>
    </div>

    <DataImport startImport={workspace.startImport} />
    {!workspace.analysis && !loadingTop && !topError && <p role="status">Анализа пока нет. Загрузите три Parquet-файла организаторов.</p>}
    {workspace.analysis && <p className="analysis-summary" data-testid="analysis-summary">Полный анализ: {workspace.analysis.summary.n_nodes} узлов · {workspace.analysis.summary.n_edges} рёбер · {workspace.analysis.summary.n_transactions} операций · {workspace.analysis.summary.n_clusters} кластеров. Поиск доступен по всем узлам.</p>}
    <GraphStatistics graph={graph} loading={loadingGraph} />

    <section ref={workspaceRef} className="network-workspace panel" id="workspace" tabIndex={-1} aria-labelledby="network-title"
      onKeyDown={(event) => { if (event.key === 'Escape' && compact && (leftOpen || rightOpen)) { event.preventDefault(); closeOverlay(); } }}>
      <div className="network-heading"><div className="network-heading__title"><span className="network-symbol"><Icon name="network" size={21} /></span><div><p className="section-kicker">РАБОЧЕЕ ПРОСТРАНСТВО</p><h2 id="network-title">Сеть переводов</h2></div></div><span className="graph-count">{graph ? graph.nodes.length + ' узлов · ' + graph.edges.length + ' связей' : 'Нет среза'}</span></div>
      <div className="workspace-grid" data-left-open={leftOpen} data-right-open={rightOpen}>
      <WorkspaceDock side="left" title="Приоритеты" open={leftOpen} busy={loadingTop} count={loadingTop ? '…' : nodes.length}
        inactive={compact && rightOpen} onToggle={() => { setLeftOpen(!leftOpen); if (compact) setRightOpen(false); }}>
        <form className="search-form" onSubmit={search}>
          <label htmlFor="gid-search" className="sr-only">Поиск по gid</label>
          <div className="search-field"><Icon name="search" size={17} /><input ref={searchRef} id="gid-search" value={filters.query} onChange={(event) => { setFilters({ ...filters, query: event.target.value }); setSearchError(''); }} placeholder="Найти клиента по gid" autoComplete="off" spellCheck={false} aria-invalid={!!searchError} aria-describedby={searchError ? 'search-error' : undefined} />
            {filters.query ? <button className="icon-button" type="button" aria-label="Очистить поиск" onClick={() => { setFilters({ ...filters, query: '' }); setSearchError(''); searchRef.current?.focus(); }}><Icon name="close" size={14} /></button> : <kbd aria-hidden="true">/</kbd>}
          </div>
          <button type="submit" className="sr-only" tabIndex={-1}>Найти точный gid</button>
        </form>
        {searchError && <p className="inline-error" id="search-error" role="alert">{searchError}</p>}
        <div className="list-filters">
          <label>Кластер в списке<select aria-label="Кластер в списке" value={filters.cluster} onChange={(event) => setFilters({ ...filters, cluster: event.target.value })}><option value="all">Все кластеры</option>{clusters.map((id) => <option key={id} value={id}>Кластер {id}</option>)}</select></label>
          <label>Роль<select aria-label="Роль в списке" value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value as Role | 'all' })}><option value="all">Все роли</option>{Object.entries(roleLabels).map(([role, label]) => <option value={role} key={role}>{label}</option>)}</select></label>
        </div>
        <div className="list-toolbar"><label className="priority-filter"><input type="checkbox" checked={filters.highOnly} onChange={(event) => setFilters({ ...filters, highOnly: event.target.checked })} /><span>Приоритет ≥ 0,80</span><span className="secondary">{highCount}</span></label>{filtered && <button type="button" className="text-button" onClick={resetFilters}>Сбросить</button>}</div>
        <div className="list-caption"><span>{visible.length} из {nodes.length}</span><label><span className="sr-only">Порядок списка</span><select aria-label="Порядок списка" value={filters.order} onChange={(event) => setFilters({ ...filters, order: event.target.value as NodeFilters['order'] })}><option value="priority">По приоритету ↓</option><option value="rank">По рангу</option></select></label></div>
        <div className="top-list" aria-label="Ранжированный список клиентов">
          {loadingTop ? <WorkspaceState title="Загрузка участников…" />
            : topError ? <WorkspaceState title="Список недоступен" error>{topError}<button type="button" onClick={workspace.refreshTop}><Icon name="refresh" />Повторить</button></WorkspaceState>
            : !visible.length ? <WorkspaceState title="Нет совпадений"><p>Измените gid или условия отбора.</p><button type="button" onClick={resetFilters}>Сбросить фильтры</button></WorkspaceState>
            : visible.map((node) => <button type="button" key={node.gid} className={'top-item' + (node.gid === selectedGid ? ' top-item--selected' : '')} onClick={() => select(node.gid)} aria-pressed={node.gid === selectedGid}>
              <span className="top-item__line"><span className="top-item__rank">{String(node.rank).padStart(2, '0')}</span><span className="data-text">{node.gid}</span><PriorityIndicator score={node.priority_score} /></span>
              <span className="top-item__role">{roleLabels[node.role]}<span>Кластер {node.cluster_id}</span></span>
              <span className="top-item__why">{node.why}</span>
            </button>)}
        </div>
        <div className="panel-footer"><Icon name="info" size={14} />Фильтры применяются к списку участников</div>
      </WorkspaceDock>

      <section className="graph-panel" aria-label="Граф и окружение клиента" aria-busy={loadingGraph} inert={compact && (leftOpen || rightOpen)}>
        <div className="graph-context"><span><span className="live-dot" />{graph ? 'Окружение ' + graph.center_gid : 'Локальный срез'}</span><span className="data-text">Выбран {selectedGid}</span></div>
        {nodeError ? <WorkspaceState title="Не удалось получить срез" error>{nodeError}<button type="button" onClick={workspace.refreshNode}>Повторить запрос</button></WorkspaceState>
          : loadingGraph ? <WorkspaceState title="Загрузка графа…" />
          : !graph ? <WorkspaceState title="Выберите узел после загрузки анализа"><p>Поиск работает по полному набору, включая изолированные узлы.</p></WorkspaceState>
          : !graph.nodes.length ? <WorkspaceState title="Связи не найдены">В доступном срезе нет узлов для отображения.</WorkspaceState>
          : <Suspense fallback={<WorkspaceState title="Подготовка графа…" />}><GraphView graph={graph} selectedGid={selectedGid} loading={false} onSelectGid={select} /></Suspense>}
        <div className="graph-panel__note"><Icon name="info" size={14} /><span>Показан подграф выбранного узла и его непосредственных соседей. Роль — гипотеза.</span><span className="graph-interaction-hint">Колесо — масштаб · перетаскивание — обзор</span></div>
      </section>

      <WorkspaceDock side="right" title="Карточка клиента" open={rightOpen} busy={loadingDetail}
        inactive={compact && leftOpen} onToggle={() => { setRightOpen(!rightOpen); if (compact) setLeftOpen(false); }}>
        {nodeError ? <WorkspaceState title="Карточка недоступна" error>{nodeError}<button type="button" onClick={workspace.refreshNode}>Повторить</button></WorkspaceState>
          : loadingDetail ? <WorkspaceState title="Загрузка карточки…" />
          : selectedNode ? <NodeCard key={selectedGid} node={selectedNode} detail={detail} graph={graph} card={workspace.card} onSelect={select} />
          : <WorkspaceState title="Выберите клиента">Нажмите на участника в списке или на узел графа.</WorkspaceState>}
      </WorkspaceDock>
      {compact && (leftOpen || rightOpen) && <button className="workspace-backdrop" type="button" tabIndex={-1} aria-label="Закрыть боковую панель" onClick={closeOverlay} />}
      </div>
    </section>
    <AgentDock key={(workspace.analysis?.analysis_id ?? "none") + ":" + selectedGid} analysisId={workspace.analysis?.analysis_id ?? null} gid={selectedGid} onSelect={select} onStale={async () => { setAnnouncement('Анализ изменился. Снимок обновлён; выберите узел и повторите вопрос.'); await workspace.refreshTop(); }} />
    <div className="toast" role="status" aria-live="polite" hidden={!announcement}>{announcement}</div>
  </main>;
}
