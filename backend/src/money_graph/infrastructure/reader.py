import csv
from collections import defaultdict
from datetime import date
from math import isfinite
from pathlib import Path
from typing import Any, Mapping

import pyarrow.parquet as parquet
from pyarrow import ArrowException

from money_graph.application.ports import Dataset
from money_graph.application.use_cases import AnalysisError
from money_graph.domain.models import Edge, Node, Transaction


REQUIRED = {
    "nodes": {"gid", "depth", "is_seed"},
    "edges": {"src", "dst", "sum_kzt", "n_tx", "depth"},
    "transactions": {"src", "dst", "date", "sum_kzt"},
}


def _int(value: Any, field: str, filename: str, row: int) -> int:
    try:
        if isinstance(value, bool) or str(value).strip() != str(int(value)):
            raise ValueError
        return int(value)
    except (ValueError, TypeError, OverflowError):
        raise AnalysisError("INVALID_SCHEMA", f"{filename}: строка {row}, {field} должен быть целым числом")


def _amount(value: Any, field: str, filename: str, row: int) -> float:
    try:
        result = float(value)
        if not isfinite(result) or result <= 0:
            raise ValueError
        return result
    except (ValueError, TypeError):
        raise AnalysisError("INVALID_SCHEMA", f"{filename}: строка {row}, {field} должен быть положительным числом")


def _bool(value: Any, filename: str, row: int) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in {"true", "false"}:
        return value.lower() == "true"
    raise AnalysisError("INVALID_SCHEMA", f"{filename}: строка {row}, is_seed должен быть true или false")


def _date(value: Any, filename: str, row: int) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise AnalysisError("INVALID_SCHEMA", f"{filename}: строка {row}, date должен быть YYYY-MM-DD")


class FileDatasetReader:
    def read(self, paths: Mapping[str, str]) -> Dataset:
        missing_files = REQUIRED.keys() - paths.keys()
        if missing_files:
            raise AnalysisError("INVALID_SCHEMA", f"Не хватает файлов: {', '.join(sorted(missing_files))}",
                                {"missing_files": sorted(missing_files)})
        tables = {name: self._table(name, Path(paths[name])) for name in REQUIRED}
        nodes = tuple(self._node(row, i, Path(paths["nodes"]).name) for i, row in enumerate(tables["nodes"], 2))
        edges = tuple(self._edge(row, i, Path(paths["edges"]).name) for i, row in enumerate(tables["edges"], 2))
        transactions = tuple(self._tx(row, i, Path(paths["transactions"]).name) for i, row in enumerate(tables["transactions"], 2))
        self._validate(nodes, edges, transactions)
        return Dataset(nodes, edges, transactions)

    @staticmethod
    def _table(name: str, path: Path) -> list[dict[str, Any]]:
        if path.suffix.lower() not in {".csv", ".parquet"}:
            raise AnalysisError("INVALID_SCHEMA", f"{path.name}: требуется .csv или .parquet")
        try:
            if path.suffix.lower() == ".csv":
                with path.open("r", encoding="utf-8", newline="") as handle:
                    reader = csv.DictReader(handle)
                    columns = set(reader.fieldnames or [])
                    missing = REQUIRED[name] - columns
                    if missing:
                        raise AnalysisError("INVALID_SCHEMA", f"{path.name}: отсутствуют колонки {', '.join(sorted(missing))}",
                                            {"file": path.name, "missing_columns": sorted(missing)})
                    rows = list(reader)
            else:
                table = parquet.read_table(path)
                columns = set(table.column_names)
                missing = REQUIRED[name] - columns
                if missing:
                    raise AnalysisError("INVALID_SCHEMA", f"{path.name}: отсутствуют поля {', '.join(sorted(missing))}",
                                        {"file": path.name, "missing_columns": sorted(missing)})
                rows = table.to_pylist()
        except AnalysisError:
            raise
        except (OSError, UnicodeError, csv.Error, ValueError, ArrowException) as exc:
            raise AnalysisError("INVALID_SCHEMA", f"{path.name}: файл не читается: {type(exc).__name__}")
        if not rows:
            raise AnalysisError("INVALID_SCHEMA", f"{path.name}: файл пуст")
        return rows

    @staticmethod
    def _node(row: dict[str, Any], number: int, filename: str) -> Node:
        gid = _int(row["gid"], "gid", filename, number)
        depth = _int(row["depth"], "depth", filename, number)
        seed = _bool(row["is_seed"], filename, number)
        if gid < 0 or not 0 <= depth <= 4 or seed != (depth == 0):
            raise AnalysisError("INVALID_SCHEMA", f"{filename}: строка {number}, gid/depth/is_seed противоречат схеме обхода")
        return Node(gid, depth, seed)

    @staticmethod
    def _edge(row: dict[str, Any], number: int, filename: str) -> Edge:
        src = _int(row["src"], "src", filename, number)
        dst = _int(row["dst"], "dst", filename, number)
        amount = _amount(row["sum_kzt"], "sum_kzt", filename, number)
        n_tx = _int(row["n_tx"], "n_tx", filename, number)
        depth = _int(row["depth"], "depth", filename, number)
        if src < 0 or dst < 0 or src == dst or n_tx < 1 or not 1 <= depth <= 4:
            raise AnalysisError("INVALID_SCHEMA", f"{filename}: строка {number}, неверное ребро или depth")
        return Edge(src, dst, amount, n_tx, depth)

    @staticmethod
    def _tx(row: dict[str, Any], number: int, filename: str) -> Transaction:
        src = _int(row["src"], "src", filename, number)
        dst = _int(row["dst"], "dst", filename, number)
        amount = _amount(row["sum_kzt"], "sum_kzt", filename, number)
        day = _date(row["date"], filename, number)
        if src < 0 or dst < 0 or src == dst:
            raise AnalysisError("INVALID_SCHEMA", f"{filename}: строка {number}, неверная пара gid")
        return Transaction(src, dst, day, amount)

    @staticmethod
    def _validate(nodes: tuple[Node, ...], edges: tuple[Edge, ...], transactions: tuple[Transaction, ...]) -> None:
        gids = {n.gid for n in nodes}
        if len(gids) != len(nodes):
            raise AnalysisError("INVALID_SCHEMA", "nodes: повторяющийся gid")
        pairs = {(e.src, e.dst) for e in edges}
        if len(pairs) != len(edges):
            raise AnalysisError("INVALID_SCHEMA", "edges: повторяющаяся пара src,dst")
        if any(e.src not in gids or e.dst not in gids for e in edges):
            raise AnalysisError("INVALID_SCHEMA", "edges: src или dst отсутствует в nodes")
        by_pair: dict[tuple[int, int], list[float]] = defaultdict(list)
        for tx in transactions:
            by_pair[tx.src, tx.dst].append(tx.sum_kzt)
        if set(by_pair) != pairs:
            raise AnalysisError("INVALID_SCHEMA", "edges и transactions: набор пар src,dst различается")
        for edge in edges:
            values = by_pair[edge.src, edge.dst]
            if len(values) != edge.n_tx or abs(sum(values) - edge.sum_kzt) > max(0.01, edge.sum_kzt * 1e-9):
                raise AnalysisError("INVALID_SCHEMA", f"edges и transactions: n_tx или sum_kzt не сходятся для {edge.src}→{edge.dst}")
