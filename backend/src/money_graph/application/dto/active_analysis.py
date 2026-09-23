from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import BinaryIO, Literal

from money_graph.domain.entities.edge import Edge
from money_graph.domain.models.analysis import AnalysisResult, NodeAnalysis
from money_graph.domain.models.observation import ObservationAdvice
from money_graph.domain.models.temporal import TemporalAnalysis, TemporalPattern

UploadName = Literal["nodes", "edges", "transactions"]


@dataclass(frozen=True)
class DatasetUpload:
    name: UploadName
    filename: str
    stream: BinaryIO


@dataclass(frozen=True)
class AnalysisStatistics:
    n_nodes: int
    n_edges: int
    n_transactions: int
    n_seed: int
    n_clusters: int
    edge_volume_kzt: Decimal


@dataclass(frozen=True)
class NodeView:
    analysis: NodeAnalysis
    truncated_by_depth: bool


@dataclass(frozen=True)
class AnalysisSnapshot:
    analysis_id: str
    summary: AnalysisStatistics
    result: AnalysisResult
    nodes: tuple[NodeView, ...]
    edges: tuple[Edge, ...]
    output_dir: Path
    temporal: TemporalAnalysis = TemporalAnalysis()


@dataclass(frozen=True)
class TemporalPatternPage:
    items: tuple[TemporalPattern, ...]
    total_count: int
    truncated: bool


@dataclass(frozen=True)
class NodeCard:
    analysis_id: str
    node: NodeView
    incoming: tuple[Edge, ...]
    outgoing: tuple[Edge, ...]
    limitations: tuple[str, ...]
    observation_advice: tuple[ObservationAdvice, ...]
    temporal_patterns: TemporalPatternPage


@dataclass(frozen=True)
class AnalysisWorkspace:
    input_dir: Path
    output_dir: Path


@dataclass(frozen=True)
class ExportFile:
    analysis_id: str
    name: str
    path: Path
