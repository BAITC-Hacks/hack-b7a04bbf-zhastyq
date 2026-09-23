from datetime import date
from decimal import Decimal
from random import Random

import pytest

from money_graph.domain.entities.node import Node
from money_graph.domain.entities.transaction import Transaction
from money_graph.domain.models.temporal import ActivitySpike, RapidOutflow, SynchronizedInflow
from money_graph.domain.services.temporal_patterns import analyze_temporal_patterns

A, B, C, D = 100000000000000001, 100000000000000002, 100000000000000003, 100000000000000004


def tx(src, dst, day, amount="5000"):
    return Transaction(src, dst, date(2026, 7, day), Decimal(amount))


def analyze(transactions, seed=False):
    nodes = tuple(
        Node(gid, 0 if seed and gid == A else 1, seed and gid == A) for gid in (A, B, C, D)
    )
    return analyze_temporal_patterns(nodes, tuple(transactions))


def items(result, gid=A, kind=None):
    found = next(group.items for group in result.nodes if group.gid == gid)
    return tuple(item for item in found if kind is None or item.kind == kind)


def test_rapid_groups_duplicates_and_both_later_days_into_one_observation():
    result = analyze([tx(B, A, 1), tx(B, A, 1), tx(A, C, 2, "7000"), tx(A, D, 2), tx(A, C, 3)])
    (rapid,) = items(result, kind="rapid_outflow")
    assert isinstance(rapid, RapidOutflow)
    assert rapid.date == date(2026, 7, 1)
    assert rapid.incoming_n_tx == 2 and rapid.incoming_sum_kzt == Decimal(10000)
    assert [(d.date.day, d.interval_days, d.n_tx, d.sum_kzt) for d in rapid.outgoing_days] == [
        (2, 1, 2, Decimal(12000)),
        (3, 2, 1, Decimal(5000)),
    ]
    assert any("нельзя суммировать" in note for note in rapid.limitations)
    assert any("именно ранее полученные" in note for note in rapid.limitations)


@pytest.mark.parametrize("outgoing_day", [1, 4])
def test_same_day_or_three_days_later_is_not_rapid(outgoing_day):
    assert not items(analyze([tx(B, A, 1), tx(A, C, outgoing_day)]), kind="rapid_outflow")


def test_overlapping_windows_remain_separate_incoming_dates():
    result = analyze([tx(B, A, 1), tx(B, A, 2), tx(A, C, 3)])
    found = items(result, kind="rapid_outflow")
    assert [i.date.day for i in found] == [1, 2]
    assert [i.outgoing_days[0].interval_days for i in found] == [2, 1]


def test_synchronized_counts_unique_external_senders_and_all_their_operations():
    result = analyze([tx(B, A, 1)] * 2 + [tx(C, A, 1), tx(D, A, 1), tx(A, A, 1, "9000")])
    (synchronized,) = items(result, kind="synchronized_inflow")
    assert isinstance(synchronized, SynchronizedInflow)
    assert synchronized.sender_gids == (B, C, D)
    assert synchronized.n_senders == 3
    assert synchronized.n_tx == 4 and synchronized.sum_kzt == Decimal(20000)
    assert "не доказанная координация" in synchronized.explanation


def test_three_operations_from_one_sender_are_not_synchronized():
    assert not items(analyze([tx(B, A, 1)] * 3), kind="synchronized_inflow")


def test_two_external_senders_plus_self_loop_are_not_three_senders():
    assert not items(analyze([tx(B, A, 1), tx(C, A, 1), tx(A, A, 1)]), kind="synchronized_inflow")


def test_spike_includes_incoming_outgoing_zero_days_and_self_loop_once():
    result = analyze([tx(B, A, 7)] * 2 + [tx(A, C, 7)] * 2 + [tx(A, A, 7, "9000")])
    (spike,) = items(result, kind="activity_spike")
    assert isinstance(spike, ActivitySpike)
    assert spike.n_tx == 5 and spike.sum_kzt == Decimal(29000)
    assert spike.period_n_tx == 5 and spike.period_days == 31
    assert spike.period_start == date(2026, 7, 1) and spike.period_end == date(2026, 7, 31)
    assert spike.average_daily_n_tx == pytest.approx(5 / 31)
    assert spike.multiple == 31
    assert spike.min_daily_n_tx == 5 and spike.min_multiple == 3


