from typing import Literal

from pydantic import BaseModel

from money_graph.application.dto.active_analysis import AnalysisSnapshot, NodeCard, NodeView
from money_graph.domain.entities.edge import Edge
from money_graph.domain.models.analysis import Role


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    analysis_ready: bool
    ai_configured: Literal[False] = False


class SummaryResponse(BaseModel):
    n_nodes: int
    n_edges: int
    n_transactions: int
    n_seed: int
    n_clusters: int
    edge_volume_kzt: float


class UploadResponse(BaseModel):
    analysis_id: str
    status: Literal["ready"] = "ready"
    summary: SummaryResponse
    analysis_url: Literal["/api/analysis"] = "/api/analysis"


class NodeResponse(BaseModel):
    gid: str
    depth: int
    is_seed: bool
    role: Role
    role_score: float
    cluster_id: int
    priority_score: float
    evidence: str
    in_deg: int
    out_deg: int
    in_kzt: float
    out_kzt: float
    truncated_by_depth: bool


class EdgeResponse(BaseModel):
    src: str
    dst: str
    sum_kzt: float
    n_tx: int


class ClusterResponse(BaseModel):
    cluster_id: int
    n_nodes: int
    n_seed: int
    sum_kzt_internal: float
    top_gids: list[str]
    hypothesis: str


class TopNodeResponse(BaseModel):
    rank: int
    gid: str
    role: Role
    priority_score: float
    why: str


class AnalysisResponse(BaseModel):
    analysis_id: str
    summary: SummaryResponse
    nodes: list[NodeResponse]
    edges: list[EdgeResponse]
    clusters: list[ClusterResponse]
    top_nodes: list[TopNodeResponse]


class NodeCardResponse(BaseModel):
    analysis_id: str
    node: NodeResponse
    incoming: list[EdgeResponse]
    outgoing: list[EdgeResponse]
    limitations: list[str]


def summary_response(snapshot: AnalysisSnapshot) -> SummaryResponse:
    summary = snapshot.summary
    return SummaryResponse(
        n_nodes=summary.n_nodes,
        n_edges=summary.n_edges,
        n_transactions=summary.n_transactions,
        n_seed=summary.n_seed,
        n_clusters=summary.n_clusters,
        edge_volume_kzt=float(summary.edge_volume_kzt),
    )


def node_response(view: NodeView) -> NodeResponse:
    node = view.analysis
    f = node.features
    return NodeResponse(
        gid=str(f.gid),
        depth=f.depth,
        is_seed=f.is_seed,
        role=node.decision.role,
        role_score=node.decision.score,
        cluster_id=node.cluster_id,
        priority_score=node.priority.score,
        evidence=node.decision.evidence,
        in_deg=f.in_degree,
        out_deg=f.out_degree,
        in_kzt=float(f.incoming_kzt),
        out_kzt=float(f.outgoing_kzt),
        truncated_by_depth=view.truncated_by_depth,
    )


def edge_response(edge: Edge) -> EdgeResponse:
    return EdgeResponse(
        src=str(edge.src), dst=str(edge.dst), sum_kzt=float(edge.sum_kzt), n_tx=edge.n_tx
    )


def analysis_response(snapshot: AnalysisSnapshot) -> AnalysisResponse:
    return AnalysisResponse(
        analysis_id=snapshot.analysis_id,
        summary=summary_response(snapshot),
        nodes=[node_response(node) for node in snapshot.nodes],
        edges=[edge_response(edge) for edge in snapshot.edges],
        clusters=[
            ClusterResponse(
                cluster_id=c.cluster_id,
                n_nodes=c.n_nodes,
                n_seed=c.n_seed,
                sum_kzt_internal=float(c.sum_kzt_internal),
                top_gids=[str(gid) for gid in c.top_gids],
                hypothesis=c.hypothesis,
            )
            for c in snapshot.result.clusters
        ],
        top_nodes=[
            TopNodeResponse(
                rank=rank,
                gid=str(node.features.gid),
                role=node.decision.role,
                priority_score=node.priority.score,
                why=node.priority.why,
            )
            for rank, node in enumerate(snapshot.result.top_nodes, start=1)
        ],
    )


def card_response(card: NodeCard) -> NodeCardResponse:
    return NodeCardResponse(
        analysis_id=card.analysis_id,
        node=node_response(card.node),
        incoming=[edge_response(edge) for edge in card.incoming],
        outgoing=[edge_response(edge) for edge in card.outgoing],
        limitations=list(card.limitations),
    )
