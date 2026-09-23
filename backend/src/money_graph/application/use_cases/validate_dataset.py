from pathlib import Path

from money_graph.application.dto.validation_result import ValidationResult
from money_graph.application.interfaces.dataset_reader import DatasetReader
from money_graph.domain.services.dataset_validator import validate_dataset


class ValidateDataset:
    def __init__(self, reader: DatasetReader) -> None:
        self._reader = reader

    def execute(self, data_dir: Path) -> ValidationResult:
        dataset = self._reader.read(data_dir)
        validate_dataset(dataset)
        return ValidationResult(
            n_nodes=len(dataset.nodes),
            n_edges=len(dataset.edges),
            n_transactions=len(dataset.transactions),
            n_seed=sum(node.is_seed for node in dataset.nodes),
        )
