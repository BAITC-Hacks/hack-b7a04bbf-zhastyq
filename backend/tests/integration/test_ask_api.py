import pytest
from fastapi.testclient import TestClient

from money_graph.application.dto.question import ModelAnswer
from money_graph.application.exceptions import LanguageModelError
from money_graph.bootstrap import build_api, create_api_app

GID_A = "100000000000000001"
GID_B = "100000000000000002"


@pytest.fixture
def client(tmp_path, fake_model):
    with TestClient(build_api(tmp_path / "versions", language_model=fake_model)) as client:
        yield client


def load(client, payloads):
    response = client.post(
        "/api/analyze",
        files={
            name: (f"{name}.parquet", data, "application/octet-stream")
            for name, data in payloads.items()
        },
    )
    assert response.status_code == 200
    return response.json()["analysis_id"]


def question(analysis_id):
    return {
        "analysis_id": analysis_id,
        "question": "Почему эти узлы в топе?",
        "context_gids": [GID_A, GID_B],
    }


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert set(response.json()["error"]) == {"code", "message", "details"}
    assert "Traceback" not in response.text
    assert "private" not in response.text


def test_contract_precise_identifiers_and_server_facts(client, payloads, fake_model):
    analysis_id = load(client, payloads)
    fake_model.reply = ModelAnswer(
        f"Узел gid={GID_A} переводит деньги узлу gid={GID_B}.", (GID_A, GID_B)
    )
    response = client.post("/api/ask", json=question(analysis_id))
    assert response.status_code == 200, response.text
    data = response.json()
    assert set(data) == {"analysis_id", "answer", "references", "limitations"}
    assert data["analysis_id"] == analysis_id
    assert [r["gid"] for r in data["references"]] == [GID_A, GID_B]
    assert "Исходящих контрагентов: 2" in data["references"][0]["facts"]
    assert "Входящих контрагентов: 1" in data["references"][1]["facts"]
    assert data["limitations"]
    assert client.get("/api/health").json()["ai_configured"] is True
    assert len(fake_model.calls) == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"question": ""},
        {"question": " \n "},
        {"question": "x" * 2001},
        {"context_gids": []},
        {"context_gids": ["999"]},
        {"context_gids": [GID_A] * 2},
        {"context_gids": [GID_A] * 6},
        {"context_gids": [int(GID_A)]},
        {"context_gids": ["1e17"]},
        {"context_gids": ["9223372036854775808"]},
    ],
)
def test_invalid_requests(client, payloads, fake_model, changes):
    data = {**question(load(client, payloads)), **changes}
    response = client.post("/api/ask", json=data)
    assert_error(response, 422, "INVALID_QUESTION")
    assert fake_model.calls == []


def test_missing_selection_and_strip(client, payloads):
    data = question(load(client, payloads))
    data.pop("context_gids")
    response = client.post("/api/ask", json=data)
    assert_error(response, 422, "INVALID_QUESTION")
    assert "на графе" in response.json()["error"]["message"]
    data["context_gids"] = [GID_A]
    data["question"] = " " * 20 + "x" * 2000 + " " * 20
    assert client.post("/api/ask", json=data).status_code == 200


def test_no_analysis_and_stale(client, payloads, fake_model):
    assert_error(client.post("/api/ask", json=question("missing")), 404, "NO_ANALYSIS")
    analysis_id = load(client, payloads)
    load(client, payloads)
    assert_error(client.post("/api/ask", json=question(analysis_id)), 409, "STALE_ANALYSIS")
    assert fake_model.calls == []


def test_changed_snapshot_during_answer(client, payloads, fake_model):
    analysis_id = load(client, payloads)
    fake_model.callback = lambda: load(client, payloads)
    assert_error(client.post("/api/ask", json=question(analysis_id)), 409, "STALE_ANALYSIS")


def test_unverified_reply_rejected(client, payloads, fake_model):
    analysis_id = load(client, payloads)
    fake_model.reply = ModelAnswer("Придуманный клиент", ("999",))
    assert_error(client.post("/api/ask", json=question(analysis_id)), 503, "AI_UNAVAILABLE")


def test_ai_failure_does_not_break_other_routes(client, payloads, fake_model):
    analysis_id = load(client, payloads)
    graph = client.get("/api/analysis").json()
    fake_model.error = LanguageModelError("private provider error")
    assert_error(client.post("/api/ask", json=question(analysis_id)), 503, "AI_UNAVAILABLE")
    assert client.get("/api/analysis").json() == graph
    assert client.get(f"/api/nodes/{GID_A}").status_code == 200
    for name in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv"):
        assert client.get(f"/api/exports/{name}").status_code == 200
    assert client.get("/api/health").json()["ai_configured"] is True


def test_missing_config_keeps_analysis_usable(tmp_path, payloads, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.setenv("ANALYSIS_STORAGE_DIR", str(tmp_path / "versions"))
    with TestClient(create_api_app()) as client:
        analysis_id = load(client, payloads)
        assert client.get("/api/health").json()["ai_configured"] is False
        assert_error(client.post("/api/ask", json=question(analysis_id)), 503, "AI_UNAVAILABLE")
        assert client.get("/api/analysis").status_code == 200
        assert client.get("/api/exports/nodes_roles.csv").status_code == 200


def test_configured_does_not_call_provider_on_health(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    monkeypatch.setenv("ANALYSIS_STORAGE_DIR", str(tmp_path / "versions"))
    with TestClient(create_api_app()) as client:
        assert client.get("/api/health").json()["ai_configured"] is True
