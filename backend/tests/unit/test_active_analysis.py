from contextlib import contextmanager
from dataclasses import replace
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest

from money_graph.application.dto.active_analysis import AnalysisWorkspace, DatasetUpload
from money_graph.application.dto.analysis_summary import AnalysisSummary
from money_graph.application.exceptions import ApiError, DatasetReadError
from money_graph.application.use_cases.get_analysis import GetAnalysis
from money_graph.application.use_cases.get_export import GetExport
from money_graph.application.use_cases.get_node import GetNode
from money_graph.application.use_cases.publish_analysis import PublishAnalysis
from money_graph.domain.models.analysis import (
    AnalysisResult,
    ClusterAnalysis,
    NodeAnalysis,
    NodeFeatures,
    Priority,
    RoleDecision,
)


class Store:
    def __init__(self):
        self.active = None
        self.busy = False

    def get(self):
        return self.active

    def replace(self, snapshot):
        self.active = snapshot

    def try_start_analysis(self):
        if self.busy:
            return False
        self.busy = True
        return True

    def finish_analysis(self):
        self.busy = False


class Files:
    def __init__(self, store):
        self.store = store
        self.cleaned = False

    @contextmanager
    def prepare(self, analysis_id, uploads):
        previous = self.store.active
        yield AnalysisWorkspace(Path("input"), Path("output"))
        assert self.store.active is previous
        self.cleaned = True

    def export_path(self, output_dir, name):
        return output_dir / name


@pytest.fixture
def calculation(dataset):
    f = NodeFeatures(dataset.nodes[0].gid, 0, True, 0, 0, Decimal(0), Decimal(0), 0, 0, 0)
    node = NodeAnalysis(
        f, RoleDecision("peripheral", 0.5, "Связей=0"), 1, Priority(0, "Нет связей")
    )
    result = AnalysisResult(
        (node,), (ClusterAnalysis(1, 1, 1, Decimal(0), (f.gid,), "Изолирован"),), (node,)
    )
    return AnalysisSummary(result, len(dataset.transactions), 0.01, dataset.edges)


@pytest.fixture
def uploads():
    return tuple(
        DatasetUpload(name, f"{name}.parquet", BytesIO())
        for name in ("nodes", "edges", "transactions")
    )


def test_publish_once_cleanup_before_swap_and_query_results(calculation, uploads):
    store = Store()
    files = Files(store)
    calls = []

    class Analyzer:
        def execute(self, source, output):
            calls.append((source, output))
            return calculation

    publisher = PublishAnalysis(Analyzer(), store, files)
    snapshot = publisher.execute(uploads)
    assert calls == [(Path("input"), Path("output"))]
    assert files.cleaned and not store.busy
    assert store.active is snapshot
    assert snapshot.edges is calculation.edges
    assert snapshot.summary.edge_volume_kzt == Decimal("10000")
    query = GetAnalysis(store)
    assert query.execute() is snapshot
    gid = calculation.result.nodes[0].features.gid
    card = GetNode(query).execute(gid)
    assert card.analysis_id == snapshot.analysis_id
    assert card.outgoing == calculation.edges
    assert any("seed" in text for text in card.limitations)
    exported = GetExport(query, files).execute("nodes_roles.csv")
    assert exported.path == Path("output/nodes_roles.csv")
    assert exported.analysis_id == snapshot.analysis_id
    next_snapshot = publisher.execute(uploads)
    assert next_snapshot.analysis_id != snapshot.analysis_id


def test_read_failure_sanitizes_path_and_releases_lock(uploads):
    class Analyzer:
        def execute(self, *args):
            raise DatasetReadError("/private/internal/upload/nodes.parquet: поле gid: неверный тип")

    store = Store()
    with pytest.raises(ApiError) as error:
        PublishAnalysis(Analyzer(), store, Files(store)).execute(uploads)
    assert error.value.code == "INVALID_SCHEMA"
    assert error.value.message == "nodes.parquet: поле gid: неверный тип"
    assert store.active is None and not store.busy


def test_busy_does_not_read_uploads_or_unlock_other_request(uploads):
    store = Store()
    store.busy = True
    with pytest.raises(ApiError, match="Другой анализ"):
        PublishAnalysis(None, store, Files(store)).execute(uploads)
    assert store.busy is True


@pytest.mark.parametrize("problem", ["missing", "extension"])
def test_invalid_upload_metadata_releases_lock(uploads, problem):
    if problem == "missing":
        uploads = uploads[:2]
    else:
        uploads = (replace(uploads[0], filename="nodes.csv"), *uploads[1:])
    store = Store()
    with pytest.raises(ApiError) as error:
        PublishAnalysis(None, store, Files(store)).execute(uploads)
    assert error.value.code == "INVALID_SCHEMA"
    assert not store.busy


def test_query_errors(calculation):
    store = Store()
    query = GetAnalysis(store)
    assert query.optional() is None
    with pytest.raises(ApiError) as error:
        query.execute()
    assert error.value.code == "NO_ANALYSIS"
    with pytest.raises(ApiError) as error:
        GetExport(query, Files(store)).execute("../nodes_roles.csv")
    assert error.value.code == "EXPORT_NOT_FOUND"
