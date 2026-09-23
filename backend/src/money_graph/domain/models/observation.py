from dataclasses import dataclass
from typing import Literal

GapCode = Literal[
    "DEPTH_BOUNDARY",
    "SEED_INCOMING_INCOMPLETE",
    "ISOLATED_NODE",
    "OUTFLOW_EXCEEDS_INFLOW",
    "INTRABANK_ONLY",
    "AMOUNT_THRESHOLD",
    "LIMITED_PERIOD",
    "BALANCES_UNAVAILABLE",
]


@dataclass(frozen=True)
class ObservationAdvice:
    code: GapCode
    description: str
    evidence: str
    request: str
    reason: str
