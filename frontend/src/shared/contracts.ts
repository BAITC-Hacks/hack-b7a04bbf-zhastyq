export type Role =
  | 'consolidator'
  | 'transit'
  | 'distributor'
  | 'terminal'
  | 'coordinator'
  | 'peripheral';

export interface NodeSummary {
  gid: string;
  role: Role;
  role_score: number;
  priority_score: number;
  cluster_id: number;
  evidence: string;
  is_seed: boolean;
  depth: number;
}

export interface TopNode extends NodeSummary {
  rank: number;
  why: string;
}

export interface NodeDetails extends NodeSummary {
  incoming_sum_kzt: number;
  outgoing_sum_kzt: number;
  unique_payers: number;
  unique_recipients: number;
}

export interface TransferEdge {
  source: string;
  target: string;
  sum_kzt: number;
  n_tx: number;
}

export interface GraphSlice {
  center_gid: string;
  nodes: NodeSummary[];
  edges: TransferEdge[];
}

export interface GraphViewProps {
  graph: GraphSlice | null;
  selectedGid: string | null;
  loading: boolean;
  onSelectGid: (gid: string) => void;
}
