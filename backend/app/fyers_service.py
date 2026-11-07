from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Iterable

import requests

from .config import Settings
from .tokens import TokenStore

try:  # pragma: no cover - import guard for friendlier errors
    from fyers_apiv3 import fyersModel
    from fyers_apiv3.fyersModel import Config as FyersConfig
except Exception:  # noqa: BLE001
    fyersModel = None
    FyersConfig = None


class FyersError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def _require_sdk() -> None:
    if fyersModel is None:
        raise FyersError(
            "fyers-apiv3 is not installed. Run: pip install -r requirements.txt",
            status_code=500,
        )


@dataclass(frozen=True)
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    def as_dict(self) -> dict[str, float | int]:
        return {
            "time": self.time,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
        }


class FyersService:
    """Thin wrapper around the official Fyers SDK.

    Handles the daily auth flow, token persistence, request chunking and
    normalisation of historical candles into a JSON friendly shape.
    """

    INTRADAY_MAX_DAYS = 100
    DAILY_MAX_DAYS = 366
    DAILY_RESOLUTIONS = {"D", "1D", "W", "1W", "M", "1M"}

    def __init__(self, settings: Settings, token_store: TokenStore) -> None:
        self.settings = settings
        self.tokens = token_store
        self._client: Any | None = None
        self._client_token: str | None = None

    # ------------------------------------------------------------------ auth
    def auth_url(self, state: str = "nifty-smc") -> str:
        _require_sdk()
        if not self.settings.configured:
            raise FyersError("Fyers credentials are not configured in backend/.env", status_code=500)
        session = fyersModel.SessionModel(
            client_id=self.settings.client_id,
            secret_key=self.settings.secret_key,
            redirect_uri=self.settings.redirect_uri,
            response_type="code",
            state=state,
            grant_type="authorization_code",
        )
        return session.generate_authcode()

    def exchange_code(self, auth_code: str) -> dict[str, Any]:
        _require_sdk()
        if not self.settings.configured:
            raise FyersError("Fyers credentials are not configured in backend/.env", status_code=500)
        session = fyersModel.SessionModel(
            client_id=self.settings.client_id,
            secret_key=self.settings.secret_key,
            redirect_uri=self.settings.redirect_uri,
            response_type="code",
            grant_type="authorization_code",
        )
        session.set_token(auth_code)
        response = session.generate_token()
        return self._persist_token_response(response)

    def refresh(self) -> dict[str, Any]:
        _require_sdk()
        refresh_token = self.tokens.refresh_token()
        if not refresh_token:
            raise FyersError(
                "No refresh token stored. Authenticate once via /api/auth/url.",
                status_code=400,
            )
        if not self.settings.pin:
            raise FyersError(
                "FYERS_PIN is required for the refresh-token flow. Add it to "
                "backend/.env or authenticate again with the auth-code flow.",
                status_code=400,
            )

        app_id_hash = hashlib.sha256(
            f"{self.settings.client_id}:{self.settings.secret_key}".encode()
        ).hexdigest()
        payload = {
            "grant_type": "refresh_token",
            "appIdHash": app_id_hash,
            "refresh_token": refresh_token,
            "pin": self.settings.pin,
        }

        try:
            response = requests.post(
                f"{FyersConfig.API}/validate-refresh-token",
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=20,
            )
            data = response.json()
        except Exception as exc:  # noqa: BLE001
            raise FyersError(f"Fyers refresh request failed: {exc}") from exc

        if not isinstance(data, dict) or "access_token" not in data:
            message = data.get("message") if isinstance(data, dict) else str(data)
            raise FyersError(f"Fyers refresh failed: {message}", status_code=401)

        return self._persist_token_response(data)

    def _persist_token_response(self, response: Any) -> dict[str, Any]:
        if not isinstance(response, dict) or "access_token" not in response:
            message = response.get("message") if isinstance(response, dict) else str(response)
            raise FyersError(f"Fyers token exchange failed: {message}", status_code=401)
        payload = {
            "access_token": response["access_token"],
            "refresh_token": response.get("refresh_token") or self.tokens.refresh_token(),
            "token_type": response.get("token_type"),
            "expires_in": response.get("expires_in"),
        }
        self.tokens.save(payload)
        self._client = None
        self._client_token = None
        return {
            "ok": True,
            "token_saved": True,
            "has_refresh_token": bool(payload.get("refresh_token")),
            "expires_in": payload.get("expires_in"),
        }

    def auth_status(self) -> dict[str, Any]:
        data = self.tokens.load()
        return {
            "configured": self.settings.configured,
            "has_token": bool(data.get("access_token")),
            "has_refresh_token": bool(data.get("refresh_token")),
            "updated_at": data.get("updated_at"),
        }

    # --------------------------------------------------------------- client
    def _get_client(self) -> Any:
        _require_sdk()
        token = self.tokens.access_token()
        if not token:
            raise FyersError(
                "No Fyers access token. Authenticate via /api/auth/url first.",
                status_code=401,
            )
        if self._client is None or self._client_token != token:
            self._client = fyersModel.FyersModel(
                client_id=self.settings.client_id,
                token=token,
                is_async=False,
                log_path="",
            )
            self._client_token = token
        return self._client

    # -------------------------------------------------------------- history
    def history(
        self,
        symbol: str,
        resolution: str,
        range_from: date,
        range_to: date,
    ) -> list[dict[str, float | int]]:
        if range_from > range_to:
            raise FyersError("range_from must be before range_to", status_code=400)

        client = self._get_client()
        chunk_days = (
            self.DAILY_MAX_DAYS
            if resolution.upper() in self.DAILY_RESOLUTIONS
            else self.INTRADAY_MAX_DAYS
        )

        merged: dict[int, dict[str, float | int]] = {}
        for start, end in self._chunk_ranges(range_from, range_to, chunk_days):
            payload: dict[str, Any] = {
                "symbol": symbol,
                "resolution": resolution,
                "date_format": "1",
                "range_from": start.isoformat(),
                "range_to": end.isoformat(),
            }
            if "FUT" in symbol.upper():
                payload["cont_flag"] = "1"

            response = client.history(payload)
            if not isinstance(response, dict) or response.get("s") == "error":
                message = response.get("message") if isinstance(response, dict) else str(response)
                code = response.get("code") if isinstance(response, dict) else None
                raise FyersError(f"Fyers history error ({code}): {message}", status_code=502)

            for raw in response.get("candles") or []:
                candle = self._parse_candle(raw)
                if candle is not None:
                    merged[candle.time] = candle.as_dict()

            # Stay within the standard plan's 5 requests/second limit.
            time.sleep(0.25)

        return [merged[key] for key in sorted(merged)]

    @staticmethod
    def _parse_candle(raw: Iterable[Any]) -> Candle | None:
        values = list(raw)
        if len(values) < 6:
            return None
        try:
            timestamp = int(values[0])
            if timestamp > 10_000_000_000:  # milliseconds -> seconds
                timestamp //= 1000
            return Candle(
                time=timestamp,
                open=float(values[1]),
                high=float(values[2]),
                low=float(values[3]),
                close=float(values[4]),
                volume=float(values[5] or 0),
            )
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _chunk_ranges(start: date, end: date, max_days: int):
        cursor = start
        step = timedelta(days=max_days - 1)
        while cursor <= end:
            chunk_end = min(cursor + step, end)
            yield cursor, chunk_end
            cursor = chunk_end + timedelta(days=1)

    @staticmethod
    def parse_date(value: str) -> date:
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError as exc:
            raise FyersError(f"Invalid date '{value}', expected YYYY-MM-DD", status_code=400) from exc
