# Nifty Smart Money Concepts

A local dashboard that pulls Nifty 50 OHLC data from **Fyers** and renders a
faithful JavaScript port of the LuxAlgo **Smart Money Concepts** Pine script on
**TradingView Lightweight Charts**.

![SMC features](https://img.shields.io/badge/features-structure%20%C2%B7%20order%20blocks%20%C2%B7%20EQH%2FEQL%20%C2%B7%20weak%20high%2Flow-3179f5)

## What it does

- Fetches historical candles for `NSE:NIFTY50-INDEX` (or any Fyers symbol) in
  1m–1D resolutions.
- Ports the core LuxAlgo logic bar-by-bar:
  - Real-time **swing** and **internal** structure (`Breaker` = BOS, `Trap` = CHoCH).
  - Internal / swing **order blocks** with volatility filtering and mitigation.
  - **Equal highs / equal lows** (EQH/EQL) with an ATR threshold.
  - **Weak / strong highs & lows** (`Weak High`, `Institutional Buying`, …).
  - Optional swing point labels (`HH`, `HL`, `LH`, `LL`).
- Renders boxes, dashed structure levels and labels with a custom Lightweight
  Charts series primitive (the library has no native box annotation API).
- Live-polls during NSE market hours and re-runs the engine on the latest bars.

## Architecture

```
Fyers API ──► FastAPI (auth + chunked history) ──► REST JSON ──► Vite frontend
                                                                     │
                                                    SMC engine (Pine port)
                                                                     │
                                              Lightweight Charts v5 + canvas primitive
```

Secrets and the Fyers access token stay in the Python backend. The browser only
receives candles.

## Prerequisites

- Python 3.10+
- Node.js 20+
- A Fyers account / app with **Market Data** permission.
- The `NSE:NIFTY50-INDEX` symbol is used by default (no volume on index data).
  For futures use e.g. `NSE:NIFTY25NOVFUT`.

## 1. Backend setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env`:

```dotenv
FYERS_CLIENT_ID=YOUR_APP_ID-100
FYERS_SECRET_KEY=YOUR_SECRET_KEY
# Optional, only for POST /api/auth/refresh
FYERS_PIN=
FYERS_REDIRECT_URI=http://127.0.0.1:8000/api/auth/callback
FYERS_SYMBOL=NSE:NIFTY50-INDEX
FYERS_RESOLUTION=5
FYERS_RANGE_DAYS=30
```

Make sure the redirect URI is registered in your Fyers app dashboard.

Start the API:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

## 2. Authenticate Fyers

Fyers access tokens expire daily (around 6 AM IST). Pick one:

**A. From the app** — start the frontend, then click **Authenticate Fyers**.
The auth URL opens in a popup, and the callback stores the token in
`backend/.tokens/fyers.json`.

**B. From the terminal**

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m scripts.login
```

Open the printed URL, complete the login and paste the `auth_code` (or the whole
redirect URL) back into the prompt.

A `refresh_token` is stored when Fyers returns one. `POST /api/auth/refresh`
uses Fyers' `validate-refresh-token` endpoint (valid ~15 days) and requires
`FYERS_PIN` in `.env`. Fyers has signalled that this flow may be discontinued,
so daily re-authentication is the reliable path.

Check status:

```powershell
curl http://127.0.0.1:8000/api/health
```

## 3. Frontend setup

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the FastAPI server on
port 8000.

For a single-server setup, run `npm run build` and restart the backend; it serves
`frontend/dist` at `http://127.0.0.1:8000`.

## Controls

| Control | Meaning |
|---|---|
| Mode | **Live** (range days + polling) or **Date** (exact from/to range) |
| Symbol | Fyers symbol, e.g. `NSE:NIFTY50-INDEX`, `NSE:NIFTY25NOVFUT` |
| TF | Candle resolution: 1m, 3m, 5m, 15m, 30m, 60m, 1D |
| Range | Calendar days to request in Live mode (Fyers limits: 100 days/request intraday, 366 daily) |
| From / To | Date-mode range; **Load range** fetches exactly these dates |
| Internal | Internal (5-bar) structure labels |
| Swing | Swing (50-bar, configurable) structure labels |
| Weak H/L | Latest strong/weak high and low with trend-aware labels |
| EQH/EQL | Equal highs/lows detection |
| HH/LL | Swing point labels |
| Internal OB | Show internal order blocks |
| IOB # | Number of latest internal order blocks visible |
| Swing OB | Show swing order blocks |
| Live | Poll Fyers every 5s during 09:15–15:30 IST (Live mode only) |

Toggling a checkbox re-runs the engine on the already loaded candles; **Load**
refetches from Fyers.

### Date mode

Set **Mode** to **Date**, pick **From** and **To**, and click **Load range**.

- The chart is rebuilt from only the selected dates; no live polling runs.
- The backend still fetches a hidden warmup window before **From** so ATR(200),
  swing pivots and order-block state are correct at the start of the range.
  Warmup candles and their labels are clipped out of the chart.
- The **indicator readout** sidebar shows the swing/internal trend, structure
  counts (Breaker/Trap), active order blocks, EQH/EQL and swing points, key
  levels, and the latest signals detected inside the range.
- Works in demo mode too: `http://localhost:5173/?demo=1`, then switch to Date.

### Demo mode

Open `http://localhost:5173/?demo=1` to render 1,400 synthetic 5-minute candles
without the backend or a Fyers account. This is handy for checking the
structure/order-block rendering before credentials are configured.

## Pine → JavaScript port

The engine is a deliberate line-by-line port, not a reimplementation:

| Pine | This project |
|---|---|
| `var` / UDT state | `SMCEngine` class fields |
| `high[size]`, `ta.highest` | `bars[i-size]`, `highestHigh` |
| `ta.atr(200)` | Wilder RMA seeded with SMA (`indicators.js`) |
| `ta.cum(ta.tr)/bar_index` | `cumulativeMeanRange` |
| `leg` / `getCurrentStructure` | separate trackers for swing / internal / equal |
| `request.security` | not needed for the core scope (FVG/MTF later) |
| `label` / `line` / `box` | drawable descriptors rendered by `SMCPrimitive` |
| `alertcondition` | alert events recorded in `engine.alerts` |

Order blocks take the max parsed high / min parsed low between the pivot and the
break bar, are stored newest-first (max 100), and are removed when price trades
through them using the Pine `High/Low` or `Close` mitigation source.

### Intentional / known differences

- Pine `na` propagation is modelled with `null`; comparisons that involve an
  unset pivot are treated as false.
- Removing order blocks while iterating is done from the end of the array
  (Pine's forward removal can skip entries).
- Lightweight Charts draws to the right edge of the pane, so boxes are extended
  visually instead of storing a pixel coordinate.
- The last (unclosed) candle is re-evaluated on every poll, so an intrabar
  signal can flip before the candle closes. This matches Pine's realtime bar
  behaviour but not its historical repainting model.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Service + auth status |
| `GET /api/config` | Defaults and resolutions |
| `GET /api/auth/url` | Fyers login URL |
| `GET /api/auth/callback?auth_code=...` | Exchange code, store token |
| `POST /api/auth/refresh` | Refresh access token |
| `GET /api/history?symbol=&resolution=&from=&to=` | Chunked historical candles |
| `GET /api/history/latest?symbol=&resolution=&lookbackDays=3` | Recent candles for polling |

Candles are returned as:

```json
{ "time": 1700000000, "open": 0, "high": 0, "low": 0, "close": 0, "volume": 0 }
```

Time is epoch **seconds** for intraday. Daily/weekly/monthly bars are converted
to IST business-day strings in the frontend so Lightweight Charts labels them on
the correct date.

## Rate limits

The backend sleeps 250 ms between chunk requests and uses a TTL cache. The
frontend polls at most once every 5 seconds, and only while the NSE is open and
the tab is visible, which keeps a 6.25-hour session around 4,500 requests — below
the Standard plan's 5,000/day.

## Tests / build

```powershell
cd frontend
npm test
npm run build
```

The test suite covers the indicators (ATR/RMA, highest/lowest, cumulative range),
the core engine (pivots, Breaker + order block creation, mitigation, drawables),
and date-mode helpers (IST range slicing, drawable clipping, analysis counts).

## Roadmap

The Pine script also contains Fair Value Gaps, MTF daily/weekly/monthly levels,
premium/discount zones and color candles. The engine/config already has flags for
them; they are the next features to port.

## License / attribution

The original Pine script is © LuxAlgo and licensed under
**CC BY-NC-SA 4.0**. This port is a derivative work: keep the attribution, do not
use it commercially, and share modifications under the same license.
