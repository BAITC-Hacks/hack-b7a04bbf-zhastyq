from pathlib import Path
from typing import Protocol

from money_graph.domain.models.dataset import Dataset


class DatasetReader(Protocol):
    def read(self, data_dir: Path) -> Dataset: ...
