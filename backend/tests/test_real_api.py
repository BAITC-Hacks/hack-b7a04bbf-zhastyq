import csv
from io import StringIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from money_graph.application.use_cases import AnalysisService
from money_graph.infrastructure.graph import NetworkxAnalyzer
from money_graph.infrastructure.publisher import FilePublisher
from money_graph.infrastructure.reader import FileDatasetReader
from money_graph.presentation.api import create_app


DATA = Path(__file__).resolve().parents[1] / "data"


@pytest.mark.skipif(not (DATA / "nodes.parquet").exists(), reason="Выданный датасет отсутствует")
def test_real_parquet_upload_card_exports_and_unconfigured_ai(tmp_path):
    publisher = FilePublisher(tmp_path / "out")
    service = AnalysisService(FileDatasetReader(), NetworkxAnalyzer(), publisher, None)
    api = TestClient(create_app(service, publisher))
    files = {name: (f"{name}.parquet", (DATA / f"{name}.parquet").read_bytes(), "application/octet-stream")
             for name in ("nodes", "edges", "transactions")}
    response = api.post("/api/analyze", files=files)
    assert response.status_code == 200
    result = response.json()
    assert result["summary"]["n_nodes"] == 2248
    analysis = api.get("/api/analysis").json()
    assert len(analysis["nodes"]) == 2248
    isolated = next(n["gid"] for n in analysis["nodes"] if n["is_seed"] and n["in_deg"] == n["out_deg"] == 0)
    assert api.get(f"/api/nodes/{isolated}").json()["node"]["gid"] == isolated
    boundary = next(n["gid"] for n in analysis["nodes"] if n["truncated_by_depth"])
    card = api.get(f"/api/nodes/{boundary}").json()
    assert card["node"]["role"] != "terminal"
    assert card["node"]["next_request"]
    exported = api.get("/api/exports/nodes_roles.csv")
    assert len(list(csv.DictReader(StringIO(exported.text)))) == 2248
    answer = api.post("/api/ask", json={"analysis_id": result["analysis_id"],
                                    "question": "Почему этот gid в топе?", "context_gids": [analysis["top_nodes"][0]["gid"]]})
    assert answer.status_code == 503
    assert answer.json()["error"]["code"] == "AI_UNAVAILABLE"
