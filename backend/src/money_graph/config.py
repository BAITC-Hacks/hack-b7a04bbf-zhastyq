import math
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit


@dataclass(frozen=True)
class AIConfig:
    api_key: str = field(default="", repr=False)
    model: str = ""
    base_url: str = "https://api.openai.com/v1"
    timeout_seconds: float = 30.0

    @property
    def configured(self) -> bool:
        try:
            address = urlsplit(self.base_url)
            address_valid = (
                address.scheme == "https"
                and bool(address.hostname)
                and address.username is None
                and address.password is None
                and not address.query
                and not address.fragment
            )
        except ValueError:
            address_valid = False
        return bool(
            self.api_key.strip()
            and self.model.strip()
            and address_valid
            and math.isfinite(self.timeout_seconds)
            and 1 <= self.timeout_seconds <= 120
        )

    @classmethod
    def from_environment(cls) -> "AIConfig":
        try:
            timeout = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "30"))
        except ValueError:
            timeout = 0.0
        return cls(
            os.getenv("OPENAI_API_KEY", "").strip(),
            os.getenv("OPENAI_MODEL", "").strip(),
            os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/"),
            timeout,
        )
