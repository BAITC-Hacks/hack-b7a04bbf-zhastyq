import { useCallback, useEffect, useRef, useState } from 'react';
import { getNodeView, getTopNodes } from '../../shared/api/workspace';
import type { GraphSlice, NodeDetails, TopNode } from '../../shared/contracts';

const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось получить данные. Повторите запрос.';

export function useWorkspace() {
  const [nodes, setNodes] = useState<TopNode[]>([]);
  const [selectedGid, setSelectedGid] = useState('1005');
  const [detail, setDetail] = useState<NodeDetails | null>(null);
  const [graph, setGraph] = useState<GraphSlice | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const [loadingTop, setLoadingTop] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loadingGraph, setLoadingGraph] = useState(true);
  const [topError, setTopError] = useState('');
  const [nodeError, setNodeError] = useState('');
  const [topVersion, setTopVersion] = useState(0);
  const [nodeVersion, setNodeVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadingTop(true); setTopError('');
    getTopNodes().then((value) => { if (active) setNodes(value); })
      .catch((error: unknown) => { if (active) setTopError(message(error)); })
      .finally(() => { if (active) setLoadingTop(false); });
    return () => { active = false; };
  }, [topVersion]);

  useEffect(() => {
    let active = true;
    const keepSlice = !!graphRef.current?.nodes.some((node) => node.gid === selectedGid);
    setLoadingGraph(!keepSlice); setLoadingDetail(true); setNodeError(''); setDetail(null);
    if (!keepSlice) setGraph(null);
    getNodeView(selectedGid).then((value) => {
      if (!active) return;
      setDetail(value.detail);
      if (value.graph || !keepSlice) setGraph(value.graph);
    }).catch((error: unknown) => { if (active) setNodeError(message(error)); })
      .finally(() => { if (active) { setLoadingGraph(false); setLoadingDetail(false); } });
    return () => { active = false; };
  }, [selectedGid, nodeVersion]);

  const refreshTop = useCallback(() => setTopVersion((value) => value + 1), []);
  const refreshNode = useCallback(() => setNodeVersion((value) => value + 1), []);
  const selectedNode = detail || nodes.find((node) => node.gid === selectedGid) || graph?.nodes.find((node) => node.gid === selectedGid) || null;
  return { nodes, selectedGid, selectNode: setSelectedGid, selectedNode, detail, graph, loadingTop, loadingDetail, loadingGraph, topError, nodeError, refreshTop, refreshNode };
}
