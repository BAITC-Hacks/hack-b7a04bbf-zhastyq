from money_graph.domain.models import Node, NodeFeatures
from money_graph.domain.roles import assign_role, priority_base


def f(**kwargs):
    return NodeFeatures(node=Node(1, kwargs.pop("depth", 2), kwargs.pop("is_seed", False)), **kwargs)


def test_each_role_and_non_matches():
    assert assign_role(f(in_deg=4, out_deg=4, seed_neighbors=2)).role == "coordinator"
    assert assign_role(f(in_deg=4, in_kzt=200_000, out_kzt=10_000)).role == "consolidator"
    assert assign_role(f(out_deg=6, out_kzt=200_000)).role == "distributor"
    assert assign_role(f(in_deg=1, out_deg=1, in_kzt=100_000, out_kzt=100_000)).role == "transit"
    assert assign_role(f(in_deg=1, in_kzt=10_000)).role == "terminal"
    assert assign_role(f()).role == "peripheral"
    assert assign_role(f(in_deg=2, in_kzt=200_000, out_kzt=1_000)).role != "consolidator"
    assert assign_role(f(out_deg=4, out_kzt=200_000)).role != "distributor"
    assert assign_role(f(in_deg=1, out_deg=1, in_kzt=100_000, out_kzt=150_000)).role != "transit"


def test_precedence_seed_and_observation_boundary():
    both = f(in_deg=5, out_deg=6, in_kzt=300_000, out_kzt=200_000, seed_neighbors=2)
    assert assign_role(both).role == "coordinator"
    seed = f(is_seed=True, in_deg=1, out_deg=1, in_kzt=1_000, out_kzt=1_000)
    assert seed.observed_ratio is None
    assert assign_role(seed).role != "transit"
    boundary = f(depth=4, in_deg=1, in_kzt=20_000)
    assert assign_role(boundary).role == "peripheral"
    assert "граница обхода" in assign_role(boundary).evidence


def test_scores_and_evidence_are_bounded_and_numeric():
    features = f(in_deg=24, out_deg=116, in_kzt=1e10, out_kzt=1e10, in_tx=400, seed_neighbors=81)
    result = assign_role(features)
    assert 0 <= result.role_score <= 1
    assert len(result.evidence) <= 200
    assert "in=24" in result.evidence
    assert priority_base(features, result) > priority_base(f(), assign_role(f()))
