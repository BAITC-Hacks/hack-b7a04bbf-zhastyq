from math import log1p

from .models import NodeFeatures, RoleDecision


def _cap(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 4)


def assign_role(f: NodeFeatures) -> RoleDecision:
    ratio = f.observed_ratio
    if f.in_deg >= 3 and f.out_deg >= 3 and f.seed_neighbors >= 2:
        role = "coordinator"
        score = _cap(0.55 + 0.05 * min(f.in_deg, 5) + 0.05 * min(f.out_deg, 5))
    elif f.in_deg >= 3 and f.in_kzt >= 100_000 and (ratio is None or ratio <= 0.6):
        role = "consolidator"
        score = _cap(0.55 + 0.07 * min(f.in_deg - 2, 5) + 0.05 * min(f.in_kzt / 100_000, 2))
    elif f.out_deg >= 5 and f.out_kzt >= 100_000:
        role = "distributor"
        score = _cap(0.55 + 0.05 * min(f.out_deg - 4, 6) + 0.05 * min(f.out_kzt / 100_000, 2))
    elif ratio is not None and f.in_deg > 0 and f.out_deg > 0 and 0.8 <= ratio <= 1.2:
        role = "transit"
        score = _cap(0.8 - abs(ratio - 1.0))
    elif f.in_deg > 0 and f.out_deg == 0 and not f.truncated_by_depth:
        role = "terminal"
        score = _cap(0.55 + 0.08 * min(f.in_deg, 5))
    else:
        role = "peripheral"
        score = 0.5

    ratio_text = "н/д" if ratio is None else f"{ratio:.2f}"
    boundary = "; граница обхода depth=4" if f.truncated_by_depth else ""
    evidence = (
        f"in={f.in_deg}, out={f.out_deg}, in_kzt={f.in_kzt:.0f}, "
        f"out_kzt={f.out_kzt:.0f}, n_tx={f.in_tx + f.out_tx}, "
        f"seed_links={f.seed_neighbors}, ratio={ratio_text}{boundary}"
    )
    return RoleDecision(role, score, evidence[:200])


def priority_base(f: NodeFeatures, decision: RoleDecision) -> float:
    activity = 0.35 * log1p(f.in_deg + f.out_deg) + 0.25 * log1p(f.in_tx + f.out_tx)
    volume = 0.2 * log1p(f.in_kzt + f.out_kzt)
    structure = 1.0 * f.seed_neighbors + (0.75 if decision.role == "coordinator" else 0.0)
    return activity + volume + structure
