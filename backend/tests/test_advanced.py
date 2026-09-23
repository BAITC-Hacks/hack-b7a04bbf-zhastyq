from datetime import date

import networkx as nx

from money_graph.application.ports import Dataset
from money_graph.domain.models import Edge, Node, Transaction
from money_graph.infrastructure.advanced import detect_anomalies, enrich, robustness, routes_and_cycles, temporal_patterns
from money_graph.infrastructure.graph import NetworkxAnalyzer


def sample():
    nodes = (Node(1, 0, True), Node(2, 1, False), Node(3, 2, False), Node(4, 0, True), Node(5, 4, False))
    edges = (Edge(1, 2, 21000, 3, 1), Edge(4, 2, 5000, 1, 1), Edge(2, 3, 21000, 2, 2), Edge(3, 1, 5000, 1, 3))
    tx = (Transaction(1, 2, date(2026, 7, 1), 6000), Transaction(1, 2, date(2026, 7, 1), 7000),
          Transaction(1, 2, date(2026, 7, 1), 8000), Transaction(4, 2, date(2026, 7, 1), 5000),
          Transaction(2, 3, date(2026, 7, 2), 10000), Transaction(2, 3, date(2026, 7, 2), 11000),
          Transaction(3, 1, date(2026, 7, 10), 5000))
    return Dataset(nodes, edges, tx)


def graph(data):
    result = nx.DiGraph()
    result.add_nodes_from(node.gid for node in data.nodes)
    for edge in data.edges:
        result.add_edge(edge.src, edge.dst, sum_kzt=edge.sum_kzt, n_tx=edge.n_tx)
    return result


def test_temporal_dates_sums_and_sync():
    findings = temporal_patterns(sample())
    assert any(item["kind"] == "rapid_transit" and item["gid"] == 2 and
               item["received_date"] == "2026-07-01" and item["sent_date"] == "2026-07-02" and
               item["received_kzt"] == 26000 and item["sent_kzt"] == 21000 for item in findings)
    assert any(item["kind"] == "synchronized_inflow" and item["gid"] == 2 and
               item["payer_gids"] == [1, 4] and item["sum_kzt"] == 26000 for item in findings)
    assert any(item["kind"] == "activity_spike" and item["gid"] == 2 and
               item["date"] == "2026-07-01" and item["n_tx"] == 4 for item in findings)


def test_repeated_route_cycle_and_limitations():
    routes, cycles = routes_and_cycles(graph(sample()))
    route = next(item for item in routes if (item["src"], item["via"], item["dst"]) == (1, 2, 3))
    assert route["observed_repetitions_min"] == 2
    assert "не установлена" in route["limitation"]
    assert any(set(item["gids"]) == {1, 2, 3} for item in cycles)


def test_anomalies_robustness_and_card_data():
    data = sample()
    rows = NetworkxAnalyzer().analyze(data).nodes
    findings = detect_anomalies(data, rows)
    assert any(item["kind"] == "observed_splitting" and item["gid"] == 1 and
               item["n_tx"] == 3 and item["sum_kzt"] == 21000 for item in findings)
    assert robustness(graph(data), rows)["top_n"] == 1
    assert robustness(graph(data), rows)["after"]["n_components"] > robustness(graph(data), rows)["before"]["n_components"]
    extras = enrich(data, graph(data), rows)
    assert extras["robustness"]["removed_gids"]
    boundary = next(row for row in rows if row["gid"] == 5)
    assert "четвёртого" in boundary["data_gaps"][-1]
    assert "5" in boundary["next_request"]
    assert next(row for row in rows if row["gid"] == 2)["temporal_patterns"]


def test_unusual_profile_relative_to_depth():
    rows = [{"gid": gid, "depth": 1, "out_deg": 4 if gid == 1 else 0} for gid in range(1, 6)]
    findings = detect_anomalies(Dataset((), (), ()), rows)
    assert findings == [{"kind": "unusual_out_degree", "gid": 1, "depth": 1, "out_deg": 4,
                         "depth_median": 0, "threshold": 3.0, "peer_count": 5}]
