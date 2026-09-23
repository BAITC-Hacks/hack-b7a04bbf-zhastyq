import json
import os
from typing import Any

import httpx


SYSTEM_PROMPT = (
    "Ты помощник AML-аналитика. Отвечай по-русски коротко и только по переданным фактам. "
    "Приводи существующие gid и точные числа, не выдумывай атрибуты или связи. "
    "Роли и выводы называй гипотезами для проверки. Укажи ограничения наблюдения."
)


class HttpLanguageModel:
    def __init__(self, provider: str, api_key: str, model: str, base_url: str | None = None):
        self.provider = provider
        self.api_key = api_key
        self.model = model
        defaults = {"openai": "https://api.openai.com/v1", "nvidia": "https://integrate.api.nvidia.com/v1"}
        if provider not in defaults:
            raise ValueError(f"Неизвестный LLM_PROVIDER: {provider}")
        self.base_url = (base_url or defaults[provider]).rstrip("/")

    @classmethod
    def from_environment(cls) -> "HttpLanguageModel | None":
        provider = os.getenv("LLM_PROVIDER", "openai").lower()
        prefix = "OPENAI" if provider == "openai" else "NVIDIA" if provider == "nvidia" else None
        if prefix is None:
            raise ValueError(f"Неизвестный LLM_PROVIDER: {provider}")
        key = os.getenv(f"{prefix}_API_KEY")
        model = os.getenv(f"{prefix}_MODEL")
        if not key or not model:
            return None
        return cls(provider, key, model, os.getenv(f"{prefix}_BASE_URL"))

    def answer(self, question: str, facts: dict[str, Any], limitations: list[str]) -> str:
        user = json.dumps({"question": question, "facts": facts, "limitations": limitations}, ensure_ascii=False)
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        try:
            with httpx.Client(timeout=45) as client:
                if self.provider == "openai":
                    response = client.post(f"{self.base_url}/responses", headers=headers,
                                           json={"model": self.model, "instructions": SYSTEM_PROMPT, "input": user,
                                                 "max_output_tokens": 500})
                    response.raise_for_status()
                    body = response.json()
                    chunks = [part.get("text", "") for item in body.get("output", [])
                              for part in item.get("content", []) if part.get("type") == "output_text"]
                    answer = "\n".join(chunks).strip()
                else:
                    response = client.post(f"{self.base_url}/chat/completions", headers=headers,
                                           json={"model": self.model, "messages": [
                                               {"role": "system", "content": SYSTEM_PROMPT},
                                               {"role": "user", "content": user}],
                                                 "max_tokens": 500, "stream": False})
                    response.raise_for_status()
                    answer = response.json()["choices"][0]["message"]["content"].strip()
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise RuntimeError(f"Модель недоступна: {type(exc).__name__}") from None
        if not answer:
            raise RuntimeError("Модель вернула пустой ответ")
        return answer
