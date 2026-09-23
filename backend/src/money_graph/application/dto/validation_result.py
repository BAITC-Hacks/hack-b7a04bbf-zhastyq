from dataclasses import dataclass


@dataclass(frozen=True)
class ValidationResult:
    n_nodes: int
    n_edges: int
    n_transactions: int
    n_seed: int
