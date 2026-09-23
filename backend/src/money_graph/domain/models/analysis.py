from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

Role = Literal["consolidator", "transit", "distributor", "terminal", "coordinator", "peripheral"]


@dataclass(frozen=True)
class NodeFeatures:
    gid: int
    depth: int
    is_seed: bool
    in_degree: int
    out_degree: int
    incoming_kzt: Decimal
    outgoing_kzt: Decimal
    incoming_transactions: int
    outgoing_transactions: int
    seed_neighbors: int


@dataclass(frozen=True)
class Community:
    cluster_id: int
    gids: tuple[int, ...]
    internal_kzt: Decimal


@dataclass(frozen=True)
class GraphFacts:
    nodes: tuple[NodeFeatures, ...]
    communities: tuple[Community, ...]


@dataclass(frozen=True)
class RoleDecision:
    role: Role
    score: float
    evidence: str


@dataclass(frozen=True)
class Priority:
    score: float
    why: str


@dataclass(frozen=True)
class NodeAnalysis:
    features: NodeFeatures
    decision: RoleDecision
    cluster_id: int
    priority: Priority


@dataclass(frozen=True)
class ClusterAnalysis:
    cluster_id: int
    n_nodes: int
    n_seed: int
    sum_kzt_internal: Decimal
    top_gids: tuple[int, ...]
    hypothesis: str


@dataclass(frozen=True)
class AnalysisResult:
    nodes: tuple[NodeAnalysis, ...]
    clusters: tuple[ClusterAnalysis, ...]
    top_nodes: tuple[NodeAnalysis, ...]
