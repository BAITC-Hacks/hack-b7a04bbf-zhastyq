from money_graph.domain.models.analysis import ClusterAnalysis, Community, NodeAnalysis


def summarize_cluster(community: Community, nodes: tuple[NodeAnalysis, ...]) -> ClusterAnalysis:
    ranked = sorted(nodes, key=lambda node: (-node.priority.score, node.features.gid))
    n_seed = sum(node.features.is_seed for node in nodes)
    collectors = sum(node.decision.role == "consolidator" for node in nodes)
    distributors = sum(node.decision.role == "distributor" for node in nodes)
    coordinators = sum(node.decision.role == "coordinator" for node in nodes)
    if len(nodes) == 1 and nodes[0].features.in_degree + nodes[0].features.out_degree == 0:
        hypothesis = "Изолированный узел: наблюдаемых связей=0; назначение группы не установлено"
    else:
        hypothesis = (
            f"Группа наблюдаемых потоков: узлов={len(nodes)}, seed={n_seed}; "
            f"признаки сбора у {collectors}, распределения у {distributors}, "
            f"координации у {coordinators}; внутренний оборот={community.internal_kzt:.6g} KZT. "
            "Гипотеза для проверки, не доказательство общей деятельности"
        )
    return ClusterAnalysis(
        community.cluster_id,
        len(nodes),
        n_seed,
        community.internal_kzt,
        tuple(node.features.gid for node in ranked[:5]),
        hypothesis,
    )
