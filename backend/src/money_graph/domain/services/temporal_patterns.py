from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, localcontext

from money_graph.domain.entities.node import Node
from money_graph.domain.entities.transaction import Transaction
from money_graph.domain.models.temporal import (
    ActivitySpike,
    NodeTemporalPatterns,
    OutflowDay,
    RapidOutflow,
    SynchronizedInflow,
    TemporalAnalysis,
    TemporalPattern,
    TemporalSummary,
)
from money_graph.domain.services.observation_policy import OBSERVATION_END, OBSERVATION_START

MIN_SENDERS = 3
MIN_DAILY_OPERATIONS = 5
MIN_SPIKE_MULTIPLE = 3
KIND_ORDER = {"rapid_outflow": 0, "synchronized_inflow": 1, "activity_spike": 2}


@dataclass
class DailyFlow:
    n_tx: int = 0
    sum_kzt: Decimal = Decimal(0)

    def add(self, amount: Decimal) -> None:
        self.n_tx += 1
        self.sum_kzt += amount


@dataclass
class NodeDay:
    incoming: DailyFlow = field(default_factory=DailyFlow)
    outgoing: DailyFlow = field(default_factory=DailyFlow)
    activity: DailyFlow = field(default_factory=DailyFlow)
    senders: set[int] = field(default_factory=set)


def _aggregate(transactions: tuple[Transaction, ...]) -> dict[int, dict[date, NodeDay]]:
    days: dict[int, dict[date, NodeDay]] = {}
    for transaction in transactions:
        if not OBSERVATION_START <= transaction.date <= OBSERVATION_END:
            raise ValueError("Дата транзакции вне периода наблюдения")
        source = days.setdefault(transaction.src, {}).setdefault(transaction.date, NodeDay())
        source.activity.add(transaction.sum_kzt)
        if transaction.src == transaction.dst:
            continue
        destination = days.setdefault(transaction.dst, {}).setdefault(transaction.date, NodeDay())
        source.outgoing.add(transaction.sum_kzt)
        destination.incoming.add(transaction.sum_kzt)
        destination.activity.add(transaction.sum_kzt)
        destination.senders.add(transaction.src)
    return days


def _limitations(node: Node) -> tuple[str, ...]:
    notes = [
        "Данные содержат дату без времени суток; операции одного дня не устанавливают порядок",
        f"Операции вне периода {OBSERVATION_START} — {OBSERVATION_END} неизвестны",
        "Выборка ограничена внутрибанковскими переводами от 5000 KZT и четырьмя коленами; "
        "полный баланс неизвестен",
    ]
    if node.is_seed:
        notes.append("Наблюдаемые входящие seed неполны")
    return tuple(notes)


def _rapid_outflow(
    day: date, flow: NodeDay, days: dict[date, NodeDay], limitations: tuple[str, ...]
) -> RapidOutflow | None:
    if not flow.incoming.n_tx:
        return None
    outgoing = []
    for interval in (1, 2):
        next_day = day + timedelta(days=interval)
        following = days.get(next_day)
        if following and following.outgoing.n_tx:
            outgoing.append(
                OutflowDay(next_day, interval, following.outgoing.n_tx, following.outgoing.sum_kzt)
            )
    if not outgoing:
        return None
    notes = limitations + (
        "Не установлено, что перечислены именно ранее полученные деньги",
        "Окна могут пересекаться; наблюдения нельзя суммировать как независимые денежные потоки",
        "Self-loop исключены из входящих и исходящих показателей; интервалы — календарные дни",
    )
    if day + timedelta(days=2) > OBSERVATION_END:
        notes += ("Часть окна D+1/D+2 выходит за конец периода и не наблюдается",)
    return RapidOutflow(
        day,
        flow.incoming.n_tx,
        flow.incoming.sum_kzt,
        tuple(outgoing),
        "За днём внешних поступлений следуют исходящие другим участникам через 1–2 дня; "
        "это временное совпадение и кандидат для проверки транзита",
        notes,
    )


def _node_patterns(node: Node, days: dict[date, NodeDay]) -> NodeTemporalPatterns:
    items: list[TemporalPattern] = []
    limitations = _limitations(node)
    period_days = (OBSERVATION_END - OBSERVATION_START).days + 1
    period_n_tx = sum(flow.activity.n_tx for flow in days.values())
    for day, flow in sorted(days.items()):
        rapid = _rapid_outflow(day, flow, days, limitations)
        if rapid:
            items.append(rapid)
        if len(flow.senders) >= MIN_SENDERS:
            items.append(
                SynchronizedInflow(
                    day,
                    tuple(sorted(flow.senders)),
                    len(flow.senders),
                    flow.incoming.n_tx,
                    flow.incoming.sum_kzt,
                    "Поступления минимум от трёх разных внешних отправителей совпали по дню; "
                    "это не доказанная координация участников",
                    limitations + ("Self-loop не является внешним отправителем и исключён",),
                )
            )
        activity = flow.activity
        if (
            period_n_tx > 0
            and activity.n_tx >= MIN_DAILY_OPERATIONS
            and activity.n_tx * period_days >= MIN_SPIKE_MULTIPLE * period_n_tx
        ):
            items.append(
                ActivitySpike(
                    day,
                    activity.n_tx,
                    activity.sum_kzt,
                    OBSERVATION_START,
                    OBSERVATION_END,
                    period_days,
                    period_n_tx,
                    period_n_tx / period_days,
                    activity.n_tx * period_days / period_n_tx,
                    MIN_DAILY_OPERATIONS,
                    MIN_SPIKE_MULTIPLE,
                    "Эвристический всплеск числа операций относительно среднего за ту же выборку; "
                    "это не подтверждённая подозрительная операция",
                    limitations
                    + (
                        "Среднее включает дни без операций; входящие и исходящие учтены, "
                        "каждый self-loop посчитан один раз",
                    ),
                )
            )
    return NodeTemporalPatterns(node.gid, tuple(items))


def analyze_temporal_patterns(
    nodes: tuple[Node, ...], transactions: tuple[Transaction, ...]
) -> TemporalAnalysis:
    with localcontext() as context:
        context.prec = 400
        daily = _aggregate(transactions)
        groups = tuple(
            _node_patterns(node, daily.get(node.gid, {}))
            for node in sorted(nodes, key=lambda n: n.gid)
        )
    counts = {kind: 0 for kind in KIND_ORDER}
    for group in groups:
        for item in group.items:
            counts[item.kind] += 1
    return TemporalAnalysis(
        groups,
        TemporalSummary(
            counts["rapid_outflow"],
            counts["synchronized_inflow"],
            counts["activity_spike"],
            sum(bool(group.items) for group in groups),
        ),
    )
