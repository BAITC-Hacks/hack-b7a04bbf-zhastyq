from dataclasses import dataclass


@dataclass(frozen=True)
class Node:
    gid: int
    depth: int
    is_seed: bool
