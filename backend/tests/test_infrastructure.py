import csv
from dataclasses import replace
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from money_graph.application.use_cases import AnalysisError
from money_graph.infrastructure.graph import NetworkxAnalyzer
from money_graph.infrastructure.publisher import FilePublisher
from money_graph.infrastructure.reader import FileDatasetReader
from money_graph.infrastructure.llm import HttpLanguageModel


TABLES = {
    "nodes": [{"gid": 1, "depth": 0, "is_seed": True},
              {"gid": 2, "depth": 1, "is_seed": False},
              {"gid": 3, "depth": 0, "is_seed": True}],
    "edges": [{"src": 1, "dst": 2, "sum_kzt": 12000.0, "n_tx": 2, "depth": 1}],
    "transactions": [{"src": 1, "dst": 2, "date": "2026-07-01", "sum_kzt": 5000.0},
                     {"src": 1, "dst": 2, "date": "2026-07-02", "sum_kzt": 7000.0}],
}


def write_tables(folder: Path, suffix: str, tables=TABLES):
    paths = {}
    for name, rows in tables.items():
        path = folder / f"{name}.{suffix}"
        if suffix == "csv":
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, rows[0].keys())
                writer.writeheader()
                writer.writerows(rows)
        else:
            pq.write_table(pa.Table.from_pylist(rows), path)
        paths[name] = str(path)
    return paths


def test_csv_parquet_same_result_and_isolated_seed(tmp_path):
    csv_paths = write_tables(tmp_path, "csv")
    pq_paths = write_tables(tmp_path, "parquet")
    reader = FileDatasetReader()
    csv_result = NetworkxAnalyzer().analyze(reader.read(csv_paths))
    pq_result = NetworkxAnalyzer().analyze(reader.read(pq_paths))
    assert csv_result.screen() == pq_result.screen()
    assert {row["gid"] for row in csv_result.nodes} == {1, 2, 3}
    assert csv_result.summary["n_seed"] == 2
    assert sum(cluster["sum_kzt_internal"] for cluster in csv_result.clusters) == 12000


def test_missing_column_and_wrong_aggregate_are_explicit(tmp_path):
    paths = write_tables(tmp_path, "csv")
    (tmp_path / "nodes.csv").write_text("gid,is_seed\n1,true\n", encoding="utf-8")
    with pytest.raises(AnalysisError, match="depth") as error:
        FileDatasetReader().read(paths)
    assert error.value.details["missing_columns"] == ["depth"]
    paths = write_tables(tmp_path, "csv")
    (tmp_path / "edges.csv").write_text("src,dst,sum_kzt,n_tx,depth\n1,2,13000,2,1\n", encoding="utf-8")
    with pytest.raises(AnalysisError, match="не сходятся"):
        FileDatasetReader().read(paths)


def test_publisher_keeps_previous_version_when_new_write_fails(tmp_path, monkeypatch):
    data = FileDatasetReader().read(write_tables(tmp_path, "csv"))
    result = NetworkxAnalyzer().analyze(data)
    publisher = FilePublisher(tmp_path / "out")
    publisher.publish(replace(result, analysis_id="first"))
    assert publisher.load().analysis_id == "first"
    assert (tmp_path / "out" / "nodes_roles.csv").exists()
    original = Path.write_text

    def fail_on_json(path, text, *args, **kwargs):
        if path.name == "viewer_data.json":
            raise OSError("disk full")
        return original(path, text, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", fail_on_json)
    with pytest.raises(OSError):
        publisher.publish(replace(result, analysis_id="second"))
    assert publisher.load().analysis_id == "first"


@pytest.mark.parametrize("provider,endpoint", [("openai", "/responses"), ("nvidia", "/chat/completions")])
def test_llm_adapters_use_provider_specific_payloads(monkeypatch, provider, endpoint):
    calls = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            if provider == "openai":
                return {"output": [{"content": [{"type": "output_text", "text": "gid 1: 12000 KZT"}]}]}
            return {"choices": [{"message": {"content": "gid 1: 12000 KZT"}}]}

    class Client:
        def __init__(self, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, headers, json):
            calls.append((url, headers, json))
            return Response()

    monkeypatch.setattr("money_graph.infrastructure.llm.httpx.Client", Client)
    model = HttpLanguageModel(provider, "test-token", "test-model", "https://test.example/v1")
    assert model.answer("Почему?", {"gid": 1}, ["Ограничение"]) == "gid 1: 12000 KZT"
    assert calls[0][0].endswith(endpoint)
    assert calls[0][2]["model"] == "test-model"
    assert ("instructions" in calls[0][2]) == (provider == "openai")
