"""One-off helper to authenticate with Fyers without the browser callback.

Usage (from the backend directory):
    python -m scripts.login

Open the printed URL, log in, then paste either the `auth_code` query value or
the full redirect URL back into the prompt.
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.fyers_service import FyersService  # noqa: E402
from app.tokens import TokenStore  # noqa: E402


def main() -> None:
    service = FyersService(settings, TokenStore(settings.token_path))
    print("Open this URL and complete the Fyers login:\n")
    print(service.auth_url())
    print()
    raw = input("Paste auth_code or the full redirect URL: ").strip()
    if not raw:
        raise SystemExit("No auth code supplied")

    auth_code = raw
    if raw.startswith("http"):
        query = parse_qs(urlparse(raw).query)
        auth_code = (query.get("auth_code") or [""])[0]

    if not auth_code:
        raise SystemExit("Could not find auth_code in the supplied value")

    result = service.exchange_code(auth_code)
    print("\nSuccess:", result)


if __name__ == "__main__":
    main()
