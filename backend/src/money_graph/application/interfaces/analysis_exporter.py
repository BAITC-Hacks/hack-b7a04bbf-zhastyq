from pathlib import Path
from typing import Protocol

from money_graph.domain.models.analysis import AnalysisResult


class AnalysisExporter(Protocol):
    def export(self, result: AnalysisResult, output_dir: Path) -> None: ...
