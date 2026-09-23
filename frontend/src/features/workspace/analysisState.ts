import type { GraphSlice, NodeDetails, TopNode } from '../../shared/contracts';
import type { NodeView, WorkspaceAnalysis } from '../../shared/api/client';

export interface WorkspaceState {
  demo: boolean;
  analysisId: string | null;
  nodes: TopNode[];
  selectedGid: string | null;
  detail: NodeDetails | null;
  graph: GraphSlice | null;
  loadingTop: boolean;
  loadingDetail: boolean;
  loadingGraph: boolean;
  topError: string;
  nodeError: string;
  nodeRequest: number | null;
}
export const initialWorkspace = (demo: boolean): WorkspaceState => ({
  demo, analysisId: null, nodes: [], selectedGid: null, detail: null, graph: null,
  loadingTop: true, loadingDetail: false, loadingGraph: true, topError: '', nodeError: '', nodeRequest: null,
});
type Action =
  | { type: 'analysis-start' }
  | { type: 'analysis-ready'; analysis: WorkspaceAnalysis }
  | { type: 'analysis-error'; error: string }
  | { type: 'select'; gid: string }
  | { type: 'node-start'; request: number }
  | { type: 'node-ready'; request: number; analysisId: string | null; gid: string; view: NodeView }
  | { type: 'node-error'; request: number; analysisId: string | null; gid: string; error: string };

export function workspaceReducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case 'analysis-start': return { ...state, loadingTop: true, loadingGraph: !state.graph, topError: '' };
    case 'analysis-ready': {
      const { analysis } = action;
      const exists = state.selectedGid && (analysis.graph.nodes.some((node) => node.gid === state.selectedGid) || analysis.nodes.some((node) => node.gid === state.selectedGid));
      const selectedGid = exists ? state.selectedGid : analysis.graph.center_gid || null;
      const sameVersion = state.analysisId === analysis.analysisId;
      return {
        ...state, analysisId: analysis.analysisId, nodes: analysis.nodes, selectedGid,
        graph: sameVersion ? state.graph ?? analysis.graph : analysis.graph,
        detail: sameVersion && selectedGid === state.selectedGid ? state.detail : null,
        loadingTop: false, loadingGraph: false, loadingDetail: !!selectedGid,
        topError: '', nodeError: '', nodeRequest: null,
      };
    }
    case 'analysis-error': return { ...state, loadingTop: false, loadingGraph: false, topError: action.error };
    case 'select': {
      const graph = state.demo && !state.graph?.nodes.some((node) => node.gid === action.gid) ? null : state.graph;
      return { ...state, selectedGid: action.gid, graph, detail: null, nodeError: '', loadingDetail: true, loadingGraph: state.demo && !graph, nodeRequest: null };
    }
    case 'node-start': return { ...state, nodeRequest: action.request, detail: null, nodeError: '', loadingDetail: true };
    case 'node-ready':
    case 'node-error': {
      if (state.nodeRequest !== action.request || state.analysisId !== action.analysisId || state.selectedGid !== action.gid) return state;
      return { ...state, loadingDetail: false, loadingGraph: false,
        ...(action.type === 'node-error' ? { nodeError: action.error, detail: null } : { detail: action.view.detail, graph: state.demo ? action.view.graph ?? state.graph : state.graph }),
      };
    }
  }
}
