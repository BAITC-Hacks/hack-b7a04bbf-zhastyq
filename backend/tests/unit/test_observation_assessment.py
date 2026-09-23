from dataclasses import replace
from decimal import Decimal

import pytest

from money_graph.application.use_cases.get_analysis import GetAnalysis
from money_graph.application.use_cases.get_node import GetNode
from money_graph.domain.models.analysis import NodeFeatures
from money_graph.domain.services.observation_assessment import assess_observation
from money_graph.domain.services.observation_policy import observation_limitations


@pytest.fixture
def node():
    return NodeFeatures(100000000000000001, 1, False, 1, 1, Decimal(10000), Decimal(5000), 2, 1, 0)


GENERAL_CODES = ["INTRABANK_ONLY", "AMOUNT_THRESHOLD", "LIMITED_PERIOD", "BALANCES_UNAVAILABLE"]


def test_boundary_explains_missing_outgoing_without_retention_claim(node):
    result = assess_observation(replace(node, depth=4, out_degree=0, outgoing_kzt=Decimal(0)))
    assert [item.code for item in result] == ["DEPTH_BOUNDARY", *GENERAL_CODES]
    warning = result[0]
    assert warning.evidence == "depth=4; out_deg=0"
    assert "не доказывает" in warning.description
    assert "исходящие" in warning.request and "за пределами" in warning.request
    assert "продолжается ли" in warning.reason


@pytest.mark.parametrize("depth,out_degree", [(3, 0), (4, 1), (1, 1)])
def test_boundary_requires_both_depth_and_missing_outgoing(node, depth, out_degree):
    result = assess_observation(replace(node, depth=depth, out_degree=out_degree))
    assert "DEPTH_BOUNDARY" not in {item.code for item in result}


def test_seed_requests_incoming_without_treating_ratio_as_balance(node):
    result = assess_observation(replace(node, depth=0, is_seed=True))
    assert [item.code for item in result] == ["SEED_INCOMING_INCOMPLETE", *GENERAL_CODES]
    assert "is_seed=true" in result[0].evidence
    assert "out/in нельзя трактовать" in result[0].description
    assert "полную историю входящих" in result[0].request


def test_isolated_seed_keeps_both_independent_gaps(node):
    isolated = replace(
        node,
        depth=0,
        is_seed=True,
        in_degree=0,
        out_degree=0,
        incoming_kzt=Decimal(0),
        outgoing_kzt=Decimal(0),
    )
    result = assess_observation(isolated)
    assert [item.code for item in result] == [
        "SEED_INCOMING_INCOMPLETE",
        "ISOLATED_NODE",
        *GENERAL_CODES,
    ]
    assert result[1].evidence == "in_deg=0; out_deg=0"
    assert "не доказывает отсутствие деятельности" in result[1].description
    assert "полноту выгрузки" in result[1].request
    assert "могли быть исключены условиями сбора" in result[1].request


def test_isolated_boundary_keeps_both_gaps_without_inventing_seed(node):
    isolated = replace(
        node,
        depth=4,
        in_degree=0,
        out_degree=0,
        incoming_kzt=Decimal(0),
        outgoing_kzt=Decimal(0),
        incoming_transactions=0,
        outgoing_transactions=0,
    )
    result = assess_observation(isolated)
    assert [item.code for item in result] == ["DEPTH_BOUNDARY", "ISOLATED_NODE", *GENERAL_CODES]


def test_outflow_excess_uses_exact_money_and_requests_reconciliation(node):
    result = assess_observation(
        replace(node, incoming_kzt=Decimal("10000.00"), outgoing_kzt=Decimal("10000.01"))
    )
    assert [item.code for item in result] == ["OUTFLOW_EXCEEDS_INFLOW", *GENERAL_CODES[:-1]]
    assert result[0].evidence == "out_kzt=10000.01; in_kzt=10000.00"
    assert "не доказанная аномалия" in result[0].description
    assert "остаток на начало" in result[0].description
    assert "отсутствующие поступления" in result[0].description
    assert "остатки на начало и конец" in result[0].request
    assert "полную выписку" in result[0].request


@pytest.mark.parametrize(
    "incoming,outgoing", [("10000", "10000"), ("10000", "9999.99"), ("0", "0")]
)
def test_equal_or_lower_outflow_has_only_general_balance_gap(node, incoming, outgoing):
    result = assess_observation(
        replace(node, incoming_kzt=Decimal(incoming), outgoing_kzt=Decimal(outgoing))
    )
    assert [item.code for item in result] == GENERAL_CODES


def test_seed_with_no_observed_incoming_still_flags_outflow_without_division(node):
    result = assess_observation(
        replace(node, depth=0, is_seed=True, in_degree=0, incoming_kzt=Decimal(0))
    )
    assert [item.code for item in result] == [
        "SEED_INCOMING_INCOMPLETE",
        "OUTFLOW_EXCEEDS_INFLOW",
        *GENERAL_CODES[:-1],
    ]


@pytest.mark.parametrize(
    "depth,is_seed,in_degree,out_degree", [(4, False, 0, 0), (0, True, 0, 0), (1, False, 2, 3)]
)
def test_order_is_stable_specific_first_and_recommendations_unique(
    node, depth, is_seed, in_degree, out_degree
):
    features = replace(
        node, depth=depth, is_seed=is_seed, in_degree=in_degree, out_degree=out_degree
    )
    first = assess_observation(features)
    assert assess_observation(features) == first
    assert len({item.code for item in first}) == len(first)
    assert len({item.request for item in first}) == len(first)
    assert [item.code for item in first][-4:] == GENERAL_CODES
    assert all(
        item.description and item.evidence and item.request and item.reason for item in first
    )


def test_general_gaps_are_collection_constraints_not_claims_of_missing_operations(node):
    result = {item.code: item for item in assess_observation(node)}
    assert "могли" in result["INTRABANK_ONLY"].description
    assert "наличие не установлено" in result["AMOUNT_THRESHOLD"].description
    assert "5000" in result["AMOUNT_THRESHOLD"].evidence
    assert "июль 2026" in result["LIMITED_PERIOD"].evidence
    assert "нет данных об остатках" in result["BALANCES_UNAVAILABLE"].evidence


def test_get_node_assesses_one_snapshot_and_preserves_existing_card(analysis_snapshot):
    class Store:
        calls = 0

        def get(self):
            self.calls += 1
            return analysis_snapshot

    store = Store()
    original = analysis_snapshot.nodes[0]
    card = GetNode(GetAnalysis(store)).execute(original.analysis.features.gid)
    assert store.calls == 1
    assert card.node is original
    assert card.analysis_id == analysis_snapshot.analysis_id
    assert card.incoming == ()
    assert card.outgoing == analysis_snapshot.edges
    assert card.limitations == observation_limitations(original.analysis.features)
    assert [item.code for item in card.observation_advice][:2] == [
        "SEED_INCOMING_INCOMPLETE",
        "OUTFLOW_EXCEEDS_INFLOW",
    ]
