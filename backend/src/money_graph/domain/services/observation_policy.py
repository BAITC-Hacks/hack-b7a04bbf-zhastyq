from decimal import Decimal, localcontext

from money_graph.domain.models.analysis import NodeFeatures


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
        "Наблюдаются только внутрибанковские переводы за июль 2026 от 5000 KZT; "
        "полный баланс неизвестен",
        "Роль и оценки — гипотезы для проверки, не вероятность и не вывод о виновности",
    ]
    if features.is_seed:
        notes.append("Внешние входящие seed неполны; отношение out/in не трактуется")
    if is_observation_boundary(features):
        notes.append(
            "depth=4 и отсутствие исходящих — граница наблюдения, не доказательство удержания"
        )
    if features.in_degree == 0 and features.out_degree == 0:
        notes.append(
            "Узел изолирован в выборке; отсутствие связей не доказывает отсутствие операций"
        )
    return tuple(notes)
