from dataclasses import replace
from decimal import Decimal

import pytest

from money_graph.domain.models.analysis import NodeFeatures
from money_graph.domain.services.observation_policy import observed_flow_ratio
from money_graph.domain.services.priority_calculator import calculate_priorities
from money_graph.domain.services.role_classifier import classify_role


def features(**changes):
    base = NodeFeatures(1, 1, False, 0, 0, Decimal(0), Decimal(0), 0, 0, 0)
    return replace(base, **changes)


@pytest.mark.parametrize(
    "node,role",
    [
        (features(in_degree=3, out_degree=3, seed_neighbors=2), "coordinator"),
        (features(in_degree=3, incoming_kzt=Decimal("100000")), "consolidator"),
        (features(out_degree=5, outgoing_kzt=Decimal("100000")), "distributor"),
        (
            features(
                in_degree=1,
                out_degree=1,
                incoming_kzt=Decimal("10000"),
                outgoing_kzt=Decimal("10000"),
            ),
            "transit",
        ),
        (features(in_degree=1, incoming_kzt=Decimal("10000")), "terminal"),
        (features(), "peripheral"),
    ],
)
def test_each_role(node, role):
    decision = classify_role(node)
    assert decision.role == role
    assert 0 <= decision.score <= 1
    assert 0 < len(decision.evidence) <= 200
    assert any(char.isdigit() for char in decision.evidence)


def test_overlap_order():
    node = features(
        in_degree=4,
        out_degree=5,
        seed_neighbors=2,
        incoming_kzt=Decimal("200000"),
        outgoing_kzt=Decimal("100000"),
    )
    assert classify_role(node).role == "coordinator"
    assert classify_role(replace(node, seed_neighbors=1)).role == "consolidator"
    equal_flow = replace(node, seed_neighbors=1, outgoing_kzt=Decimal("200000"))
    assert classify_role(equal_flow).role == "distributor"


@pytest.mark.parametrize(
    "outgoing,expected",
    [(7999, "peripheral"), (8000, "transit"), (12000, "transit"), (12001, "peripheral")],
)
def test_transit_thresholds(outgoing, expected):
    node = features(
        in_degree=1, out_degree=1, incoming_kzt=Decimal("10000"), outgoing_kzt=Decimal(outgoing)
    )
    assert classify_role(node).role == expected


def test_collection_thresholds():
    node = features(
        in_degree=3, out_degree=1, incoming_kzt=Decimal("100000"), outgoing_kzt=Decimal("60000")
    )
    assert classify_role(node).role == "consolidator"
    assert classify_role(replace(node, outgoing_kzt=Decimal("60001"))).role == "peripheral"
    assert classify_role(replace(node, in_degree=2)).role == "peripheral"
    assert classify_role(replace(node, incoming_kzt=Decimal("99999"))).role == "peripheral"


def test_distribution_thresholds():
    node = features(out_degree=5, outgoing_kzt=Decimal("100000"))
    assert classify_role(node).role == "distributor"
    assert classify_role(replace(node, out_degree=4)).role == "peripheral"
    assert classify_role(replace(node, outgoing_kzt=Decimal("99999"))).role == "peripheral"


def test_seed_ratio_not_used_for_transit_or_collection():
    seed = features(
        depth=0,
        is_seed=True,
        in_degree=1,
        out_degree=1,
        incoming_kzt=Decimal("100000"),
        outgoing_kzt=Decimal("100000"),
    )
    assert observed_flow_ratio(seed) is None
    assert classify_role(seed).role == "peripheral"
    collector = replace(seed, in_degree=3, outgoing_kzt=Decimal("10000000"))
    decision = classify_role(collector)
    assert decision.role == "consolidator"
    assert "входящие неполные" in decision.evidence
    assert "не трактуется" in decision.evidence


def test_boundary_and_isolated_nodes():
    node = features(depth=4, in_degree=1, incoming_kzt=Decimal("10000"))
    decision = classify_role(node)
    assert decision.role == "peripheral"
    assert "граница наблюдения" in decision.evidence
    assert classify_role(replace(node, depth=3)).role == "terminal"
    isolated = classify_role(features())
    assert isolated.role == "peripheral"
    assert "входов=0, выходов=0" in isolated.evidence


def test_scores_evidence_and_extreme_money_are_bounded():
    for seed in (False, True):
        for depth in (0, 4):
            node = features(
                depth=depth,
                is_seed=seed,
                in_degree=999999,
                out_degree=0,
                incoming_kzt=Decimal("1.7976931348623157e308"),
            )
            decision = classify_role(node)
            assert 0 <= decision.score <= 1
            assert len(decision.evidence) <= 200
            score = calculate_priorities((node,))[1].score
            assert 0 <= score <= 1


def test_priority_increases_with_observed_activity_and_explains_inputs():
    quiet = features(gid=1)
    active = features(gid=2, in_degree=1, incoming_kzt=Decimal("10000"), incoming_transactions=1)
    hub = replace(
        active,
        gid=3,
        in_degree=10,
        incoming_kzt=Decimal("1000000"),
        incoming_transactions=100,
        seed_neighbors=3,
    )
    results = calculate_priorities((quiet, active, hub))
    assert results[1].score == 0
    assert results[1].score < results[2].score < results[3].score <= 1
    assert "Связей=10" in results[3].why
    assert "операций=100" in results[3].why
    assert "соседей seed=3" in results[3].why


def test_priority_for_empty_and_all_zero_features():
    assert calculate_priorities(()) == {}
    assert calculate_priorities((features(),))[1].score == 0
