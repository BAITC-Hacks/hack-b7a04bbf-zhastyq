from fastapi.testclient import TestClient

from money_graph.application.use_cases import AnalysisService
from money_graph.infrastructure.graph import NetworkxAnalyzer
from money_graph.infrastructure.publisher import FilePublisher
from money_graph.infrastructure.reader import FileDatasetReader
from money_graph.presentation.api import create_app


class FakeModel:
    def answer(self, question, facts, limitations):
        node = facts["selected_nodes"][0]
        return f"gid {node['gid']} имеет исходящий поток {node['out_kzt']:.0f} KZT; есть ограничения наблюдения."


FILES = {
    "nodes": "gid,depth,is_seed\n1,0,true\n2,1,false\n3,0,true\n",
    "edges": "src,dst,sum_kzt,n_tx,depth\n1,2,12000,2,1\n",
    "transactions": "src,dst,date,sum_kzt\n1,2,2026-07-01,5000\n1,2,2026-07-02,7000\n",
}


def uploads(files=FILES):
    return {name: (f"{name}.csv", text.encode("utf-8"), "text/csv") for name, text in files.items()}


def client(tmp_path):
    publisher = FilePublisher(tmp_path / "out")
    service = AnalysisService(FileDatasetReader(), NetworkxAnalyzer(), publisher, FakeModel())
    return TestClient(create_app(service, publisher))


def test_full_api_path_and_downloads(tmp_path):
    api = client(tmp_path)
    assert api.get("/api/analysis").status_code == 404
    assert api.get("/api/health").json()["analysis_ready"] is False
    loaded = api.post("/api/analyze", files=uploads())
    assert loaded.status_code == 200
    assert loaded.json()["summary"]["n_nodes"] == 3
    current = api.get("/api/analysis")
    assert current.status_code == 200
    assert {node["gid"] for node in current.json()["nodes"]} == {1, 2, 3}
    assert api.get("/api/nodes/3").json()["node"]["is_seed"] is True
    assert api.get("/api/nodes/999").json()["error"]["code"] == "GID_NOT_FOUND"
    answer = api.post("/api/ask", json={"analysis_id": loaded.json()["analysis_id"],
                                      "question": "Куда идут деньги?", "context_gids": [1]})
    assert answer.status_code == 200
    assert answer.json()["references"][0]["gid"] == 1
    for name in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv"):
        response = api.get(f"/api/exports/{name}")
        assert response.status_code == 200
        assert "attachment" in response.headers["content-disposition"]


def test_bad_upload_keeps_previous_analysis_and_stale_ask(tmp_path):
    api = client(tmp_path)
    first = api.post("/api/analyze", files=uploads()).json()["analysis_id"]
    broken = dict(FILES)
    broken["nodes"] = "gid,is_seed\n1,true\n"
    response = api.post("/api/analyze", files=uploads(broken))
    assert response.status_code == 422
    assert response.json()["error"]["details"]["missing_columns"] == ["depth"]
    assert api.get("/api/analysis").json()["analysis_id"] == first
    missing = api.post("/api/analyze", files={"nodes": uploads()["nodes"]})
    assert missing.status_code == 422
    assert set(missing.json()["error"]["details"]["missing_files"]) == {"edges", "transactions"}
    second = api.post("/api/analyze", files=uploads()).json()["analysis_id"]
    assert second != first
    stale = api.post("/api/ask", json={"analysis_id": first, "question": "Почему?", "context_gids": [1]})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "STALE_ANALYSIS"
