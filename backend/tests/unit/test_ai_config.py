import pytest

from money_graph.config import AIConfig


def test_env_configuration_and_redacted_repr(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    monkeypatch.setenv("OPENAI_TIMEOUT_SECONDS", "12")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.openai.com/v1/")
    config = AIConfig.from_environment()
    assert config.configured
    assert config.timeout_seconds == 12
    assert config.base_url == "https://api.openai.com/v1"
    assert config.api_key not in repr(config)


@pytest.mark.parametrize("timeout", ["broken", "NaN", "inf", "0", "-1", "121"])
def test_bad_timeout_disables_ai(monkeypatch, timeout):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    monkeypatch.setenv("OPENAI_TIMEOUT_SECONDS", timeout)
    assert not AIConfig.from_environment().configured


@pytest.mark.parametrize(
    "config",
    [
        AIConfig(),
        AIConfig(api_key="test-only-placeholder"),
        AIConfig(model="test-model"),
        AIConfig("test-only-placeholder", "test-model", "http://api.openai.com/v1"),
        AIConfig("test-only-placeholder", "test-model", "https://name:password@example.test"),
    ],
)
def test_incomplete_or_invalid_configuration(config):
    assert config.configured is False
