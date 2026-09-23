from money_graph.application.dto.active_analysis import ExportFile
from money_graph.application.exceptions import ApiError
from money_graph.application.interfaces.analysis_files import AnalysisFiles
from money_graph.application.use_cases.get_analysis import GetAnalysis

EXPORT_NAMES = frozenset({"nodes_roles.csv", "clusters.csv", "top_nodes.csv"})


class GetExport:
    def __init__(self, analysis: GetAnalysis, files: AnalysisFiles) -> None:
        self._analysis = analysis
        self._files = files

    def execute(self, name: str) -> ExportFile:
        if name not in EXPORT_NAMES:
            raise ApiError("EXPORT_NOT_FOUND", "Такой файл экспорта не существует")
        snapshot = self._analysis.execute()
        path = self._files.export_path(snapshot.output_dir, name)
        return ExportFile(snapshot.analysis_id, name, path)
