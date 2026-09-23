from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class Transaction:
    src: int
    dst: int
    date: date
    sum_kzt: Decimal
