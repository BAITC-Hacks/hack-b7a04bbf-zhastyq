import csv
import io
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from money_graph.bootstrap import build_api

GID_A = 100000000000000001
GID_B = 100000000000000002
GID_C = 100000000000000003
GID_D = 100000000000000004


@pytest.fixture
def client(tmp_path):
    with TestClient(
        build_api(tmp_path / "versions", ("http://localhost:5173",)), raise_server_exceptions=False
    ) as client:
        yield client


def upload(client, payloads):
    return client.post(
        "/api/analyze",
        files={
            name: (f"../../{name}.parquet", content, "application/octet-stream")
            for name, content in payloads.items()
        },
    )


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert set(response.json()["error"]) == {"code", "message", "details"}
    assert "Traceback" not in response.text
    assert "/home/" not in response.text
    assert "/tmp/" not in response.text


def test_initial_health_and_no_analysis(client):
    assert client.get("/api/health").json() == {
        "status": "ok",
        "analysis_ready": False,
        "ai_configured": False,
    }
    for url in ("/api/analysis", f"/api/nodes/{GID_A}", "/api/exports/nodes_roles.csv"):
        assert_error(client.get(url), 404, "NO_ANALYSIS")


def test_upload_full_graph_exact_ids_cards_and_exports(client, payloads):
    response = upload(client, payloads)
    assert response.status_code == 200, response.text
    posted = response.json()
    assert posted["status"] == "ready"
    assert posted["analysis_url"] == "/api/analysis"
    assert posted["summary"] == {
        "n_nodes": 4,
        "n_edges": 3,
        "n_transactions": 4,
        "n_seed": 2,
        "n_clusters": 2,
        "edge_volume_kzt": 20000.0,
    }
    assert client.get("/api/health").json()["analysis_ready"] is True
    assert client.get("/api/health").json()["ai_configured"] is False
    graph = client.get("/api/analysis").json()
    assert graph["analysis_id"] == posted["analysis_id"]
    assert graph["summary"] == posted["summary"]
    ids = {node["gid"] for node in graph["nodes"]}
    assert ids == {str(GID_A), str(GID_B), str(GID_C), str(GID_D)}
    assert float(GID_A) == float(GID_B)
    assert len(graph["edges"]) == 3
    assert all(isinstance(e[key], str) for e in graph["edges"] for key in ("src", "dst"))
    assert all(isinstance(n["gid"], str) for n in graph["top_nodes"])
    assert all(isinstance(gid, str) for c in graph["clusters"] for gid in c["top_gids"])
    for gid in (GID_A, GID_B):
        card = client.get(f"/api/nodes/{gid}").json()
        assert card["analysis_id"] == graph["analysis_id"]
        assert card["node"]["gid"] == str(gid)
        assert all(e["dst"] == str(gid) for e in card["incoming"])
        assert all(e["src"] == str(gid) for e in card["outgoing"])
        assert len(card["incoming"]) == 1
        assert len(card["outgoing"]) == (2 if gid == GID_A else 1)
    boundary = client.get(f"/api/nodes/{GID_C}").json()
    assert boundary["node"]["truncated_by_depth"] is True
    assert any("граница" in note for note in boundary["limitations"])
    seed = client.get(f"/api/nodes/{GID_A}").json()
    assert any("seed" in note for note in seed["limitations"])
    isolated = client.get(f"/api/nodes/{GID_D}").json()
    assert isolated["incoming"] == isolated["outgoing"] == []
    assert any("изолирован" in note for note in isolated["limitations"])
    for name, section in (
        ("nodes_roles.csv", "nodes"),
        ("clusters.csv", "clusters"),
        ("top_nodes.csv", "top_nodes"),
    ):
        csv_response = client.get(f"/api/exports/{name}")
        assert csv_response.status_code == 200
        assert "text/csv" in csv_response.headers["content-type"]
        assert f'filename="{name}"' in csv_response.headers["content-disposition"]
        assert csv_response.headers["x-analysis-id"] == posted["analysis_id"]
        rows = list(csv.DictReader(io.StringIO(csv_response.text)))
        assert len(rows) == len(graph[section])
        for row, node in zip(rows, graph[section], strict=True):
            if "gid" in row:
                assert row["gid"] == node["gid"]
                assert row["role"] == node["role"]
                assert float(row["priority_score"]) == node["priority_score"]
            else:
                assert [str(g) for g in json.loads(row["top_gids"])] == node["top_gids"]
                assert float(row["sum_kzt_internal"]) == node["sum_kzt_internal"]
    assert_error(client.get("/api/nodes/123"), 404, "GID_NOT_FOUND")


@pytest.mark.parametrize("name", ["bad.csv", "%2e%2e%2fREADME.md", "a/b.csv", "%2fetc%2fpasswd"])
def test_export_paths_rejected(client, name):
    assert_error(client.get(f"/api/exports/{name}"), 404, "EXPORT_NOT_FOUND")


