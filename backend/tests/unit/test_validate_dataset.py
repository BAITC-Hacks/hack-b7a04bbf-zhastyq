from dataclasses import replace
from pathlib import Path

import pytest

from money_graph.application.dto.validation_result import ValidationResult
from money_graph.application.exceptions import DatasetReadError
from money_graph.application.use_cases.validate_dataset import ValidateDataset
from money_graph.domain.services.dataset_validator import DatasetValidationError


class StubReader:
    def __init__(self, dataset):
        self.dataset = dataset
        self.paths = []

    def read(self, data_dir):
        self.paths.append(data_dir)
        return self.dataset


def test_summary_and_reader_argument(dataset):
    reader = StubReader(dataset)
    result = ValidateDataset(reader).execute(Path("example"))
    assert result == ValidationResult(3, 1, 2, 2)
    assert reader.paths == [Path("example")]


def test_use_case_validates_reader_result(dataset):
    reader = StubReader(replace(dataset, nodes=dataset.nodes * 2))
    with pytest.raises(DatasetValidationError, match="gid"):
        ValidateDataset(reader).execute(Path("example"))


def test_read_error_propagates():
    class FailedReader:
        def read(self, data_dir):
            raise DatasetReadError("nodes.parquet: файл недоступен")

    with pytest.raises(DatasetReadError, match="файл недоступен"):
        ValidateDataset(FailedReader()).execute(Path("example"))
