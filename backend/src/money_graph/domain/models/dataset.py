from dataclasses import dataclass

from money_graph.domain.entities.edge import Edge
from money_graph.domain.entities.node import Node
from money_graph.domain.entities.transaction import Transaction


@dataclass(frozen=True)
class Dataset:
    nodes: tuple[Node, ...]
    edges: tuple[Edge, ...]
    transactions: tuple[Transaction, ...]
