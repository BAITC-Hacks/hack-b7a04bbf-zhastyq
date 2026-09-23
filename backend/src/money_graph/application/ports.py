from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol

from money_graph.domain.models import Edge, Node, Transaction


@dataclass(frozen=True, slots=True)
class Dataset:
    nodes: tuple[Node, ...]
    edges: tuple[Edge, ...]
    transactions: tuple[Transaction, ...]


@dataclass(frozen=True, slots=True)
class Analysis:
    analysis_id: str
    summary: dict[str, Any]
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    clusters: list[dict[str, Any]]
    top_nodes: list[dict[str, Any]]
    extras: dict[str, Any] = field(default_factory=dict)

    def screen(self) -> dict[str, Any]:
        return {
            "analysis_id": self.analysis_id,
            "summary": self.summary,
            "nodes": self.nodes,
            "edges": self.edges,
            "clusters": self.clusters,
            "top_nodes": self.top_nodes,
            **self.extras,
        }


class DatasetReader(Protocol):
    def read(self, paths: Mapping[str, str]) -> Dataset: ...


class GraphAnalyzer(Protocol):
    def analyze(self, dataset: Dataset) -> Analysis: ...


class Publisher(Protocol):
    def publish(self, analysis: Analysis) -> None: ...
    def load(self) -> Analysis | None: ...


class LanguageModel(Protocol):
    def answer(self, question: str, facts: dict[str, Any], limitations: list[str]) -> str: ...
