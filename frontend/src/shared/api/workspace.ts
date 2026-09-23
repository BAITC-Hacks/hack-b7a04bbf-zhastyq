import topNodes from './fixtures/top-nodes.json';
import nodeDetails from './fixtures/node-details.json';
import graphSlice from './fixtures/graph-slice.json';
import { createWorkspaceApi, type NodeView, type WorkspaceAnalysis } from './client';
import type { GraphSlice, NodeDetails, TopNode } from '../contracts';

export const isDemo = import.meta.env.VITE_API_MOCK !== 'false';
const api = createWorkspaceApi(import.meta.env.VITE_API_BASE_URL);

export async function getAnalysis(signal?: AbortSignal): Promise<WorkspaceAnalysis> {
  signal?.throwIfAborted();
  if (!isDemo) return api.getAnalysis(signal);
  return { analysisId: 'demo', nodes: topNodes as TopNode[], graph: graphSlice as GraphSlice };
}
export async function getNodeView(gid: string, analysisId: string | null, signal?: AbortSignal): Promise<NodeView> {
  signal?.throwIfAborted();
  if (!isDemo) return api.getNodeView(gid, analysisId, signal);
  if (gid !== nodeDetails.gid) return { detail: null, graph: null };
  return { detail: nodeDetails as NodeDetails, graph: graphSlice as GraphSlice };
}
export const importAnalysis = api.importAnalysis;