@pytest.mark.parametrize("gid", ["1.0", "nan", "9223372036854775808"])
def test_invalid_gid(client, gid):
    assert_error(client.get(f"/api/nodes/{gid}"), 422, "INVALID_SCHEMA")


def test_failed_upload_preserves_old_snapshot_and_csv(client, payloads, tmp_path):
    first = upload(client, payloads).json()
    before = client.get("/api/analysis").json()
    old_csv = {
        name: client.get(f"/api/exports/{name}").content
        for name in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv")
    }
    for changed in (
        {**payloads, "edges": b"broken"},
        {k: v for k, v in payloads.items() if k != "nodes"},
    ):
        response = upload(client, changed)
        assert_error(response, 422, "INVALID_SCHEMA")
        assert client.get("/api/analysis").json() == before
        assert all(client.get(f"/api/exports/{n}").content == value for n, value in old_csv.items())
    assert [p.name for p in (tmp_path / "versions").iterdir()] == [first["analysis_id"]]
    second = upload(client, payloads).json()
    assert second["analysis_id"] != first["analysis_id"]
    assert len(list((tmp_path / "versions").iterdir())) == 2
    assert not list((tmp_path / "versions").glob(".upload-*"))


def test_parquet_only_extra_fields_and_duplicate_fields(client, payloads):
    files = [(name, (f"{name}.parquet", value)) for name, value in payloads.items()]
    bad_extension = [(name, ("input.csv", value)) for name, value in payloads.items()]
    for body in (bad_extension, files + [files[0]], files + [("extra", ("x.parquet", b"x"))]):
        assert_error(client.post("/api/analyze", files=body), 422, "INVALID_SCHEMA")
    assert_error(client.post("/api/analyze", content=b"not multipart"), 422, "INVALID_SCHEMA")


def test_actual_size_limit_and_cleanup(tmp_path, payloads):
    limit = max(map(len, payloads.values()))
    with TestClient(build_api(tmp_path / "versions", max_file_bytes=limit)) as client:
        first = upload(client, payloads).json()
        assert "analysis_id" in first
        response = upload(client, {**payloads, "nodes": b"x" * (limit + 1)})
        assert_error(response, 413, "FILE_TOO_LARGE")
        assert response.json()["error"]["details"]["max_bytes"] == limit
        assert client.get("/api/analysis").json()["analysis_id"] == first["analysis_id"]
        assert [p.name for p in (tmp_path / "versions").iterdir()] == [first["analysis_id"]]


def test_total_body_limit(tmp_path):
    with TestClient(build_api(tmp_path / "versions", max_file_bytes=100)) as client:
        response = client.post(
            "/api/analyze", files={"nodes": ("nodes.parquet", b"x" * (1024 * 1024 + 301))}
        )
        assert_error(response, 413, "FILE_TOO_LARGE")


def test_busy_and_reads_during_calculation(client, payloads, monkeypatch):
    first = upload(client, payloads).json()
    publisher = client.app.state.services.publish
    original = publisher._analyzer.execute
    started, release = Event(), Event()

    def blocked(*args):
        started.set()
        assert release.wait(10)
        return original(*args)

    monkeypatch.setattr(publisher._analyzer, "execute", blocked)
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(upload, client, payloads)
        try:
            assert started.wait(5)
            assert_error(upload(client, payloads), 409, "ANALYSIS_BUSY")
            assert client.get("/api/analysis").json()["analysis_id"] == first["analysis_id"]
            assert client.get("/api/health").status_code == 200
            assert client.get("/api/exports/nodes_roles.csv").status_code == 200
        finally:
            release.set()
        assert pending.result(timeout=10).status_code == 200


def test_calculation_error_safe_and_lock_released(client, payloads, monkeypatch, tmp_path):
    first = upload(client, payloads).json()
    analyzer = client.app.state.services.publish._analyzer
    original = analyzer.execute

    def fail(*args):
        raise RuntimeError(f"private location {tmp_path}")

    monkeypatch.setattr(analyzer, "execute", fail)
    response = upload(client, payloads)
    assert_error(response, 500, "INTERNAL_ERROR")
    assert str(tmp_path) not in response.text
    assert client.get("/api/analysis").json()["analysis_id"] == first["analysis_id"]
    monkeypatch.setattr(analyzer, "execute", original)
    assert upload(client, payloads).status_code == 200


def test_openapi_cors_and_restart(client, tmp_path, payloads):
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert schema["components"]["schemas"]["NodeResponse"]["properties"]["gid"]["type"] == "string"
    assert "/api/ask" in schema["paths"]
    allowed = client.options(
        "/api/analyze",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    denied = client.options(
        "/api/analyze",
        headers={"Origin": "https://other.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in denied.headers
    assert upload(client, payloads).status_code == 200
    with TestClient(build_api(tmp_path / "versions")) as restarted:
        assert_error(restarted.get("/api/analysis"), 404, "NO_ANALYSIS")
