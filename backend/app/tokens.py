from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any


class TokenStore:
    """Small JSON-backed token store for the daily Fyers access token."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()

    def load(self) -> dict[str, Any]:
        with self._lock:
            if not self._path.exists():
                return {}
            try:
                return json.loads(self._path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return {}

    def save(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = self.load()
        data.update(payload)
        data["updated_at"] = int(time.time())
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return data

    def access_token(self) -> str | None:
        return self.load().get("access_token")

    def refresh_token(self) -> str | None:
        return self.load().get("refresh_token")
