from datetime import date
from decimal import Decimal

from money_graph.domain.models.dataset import Dataset
from money_graph.domain.services.observation_policy import OBSERVATION_END, OBSERVATION_START


class DatasetValidationError(ValueError):
    """Набор нарушает правила исходной выборки."""


def _fail(table: str, row: int, field: str, message: str) -> None:
    raise DatasetValidationError(f"{table}.parquet: строка {row}, поле {field}: {message}")


def _integer(value: int, table: str, row: int, field: str) -> None:
    if type(value) is not int or not -(2**63) <= value < 2**63:
        _fail(table, row, field, "ожидается целое число int64")


def _amount(value: Decimal, table: str, row: int) -> None:
    if not isinstance(value, Decimal) or not value.is_finite():
        _fail(table, row, "sum_kzt", "ожидается конечная денежная сумма")
    if value < Decimal("5000"):
        _fail(table, row, "sum_kzt", "сумма должна быть не меньше 5000 KZT")


def _reference(value: int, gids: set[int], table: str, row: int, field: str) -> None:
    _integer(value, table, row, field)
    if value not in gids:
        _fail(table, row, field, f"узел gid={value} отсутствует в nodes")


def validate_dataset(dataset: Dataset) -> None:
    gids: set[int] = set()
    for row, node in enumerate(dataset.nodes, start=1):
        _integer(node.gid, "nodes", row, "gid")
        if node.gid in gids:
            _fail("nodes", row, "gid", f"повторный gid={node.gid}")
        gids.add(node.gid)
        _integer(node.depth, "nodes", row, "depth")
        if not 0 <= node.depth <= 4:
            _fail("nodes", row, "depth", "допустимы значения 0–4")
        if type(node.is_seed) is not bool:
            _fail("nodes", row, "is_seed", "ожидается bool")
        if node.is_seed != (node.depth == 0):
            _fail("nodes", row, "is_seed", "seed должен соответствовать depth=0")

    pairs: set[tuple[int, int]] = set()
    for row, edge in enumerate(dataset.edges, start=1):
        _reference(edge.src, gids, "edges", row, "src")
        _reference(edge.dst, gids, "edges", row, "dst")
        pair = (edge.src, edge.dst)
        if pair in pairs:
            _fail("edges", row, "src/dst", f"повторная пара {pair}")
        pairs.add(pair)
        _amount(edge.sum_kzt, "edges", row)
        _integer(edge.n_tx, "edges", row, "n_tx")
        if edge.n_tx <= 0:
            _fail("edges", row, "n_tx", "ожидается положительное целое число")
        _integer(edge.depth, "edges", row, "depth")
        if not 1 <= edge.depth <= 4:
            _fail("edges", row, "depth", "допустимы значения 1–4")

    for row, transaction in enumerate(dataset.transactions, start=1):
        _reference(transaction.src, gids, "transactions", row, "src")
        _reference(transaction.dst, gids, "transactions", row, "dst")
        _amount(transaction.sum_kzt, "transactions", row)
        if type(transaction.date) is not date:
            _fail("transactions", row, "date", "ожидается календарная дата")
        if not OBSERVATION_START <= transaction.date <= OBSERVATION_END:
            _fail("transactions", row, "date", "дата вне периода 2026-07-01 — 2026-07-31")
        if (transaction.src, transaction.dst) not in pairs:
            _fail("transactions", row, "src/dst", "пара отсутствует в edges")
