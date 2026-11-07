from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@dataclass(frozen=True)
class Settings:
    client_id: str = field(default_factory=lambda: _env("FYERS_CLIENT_ID"))
    secret_key: str = field(default_factory=lambda: _env("FYERS_SECRET_KEY"))
    pin: str = field(default_factory=lambda: _env("FYERS_PIN"))
    redirect_uri: str = field(
        default_factory=lambda: _env(
            "FYERS_REDIRECT_URI", "http://127.0.0.1:8000/api/auth/callback"
        )
    )
    default_symbol: str = field(
        default_factory=lambda: _env("FYERS_SYMBOL", "NSE:NIFTY50-INDEX")
    )
    default_resolution: str = field(
        default_factory=lambda: _env("FYERS_RESOLUTION", "5")
    )
    default_range_days: int = field(
        default_factory=lambda: int(_env("FYERS_RANGE_DAYS", "30") or 30)
    )
    token_path: Path = field(default_factory=lambda: BASE_DIR / ".tokens" / "fyers.json")
    cache_ttl_seconds: int = field(
        default_factory=lambda: int(_env("CACHE_TTL_SECONDS", "60") or 60)
    )
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            origin.strip()
            for origin in _env(
                "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
            if origin.strip()
        )
    )

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.secret_key)

    def __post_init__(self) -> None:  # pragma: no cover - trivial side effect
        self.token_path.parent.mkdir(parents=True, exist_ok=True)


settings = Settings()
