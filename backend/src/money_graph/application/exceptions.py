class DatasetReadError(ValueError):
    """Невозможно прочитать набор по заданной схеме."""


class AnalysisExportError(ValueError):
    """Не удалось опубликовать CSV анализа."""


class ApiError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, str | int | list[str]] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
