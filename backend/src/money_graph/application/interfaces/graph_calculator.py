from typing import Protocol

from money_graph.domain.models.analysis import GraphFacts
from money_graph.domain.models.dataset import Dataset


class GraphCalculator(Protocol):
    def calculate(self, dataset: Dataset) -> GraphFacts: ...
