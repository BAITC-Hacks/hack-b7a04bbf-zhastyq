from datetime import date
from decimal import Decimal, localcontext

from money_graph.domain.models.analysis import NodeFeatures

OBSERVATION_PERIOD = "июль 2026"
OBSERVATION_START = date(2026, 7, 1)
OBSERVATION_END = date(2026, 7, 31)
MIN_OBSERVED_AMOUNT_KZT = 5000


def is_isolated(features: NodeFeatures) -> bool:
    return features.in_degree == 0 and features.out_degree == 0


def is_observation_boundary(features: NodeFeatures) -> bool:
    return features.depth == 4 and features.out_degree == 0


def observed_flow_ratio(features: NodeFeatures) -> Decimal | None:
    if features.is_seed or features.incoming_kzt == 0:
        return None
    with localcontext() as context:
        context.prec = 400
        return features.outgoing_kzt / features.incoming_kzt


def observation_note(features: NodeFeatures) -> str:
    if is_observation_boundary(features):
        return "; depth=4: граница наблюдения, не доказанный сток"
    if features.is_seed:
        return "; seed: входящие неполные, out/in не трактуется"
    return "; полный баланс неизвестен"


def observation_limitations(features: NodeFeatures) -> tuple[str, ...]:
    notes = [
        f"Наблюдаются только внутрибанковские переводы за {OBSERVATION_PERIOD} "
        f"от {MIN_OBSERVED_AMOUNT_KZT} KZT; "
        "полный баланс неизвестен",
        "Роль и оценки — гипотезы для проверки, не вероятность и не вывод о виновности",
    ]
    if features.is_seed:
        notes.append("Внешние входящие seed неполны; отношение out/in не трактуется")
    if is_observation_boundary(features):
        notes.append(
            "depth=4 и отсутствие исходящих — граница наблюдения, не доказательство удержания"
        )
    if is_isolated(features):
        notes.append(
            "Узел изолирован в выборке; отсутствие связей не доказывает отсутствие операций"
        )
    return tuple(notes)
