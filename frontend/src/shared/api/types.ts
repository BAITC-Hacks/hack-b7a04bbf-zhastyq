import type { NodeDetails, Role, TransferEdge, TopNode } from '../contracts';

export interface ApiNode {
  gid: string; role: Role; role_score: number; priority_score: number;
  cluster_id: number; evidence: string; is_seed: boolean; depth: number;
  in_deg: number; out_deg: number; in_kzt: number; out_kzt: number; truncated_by_depth: boolean;
}
export interface ApiEdge { src: string; dst: string; sum_kzt: number; n_tx: number }
export interface Summary {
  n_nodes: number; n_edges: number; n_transactions: number; n_seed: number;
  n_clusters: number; edge_volume_kzt: number;
}
export interface Cluster {
  cluster_id: number; n_nodes: number; n_seed: number; sum_kzt_internal: number;
  top_gids: string[]; hypothesis: string;
}
export interface TemporalSummary {
  rapid_outflow: number; synchronized_inflow: number; activity_spike: number; n_nodes: number;
}
interface Observation { date: string; explanation: string; limitations: string[] }
export type TemporalPattern = Observation & (
  | { kind: 'rapid_outflow'; incoming_n_tx: number; incoming_sum_kzt: number;
      outgoing_days: { date: string; interval_days: number; n_tx: number; sum_kzt: number }[] }
  | { kind: 'synchronized_inflow'; sender_gids: string[]; n_senders: number; n_tx: number; sum_kzt: number }
  | { kind: 'activity_spike'; n_tx: number; sum_kzt: number; period_start: string; period_end: string;
      period_days: number; period_n_tx: number; average_daily_n_tx: number; multiple: number;
      min_daily_n_tx: number; min_multiple: number }
);
export interface CardObservations {
  limitations: string[];
  data_gaps: { code: string; description: string; evidence: string }[];
  next_requests: { gap_code: string; request: string; reason: string }[];
  temporal_patterns: { items: TemporalPattern[]; total_count: number; truncated: boolean };
}
export interface ApiCard extends CardObservations {
  analysis_id: string; node: ApiNode; incoming: ApiEdge[]; outgoing: ApiEdge[];
}
export interface NodeCardData extends CardObservations {
  analysis_id: string; node: NodeDetails; incoming: TransferEdge[]; outgoing: TransferEdge[];
}
export interface ApiAnalysis {
  analysis_id: string; summary: Summary; nodes: ApiNode[]; edges: ApiEdge[];
  clusters: Cluster[]; top_nodes: { rank: number; gid: string; role: Role; priority_score: number; why: string }[];
  temporal_summary: TemporalSummary;
}
export interface Analysis {
  analysis_id: string; summary: Summary; nodes: NodeDetails[]; edges: TransferEdge[];
  clusters: Cluster[]; top_nodes: TopNode[]; temporal_summary: TemporalSummary;
}
export interface AiAnswer {
  analysis_id: string; answer: string; references: { gid: string; facts: string[] }[]; limitations: string[];
}
