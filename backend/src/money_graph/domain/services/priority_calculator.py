import math
from decimal import localcontext

from money_graph.domain.models.analysis import NodeFeatures, Priority


def calculate_priorities(nodes: tuple[NodeFeatures, ...]) -> dict[int, Priority]:
    components: dict[int, tuple[float, float, float, float]] = {}
    with localcontext() as context:
        context.prec = 400
        for node in nodes:
            volume = node.incoming_kzt + node.outgoing_kzt
            components[node.gid] = (
                math.log1p(node.in_degree + node.out_degree),
                math.log1p(node.incoming_transactions + node.outgoing_transactions),
                float((1 + volume).ln()),
                math.log1p(node.seed_neighbors),
            )
        maxima = tuple(
            max((values[i] for values in components.values()), default=0) for i in range(4)
        )
        priorities: dict[int, Priority] = {}
        for node in nodes:
            values = components[node.gid]
            contributions = tuple(
                weight * value / maximum if maximum else 0.0
                for weight, value, maximum in zip(
                    (0.35, 0.25, 0.25, 0.15), values, maxima, strict=True
                )
            )
            why = (
                f"Связей={node.in_degree + node.out_degree} ({contributions[0]:.1%} балла); "
                f"операций={node.incoming_transactions + node.outgoing_transactions} "
                f"({contributions[1]:.1%}); "
                f"оборот={node.incoming_kzt + node.outgoing_kzt:.6g} KZT "
                f"({contributions[2]:.1%}); соседей seed={node.seed_neighbors} "
                f"({contributions[3]:.1%}). Приоритет проверки, не вывод о виновности."
            )
            priorities[node.gid] = Priority(min(1.0, max(0.0, sum(contributions))), why)
        return priorities
