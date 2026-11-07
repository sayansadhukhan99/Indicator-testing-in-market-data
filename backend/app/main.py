from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .cache import TTLCache
from .config import BASE_DIR, settings
from .fyers_service import FyersError, FyersService
from .tokens import TokenStore

token_store = TokenStore(settings.token_path)
fyers = FyersService(settings, token_store)
history_cache = TTLCache(settings.cache_ttl_seconds)
latest_cache = TTLCache(3)

RESOLUTIONS = ["1", "2", "3", "5", "10", "15", "20", "30", "60", "120", "240", "D", "W", "M"]

app = FastAPI(title="Nifty SMC API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins) or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(FyersError)
def fyers_error_handler(_request, exc: FyersError):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


def _validate(symbol: str, resolution: str) -> None:
    if not symbol or ":" not in symbol:
        raise HTTPException(status_code=400, detail="symbol must look like NSE:SYMBOL")
    if resolution not in RESOLUTIONS:
        raise HTTPException(status_code=400, detail=f"resolution must be one of {RESOLUTIONS}")


@app.get("/api/health")
def health():
    return {"ok": True, "auth": fyers.auth_status()}


@app.get("/api/config")
def config():
    return {
        "defaultSymbol": settings.default_symbol,
        "defaultResolution": settings.default_resolution,
        "defaultRangeDays": settings.default_range_days,
        "resolutions": RESOLUTIONS,
        "auth": fyers.auth_status(),
    }


@app.get("/api/auth/url")
def auth_url():
    return {"url": fyers.auth_url(), "redirect_uri": settings.redirect_uri}


@app.get("/api/auth/status")
def auth_status():
    return fyers.auth_status()


@app.get("/api/auth/callback", response_class=HTMLResponse)
def auth_callback(
    auth_code: str | None = Query(default=None),
    s: str | None = Query(default=None),
):
    if not auth_code:
        return HTMLResponse(
            "<h3>Missing auth_code</h3><p>Start again from <code>/api/auth/url</code>.</p>",
            status_code=400,
        )
    try:
        result = fyers.exchange_code(auth_code)
    except FyersError as exc:
        return HTMLResponse(f"<h3>Authentication failed</h3><p>{exc}</p>", status_code=400)
    return HTMLResponse(
        "<h3>Fyers authentication complete</h3>"
        f"<p>{result}</p>"
        "<script>if(window.opener){window.opener.postMessage('fyers-auth-ok','*')}"
        "setTimeout(()=>window.close(),1200)</script>",
    )


@app.post("/api/auth/refresh")
def auth_refresh():
    return fyers.refresh()


@app.get("/api/history")
def history(
    symbol: str = Query(default=settings.default_symbol),
    resolution: str = Query(default=settings.default_resolution),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    days: int | None = Query(default=None, ge=1, le=1000),
):
    _validate(symbol, resolution)
    end = FyersService.parse_date(date_to) if date_to else date.today()
    if date_from:
        start = FyersService.parse_date(date_from)
    else:
        start = end - timedelta(days=(days or settings.default_range_days) - 1)

    key = f"{symbol}|{resolution}|{start}|{end}"
    cached = history_cache.get(key)
    if cached is not None:
        return {"symbol": symbol, "resolution": resolution, "candles": cached, "cached": True}

    candles = fyers.history(symbol, resolution, start, end)
    history_cache.set(key, candles)
    return {"symbol": symbol, "resolution": resolution, "candles": candles, "cached": False}


@app.get("/api/history/latest")
def latest(
    symbol: str = Query(default=settings.default_symbol),
    resolution: str = Query(default=settings.default_resolution),
    lookbackDays: int = Query(default=3, ge=1, le=30),
):
    _validate(symbol, resolution)
    end = date.today()
    start = end - timedelta(days=lookbackDays)
    key = f"latest|{symbol}|{resolution}|{start}|{end}"
    cached = latest_cache.get(key)
    if cached is not None:
        return {"symbol": symbol, "resolution": resolution, "candles": cached, "cached": True}

    candles = fyers.history(symbol, resolution, start, end)
    latest_cache.set(key, candles)
    return {"symbol": symbol, "resolution": resolution, "candles": candles, "cached": False}


dist_dir = BASE_DIR.parent / "frontend" / "dist"
if dist_dir.exists():
    app.mount("/", StaticFiles(directory=Path(dist_dir), html=True), name="frontend")


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
