from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from money_graph.application.use_cases.analyze_dataset import AnalyzeDataset
from money_graph.domain.models.analysis import Community, GraphFacts, NodeFeatures
from money_graph.domain.services.dataset_validator import DatasetValidationError


class Reader:
    def __init__(self, dataset, events):
        self.dataset, self.events = dataset, events

    def read(self, path):
        self.events.append("read")
        return self.dataset


class Graph:
    def __init__(self, events):
        self.events = events

    def calculate(self, dataset):
        self.events.append("graph")
        return GraphFacts(
            tuple(
                NodeFeatures(n.gid, n.depth, n.is_seed, 0, 0, Decimal(0), Decimal(0), 0, 0, 0)
                for n in dataset.nodes
            ),
            tuple(Community(i, (n.gid,), Decimal(0)) for i, n in enumerate(dataset.nodes, 1)),
        )


class Exporter:
    def __init__(self, events):
        self.events = events
        self.result = None

    def export(self, result, output_dir):
        self.events.append("export")
        self.result = result


def test_analysis_order_results_and_stable_ties(dataset):
    events = []
    exporter = Exporter(events)
    summary = AnalyzeDataset(Reader(dataset, events), Graph(events), exporter).execute(
        Path("input"), Path("output")
    )
    assert events == ["read", "graph", "export"]
    assert summary.result is exporter.result
    assert summary.n_transactions == 2
    assert summary.elapsed_seconds >= 0
    assert [n.features.gid for n in summary.result.top_nodes] == [2, 3, 100000005382566100]
    assert sum(c.n_nodes for c in summary.result.clusters) == 3


def test_invalid_dataset_never_calculated_or_published(dataset):
    events = []
    invalid = replace(dataset, nodes=dataset.nodes * 2)
    with pytest.raises(DatasetValidationError):
        AnalyzeDataset(Reader(invalid, events), Graph(events), Exporter(events)).execute(
            Path("input"), Path("output")
        )
    assert events == ["read"]


def test_graph_failure_never_publishes(dataset):
    events = []

    class FailedGraph:
        def calculate(self, dataset):
            raise RuntimeError("calculation failed")

    with pytest.raises(RuntimeError, match="calculation failed"):
        AnalyzeDataset(Reader(dataset, events), FailedGraph(), Exporter(events)).execute(
            Path("input"), Path("output")
        )
    assert events == ["read"]


def test_temporal_calculated_once_on_read_dataset_before_export(dataset, monkeypatch):
    from money_graph.application.use_cases import analyze_dataset as module

    events = []
    original = module.analyze_temporal_patterns

    def calculate(nodes, transactions):
        assert nodes is dataset.nodes and transactions is dataset.transactions
        events.append("temporal")
        return original(nodes, transactions)

    monkeypatch.setattr(module, "analyze_temporal_patterns", calculate)
    summary = AnalyzeDataset(Reader(dataset, events), Graph(events), Exporter(events)).execute(
        Path("input"), Path("output")
    )
    assert events == ["read", "graph", "temporal", "export"]
    assert {group.gid for group in summary.temporal.nodes} == {node.gid for node in dataset.nodes}


def test_temporal_failure_does_not_export(dataset, monkeypatch):
    from money_graph.application.use_cases import analyze_dataset as module

    def fail(*args):
        raise ValueError("temporal failure")

    monkeypatch.setattr(module, "analyze_temporal_patterns", fail)
    events = []
    with pytest.raises(ValueError, match="temporal failure"):
        AnalyzeDataset(Reader(dataset, events), Graph(events), Exporter(events)).execute(
            Path("input"), Path("output")
        )
    assert events == ["read", "graph"]
