from pathlib import Path
from time import perf_counter

from money_graph.application.dto.analysis_summary import AnalysisSummary
from money_graph.application.interfaces.analysis_exporter import AnalysisExporter
from money_graph.application.interfaces.dataset_reader import DatasetReader
from money_graph.application.interfaces.graph_calculator import GraphCalculator
from money_graph.domain.models.analysis import AnalysisResult, NodeAnalysis
from money_graph.domain.services.cluster_summary import summarize_cluster
from money_graph.domain.services.dataset_validator import validate_dataset
from money_graph.domain.services.priority_calculator import calculate_priorities
from money_graph.domain.services.role_classifier import classify_role


class AnalyzeDataset:
    def __init__(
        self,
        reader: DatasetReader,
        graph: GraphCalculator,
        exporter: AnalysisExporter,
    ) -> None:
        self._reader = reader
        self._graph = graph
        self._exporter = exporter

    def execute(self, data_dir: Path, output_dir: Path) -> AnalysisSummary:
        started = perf_counter()
        dataset = self._reader.read(data_dir)
        validate_dataset(dataset)
        facts = self._graph.calculate(dataset)
        priorities = calculate_priorities(facts.nodes)
        membership = {gid: group.cluster_id for group in facts.communities for gid in group.gids}
        nodes = tuple(
            NodeAnalysis(
                features,
                classify_role(features),
                membership[features.gid],
                priorities[features.gid],
            )
            for features in sorted(facts.nodes, key=lambda node: node.gid)
        )
        grouped: dict[int, list[NodeAnalysis]] = {
            group.cluster_id: [] for group in facts.communities
        }
        for node in nodes:
            grouped[node.cluster_id].append(node)
        clusters = tuple(
            summarize_cluster(group, tuple(grouped[group.cluster_id]))
            for group in sorted(facts.communities, key=lambda group: group.cluster_id)
        )
        top = tuple(sorted(nodes, key=lambda node: (-node.priority.score, node.features.gid))[:20])
        result = AnalysisResult(nodes, clusters, top)
        self._exporter.export(result, output_dir)
        return AnalysisSummary(result, len(dataset.transactions), perf_counter() - started)
