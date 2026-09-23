import json
from dataclasses import asdict, dataclass

from money_graph.domain.models.analysis import Role


@dataclass(frozen=True)
class ContextNode:
    gid: str
    selected: bool
    role: Role
    role_score: float
    priority_score: float
    evidence: str
    priority_reason: str
    in_degree: int
    out_degree: int
    incoming_kzt: str
    outgoing_kzt: str
    incoming_transactions: int
    outgoing_transactions: int
    seed_neighbors: int
    depth: int
    is_seed: bool
    top_rank: int | None


@dataclass(frozen=True)
class ContextEdge:
    src: str
    dst: str
    sum_kzt: str
    n_tx: int


@dataclass(frozen=True)
class QuestionContext:
    nodes: tuple[ContextNode, ...]
    edges: tuple[ContextEdge, ...]
    total_related_edges: int
    limitations: tuple[str, ...]

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, separators=(",", ":"))


@dataclass(frozen=True)
class ModelAnswer:
    answer: str
    referenced_gids: tuple[str, ...]


@dataclass(frozen=True)
class AnswerReference:
    gid: str
    facts: tuple[str, ...]


@dataclass(frozen=True)
class QuestionAnswer:
    analysis_id: str
    answer: str
    references: tuple[AnswerReference, ...]
    limitations: tuple[str, ...]
