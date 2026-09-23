from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from money_graph.domain.models.temporal import (
    ActivitySpike,
    RapidOutflow,
    SynchronizedInflow,
    TemporalPattern,
)


class OutflowDayResponse(BaseModel):
    date: date
    interval_days: Literal[1, 2]
    n_tx: int
    sum_kzt: float


class TemporalObservationResponse(BaseModel):
    date: date
    explanation: str
    limitations: list[str]


class RapidOutflowResponse(TemporalObservationResponse):
    kind: Literal["rapid_outflow"]
    incoming_n_tx: int
    incoming_sum_kzt: float
    outgoing_days: list[OutflowDayResponse]


class SynchronizedInflowResponse(TemporalObservationResponse):
    kind: Literal["synchronized_inflow"]
    sender_gids: list[str]
    n_senders: int
    n_tx: int
    sum_kzt: float


class ActivitySpikeResponse(TemporalObservationResponse):
    kind: Literal["activity_spike"]
    n_tx: int
    sum_kzt: float
    period_start: date
    period_end: date
    period_days: int
    period_n_tx: int
    average_daily_n_tx: float
    multiple: float
    min_daily_n_tx: int
    min_multiple: int


TemporalItemResponse = Annotated[
    RapidOutflowResponse | SynchronizedInflowResponse | ActivitySpikeResponse,
    Field(discriminator="kind"),
]


class TemporalPatternsResponse(BaseModel):
    items: list[TemporalItemResponse]
    total_count: int
    truncated: bool


class TemporalSummaryResponse(BaseModel):
    rapid_outflow: int
    synchronized_inflow: int
    activity_spike: int
    n_nodes: int


def temporal_item_response(item: TemporalPattern) -> TemporalItemResponse:
    if isinstance(item, RapidOutflow):
        return RapidOutflowResponse(
            kind=item.kind,
            date=item.date,
            incoming_n_tx=item.incoming_n_tx,
            incoming_sum_kzt=float(item.incoming_sum_kzt),
            outgoing_days=[
                OutflowDayResponse(
                    date=day.date,
                    interval_days=day.interval_days,
                    n_tx=day.n_tx,
                    sum_kzt=float(day.sum_kzt),
                )
                for day in item.outgoing_days
            ],
            explanation=item.explanation,
            limitations=list(item.limitations),
        )
    if isinstance(item, SynchronizedInflow):
        return SynchronizedInflowResponse(
            kind=item.kind,
            date=item.date,
            sender_gids=[str(gid) for gid in item.sender_gids],
            n_senders=item.n_senders,
            n_tx=item.n_tx,
            sum_kzt=float(item.sum_kzt),
            explanation=item.explanation,
            limitations=list(item.limitations),
        )
    if isinstance(item, ActivitySpike):
        return ActivitySpikeResponse(
            kind=item.kind,
            date=item.date,
            n_tx=item.n_tx,
            sum_kzt=float(item.sum_kzt),
            period_start=item.period_start,
            period_end=item.period_end,
            period_days=item.period_days,
            period_n_tx=item.period_n_tx,
            average_daily_n_tx=item.average_daily_n_tx,
            multiple=item.multiple,
            min_daily_n_tx=item.min_daily_n_tx,
            min_multiple=item.min_multiple,
            explanation=item.explanation,
            limitations=list(item.limitations),
        )
    raise TypeError("Неизвестный вид временного наблюдения")
