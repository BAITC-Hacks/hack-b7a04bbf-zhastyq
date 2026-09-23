from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Edge:
    src: int
    dst: int
    sum_kzt: Decimal
    n_tx: int
    depth: int
