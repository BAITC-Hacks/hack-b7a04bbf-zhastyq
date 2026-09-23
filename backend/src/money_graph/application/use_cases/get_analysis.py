from money_graph.application.dto.active_analysis import AnalysisSnapshot
from money_graph.application.exceptions import ApiError
from money_graph.application.interfaces.active_analysis_store import ActiveAnalysisStore


class GetAnalysis:
    def __init__(self, store: ActiveAnalysisStore) -> None:
        self._store = store

    def optional(self) -> AnalysisSnapshot | None:
        return self._store.get()

    def execute(self) -> AnalysisSnapshot:
        snapshot = self.optional()
        if snapshot is None:
            raise ApiError("NO_ANALYSIS", "Сначала загрузите набор данных")
        return snapshot
