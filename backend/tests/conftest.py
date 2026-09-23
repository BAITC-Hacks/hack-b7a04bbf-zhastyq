import io
from datetime import date
from decimal import Decimal

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from money_graph.domain.entities.edge import Edge
from money_graph.domain.entities.node import Node
from money_graph.domain.entities.transaction import Transaction
from money_graph.domain.models.dataset import Dataset


@pytest.fixture
def dataset():
    return Dataset(
        nodes=(Node(100000005382566100, 0, True), Node(2, 1, False), Node(3, 0, True)),
        edges=(Edge(100000005382566100, 2, Decimal("10000"), 2, 1),),
        transactions=(
            Transaction(100000005382566100, 2, date(2026, 7, 1), Decimal("5000")),
            Transaction(100000005382566100, 2, date(2026, 7, 1), Decimal("5000")),
        ),
    )


GID_A = 100000000000000001
GID_B = 100000000000000002
GID_C = 100000000000000003
GID_D = 100000000000000004


@pytest.fixture
def payloads():
    tables = {
        "nodes": pa.table(
            {
                "gid": [GID_A, GID_B, GID_C, GID_D],
                "depth": [0, 1, 4, 0],
                "is_seed": [True, False, False, True],
            }
        ),
        "edges": pa.table(
            {
                "src": [GID_A, GID_B, GID_A],
                "dst": [GID_B, GID_A, GID_C],
                "sum_kzt": [10000.0, 5000.0, 5000.0],
                "n_tx": [2, 1, 1],
                "depth": pa.array([1, 2, 4], type=pa.int8()),
            }
        ),
        "transactions": pa.table(
            {
                "src": [GID_A, GID_A, GID_B, GID_A],
                "dst": [GID_B, GID_B, GID_A, GID_C],
                "date": pa.array([date(2026, 7, 1)] * 4, type=pa.date32()),
                "sum_kzt": [5000.0] * 4,
            }
        ),
    }
    result = {}
    for name, table in tables.items():
        stream = io.BytesIO()
        pq.write_table(table, stream)
        result[name] = stream.getvalue()
    return result


@pytest.fixture
def fake_model():
    from money_graph.application.dto.question import ModelAnswer

    class FakeModel:
        configured = True
        reply = None
        error = None
        callback = None

        def __init__(self):
            self.calls = []

        def answer(self, question, context):
            self.calls.append((question, context))
            if self.callback:
                self.callback()
            if self.error:
                raise self.error
            gid = next(node.gid for node in context.nodes if node.selected)
            return self.reply or ModelAnswer(
                f"Узел gid={gid}: признаки роли и приоритет требуют проверки по данным.", (gid,)
            )

    return FakeModel()


@pytest.fixture
def analysis_snapshot():
    from pathlib import Path

    from money_graph.application.dto.active_analysis import (
        AnalysisSnapshot,
        AnalysisStatistics,
        NodeView,
    )
    from money_graph.domain.models.analysis import (
        AnalysisResult,
        ClusterAnalysis,
        NodeAnalysis,
        NodeFeatures,
        Priority,
        RoleDecision,
    )

    features = (
        NodeFeatures(GID_A, 0, True, 0, 1, Decimal(0), Decimal("10000"), 0, 2, 0),
        NodeFeatures(GID_B, 4, False, 1, 0, Decimal("10000"), Decimal(0), 2, 0, 1),
        NodeFeatures(GID_C, 0, True, 0, 0, Decimal(0), Decimal(0), 0, 0, 0),
    )
    nodes = tuple(
        NodeAnalysis(
            f,
            RoleDecision("peripheral", 0.5, "Наблюдаемых признаков роли недостаточно"),
            1 if f.gid != GID_C else 2,
            Priority(0.8 if f.gid != GID_C else 0, "Приоритет по наблюдаемым связям и обороту"),
        )
        for f in features
    )
    result = AnalysisResult(
        nodes,
        (
            ClusterAnalysis(1, 2, 1, Decimal("10000"), (GID_A, GID_B), "Группа потоков"),
            ClusterAnalysis(2, 1, 1, Decimal(0), (GID_C,), "Изолирован"),
        ),
        nodes,
    )
    return AnalysisSnapshot(
        "current",
        AnalysisStatistics(3, 1, 2, 2, 2, Decimal("10000")),
        result,
        tuple(NodeView(node, node.features.depth == 4) for node in nodes),
        (Edge(GID_A, GID_B, Decimal("10000"), 2, 1),),
        Path("unused-output"),
    )


@pytest.fixture(autouse=True)
def prohibit_external_http(monkeypatch):
    import httpx

    def blocked(*args, **kwargs):
        raise AssertionError("Automatic tests must use a fake model or HTTP mock")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
