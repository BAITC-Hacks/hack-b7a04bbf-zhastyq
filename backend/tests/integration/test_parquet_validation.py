import hashlib
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from money_graph.application.exceptions import DatasetReadError
from money_graph.application.use_cases.validate_dataset import ValidateDataset
from money_graph.domain.services.dataset_validator import DatasetValidationError
from money_graph.infrastructure.readers.parquet_dataset_reader import ParquetDatasetReader


@pytest.fixture
def parquet_dir(tmp_path):
    tables = {
        "nodes": pa.table(
            {
                "gid": pa.array([100000005382566100, 2, 3], type=pa.int64()),
                "depth": pa.array([0, 1, 0], type=pa.int64()),
                "is_seed": [True, False, True],
            }
        ),
        "edges": pa.table(
            {
                "src": pa.array([100000005382566100], type=pa.int64()),
                "dst": pa.array([2], type=pa.int64()),
                "sum_kzt": [10000.0],
                "n_tx": pa.array([2], type=pa.int64()),
                "depth": pa.array([1], type=pa.int8()),
            }
        ),
        "transactions": pa.table(
            {
                "src": pa.array([100000005382566100] * 2, type=pa.int64()),
                "dst": pa.array([2, 2], type=pa.int64()),
                "date": pa.array([date(2026, 7, 1)] * 2, type=pa.date32()),
                "sum_kzt": [5000.0, 5000.0],
            }
        ),
    }
    for name, table in tables.items():
        pq.write_table(table, tmp_path / f"{name}.parquet")
    return tmp_path


def execute(path):
    return ValidateDataset(ParquetDatasetReader()).execute(path)


def change_column(directory, table_name, field, values, dtype):
    path = directory / f"{table_name}.parquet"
    table = pq.read_table(path)
    values = pa.array(values, type=dtype)
    table = table.set_column(table.schema.get_field_index(field), field, values)
    pq.write_table(table, path)


def run_cli(directory):
    script = Path(sys.executable).parent / "money-graph"
    return subprocess.run(
        [str(script), "validate", "--data-dir", str(directory)],
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "PYTHONUTF8": "1"},
    )


def test_read_preserves_all_records_and_source(parquet_dir, dataset):
    before = {p.name: hashlib.sha256(p.read_bytes()).digest() for p in parquet_dir.iterdir()}
    assert ParquetDatasetReader().read(parquet_dir) == dataset
    result = execute(parquet_dir)
    assert (result.n_nodes, result.n_edges, result.n_transactions, result.n_seed) == (3, 1, 2, 2)
    assert before == {
        p.name: hashlib.sha256(p.read_bytes()).digest() for p in parquet_dir.iterdir()
    }


def test_cli_success(parquet_dir):
    result = run_cli(parquet_dir)
    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout.splitlines() == [
        "Статус: OK",
        "Узлов: 3",
        "Рёбер: 1",
        "Транзакций: 2",
        "Seed: 2",
    ]


@pytest.mark.parametrize("name", ["nodes", "edges", "transactions"])
def test_missing_file_cli(parquet_dir, name):
    (parquet_dir / f"{name}.parquet").unlink()
    result = run_cli(parquet_dir)
    assert result.returncode == 1
    assert f"{name}.parquet" in result.stderr
    assert "Traceback" not in result.stderr
    assert result.stdout == ""


@pytest.mark.parametrize(
    "name,field",
    [
        ("nodes", "gid"),
        ("nodes", "depth"),
        ("nodes", "is_seed"),
        ("edges", "src"),
        ("edges", "dst"),
        ("edges", "sum_kzt"),
        ("edges", "n_tx"),
        ("edges", "depth"),
        ("transactions", "src"),
        ("transactions", "dst"),
        ("transactions", "date"),
        ("transactions", "sum_kzt"),
    ],
)
@pytest.mark.parametrize("problem", ["missing", "null"])
def test_required_columns(parquet_dir, name, field, problem):
    path = parquet_dir / f"{name}.parquet"
    table = pq.read_table(path)
    if problem == "missing":
        table = table.drop([field])
    else:
        index = table.schema.get_field_index(field)
        table = table.set_column(index, field, pa.nulls(len(table), table[field].type))
    pq.write_table(table, path)
    with pytest.raises(DatasetReadError, match=rf"{name}.*{field}"):
        execute(parquet_dir)


