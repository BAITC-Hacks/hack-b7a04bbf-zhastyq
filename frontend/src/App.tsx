import { useEffect, useRef, useState, type FormEvent } from 'react';
import GraphView from './features/graph/GraphView';
import NodeCard from './features/workspace/NodeCard';
import PriorityIndicator from './features/workspace/PriorityIndicator';
import GraphStatistics from './features/workspace/GraphStatistics';
import AgentDock from './features/workspace/AgentDock';
import WorkspaceState from './features/workspace/WorkspaceState';
import { roleLabels } from './features/workspace/labels';
import { getNodeView, getTopNodes, isDemo } from './shared/api/workspace';
import type { GraphSlice, NodeDetails, TopNode } from './shared/contracts';

export default function App() {
  const [nodes, setNodes] = useState<TopNode[]>([]);
  const [selectedGid, setSelectedGid] = useState('1005');
  const [query, setQuery] = useState('');
  const [cluster, setCluster] = useState('all');
  const [detail, setDetail] = useState<NodeDetails | null>(null);
  const [graph, setGraph] = useState<GraphSlice | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const [loadingTop, setLoadingTop] = useState(true);
  const [loadingNode, setLoadingNode] = useState(true);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    getTopNodes().then((value) => { if (active) setNodes(value); })
      .catch((reason: unknown) => { if (active) setError(String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (active) setLoadingTop(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const keepSlice = !!graphRef.current?.nodes.some((node) => node.gid === selectedGid);
    setLoadingNode(!keepSlice);
    setDetail(null);
    if (!keepSlice) setGraph(null);
    getNodeView(selectedGid).then((value) => {
      if (active) {
        setDetail(value.detail);
        if (value.graph || !keepSlice) setGraph(value.graph);
      }
    }).catch((reason: unknown) => {
      if (active) setError(String(reason instanceof Error ? reason.message : reason));
    }).finally(() => { if (active) setLoadingNode(false); });
    return () => { active = false; };
  }, [selectedGid]);

  const clusters = [...new Set(nodes.map((node) => node.cluster_id))].sort((a, b) => a - b);
  const visible = nodes.filter((node) => cluster === 'all' || String(node.cluster_id) === cluster);
  const selectNode = (gid: string) => { setSelectedGid(gid); setSearchError(''); };
  const search = (event: FormEvent) => {
    event.preventDefault();
    const gid = query.trim();
    if (!nodes.some((node) => node.gid === gid)) {
      setSearchError('Клиент с таким gid не найден в доступном топ-листе.');
      return;
    }
    setCluster('all');
    selectNode(gid);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">ZHASTYQ / AML</p><h1>Граф денег</h1></div>
        <div className="app-header__meta">
          <span>Рабочее пространство аналитика</span>
          {isDemo && <span className="demo-badge">Демонстрационные данные</span>}
        </div>
      </header>

      <section className="upload-bar panel" aria-label="Загрузка данных">
        <div><h2>Данные исследования</h2><p className="secondary">edges.parquet · nodes.parquet · transactions.parquet</p></div>
        <label className="file-control">Выбрать файлы
          <input type="file" accept=".parquet" multiple aria-label="Выбрать Parquet-файлы"
            onChange={(event) => setFiles(Array.from(event.target.files ?? [], (file) => file.name))} />
        </label>
        <div className="upload-bar__status" role="status">
          {files.length > 0 ? <><span>{files.join(', ')}</span><span className="secondary">Анализ файлов пока недоступен.</span></>
            : <span className="secondary">Для просмотра открыт демонстрационный пример.</span>}
        </div>
      </section>

      <GraphStatistics graph={error ? null : graph} loading={loadingNode} />

      <div className="workspace-grid">
        <section className="panel top-panel" aria-labelledby="top-title">
          <div className="panel-heading"><h2 id="top-title">Приоритеты проверки</h2><span className="count-label">{visible.length}</span></div>
          <form className="search-form" onSubmit={search}>
            <label htmlFor="gid-search">Поиск по gid</label>
            <div className="search-form__row">
              <input id="gid-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например, 1005" aria-invalid={!!searchError} aria-describedby={searchError ? 'search-error' : undefined} />
              <button type="submit">Найти</button>
            </div>
          </form>
          {searchError && <p className="inline-error" id="search-error" role="alert">{searchError}</p>}
          <label className="cluster-filter" htmlFor="cluster-filter">Кластер
            <select id="cluster-filter" value={cluster} onChange={(event) => setCluster(event.target.value)}>
              <option value="all">Все кластеры</option>
              {clusters.map((id) => <option key={id} value={id}>Кластер {id}</option>)}
            </select>
          </label>
          <div className="top-list" aria-label="Ранжированный список клиентов">
            {loadingTop ? <WorkspaceState title="Загрузка приоритетов…" />
              : error ? <WorkspaceState title={error} error />
              : !visible.length ? <WorkspaceState title="Клиенты не найдены" />
              : visible.map((node) => (
                <button type="button" key={node.gid} className={`top-item${node.gid === selectedGid ? ' top-item--selected' : ''}`}
                  onClick={() => selectNode(node.gid)} aria-pressed={node.gid === selectedGid}>
                  <span className="top-item__line"><span className="secondary">#{node.rank}</span><span className="data-text">{node.gid}</span><PriorityIndicator score={node.priority_score} /></span>
                  <span className="top-item__role">{roleLabels[node.role]}</span>
                  <span className="top-item__why">{node.why}</span>
                </button>
              ))}
          </div>
        </section>

        <section className="panel graph-panel" aria-label="Сеть переводов" aria-busy={loadingNode}>
          <div className="panel-heading"><h2>Сеть переводов</h2><span className="data-text secondary">gid {selectedGid}</span></div>
          {error ? <WorkspaceState title={error} error />
            : loadingNode ? <WorkspaceState title="Загрузка графа…" />
            : !graph ? <WorkspaceState title={isDemo ? 'Для этого клиента демонстрационный срез не подготовлен' : 'Граф пока не загружен'}>
              {isDemo && <button type="button" onClick={() => selectNode('1005')}>Открыть пример 1005</button>}
            </WorkspaceState>
            : graph.nodes.length === 0 ? <WorkspaceState title="Для выбранного клиента связи не найдены" />
            : <GraphView graph={graph} selectedGid={selectedGid} loading={false} onSelectGid={selectNode} />}
          <p className="graph-panel__note">Роли участников — гипотезы для углублённой проверки.</p>
        </section>

        <aside className="panel detail-panel" aria-labelledby="detail-title" aria-busy={loadingNode}>
          <div className="panel-heading"><h2 id="detail-title">Карточка узла</h2></div>
          {error ? <WorkspaceState title={error} error />
            : loadingNode ? <WorkspaceState title="Загрузка карточки…" />
            : detail ? <NodeCard node={detail} />
            : <WorkspaceState title="Подробная карточка пока недоступна">Выберите демонстрационный узел 1005.</WorkspaceState>}
        </aside>
      </div>
      <AgentDock />
    </main>
  );
}