def test_four_operations_do_not_meet_minimum_even_with_high_multiple():
    assert not items(analyze([tx(B, A, 7)] * 4), kind="activity_spike")


def test_regular_daily_activity_is_not_spike():
    result = analyze([tx(B, A, day) for day in range(1, 32) for _ in range(5)])
    assert not items(result, kind="activity_spike")


@pytest.mark.parametrize("extra_operations,expected", [(0, True), (1, False)])
def test_spike_multiple_threshold_is_inclusive(extra_operations, expected):
    # 62 operations over 31 days: day 1 has exactly 3x mean (6 vs 2).
    transactions = [tx(B, A, 1)] * 6 + [tx(B, A, day) for day in range(2, 30) for _ in range(2)]
    transactions += [tx(B, A, 31)] * extra_operations
    result = items(analyze(transactions), kind="activity_spike")
    assert bool(result) is expected
    if result:
        assert result[0].multiple == 3


def test_only_self_loops_are_activity_not_transit_or_external_inflow():
    result = analyze([tx(A, A, 1)] * 5 + [tx(A, A, 2)])
    assert not items(result, kind="rapid_outflow")
    assert not items(result, kind="synchronized_inflow")
    (spike,) = items(result, kind="activity_spike")
    assert spike.n_tx == 5 and spike.sum_kzt == Decimal(25000)
    assert spike.period_n_tx == 6


@pytest.mark.parametrize("transactions", [[tx(A, A, 1), tx(A, B, 2)], [tx(B, A, 1), tx(A, A, 2)]])
def test_self_loop_cannot_supply_either_leg_of_transit(transactions):
    assert not items(analyze(transactions), kind="rapid_outflow")


def test_empty_transactions_keep_nodes_without_findings():
    result = analyze([])
    assert len(result.nodes) == 4
    assert all(not group.items for group in result.nodes)
    assert result.summary.rapid_outflow == result.summary.synchronized_inflow == 0
    assert result.summary.activity_spike == result.summary.n_nodes == 0
    assert analyze_temporal_patterns((), ()).nodes == ()


def test_end_of_period_and_seed_limitations():
    (rapid,) = items(analyze([tx(B, A, 30), tx(A, C, 31)], seed=True), kind="rapid_outflow")
    assert rapid.outgoing_days[0].interval_days == 1
    assert any("Часть окна" in note for note in rapid.limitations)
    assert any("входящие seed неполны" in note for note in rapid.limitations)
    assert not items(analyze([tx(B, A, 31)]), kind="rapid_outflow")


@pytest.mark.parametrize("day", [date(2026, 6, 30), date(2026, 8, 1)])
def test_outside_period_is_rejected_not_silently_aggregated(day):
    with pytest.raises(ValueError, match="вне периода"):
        analyze([Transaction(B, A, day, Decimal(5000))])


def test_permutation_does_not_change_order_money_or_counts():
    transactions = [tx(B, A, 1, "1e100"), tx(B, A, 1, "5000.01"), tx(C, A, 1), tx(D, A, 1)]
    transactions += [tx(B, A, 1), tx(A, C, 2), tx(B, A, 2), tx(A, C, 3)]
    expected = analyze(transactions)
    assert [i.kind for i in items(expected)][:3] == [
        "rapid_outflow",
        "synchronized_inflow",
        "activity_spike",
    ]
    amount = items(expected)[0].incoming_sum_kzt
    assert str(amount).endswith("20000.01")
    for seed in range(4):
        shuffled = list(transactions)
        Random(seed).shuffle(shuffled)
        assert analyze(shuffled) == expected
