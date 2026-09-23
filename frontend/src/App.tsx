import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import NodeCard from './features/workspace/NodeCard';
import PriorityIndicator from './features/workspace/PriorityIndicator';
import GraphStatistics from './features/workspace/GraphStatistics';
import AgentDock from './features/workspace/AgentDock';
import DataImport from './features/workspace/DataImport';
import ExportMenu from './features/workspace/ExportMenu';
import WorkspaceState from './features/workspace/WorkspaceState';
import WorkspaceDock from './features/workspace/WorkspaceDock';
import Icon from './features/workspace/Icon';
import { roleLabels } from './features/workspace/labels';
import { useWorkspace } from './features/workspace/useWorkspace';
import { filterNodes, topNodesCsv, type NodeFilters } from './features/workspace/workspaceModel';
import { isDemo } from './shared/api/workspace';
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
  const [listLimit, setListLimit] = useState(40);
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

  useEffect(() => { setListLimit(40); }, [filters, workspace.analysisId]);
  useEffect(() => { setFilters(initialFilters); setSearchError(''); }, [workspace.analysisId]);

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

  const select = (gid: string) => { workspace.selectNode(gid); setSearchError(''); };
  const search = (event: FormEvent) => {
    event.preventDefault();
    const gid = filters.query.trim();
    if (!gid) { searchRef.current?.focus(); return; }
    if (!nodes.some((node) => node.gid === gid) && !graph?.nodes.some((node) => node.gid === gid)) {
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
  const download = () => {
    if (!visible.length) { setAnnouncement('В текущем списке нет клиентов для экспорта. Измените фильтры.'); return; }
    try {
      const url = URL.createObjectURL(new Blob([topNodesCsv(visible)], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = isDemo ? 'top_nodes_demo.csv' : 'filtered_nodes.csv';
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setAnnouncement('CSV подготовлен: ' + visible.length + ' клиентов из текущего списка.');
    } catch {
      setAnnouncement('Не удалось подготовить CSV. Повторите попытку.');
    }
  };

  return <main className="app-shell">
    <a href="#workspace" className="skip-link">Перейти к анализу</a>
    <header className="app-header">
      <a className="brand" href="#workspace" aria-label="Zhastyq — рабочее пространство">
        <span className="brand__symbol"><Icon name="network" size={22} /></span>
        <span>zhastyq<span className="brand__suffix"> / intelligence</span></span>
      </a>
      <div className="app-header__meta"><span className="workspace-label"><Icon name="shield" size={15} /> AML workspace</span><span className="mode-status"><i />{isDemo ? 'Демонстрационный режим' : 'Режим сервиса'}</span></div>
    </header>

    <div className="workspace-title">
      <div><p className="eyebrow">АНАЛИЗ ТРАНЗАКЦИОННОЙ СЕТИ</p><h1>За переводами — связи.</h1><p className="workspace-title__description">Находите ключевых участников и исследуйте движение средств.</p></div>
      <ExportMenu analysisId={workspace.analysisId} onFiltered={download} onStale={workspace.refreshTop} announce={setAnnouncement} disabled={loadingTop || (isDemo && !visible.length)} />
    </div>

    <DataImport startImport={workspace.startImport} />
    {!isDemo && <div className={'analysis-status' + (topError ? ' analysis-status--error' : '')} role="status">
      <span><Icon name={topError ? 'info' : 'shield'} size={15} />{topError || (loadingTop ? 'Подключение к сервису…' : workspace.analysisId ? 'Анализ готов' : 'Сервис готов. Импортируйте три файла для расчёта.')}</span>
      {workspace.analysisId && <span className="analysis-status__version" title={workspace.analysisId}>Версия {workspace.analysisId.slice(0, 8)} · {workspace.snapshot?.summary.n_transactions.toLocaleString('ru-RU')} транзакций{topError ? ' · предыдущий результат' : ''}</span>}
      <button className="text-button" disabled={loadingTop} type="button" onClick={workspace.refreshTop}><Icon name="refresh" size={13} />Обновить</button>
    </div>}
    <GraphStatistics graph={workspace.fullGraph} loading={loadingGraph} full={!isDemo} />

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
          {loadingTop && !nodes.length ? <WorkspaceState title="Загрузка участников…" />
            : topError && !nodes.length ? <WorkspaceState title="Список недоступен" error>{topError}<button type="button" onClick={workspace.refreshTop}><Icon name="refresh" />Повторить</button></WorkspaceState>
            : !nodes.length ? <WorkspaceState title="Нет загруженного анализа">Выберите три файла в разделе «Данные исследования» и запустите расчёт.</WorkspaceState>
            : !visible.length ? <WorkspaceState title="Нет совпадений"><p>Измените gid или условия отбора.</p><button type="button" onClick={resetFilters}>Сбросить фильтры</button></WorkspaceState>
            : visible.slice(0, listLimit).map((node) => <button type="button" key={node.gid} className={'top-item' + (node.gid === selectedGid ? ' top-item--selected' : '')} onClick={() => select(node.gid)} aria-pressed={node.gid === selectedGid}>
              <span className="top-item__line"><span className="top-item__rank">{String(node.rank).padStart(2, '0')}</span><span className="data-text">{node.gid}</span><PriorityIndicator score={node.priority_score} /></span>
              <span className="top-item__role">{roleLabels[node.role]}<span>Кластер {node.cluster_id}</span></span>
              <span className="top-item__why">{node.why}</span>
            </button>)}
          {visible.length > listLimit && <button className="list-more" type="button" onClick={() => setListLimit((value) => value + 40)}>Показать ещё {Math.min(40, visible.length - listLimit)}</button>}
        </div>
        <div className="panel-footer"><Icon name="info" size={14} />Фильтры применяются к списку участников</div>
      </WorkspaceDock>

      <section className="graph-panel" aria-label="Граф и окружение клиента" aria-busy={loadingGraph} inert={compact && (leftOpen || rightOpen)}>
        <div className="graph-context"><span><span className="live-dot" />{graph ? 'Окружение ' + graph.center_gid : 'Локальный срез'}</span><span className="data-text">{selectedGid ? 'Выбран ' + selectedGid : 'Клиент не выбран'}</span></div>
        {!isDemo && graph && selectedGid !== graph.center_gid && <div className="graph-slice-notice"><button className="text-button" type="button" onClick={workspace.recenter}>Открыть окружение выбранного клиента<Icon name="arrow" size={13} /></button></div>}
        {!isDemo && workspace.totalNeighbors > workspace.shownNeighbors && <div className="graph-slice-notice"><span>Показано {workspace.shownNeighbors} из {workspace.totalNeighbors} соседей по обороту переводов.</span><button className="text-button" type="button" onClick={workspace.showMoreNeighbors}>Ещё {Math.min(120, workspace.totalNeighbors - workspace.shownNeighbors)}</button></div>}
        {nodeError && !graph ? <WorkspaceState title="Не удалось получить срез" error>{nodeError}<button type="button" onClick={workspace.refreshNode}>Повторить запрос</button></WorkspaceState>
          : loadingGraph ? <WorkspaceState title="Загрузка графа…" />
          : !isDemo && topError && !graph ? <WorkspaceState title="Не удалось подключиться к анализу" error>{topError}<button type="button" onClick={workspace.refreshTop}>Повторить подключение</button></WorkspaceState>
          : !isDemo && !workspace.analysisId ? <WorkspaceState title="Загрузите данные исследования"><Icon name="network" size={36} /><p>Откройте «Импорт файлов» выше и добавьте nodes.parquet, edges.parquet и transactions.parquet. После расчёта здесь появится сеть переводов.</p></WorkspaceState>
          : !graph ? <WorkspaceState title="Срез для этого клиента пока недоступен"><Icon name="network" size={36} /><p>{isDemo ? 'В демонаборе связи подготовлены для окружения клиента 1005. Известные признаки доступны в панели «Карточка клиента».' : 'Сервис пока не вернул связи выбранного клиента.'}</p>{isDemo && <button className="primary-button" type="button" onClick={() => select('1005')}>Открыть пример 1005<Icon name="arrow" size={16} /></button>}</WorkspaceState>
          : !graph.nodes.length ? <WorkspaceState title="Связи не найдены">В доступном срезе нет узлов для отображения.</WorkspaceState>
          : <Suspense fallback={<WorkspaceState title="Подготовка графа…" />}><GraphView graph={graph} selectedGid={selectedGid} loading={false} onSelectGid={select} /></Suspense>}
        <div className="graph-panel__note"><Icon name="info" size={14} /><span>Роль участника — гипотеза для проверки.</span><span className="graph-interaction-hint">Колесо — масштаб · перетаскивание — обзор</span></div>
      </section>

      <WorkspaceDock side="right" title="Карточка клиента" open={rightOpen} busy={loadingDetail}
        inactive={compact && leftOpen} onToggle={() => { setRightOpen(!rightOpen); if (compact) setLeftOpen(false); }}>
        {nodeError ? <WorkspaceState title="Карточка недоступна" error>{nodeError}<button type="button" onClick={workspace.refreshNode}>Повторить</button></WorkspaceState>
          : loadingDetail ? <WorkspaceState title="Загрузка карточки…" />
          : selectedNode ? <NodeCard key={selectedGid} node={selectedNode} detail={detail} graph={graph} card={workspace.card} />
          : <WorkspaceState title="Выберите клиента">Нажмите на участника в списке или на узел графа.</WorkspaceState>}
      </WorkspaceDock>
      {compact && (leftOpen || rightOpen) && <button className="workspace-backdrop" type="button" tabIndex={-1} aria-label="Закрыть боковую панель" onClick={closeOverlay} />}
      </div>
    </section>
    <AgentDock analysisId={workspace.analysisId} selectedGid={selectedGid || null} configured={workspace.health?.ai_configured ?? null}
      healthLoading={workspace.healthLoading} healthError={workspace.healthError} onRefreshHealth={workspace.refreshHealth}
      isDemo={isDemo} onSelectGid={select} onStale={workspace.refreshTop} />
    <div className="toast" role="status" aria-live="polite" hidden={!announcement}>{announcement}</div>
  </main>;
}
