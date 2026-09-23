from contextlib import AbstractContextManager
from pathlib import Path
from typing import Protocol

from money_graph.application.dto.active_analysis import AnalysisWorkspace, DatasetUpload


class AnalysisFiles(Protocol):
    def prepare(
        self,
        analysis_id: str,
        uploads: tuple[DatasetUpload, ...],
    ) -> AbstractContextManager[AnalysisWorkspace]: ...

    def export_path(self, output_dir: Path, name: str) -> Path: ...