@pytest.mark.parametrize(
    "name,field,values,dtype",
    [
        ("nodes", "gid", [1.0, 2.0, 3.0], pa.float64()),
        ("nodes", "depth", [False, True, False], pa.bool_()),
        ("nodes", "is_seed", [1, 0, 1], pa.int64()),
        ("edges", "src", ["100000005382566100"], pa.string()),
        ("edges", "n_tx", [1.5], pa.float64()),
        ("edges", "depth", [1], pa.int64()),
        ("edges", "sum_kzt", [10000], pa.int64()),
        ("transactions", "date", ["2026-02-30"] * 2, pa.string()),
        ("transactions", "sum_kzt", ["5000"] * 2, pa.string()),
    ],
)
def test_invalid_schema_types(parquet_dir, name, field, values, dtype):
    change_column(parquet_dir, name, field, values, dtype)
    with pytest.raises(DatasetReadError, match=rf"{name}.*{field}.*тип"):
        execute(parquet_dir)


@pytest.mark.parametrize("name", ["edges", "transactions"])
@pytest.mark.parametrize("amount", [float("nan"), float("inf"), -float("inf"), -1.0, 0.0, 4999.99])
def test_invalid_money(parquet_dir, name, amount):
    change_column(
        parquet_dir, name, "sum_kzt", [amount] * (1 if name == "edges" else 2), pa.float64()
    )
    with pytest.raises(DatasetValidationError, match=rf"{name}.*строка 1.*sum_kzt"):
        execute(parquet_dir)


@pytest.mark.parametrize(
    "name,field,values,dtype",
    [
        ("nodes", "gid", [2, 2, 3], pa.int64()),
        ("nodes", "depth", [0, 5, 0], pa.int64()),
        ("nodes", "is_seed", [False, False, True], pa.bool_()),
        ("edges", "src", [999], pa.int64()),
        ("edges", "dst", [999], pa.int64()),
        ("edges", "n_tx", [0], pa.int64()),
        ("edges", "depth", [0], pa.int8()),
        ("transactions", "src", [999, 999], pa.int64()),
        ("transactions", "dst", [999, 999], pa.int64()),
        ("transactions", "date", [date(2026, 8, 1)] * 2, pa.date32()),
    ],
)
def test_invalid_values_cli(parquet_dir, name, field, values, dtype):
    change_column(parquet_dir, name, field, values, dtype)
    result = run_cli(parquet_dir)
    assert result.returncode == 1
    assert f"{name}.parquet" in result.stderr
    assert field in result.stderr
    assert "строка" in result.stderr
    assert "Traceback" not in result.stderr


def test_duplicate_edges(parquet_dir):
    path = parquet_dir / "edges.parquet"
    table = pq.read_table(path)
    pq.write_table(pa.concat_tables([table, table]), path)
    with pytest.raises(DatasetValidationError, match="edges.*строка 2.*src/dst"):
        execute(parquet_dir)


def test_corrupt_parquet(parquet_dir):
    (parquet_dir / "edges.parquet").write_bytes(b"not parquet")
    result = run_cli(parquet_dir)
    assert result.returncode == 1
    assert "edges.parquet" in result.stderr
    assert "Traceback" not in result.stderr


def test_permission_error(parquet_dir, monkeypatch):
    original = Path.open

    def denied(path, *args, **kwargs):
        if path.name == "edges.parquet":
            raise PermissionError("denied")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", denied)
    with pytest.raises(DatasetReadError, match="edges.parquet.*PermissionError"):
        execute(parquet_dir)


def test_unrepresentable_date(parquet_dir):
    path = parquet_dir / "transactions.parquet"
    table = pq.read_table(path)
    dates = pa.array([2**31 - 1] * 2, type=pa.int32()).view(pa.date32())
    table = table.set_column(table.schema.get_field_index("date"), "date", dates)
    pq.write_table(table, path)
    with pytest.raises(DatasetReadError, match="transactions.*строка 1.*date"):
        execute(parquet_dir)


def test_extra_columns_are_ignored(parquet_dir):
    path = parquet_dir / "nodes.parquet"
    table = pq.read_table(path).append_column("description", pa.array(["x"] * 3))
    pq.write_table(table, path)
    assert execute(parquet_dir).n_nodes == 3
