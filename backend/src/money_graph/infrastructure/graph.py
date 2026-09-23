from collections import defaultdict
from typing import Any

import networkx as nx

from money_graph.application.ports import Analysis, Dataset
from money_graph.domain.models import NodeFeatures
from money_graph.domain.roles import assign_role, priority_base
from money_graph.infrastructure.advanced import enrich


class NetworkxAnalyzer:
    def analyze(self, dataset: Dataset) -> Analysis:
        graph = nx.DiGraph()
        node_meta = {node.gid: node for node in dataset.nodes}
        graph.add_nodes_from(node_meta)
        for edge in dataset.edges:
            graph.add_edge(edge.src, edge.dst, sum_kzt=edge.sum_kzt, n_tx=edge.n_tx, depth=edge.depth)
        pagerank = nx.pagerank(graph, weight="sum_kzt") if graph.number_of_edges() else {gid: 0.0 for gid in graph}
        undirected = nx.Graph()
        undirected.add_nodes_from(graph.nodes)
        for edge in dataset.edges:
            previous = undirected.get_edge_data(edge.src, edge.dst, {}).get("weight", 0.0)
            undirected.add_edge(edge.src, edge.dst, weight=previous + edge.sum_kzt)
        communities = nx.community.louvain_communities(undirected, weight="weight", seed=42)
        communities.sort(key=lambda group: min(group))
        cluster_of = {gid: index for index, group in enumerate(communities, 1) for gid in group}
        rows: list[dict[str, Any]] = []
        raw_scores: dict[int, float] = {}
        for gid, node in node_meta.items():
            seed_neighbors = len({other for other in graph.predecessors(gid) if node_meta[other].is_seed} |
                                 {other for other in graph.successors(gid) if node_meta[other].is_seed})
            features = NodeFeatures(node, graph.in_degree(gid), graph.out_degree(gid),
                                    float(graph.in_degree(gid, weight="sum_kzt")),
                                    float(graph.out_degree(gid, weight="sum_kzt")),
                                    int(graph.in_degree(gid, weight="n_tx")),
                                    int(graph.out_degree(gid, weight="n_tx")),
                                    seed_neighbors, pagerank[gid])
            decision = assign_role(features)
            raw_scores[gid] = priority_base(features, decision)
            rows.append({"gid": gid, "depth": node.depth, "is_seed": node.is_seed,
                         "role": decision.role, "role_score": decision.role_score,
                         "cluster_id": cluster_of[gid], "priority_score": 0.0,
                         "evidence": decision.evidence, "in_deg": features.in_deg,
                         "out_deg": features.out_deg, "in_kzt": features.in_kzt,
                         "out_kzt": features.out_kzt, "in_tx": features.in_tx,
                         "out_tx": features.out_tx, "seed_neighbors": seed_neighbors,
                         "pagerank": pagerank[gid], "truncated_by_depth": features.truncated_by_depth})
        maximum = max(raw_scores.values(), default=1.0) or 1.0
        for row in rows:
            row["priority_score"] = round(raw_scores[row["gid"]] / maximum, 4)
        rows.sort(key=lambda row: row["gid"])
        by_gid = {row["gid"]: row for row in rows}
        internal: dict[int, float] = defaultdict(float)
        for edge in dataset.edges:
            if cluster_of[edge.src] == cluster_of[edge.dst]:
                internal[cluster_of[edge.src]] += edge.sum_kzt
        clusters = []
        for index, members in enumerate(communities, 1):
            important = sorted(members, key=lambda gid: (-by_gid[gid]["priority_score"], gid))[:5]
            leading = by_gid[important[0]]
            hypothesis = f"Группа с признаками роли {leading['role']} у ключевого узла {important[0]}; требуется проверка"
            clusters.append({"cluster_id": index, "n_nodes": len(members),
                             "n_seed": sum(node_meta[gid].is_seed for gid in members),
                             "sum_kzt_internal": round(internal[index], 2),
                             "top_gids": important, "hypothesis": hypothesis})
        leaders = sorted(rows, key=lambda row: (-row["priority_score"], row["gid"]))[:20]
        top = [{"rank": rank, "gid": row["gid"], "role": row["role"],
                "priority_score": row["priority_score"], "why": row["evidence"]}
               for rank, row in enumerate(leaders, 1)]
        edges = [{"src": e.src, "dst": e.dst, "sum_kzt": e.sum_kzt, "n_tx": e.n_tx, "depth": e.depth}
                 for e in dataset.edges]
        summary = {"n_nodes": len(rows), "n_edges": len(edges), "n_transactions": len(dataset.transactions),
                   "n_seed": sum(n.is_seed for n in dataset.nodes), "n_clusters": len(clusters),
                   "edge_volume_kzt": round(sum(e.sum_kzt for e in dataset.edges), 2),
                   "truncated_count": sum(row["truncated_by_depth"] for row in rows)}
        extras = enrich(dataset, graph, rows)
        return Analysis("", summary, rows, edges, clusters, top, extras)
