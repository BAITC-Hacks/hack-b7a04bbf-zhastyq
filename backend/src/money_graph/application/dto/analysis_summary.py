from dataclasses import dataclass

from money_graph.domain.models.analysis import AnalysisResult


@dataclass(frozen=True)
class AnalysisSummary:
    result: AnalysisResult
    n_transactions: int
    elapsed_seconds: float
