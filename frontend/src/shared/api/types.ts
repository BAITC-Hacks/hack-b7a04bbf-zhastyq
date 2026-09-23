import type { Role } from '../contracts';

export interface HealthResponse {
  status: 'ok';
  analysis_ready: boolean;
  ai_configured: boolean;
}

export interface SummaryResponse {
  n_nodes: number;
  n_edges: number;
  n_transactions: number;
  n_seed: number;
  n_clusters: number;
  edge_volume_kzt: number;
}

/** Wire DTOs preserve every int64 identifier as its exact decimal string. */
export interface NodeResponse {
  gid: string;
  depth: number;
  is_seed: boolean;
  role: Role;
  role_score: number;
  cluster_id: number;
  priority_score: number;
  evidence: string;
  in_deg: number;
  out_deg: number;
  in_kzt: number;
  out_kzt: number;
  truncated_by_depth: boolean;
}

export interface EdgeResponse {
  src: string;
  dst: string;
  sum_kzt: number;
  n_tx: number;
}

export interface ClusterResponse {
  cluster_id: number;
  n_nodes: number;
  n_seed: number;
  sum_kzt_internal: number;
  top_gids: string[];
  hypothesis: string;
}

export interface TopNodeResponse {
  rank: number;
  gid: string;
  role: Role;
  priority_score: number;
  why: string;
}

export interface AnalysisResponse {
  analysis_id: string;
  summary: SummaryResponse;
  nodes: NodeResponse[];
  edges: EdgeResponse[];
  clusters: ClusterResponse[];
  top_nodes: TopNodeResponse[];
}

export interface DataGapResponse {
  code: string;
  description: string;
  evidence: string;
}

export interface NextRequestResponse {
  gap_code: string;
  request: string;
  reason: string;
}

export interface NodeCardResponse {
  analysis_id: string;
  node: NodeResponse;
  incoming: EdgeResponse[];
  outgoing: EdgeResponse[];
  limitations: string[];
  data_gaps: DataGapResponse[];
  next_requests: NextRequestResponse[];
}

export interface UploadResponse {
  analysis_id: string;
  status: 'ready';
  summary: SummaryResponse;
  analysis_url: '/api/analysis';
}

export interface AskRequest {
  analysis_id: string;
  question: string;
  context_gids: string[];
}

export interface AskResponse {
  analysis_id: string;
  answer: string;
  references: { gid: string; facts: string[] }[];
  limitations: string[];
}

export type ExportName = 'nodes_roles.csv' | 'clusters.csv' | 'top_nodes.csv';
