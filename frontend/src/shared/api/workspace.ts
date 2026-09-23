import topNodes from './fixtures/top-nodes.json';
import nodeDetails from './fixtures/node-details.json';
import graphSlice from './fixtures/graph-slice.json';
import type { GraphSlice, NodeDetails, TopNode } from '../contracts';

export const isDemo = import.meta.env.VITE_API_MOCK !== 'false';

function requireDemo() {
  if (!isDemo) {
    throw new Error(import.meta.env.VITE_API_BASE_URL
      ? 'Подключение к сервису анализа ещё не настроено.'
      : 'Не указан адрес сервиса анализа. Задайте VITE_API_BASE_URL.');
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
