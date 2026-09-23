from datetime import date
from decimal import Decimal

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
