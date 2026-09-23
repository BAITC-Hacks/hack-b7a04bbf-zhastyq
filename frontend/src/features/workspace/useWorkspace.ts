import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getAnalysis, getNodeCard, nodeGraph, uploadAnalysis } from '../../shared/api/workspace';
import type { Analysis, NodeCardData } from '../../shared/api/types';
import type { StartImport } from './importModel';

const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось получить данные. Повторите запрос.';
export function useWorkspace() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selectedGid, setSelectedGid] = useState<string | null>(null);
  const [card, setCard] = useState<NodeCardData | null>(null);
  const [loadingTop, setLoadingTop] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [topError, setTopError] = useState('');
  const [nodeError, setNodeError] = useState('');
  const [nodeVersion, setNodeVersion] = useState(0);
  const revision = useRef(0);
  const accept = useCallback((snapshot: Analysis) => {
    setAnalysis(snapshot); setCard(null); setNodeError(''); setTopError('');
    setSelectedGid((old) => old && snapshot.nodes.some((node) => node.gid === old)
      ? old : snapshot.top_nodes[0]?.gid ?? snapshot.nodes[0]?.gid ?? null);
  }, []);
  const refreshTop = useCallback(async () => {
    const current = ++revision.current;
    setLoadingTop(true); setTopError('');
    try { const snapshot = await getAnalysis(); if (current === revision.current) accept(snapshot); }
    catch (error) {
      if (current !== revision.current) return;
      if (error instanceof ApiError && error.code === 'NO_ANALYSIS') { setAnalysis(null); setSelectedGid(null); setCard(null); }
      else setTopError(message(error));
    } finally { if (current === revision.current) setLoadingTop(false); }
  }, [accept]);
  useEffect(() => { void refreshTop(); return () => { revision.current++; }; }, [refreshTop]);
  useEffect(() => {
    setCard(null); setNodeError('');
    if (!analysis || !selectedGid) { setLoadingDetail(false); return; }
    const controller = new AbortController();
    setLoadingDetail(true);
    getNodeCard(selectedGid, analysis.analysis_id, controller.signal).then((value) => {
      if (!controller.signal.aborted) setCard(value);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.code === 'STALE_ANALYSIS') void refreshTop();
      else setNodeError(message(error));
    }).finally(() => { if (!controller.signal.aborted) setLoadingDetail(false); });
    return () => controller.abort();
  }, [analysis, selectedGid, nodeVersion, refreshTop]);
  const startImport: StartImport = async (files, report, signal) => {
    const current = ++revision.current;
    try {
      const snapshot = await uploadAnalysis(files, signal);
      if (signal.aborted || current !== revision.current) return;
      accept(snapshot);
      for (const key of ['nodes', 'edges', 'transactions'] as const) report({ type: 'file', key, status: 'ready' });
      report({ type: 'pipeline', status: 'complete' });
    } finally { if (current === revision.current) setLoadingTop(false); }
  };
  const graph = useMemo(() => analysis && selectedGid ? nodeGraph(analysis, selectedGid) : null, [analysis, selectedGid]);
  const activeCard = card?.analysis_id === analysis?.analysis_id && card?.node.gid === selectedGid ? card : null;
  return { analysis, nodes: analysis?.top_nodes ?? [], allNodes: analysis?.nodes ?? [], selectedGid,
    selectNode: setSelectedGid, selectedNode: analysis?.nodes.find((node) => node.gid === selectedGid) ?? null,
    card: activeCard, detail: activeCard?.node ?? null, graph, loadingTop,
    loadingDetail: loadingDetail || !!(analysis && selectedGid && !activeCard && !nodeError), loadingGraph: false,
    topError, nodeError, refreshTop, refreshNode: () => setNodeVersion((v) => v + 1), startImport };
}
