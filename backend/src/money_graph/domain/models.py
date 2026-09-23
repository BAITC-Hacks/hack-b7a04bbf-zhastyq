from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True, slots=True)
class Node:
    gid: int
    depth: int
    is_seed: bool


@dataclass(frozen=True, slots=True)
class Edge:
    src: int
    dst: int
    sum_kzt: float
    n_tx: int
    depth: int


@dataclass(frozen=True, slots=True)
class Transaction:
    src: int
    dst: int
    date: date
    sum_kzt: float


@dataclass(frozen=True, slots=True)
class NodeFeatures:
    node: Node
    in_deg: int = 0
    out_deg: int = 0
    in_kzt: float = 0.0
    out_kzt: float = 0.0
    in_tx: int = 0
    out_tx: int = 0
    seed_neighbors: int = 0
    pagerank: float = 0.0

    @property
    def truncated_by_depth(self) -> bool:
        return self.node.depth >= 4 and self.out_deg == 0

    @property
    def observed_ratio(self) -> float | None:
        if self.node.is_seed or self.in_kzt <= 0:
            return None
        return self.out_kzt / self.in_kzt


@dataclass(frozen=True, slots=True)
class RoleDecision:
    role: str
    role_score: float
    evidence: str


ROLES = frozenset({"consolidator", "transit", "distributor", "terminal", "coordinator", "peripheral"})
