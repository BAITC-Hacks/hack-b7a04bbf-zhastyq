import topNodes from './fixtures/top-nodes.json';
import nodeDetails from './fixtures/node-details.json';
import graphSlice from './fixtures/graph-slice.json';
import type { GraphSlice, NodeDetails, TopNode } from '../contracts';
import { ApiError, createApiClient } from './client';

export { ApiError } from './client';
export type * from './types';

export const isDemo = import.meta.env.VITE_API_MOCK === 'true';

const client = createApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL });
export const { getHealth, getAnalysis, getNodeCard, uploadAnalysis, downloadExport, askQuestion } = client;

function requireDemo() {
  if (!isDemo) {
    throw new ApiError('DEMO_DISABLED', 'Демонстрационные данные отключены. Загрузите файлы для реального анализа.');
  }
}

export async function getTopNodes(): Promise<TopNode[]> {
  requireDemo();
  return topNodes as TopNode[];
}

export async function getNodeView(gid: string): Promise<{
  detail: NodeDetails | null;
  graph: GraphSlice | null;
}> {
  requireDemo();
  if (gid !== nodeDetails.gid) return { detail: null, graph: null };
  return { detail: nodeDetails as NodeDetails, graph: graphSlice as GraphSlice };
}
