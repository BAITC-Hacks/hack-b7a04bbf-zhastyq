import re
from decimal import Decimal, localcontext
from uuid import uuid4

from money_graph.application.dto.active_analysis import (
    AnalysisSnapshot,
    AnalysisStatistics,
    DatasetUpload,
    NodeView,
)
from money_graph.application.exceptions import ApiError, DatasetReadError
from money_graph.application.interfaces.active_analysis_store import ActiveAnalysisStore
from money_graph.application.interfaces.analysis_files import AnalysisFiles
from money_graph.application.use_cases.analyze_dataset import AnalyzeDataset
from money_graph.domain.services.dataset_validator import DatasetValidationError
from money_graph.domain.services.observation_policy import is_observation_boundary


class PublishAnalysis:
    def __init__(
        self,
        analyzer: AnalyzeDataset,
        store: ActiveAnalysisStore,
        files: AnalysisFiles,
    ) -> None:
        self._analyzer = analyzer
        self._store = store
        self._files = files

    def execute(self, uploads: tuple[DatasetUpload, ...]) -> AnalysisSnapshot:
        if not self._store.try_start_analysis():
            raise ApiError("ANALYSIS_BUSY", "Другой анализ уже выполняется")
        try:
            if sorted(upload.name for upload in uploads) != ["edges", "nodes", "transactions"]:
                raise ApiError(
                    "INVALID_SCHEMA", "Нужны ровно три файла: nodes, edges, transactions"
                )
            for upload in uploads:
                if not upload.filename.lower().endswith(".parquet"):
                    raise ApiError(
                        "INVALID_SCHEMA",
                        "Принимаются только Parquet-файлы",
                        {"file": f"{upload.name}.parquet"},
                    )
            analysis_id = uuid4().hex
            with self._files.prepare(analysis_id, uploads) as workspace:
                calculation = self._analyzer.execute(workspace.input_dir, workspace.output_dir)
                result = calculation.result
                with localcontext() as context:
                    context.prec = 400
                    volume = sum((edge.sum_kzt for edge in calculation.edges), Decimal(0))
                snapshot = AnalysisSnapshot(
                    analysis_id,
                    AnalysisStatistics(
                        len(result.nodes),
                        len(calculation.edges),
                        calculation.n_transactions,
                        sum(node.features.is_seed for node in result.nodes),
                        len(result.clusters),
                        volume,
                    ),
                    result,
                    tuple(
                        NodeView(node, is_observation_boundary(node.features))
                        for node in result.nodes
                    ),
                    calculation.edges,
                    workspace.output_dir,
                    calculation.temporal,
                )
            self._store.replace(snapshot)
            return snapshot
        except (DatasetReadError, DatasetValidationError) as error:
            match = re.search(r"(nodes|edges|transactions)\.parquet: (.*)", str(error))
            if match:
                filename = f"{match[1]}.parquet"
                raise ApiError(
                    "INVALID_SCHEMA", f"{filename}: {match[2]}", {"file": filename}
                ) from error
            raise ApiError("INVALID_SCHEMA", "Набор не соответствует схеме") from error
        finally:
            self._store.finish_analysis()
