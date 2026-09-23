from dataclasses import replace
from datetime import date, datetime
from decimal import Decimal

import pytest

from money_graph.domain.models.dataset import Dataset
from money_graph.domain.services.dataset_validator import DatasetValidationError, validate_dataset


def test_preserves_isolated_nodes_and_identical_transactions(dataset):
    validate_dataset(dataset)
    assert len(dataset.nodes) == 3
    assert dataset.transactions[0] == dataset.transactions[1]
    assert len(dataset.transactions) == 2


def test_empty_dataset_and_isolated_only_are_valid(dataset):
    validate_dataset(Dataset((), (), ()))
    validate_dataset(Dataset(dataset.nodes, (), ()))


@pytest.mark.parametrize(
    ("table", "field", "value"),
    [
        ("nodes", "gid", True),
        ("nodes", "gid", 2**63),
        ("nodes", "depth", -1),
        ("nodes", "depth", 5),
        ("nodes", "is_seed", 1),
        ("nodes", "is_seed", False),
        ("edges", "src", 999),
        ("edges", "dst", 999),
        ("edges", "n_tx", 0),
        ("edges", "n_tx", -1),
        ("edges", "n_tx", 1.5),
        ("edges", "n_tx", True),
        ("edges", "depth", 0),
        ("edges", "depth", 5),
        ("transactions", "src", 999),
        ("transactions", "dst", 999),
        ("transactions", "date", "2026-07-01"),
        ("transactions", "date", datetime(2026, 7, 1)),
        ("transactions", "date", date(2026, 6, 30)),
        ("transactions", "date", date(2026, 8, 1)),
    ],
)
def test_invalid_fields(dataset, table, field, value):
    records = getattr(dataset, table)
    changed = (replace(records[0], **{field: value}), *records[1:])
    with pytest.raises(DatasetValidationError, match=rf"{table}.*строка 1.*{field}"):
        validate_dataset(replace(dataset, **{table: changed}))


@pytest.mark.parametrize("table", ["edges", "transactions"])
@pytest.mark.parametrize("value", ["NaN", "sNaN", "Infinity", "-Infinity", "-1", "0", "4999.99"])
def test_invalid_amounts(dataset, table, value):
    records = getattr(dataset, table)
    changed = (replace(records[0], sum_kzt=Decimal(value)), *records[1:])
    with pytest.raises(DatasetValidationError, match="sum_kzt"):
        validate_dataset(replace(dataset, **{table: changed}))


def test_duplicate_gid(dataset):
    with pytest.raises(DatasetValidationError, match="nodes.*строка 4.*gid"):
        validate_dataset(replace(dataset, nodes=(*dataset.nodes, dataset.nodes[0])))


def test_duplicate_edge(dataset):
    with pytest.raises(DatasetValidationError, match="edges.*строка 2.*src/dst"):
        validate_dataset(replace(dataset, edges=dataset.edges * 2))


def test_transaction_pair_missing_from_edges(dataset):
    with pytest.raises(DatasetValidationError, match="transactions.*src/dst"):
        validate_dataset(replace(dataset, edges=()))


def test_depth_and_date_upper_boundaries(dataset):
    validate_dataset(
        replace(
            dataset,
            nodes=(dataset.nodes[0], replace(dataset.nodes[1], depth=4), dataset.nodes[2]),
            edges=(replace(dataset.edges[0], depth=4),),
            transactions=(replace(dataset.transactions[0], date=date(2026, 7, 31)),),
        )
    )
