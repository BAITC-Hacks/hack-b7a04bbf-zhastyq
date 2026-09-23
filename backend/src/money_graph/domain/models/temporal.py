from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Literal


@dataclass(frozen=True)
class OutflowDay:
    date: date
    interval_days: int
    n_tx: int
    sum_kzt: Decimal


@dataclass(frozen=True)
class RapidOutflow:
    date: date
    incoming_n_tx: int
    incoming_sum_kzt: Decimal
    outgoing_days: tuple[OutflowDay, ...]
    explanation: str
    limitations: tuple[str, ...]
    kind: Literal["rapid_outflow"] = field(default="rapid_outflow", init=False)


@dataclass(frozen=True)
class SynchronizedInflow:
    date: date
    sender_gids: tuple[int, ...]
    n_senders: int
    n_tx: int
    sum_kzt: Decimal
    explanation: str
    limitations: tuple[str, ...]
    kind: Literal["synchronized_inflow"] = field(default="synchronized_inflow", init=False)


@dataclass(frozen=True)
class ActivitySpike:
    date: date
    n_tx: int
    sum_kzt: Decimal
    period_start: date
    period_end: date
    period_days: int
    period_n_tx: int
    average_daily_n_tx: float
    multiple: float
    min_daily_n_tx: int
    min_multiple: int
    explanation: str
    limitations: tuple[str, ...]
    kind: Literal["activity_spike"] = field(default="activity_spike", init=False)


TemporalPattern = RapidOutflow | SynchronizedInflow | ActivitySpike


@dataclass(frozen=True)
class NodeTemporalPatterns:
    gid: int
    items: tuple[TemporalPattern, ...]


@dataclass(frozen=True)
class TemporalSummary:
    rapid_outflow: int = 0
    synchronized_inflow: int = 0
    activity_spike: int = 0
    n_nodes: int = 0


@dataclass(frozen=True)
class TemporalAnalysis:
    nodes: tuple[NodeTemporalPatterns, ...] = ()
    summary: TemporalSummary = TemporalSummary()
