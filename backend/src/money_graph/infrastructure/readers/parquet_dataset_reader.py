from collections.abc import Callable
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import TypeVar

import pyarrow as pa
import pyarrow.parquet as pq

from money_graph.application.exceptions import DatasetReadError
from money_graph.domain.entities.edge import Edge
from money_graph.domain.entities.node import Node
from money_graph.domain.entities.transaction import Transaction
from money_graph.domain.models.dataset import Dataset

T = TypeVar("T")


def _signed_integer(dtype: pa.DataType) -> bool:
    return pa.types.is_signed_integer(dtype)


SCHEMAS: dict[str, dict[str, Callable[[pa.DataType], bool]]] = {
    "nodes": {"gid": pa.types.is_int64, "depth": _signed_integer, "is_seed": pa.types.is_boolean},
    "edges": {
        "src": pa.types.is_int64,
        "dst": pa.types.is_int64,
        "sum_kzt": pa.types.is_float64,
        "n_tx": pa.types.is_int64,
        "depth": pa.types.is_int8,
    },
    "transactions": {
        "src": pa.types.is_int64,
        "dst": pa.types.is_int64,
        "date": pa.types.is_date,
        "sum_kzt": pa.types.is_float64,
    },
}


def _column(table: pa.Table, path: Path, name: str, expected: type[T]) -> list[T]:
    values: list[T] = []
    for row, scalar in enumerate(table[name], start=1):
        try:
            value = scalar.as_py()
        except (ValueError, OverflowError, pa.ArrowException) as error:
            raise DatasetReadError(
                f"{path}: строка {row}, поле {name}: значение невозможно прочитать"
            ) from error
        if type(value) is not expected:
            raise DatasetReadError(
                f"{path}: строка {row}, поле {name}: пропуск или неверный тип значения"
            )
        values.append(value)
    return values


def _table(path: Path, name: str) -> pa.Table:
    try:
        with path.open("rb") as source:
            parquet = pq.ParquetFile(source)
            schema = parquet.schema_arrow
            for column, accepts in SCHEMAS[name].items():
                if schema.names.count(column) != 1:
                    raise DatasetReadError(
                        f"{path}: поле {column}: обязательная колонка отсутствует или повторяется"
                    )
                if not accepts(schema.field(column).type):
                    raise DatasetReadError(
                        f"{path}: поле {column}: неверный тип {schema.field(column).type}"
                    )
            return parquet.read(columns=list(SCHEMAS[name]), use_threads=False)
    except (OSError, pa.ArrowException) as error:
        raise DatasetReadError(
            f"{path}: не удалось прочитать Parquet ({type(error).__name__})"
        ) from error


class ParquetDatasetReader:
    def read(self, data_dir: Path) -> Dataset:
        nodes_path = data_dir / "nodes.parquet"
        edges_path = data_dir / "edges.parquet"
        transactions_path = data_dir / "transactions.parquet"
        nodes = _table(nodes_path, "nodes")
        edges = _table(edges_path, "edges")
        transactions = _table(transactions_path, "transactions")
        return Dataset(
            nodes=tuple(
                Node(*values)
                for values in zip(
                    _column(nodes, nodes_path, "gid", int),
                    _column(nodes, nodes_path, "depth", int),
                    _column(nodes, nodes_path, "is_seed", bool),
                    strict=True,
                )
            ),
            edges=tuple(
                Edge(src, dst, Decimal(str(amount)), n_tx, depth)
                for src, dst, amount, n_tx, depth in zip(
                    _column(edges, edges_path, "src", int),
                    _column(edges, edges_path, "dst", int),
                    _column(edges, edges_path, "sum_kzt", float),
                    _column(edges, edges_path, "n_tx", int),
                    _column(edges, edges_path, "depth", int),
                    strict=True,
                )
            ),
            transactions=tuple(
                Transaction(src, dst, day, Decimal(str(amount)))
                for src, dst, day, amount in zip(
                    _column(transactions, transactions_path, "src", int),
                    _column(transactions, transactions_path, "dst", int),
                    _column(transactions, transactions_path, "date", date),
                    _column(transactions, transactions_path, "sum_kzt", float),
                    strict=True,
                )
            ),
        )
