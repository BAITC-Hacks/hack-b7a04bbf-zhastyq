from decimal import Decimal

from money_graph.domain.models.analysis import NodeFeatures, Role, RoleDecision
from money_graph.domain.services.observation_policy import (
    is_observation_boundary,
    observation_note,
    observed_flow_ratio,
)


def classify_role(features: NodeFeatures) -> RoleDecision:
    f = features
    ratio = observed_flow_ratio(f)
    role: Role
    if f.in_degree >= 3 and f.out_degree >= 3 and f.seed_neighbors >= 2:
        role = "coordinator"
        score = min(1.0, 0.6 + 0.05 * min(f.in_degree + f.out_degree - 6, 8))
        reason = (
            f"координации: входов={f.in_degree}, выходов={f.out_degree}, seed={f.seed_neighbors}"
        )
    elif (
        f.in_degree >= 3
        and f.incoming_kzt >= Decimal("100000")
        and (f.is_seed or (ratio is not None and ratio <= Decimal("0.6")))
    ):
        role = "consolidator"
        score = min(1.0, 0.65 + 0.05 * min(f.in_degree - 3, 7))
        reason = f"сбора: плательщиков={f.in_degree}, вход={f.incoming_kzt:.6g} KZT"
        if ratio is not None:
            reason += f", out/in={ratio:.1%}"
    elif f.out_degree >= 5 and f.outgoing_kzt >= Decimal("100000"):
        role = "distributor"
        score = min(1.0, 0.65 + 0.05 * min(f.out_degree - 5, 7))
        reason = f"распределения: получателей={f.out_degree}, выход={f.outgoing_kzt:.6g} KZT"
    elif (
        f.in_degree > 0
        and f.out_degree > 0
        and ratio is not None
        and Decimal("0.8") <= ratio <= Decimal("1.2")
    ):
        role = "transit"
        score = float(Decimal("0.9") - abs(ratio - 1))
        reason = f"транзита: входов={f.in_degree}, выходов={f.out_degree}, out/in={ratio:.1%}"
    elif f.in_degree > 0 and f.out_degree == 0 and not is_observation_boundary(f):
        role = "terminal"
        score = min(0.85, 0.55 + 0.05 * min(f.in_degree, 6))
        reason = f"получателя: вход={f.incoming_kzt:.6g} KZT, плательщиков={f.in_degree}, выходов=0"
    else:
        role = "peripheral"
        score = 0.5
        reason = f"явной роли не выявлены: входов={f.in_degree}, выходов={f.out_degree}"
    return RoleDecision(role, score, f"Признаки {reason}{observation_note(f)}")
