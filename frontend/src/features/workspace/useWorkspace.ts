import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getAnalysis, getHealth, getNodeCard, getNodeView, getTopNodes, isDemo, uploadAnalysis } from '../../shared/api/workspace';
import type { AnalysisResponse, HealthResponse, NodeCardResponse } from '../../shared/api/types';
import type { GraphSlice, NodeDetails, TopNode } from '../../shared/contracts';
import type { StartImport, ImportKey } from './importModel';
import { analysisGraph, neighborhood, nodeDetails, rankedNodes } from './analysisModel';

const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось получить данные. Повторите запрос.';

export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<AnalysisResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [demoNodes, setDemoNodes] = useState<TopNode[]>([]);
  const [demoGraph, setDemoGraph] = useState<GraphSlice | null>(null);
  const [demoDetail, setDemoDetail] = useState<NodeDetails | null>(null);
  const [selectedGid, setSelectedGid] = useState(isDemo ? '1005' : '');
  const [centerGid, setCenterGid] = useState('');
  const [neighborLimit, setNeighborLimit] = useState(120);
  const [card, setCard] = useState<NodeCardResponse | null>(null);
  const [loadingTop, setLoadingTop] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [topError, setTopError] = useState('');
  const [nodeError, setNodeError] = useState('');
  const [nodeVersion, setNodeVersion] = useState(0);
  const request = useRef<AbortController | null>(null);
  const selectedRef = useRef(selectedGid);
  selectedRef.current = selectedGid;
  const demoGraphRef = useRef(demoGraph);
  demoGraphRef.current = demoGraph;

  const refreshTop = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoadingTop(true); setTopError('');
    try {
      if (isDemo) {
        const value = await getTopNodes();
        if (!controller.signal.aborted) setDemoNodes(value);
        return null;
      }
      const [analysis, healthResult] = await Promise.allSettled([getAnalysis(controller.signal), getHealth(controller.signal)]);
      if (controller.signal.aborted) return null;
      setHealth(healthResult.status === 'fulfilled' ? healthResult.value : null);
      if (analysis.status === 'rejected') throw analysis.reason;
      const value = analysis.value;
      setSnapshot(value);
      const gid = value?.nodes.some((node) => node.gid === selectedRef.current)
        ? selectedRef.current : value?.top_nodes[0]?.gid ?? value?.nodes[0]?.gid ?? '';
      setSelectedGid(gid); setCenterGid(gid); setNeighborLimit(120);
      return value;
    } catch (error) {
      if (!controller.signal.aborted) { setTopError(message(error)); throw error; }
      return null;
    } finally {
      if (request.current === controller) { request.current = null; setLoadingTop(false); }
    }
  }, []);

  useEffect(() => { void refreshTop().catch(() => {}); return () => request.current?.abort(); }, [refreshTop]);
  const refresh = useCallback(() => {
    // A stale card/AI response must not cancel the snapshot read awaited by an import.
    if (request.current && !request.current.signal.aborted) return;
    void refreshTop().catch(() => {});
  }, [refreshTop]);
  const slice = useMemo(() => snapshot ? neighborhood(snapshot, centerGid, neighborLimit) : null, [snapshot, centerGid, neighborLimit]);
  const graph = isDemo ? demoGraph : slice?.graph ?? null;
  const fullGraph = useMemo(() => isDemo ? demoGraph : snapshot ? analysisGraph(snapshot) : null, [snapshot, demoGraph]);
  const nodes = useMemo(() => isDemo ? demoNodes : snapshot ? rankedNodes(snapshot) : [], [snapshot, demoNodes]);

  useEffect(() => {
    const controller = new AbortController();
    setCard(null); setDemoDetail(null); setNodeError('');
    if (!selectedGid || (!isDemo && !snapshot)) { setLoadingDetail(false); return; }
    setLoadingDetail(true);
    const load = async () => {
      try {
        if (isDemo) {
          const keep = demoGraphRef.current?.nodes.some((node) => node.gid === selectedGid);
          if (!keep) setDemoGraph(null);
          const value = await getNodeView(selectedGid);
          if (controller.signal.aborted) return;
          setDemoDetail(value.detail);
          if (value.graph || !keep) setDemoGraph(value.graph);
        } else {
          const value = await getNodeCard(selectedGid, controller.signal);
          if (controller.signal.aborted) return;
          if (value.analysis_id !== snapshot!.analysis_id) { refresh(); return; }
          setCard(value);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setNodeError(message(error));
          if (error instanceof ApiError && ['NO_ANALYSIS', 'GID_NOT_FOUND'].includes(error.code)) refresh();
        }
      } finally { if (!controller.signal.aborted) setLoadingDetail(false); }
    };
    void load();
    return () => controller.abort();
  }, [selectedGid, snapshot, nodeVersion, refresh]);

  const selectNode = (gid: string) => {
    setSelectedGid(gid);
    if (!graph?.nodes.some((node) => node.gid === gid)) { setCenterGid(gid); setNeighborLimit(120); }
  };
  const startImport = useCallback<StartImport>(async (files, report, signal) => {
    try {
      const uploaded = await uploadAnalysis(files, signal);
      if (signal.aborted) return;
      for (const key of ['nodes', 'edges', 'transactions'] as const) report({ type: 'file', key, status: 'ready' });
      const latest = await refreshTop();
      if (signal.aborted) return;
      if (!latest) throw new Error('Расчёт завершён, но результат не получен. Обновите данные исследования.');
      if (latest.analysis_id !== uploaded.analysis_id) throw new Error('На сервере уже опубликован более новый анализ. На экране показана его версия.');
      report({ type: 'pipeline', status: 'complete' });
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError) {
        const file = error.details?.file;
        if (typeof file === 'string') {
          const key = file.replace(/\.parquet$/i, '') as ImportKey;
          if (['nodes', 'edges', 'transactions'].includes(key)) report({ type: 'file', key, status: 'error', error: message(error) });
        }
      }
      report({ type: 'pipeline', status: 'error', error: message(error) });
      throw error;
    }
  }, [refreshTop]);
  const currentCard = card?.node.gid === selectedGid && card.analysis_id === snapshot?.analysis_id ? card : null;
  const detail = isDemo ? demoDetail : currentCard ? nodeDetails(currentCard.node) : null;
  const selectedNode = detail || nodes.find((node) => node.gid === selectedGid) || graph?.nodes.find((node) => node.gid === selectedGid) || null;
  return { nodes, selectedGid, selectNode, selectedNode, detail, card: currentCard, graph, fullGraph, snapshot, health,
    loadingTop, loadingDetail, loadingGraph: isDemo ? loadingDetail && !demoGraph : loadingTop && !snapshot,
    topError, nodeError, refreshTop: refresh, refreshNode: () => setNodeVersion((value) => value + 1),
    startImport: isDemo ? undefined : startImport, analysisId: snapshot?.analysis_id ?? null,
    recenter: () => { setCenterGid(selectedGid); setNeighborLimit(120); },
    showMoreNeighbors: () => setNeighborLimit((value) => value + 120),
    totalNeighbors: slice?.totalNeighbors ?? 0, shownNeighbors: slice?.shownNeighbors ?? 0 };
}
