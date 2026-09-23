from pathlib import Path

import pytest

from money_graph.domain.models import ROLES
from money_graph.infrastructure.graph import NetworkxAnalyzer
from money_graph.infrastructure.reader import FileDatasetReader


DATA = Path(__file__).resolve().parents[1] / "data"


@pytest.mark.skipif(not (DATA / "nodes.parquet").exists(), reason="Выданный датасет отсутствует")
def test_provided_dataset_acceptance():
    paths = {name: str(DATA / f"{name}.parquet") for name in ("nodes", "edges", "transactions")}
    dataset = FileDatasetReader().read(paths)
    result = NetworkxAnalyzer().analyze(dataset)
    assert result.summary["n_nodes"] == 2248
    assert result.summary["n_edges"] == 3119
    assert result.summary["n_transactions"] == 4840
    assert result.summary["truncated_count"] == 444
    assert len({n["gid"] for n in result.nodes}) == 2248
    assert {n["role"] for n in result.nodes} <= ROLES
    assert all(0 <= n["role_score"] <= 1 and 0 <= n["priority_score"] <= 1 for n in result.nodes)
    assert all(n["evidence"] and len(n["evidence"]) <= 200 for n in result.nodes)
    assert {n["cluster_id"] for n in result.nodes} == {c["cluster_id"] for c in result.clusters}
    assert len(result.top_nodes) >= 20
    assert [r["priority_score"] for r in result.top_nodes] == sorted(
        [r["priority_score"] for r in result.top_nodes], reverse=True)
    assert any(n["is_seed"] and n["in_deg"] == n["out_deg"] == 0 for n in result.nodes)
    assert all(n["role"] != "terminal" for n in result.nodes if n["truncated_by_depth"])
    internal = sum(edge.sum_kzt for edge in dataset.edges if next(n["cluster_id"] for n in result.nodes if n["gid"] == edge.src)
                   == next(n["cluster_id"] for n in result.nodes if n["gid"] == edge.dst))
    assert abs(sum(c["sum_kzt_internal"] for c in result.clusters) - internal) < 0.01
