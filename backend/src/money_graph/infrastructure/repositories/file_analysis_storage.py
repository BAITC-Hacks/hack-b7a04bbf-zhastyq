import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from money_graph.application.dto.active_analysis import AnalysisWorkspace, DatasetUpload
from money_graph.application.exceptions import ApiError


class FileAnalysisStorage:
    def __init__(self, root: Path, max_file_bytes: int = 25 * 1024 * 1024) -> None:
        self._root = root
        self._max_file_bytes = max_file_bytes

    def _save(self, upload: DatasetUpload, directory: Path) -> None:
        path = directory / f"{upload.name}.parquet"
        size = 0
        with path.open("wb") as target:
            while chunk := upload.stream.read(64 * 1024):
                size += len(chunk)
                if size > self._max_file_bytes:
                    raise ApiError(
                        "FILE_TOO_LARGE",
                        "Файл превышает допустимый размер",
                        {"file": path.name, "max_bytes": self._max_file_bytes},
                    )
                target.write(chunk)

    @contextmanager
    def prepare(
        self,
        analysis_id: str,
        uploads: tuple[DatasetUpload, ...],
    ) -> Iterator[AnalysisWorkspace]:
        self._root.mkdir(parents=True, exist_ok=True)
        output = self._root / analysis_id
        output.mkdir()
        try:
            with TemporaryDirectory(prefix=".upload-", dir=self._root) as temporary:
                source = Path(temporary)
                for upload in uploads:
                    self._save(upload, source)
                yield AnalysisWorkspace(source, output)
        except BaseException:
            shutil.rmtree(output)
            raise

    def export_path(self, output_dir: Path, name: str) -> Path:
        path = output_dir / name
        if not path.is_file() or path.is_symlink():
            raise ApiError("EXPORT_NOT_FOUND", "Файл экспорта недоступен")
        return path
