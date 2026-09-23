from threading import Lock

from money_graph.application.dto.active_analysis import AnalysisSnapshot


class MemoryAnalysisStore:
    def __init__(self) -> None:
        self._active: AnalysisSnapshot | None = None
        self._state_lock = Lock()
        self._analysis_lock = Lock()

    def get(self) -> AnalysisSnapshot | None:
        with self._state_lock:
            return self._active

    def replace(self, snapshot: AnalysisSnapshot) -> None:
        with self._state_lock:
            self._active = snapshot

    def try_start_analysis(self) -> bool:
        return self._analysis_lock.acquire(blocking=False)

    def finish_analysis(self) -> None:
        self._analysis_lock.release()
