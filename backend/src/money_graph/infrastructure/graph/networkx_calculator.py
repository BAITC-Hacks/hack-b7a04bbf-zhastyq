from collections import Counter
from decimal import Decimal, localcontext

import networkx as nx

from money_graph.domain.models.analysis import Community, GraphFacts, NodeFeatures
from money_graph.domain.models.dataset import Dataset


class NetworkxCalculator:
    def calculate(self, dataset: Dataset) -> GraphFacts:
        with localcontext() as context:
            context.prec = 400
            return self._calculate(dataset)

    def _calculate(self, dataset: Dataset) -> GraphFacts:
        graph = nx.DiGraph()
        graph.add_nodes_from(sorted(node.gid for node in dataset.nodes))
        incoming = dict.fromkeys(graph, Decimal(0))
        outgoing = dict.fromkeys(graph, Decimal(0))
        projection = nx.Graph()
        projection.add_nodes_from(graph)
        for edge in sorted(dataset.edges, key=lambda edge: (edge.src, edge.dst)):
            graph.add_edge(edge.src, edge.dst)
            incoming[edge.dst] += edge.sum_kzt
            outgoing[edge.src] += edge.sum_kzt
            previous = projection.get_edge_data(edge.src, edge.dst, default={}).get(
                "amount", Decimal(0)
            )
            projection.add_edge(edge.src, edge.dst, amount=previous + edge.sum_kzt)
        max_weight = max((data["amount"] for _, _, data in projection.edges(data=True)), default=1)
        for _, _, data in projection.edges(data=True):
            data["weight"] = float(data["amount"] / max_weight)
        in_transactions = Counter(transaction.dst for transaction in dataset.transactions)
        out_transactions = Counter(transaction.src for transaction in dataset.transactions)
        seeds = {node.gid for node in dataset.nodes if node.is_seed}
        features = tuple(
            NodeFeatures(
                node.gid,
                node.depth,
                node.is_seed,
                graph.in_degree(node.gid),
                graph.out_degree(node.gid),
                incoming[node.gid],
                outgoing[node.gid],
                in_transactions[node.gid],
                out_transactions[node.gid],
                len(
                    (
                        (set(graph.predecessors(node.gid)) | set(graph.successors(node.gid)))
                        - {node.gid}
                    )
                    & seeds
                ),
            )
            for node in sorted(dataset.nodes, key=lambda node: node.gid)
        )
        isolated = list(nx.isolates(projection))
        active = projection.subgraph(sorted(set(projection) - set(isolated))).copy()
        groups = (
            nx.community.louvain_communities(active, seed=42, weight="weight") if active else []
        )
        ordered = sorted(tuple(sorted(group)) for group in groups) + [(gid,) for gid in isolated]
        ordered.sort()
        membership = {gid: index for index, group in enumerate(ordered, start=1) for gid in group}
        volumes = dict.fromkeys(range(1, len(ordered) + 1), Decimal(0))
        for edge in sorted(dataset.edges, key=lambda edge: (edge.src, edge.dst)):
            if membership[edge.src] == membership[edge.dst]:
                volumes[membership[edge.src]] += edge.sum_kzt
        communities = tuple(
            Community(index, group, volumes[index]) for index, group in enumerate(ordered, start=1)
        )
        return GraphFacts(features, communities)
