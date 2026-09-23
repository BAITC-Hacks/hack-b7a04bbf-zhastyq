from dataclasses import replace
from datetime import date
from decimal import Decimal

from money_graph.domain.entities.edge import Edge
from money_graph.domain.entities.node import Node
from money_graph.domain.entities.transaction import Transaction
from money_graph.domain.models.dataset import Dataset
from money_graph.infrastructure.graph.networkx_calculator import NetworkxCalculator


def test_direction_reciprocal_weights_transaction_counts_and_isolated_node():
    dataset = Dataset(
        (Node(1, 0, True), Node(2, 1, False), Node(3, 0, True)),
        (Edge(1, 2, Decimal("10000.25"), 99, 1), Edge(2, 1, Decimal("5000.10"), 1, 2)),
        (Transaction(1, 2, date(2026, 7, 1), Decimal("5000")),) * 2,
    )
    facts = NetworkxCalculator().calculate(dataset)
    first, second, isolated = facts.nodes
    assert (first.in_degree, first.out_degree) == (1, 1)
    assert first.incoming_kzt == Decimal("5000.10")
    assert first.outgoing_kzt == Decimal("10000.25")
    assert (first.incoming_transactions, first.outgoing_transactions) == (0, 2)
    assert second.seed_neighbors == 1
    assert second.incoming_transactions == 2
    assert isolated.in_degree == isolated.out_degree == 0
    assert facts.communities[0].gids == (1, 2)
    assert facts.communities[0].internal_kzt == Decimal("15000.35")
    assert facts.communities[1].gids == (3,)
    assert facts.communities[1].internal_kzt == 0


def test_projection_combines_reciprocal_weights(monkeypatch):
    import networkx as nx

    observed = []

    def communities(graph, **kwargs):
        observed.append((graph[1][2]["amount"], kwargs["seed"]))
        return [{1, 2}]

    monkeypatch.setattr(nx.community, "louvain_communities", communities)
    dataset = Dataset(
        (Node(1, 0, True), Node(2, 1, False)),
        (Edge(1, 2, Decimal("10000"), 1, 1), Edge(2, 1, Decimal("20000"), 1, 2)),
        (),
    )
    NetworkxCalculator().calculate(dataset)
    assert observed == [(Decimal("30000"), 42)]


def test_reproducible_for_reordered_input(dataset):
    calculator = NetworkxCalculator()
    reversed_dataset = replace(
        dataset,
        nodes=tuple(reversed(dataset.nodes)),
        edges=tuple(reversed(dataset.edges)),
        transactions=tuple(reversed(dataset.transactions)),
    )
    assert calculator.calculate(dataset) == calculator.calculate(reversed_dataset)


def test_no_edges_and_empty_graph():
    dataset = Dataset(tuple(Node(gid, 0, True) for gid in (5, 1, 3)), (), ())
    facts = NetworkxCalculator().calculate(dataset)
    assert [group.gids for group in facts.communities] == [(1,), (3,), (5,)]
    assert [group.cluster_id for group in facts.communities] == [1, 2, 3]
    assert all(group.internal_kzt == 0 for group in facts.communities)
    assert NetworkxCalculator().calculate(Dataset((), (), ())).communities == ()


def test_disconnected_components_and_internal_totals():
    dataset = Dataset(
        tuple(Node(gid, 0, True) for gid in range(1, 6)),
        (Edge(1, 2, Decimal("5000"), 1, 1), Edge(3, 4, Decimal("7000"), 1, 1)),
        (),
    )
    facts = NetworkxCalculator().calculate(dataset)
    assert [c.gids for c in facts.communities] == [(1, 2), (3, 4), (5,)]
    assert sum(c.internal_kzt for c in facts.communities) == Decimal("12000")
    assert sorted(gid for c in facts.communities for gid in c.gids) == [1, 2, 3, 4, 5]


def test_self_loop_counts_once_in_internal_volume_and_not_as_seed_neighbor():
    dataset = Dataset((Node(1, 0, True),), (Edge(1, 1, Decimal("5000"), 1, 1),), ())
    facts = NetworkxCalculator().calculate(dataset)
    assert facts.communities[0].internal_kzt == Decimal("5000")
    assert facts.nodes[0].seed_neighbors == 0
    assert (facts.nodes[0].in_degree, facts.nodes[0].out_degree) == (1, 1)
