import os

import pytest
import uvicorn
from fastapi.testclient import TestClient

from money_graph.config import AIConfig


@pytest.mark.parametrize("environment_model", [None, "environment-model"])
def test_uvicorn_loads_env_before_app_factory(tmp_path, monkeypatch, environment_model, caplog):
    monkeypatch.setattr(os, "environ", os.environ.copy())
    for name in (
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "OPENAI_BASE_URL",
        "OPENAI_TIMEOUT_SECONDS",
        "ANALYSIS_STORAGE_DIR",
        "CORS_ORIGINS",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)
    if environment_model:
        monkeypatch.setenv("OPENAI_MODEL", environment_model)
    env_file = tmp_path / ".env"
    env_file.write_text(
        'OPENAI_API_KEY="test-only-placeholder"\n'
        "OPENAI_MODEL=file-model\n"
        "OPENAI_BASE_URL=https://api.openai.com/v1\n"
        "OPENAI_TIMEOUT_SECONDS=17\n"
        "ANALYSIS_STORAGE_DIR=versions\n"
        "CORS_ORIGINS=http://localhost:5173\n",
        encoding="utf-8",
    )
    server = uvicorn.Config(
        "money_graph.bootstrap:create_api_app",
        factory=True,
        env_file=env_file,
        log_config=None,
        workers=1,
    )
    server.load()
    settings = AIConfig.from_environment()
    assert settings.configured
    assert settings.model == (environment_model or "file-model")
    assert settings.timeout_seconds == 17
    with TestClient(server.loaded_app) as client:
        response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert response.json() == {
            "status": "ok",
            "analysis_ready": False,
            "ai_configured": True,
        }
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert settings.api_key not in response.text
    assert settings.api_key not in caplog.text
