import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { getAnalysis, getNodeView, importAnalysis, isDemo } from '../../shared/api/workspace';
import { initialWorkspace, workspaceReducer } from './analysisState';
import type { StartImport } from './importModel';

const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось получить данные. Повторите запрос.';

export function useWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, isDemo, initialWorkspace);
  const [topVersion, setTopVersion] = useState(0);
  const [nodeVersion, setNodeVersion] = useState(0);
  const analysisRequest = useRef(0);
  const nodeRequest = useRef(0);
  const analysisController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; analysisController.current?.abort(); }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    analysisController.current?.abort(); analysisController.current = controller;
    const request = ++analysisRequest.current;
    dispatch({ type: 'analysis-start' });
    getAnalysis(controller.signal).then((analysis) => {
      if (!controller.signal.aborted && request === analysisRequest.current) { dispatch({ type: 'analysis-ready', analysis }); setNodeVersion((value) => value + 1); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && request === analysisRequest.current) dispatch({ type: 'analysis-error', error: message(error) });
    });
    return () => controller.abort();
  }, [topVersion]);

  useEffect(() => {
    if (!state.selectedGid) return;
    const controller = new AbortController();
    const request = ++nodeRequest.current;
    const gid = state.selectedGid;
    const analysisId = state.analysisId;
    dispatch({ type: 'node-start', request });
    getNodeView(gid, analysisId, controller.signal).then((view) => {
      if (!controller.signal.aborted) dispatch({ type: 'node-ready', request, gid, analysisId, view });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) dispatch({ type: 'node-error', request, gid, analysisId, error: message(error) });
    });
    return () => controller.abort();
  }, [state.selectedGid, state.analysisId, nodeVersion]);

  const startImport: StartImport = useCallback(async (files, report, signal) => {
    // A pending initial/refresh GET must not overwrite a successful upload's new snapshot.
    analysisController.current?.abort();
    const request = ++analysisRequest.current;
    try {
      const analysis = await importAnalysis(files, report, signal);
      signal.throwIfAborted();
      if (!mounted.current) return;
      // A manual refresh during calculation may still be reading the previous snapshot.
      analysisController.current?.abort();
      ++analysisRequest.current;
      dispatch({ type: 'analysis-ready', analysis });
      setNodeVersion((value) => value + 1);
      report({ type: 'pipeline', status: 'complete' });
    } catch (error) {
      // Failed uploads leave the previously valid graph, list, and card available.
      if (!signal.aborted && mounted.current && request === analysisRequest.current) dispatch({ type: 'analysis-error', error: state.graph ? '' : message(error) });
      throw error;
    }
  }, [state.graph]);
  const refreshTop = useCallback(() => setTopVersion((value) => value + 1), []);
  const refreshNode = useCallback(() => setNodeVersion((value) => value + 1), []);
  const selectNode = useCallback((gid: string) => { dispatch({ type: 'select', gid }); setNodeVersion((value) => value + 1); }, []);
  const selectedNode = state.detail || state.nodes.find((node) => node.gid === state.selectedGid) || state.graph?.nodes.find((node) => node.gid === state.selectedGid) || null;
  return { ...state, selectNode, selectedNode, refreshTop, refreshNode, startImport: isDemo ? undefined : startImport };
}
