import csv
import json
import os
import subprocess
import sys
from dataclasses import asdict, replace
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from money_graph.application.exceptions import AnalysisExportError
from money_graph.application.use_cases.analyze_dataset import AnalyzeDataset
from money_graph.domain.entities.node import Node
from money_graph.domain.models.dataset import Dataset
from money_graph.infrastructure.exporters import csv_analysis_exporter as export_module
from money_graph.infrastructure.exporters.csv_analysis_exporter import CsvAnalysisExporter
from money_graph.infrastructure.graph.networkx_calculator import NetworkxCalculator
from money_graph.infrastructure.readers.parquet_dataset_reader import ParquetDatasetReader

HEADERS = {
    "nodes_roles.csv": ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"],
    "clusters.csv": [
        "cluster_id",
        "n_nodes",
        "n_seed",
        "sum_kzt_internal",
        "top_gids",
        "hypothesis",
    ],
    "top_nodes.csv": ["rank", "gid", "role", "priority_score", "why"],
}


def write_parquet(directory, dataset):
    directory.mkdir()
    schemas = {
        "nodes": pa.schema([("gid", pa.int64()), ("depth", pa.int64()), ("is_seed", pa.bool_())]),
        "edges": pa.schema(
            [
                ("src", pa.int64()),
                ("dst", pa.int64()),
                ("sum_kzt", pa.float64()),
                ("n_tx", pa.int64()),
                ("depth", pa.int8()),
            ]
        ),
        "transactions": pa.schema(
            [
                ("src", pa.int64()),
                ("dst", pa.int64()),
                ("date", pa.date32()),
                ("sum_kzt", pa.float64()),
            ]
        ),
    }
    for name, schema in schemas.items():
        rows = [asdict(row) for row in getattr(dataset, name)]
        for row in rows:
            if "sum_kzt" in row:
                row["sum_kzt"] = float(row["sum_kzt"])
        pq.write_table(pa.Table.from_pylist(rows, schema=schema), directory / f"{name}.parquet")


def analyze(directory, output):
    return AnalyzeDataset(
        ParquetDatasetReader(), NetworkxCalculator(), CsvAnalysisExporter()
    ).execute(directory, output)


