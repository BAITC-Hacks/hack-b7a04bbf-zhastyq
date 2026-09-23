from dataclasses import dataclass

from money_graph.domain.entities.edge import Edge
from money_graph.domain.models.analysis import AnalysisResult
from money_graph.domain.models.temporal import TemporalAnalysis


@dataclass(frozen=True)
class AnalysisSummary:
    result: AnalysisResult
    n_transactions: int
    elapsed_seconds: float
    edges: tuple[Edge, ...]
    temporal: TemporalAnalysis = TemporalAnalysis()