def cli(directory, output):
    return subprocess.run(
        [
            str(Path(sys.executable).parent / "money-graph"),
            "analyze",
            "--data-dir",
            str(directory),
            "--output-dir",
            str(output),
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def read_csv(path):
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        return reader.fieldnames, list(reader)


def test_full_cli_exact_schemas_and_repeatable_csv(tmp_path, dataset):
    source, output = tmp_path / "data", tmp_path / "out"
    write_parquet(source, dataset)
    original = {p.name: p.read_bytes() for p in source.iterdir()}
    output.mkdir()
    (output / "unrelated.txt").write_text("keep")
    first = cli(source, output)
    assert first.returncode == 0, first.stderr
    assert "Узлов: 3" in first.stdout and "Длительность:" in first.stdout
    assert first.stderr == ""
    content = {}
    for name, expected in HEADERS.items():
        header, rows = read_csv(output / name)
        assert header == expected
        assert all(all(value != "" for value in row.values()) for row in rows)
        content[name] = (output / name).read_bytes()
    nodes = read_csv(output / "nodes_roles.csv")[1]
    clusters = read_csv(output / "clusters.csv")[1]
    top = read_csv(output / "top_nodes.csv")[1]
    assert len(nodes) == 3 and len(top) == 3
    assert {int(row["gid"]) for row in nodes} == {n.gid for n in dataset.nodes}
    assert sum(int(row["n_nodes"]) for row in clusters) == 3
    assert all(row["cluster_id"] in {c["cluster_id"] for c in clusters} for row in nodes)
    assert all(isinstance(json.loads(row["top_gids"]), list) for row in clusters)
    for node in nodes:
        assert 0 <= float(node["role_score"]) <= 1
        assert 0 <= float(node["priority_score"]) <= 1
        assert len(node["evidence"]) <= 200
    keys = [(-float(row["priority_score"]), int(row["gid"])) for row in top]
    assert keys == sorted(keys)
    assert [int(row["rank"]) for row in top] == [1, 2, 3]
    assert cli(source, output).returncode == 0
    assert content == {name: (output / name).read_bytes() for name in HEADERS}
    assert original == {p.name: p.read_bytes() for p in source.iterdir()}
    assert (output / "unrelated.txt").read_text() == "keep"


def test_invalid_input_preserves_outputs(tmp_path, dataset):
    source, output = tmp_path / "data", tmp_path / "out"
    write_parquet(source, dataset)
    analyze(source, output)
    before = {p.name: p.read_bytes() for p in output.iterdir()}
    (source / "edges.parquet").unlink()
    result = cli(source, output)
    assert result.returncode == 1
    assert "edges.parquet" in result.stderr
    assert "Traceback" not in result.stderr
    assert before == {p.name: p.read_bytes() for p in output.iterdir()}


def test_top_twenty_stable_ties_without_edges(tmp_path):
    source, output = tmp_path / "data", tmp_path / "out"
    dataset = Dataset(tuple(Node(gid, 0, True) for gid in reversed(range(30))), (), ())
    write_parquet(source, dataset)
    summary = analyze(source, output)
    assert len(summary.result.clusters) == 30
    assert [node.features.gid for node in summary.result.top_nodes] == list(range(20))
    assert all(node.decision.role == "peripheral" for node in summary.result.nodes)
    assert all(node.priority.score == 0 for node in summary.result.nodes)


def test_empty_graph_exports_headers(tmp_path):
    source, output = tmp_path / "data", tmp_path / "out"
    write_parquet(source, Dataset((), (), ()))
    result = cli(source, output)
    assert result.returncode == 0, result.stderr
    for name, header in HEADERS.items():
        assert read_csv(output / name) == (header, [])


def test_csv_escaping(tmp_path, dataset):
    source, output = tmp_path / "data", tmp_path / "out"
    write_parquet(source, dataset)
    result = analyze(source, output).result
    text = 'Гипотеза, "проверить"\nСледующая строка'
    node = replace(result.nodes[0], decision=replace(result.nodes[0].decision, evidence=text))
    result = replace(result, nodes=(node, *result.nodes[1:]))
    CsvAnalysisExporter().export(result, output)
    assert read_csv(output / "nodes_roles.csv")[1][0]["evidence"] == text


def test_staging_failure_does_not_publish(tmp_path, dataset, monkeypatch):
    source, output = tmp_path / "data", tmp_path / "out"
    write_parquet(source, dataset)
    result = analyze(source, output).result
    before = {p.name: p.read_bytes() for p in output.iterdir()}
    original = Path.open

    def fail(path, *args, **kwargs):
        if path.name == "clusters.csv" and path.parent.name.startswith(".analysis-"):
            raise OSError("disk full")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", fail)
    with pytest.raises(AnalysisExportError, match="disk full"):
        CsvAnalysisExporter().export(result, output)
    assert before == {p.name: p.read_bytes() for p in output.iterdir()}


def test_publish_failure_restores_previous_files(tmp_path, dataset, monkeypatch):
    source, output = tmp_path / "data", tmp_path / "out"
    write_parquet(source, dataset)
    result = analyze(source, output).result
    (output / "nodes_roles.csv").write_text("previous version")
    before = {p.name: p.read_bytes() for p in output.iterdir()}
    original = os.replace

    def fail(src, dst):
        if Path(src).name == "clusters.csv" and Path(src).parent.name.startswith(".analysis-"):
            raise OSError("publication failed")
        return original(src, dst)

    monkeypatch.setattr(export_module.os, "replace", fail)
    with pytest.raises(AnalysisExportError, match="publication failed"):
        CsvAnalysisExporter().export(result, output)
    assert before == {p.name: p.read_bytes() for p in output.iterdir()}


def test_output_symlink_rejected_and_parquet_preserved(tmp_path, dataset):
    source, output = tmp_path / "data", tmp_path / "out"
    write_parquet(source, dataset)
    output.mkdir()
    original = (source / "nodes.parquet").read_bytes()
    (output / "nodes_roles.csv").symlink_to(source / "nodes.parquet")
    result = cli(source, output)
    assert result.returncode == 1
    assert "ссылка" in result.stderr
    assert (source / "nodes.parquet").read_bytes() == original
