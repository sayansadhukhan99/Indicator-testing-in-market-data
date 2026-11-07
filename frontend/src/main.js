import './styles.css';
import { SMCEngine } from './smc/engine.js';
import { SMCPrimitive } from './primitives/smc.js';
import { createSMCChart, visibleBarsForResolution } from './chart.js';
import {
  fetchAuthUrl,
  fetchConfig,
  fetchHistory,
  fetchLatest,
  rangeForDays,
} from './api.js';
import {
  applyDefaults,
  bindControls,
  readSettings,
  setMeta,
  setStatus,
  showAuthButton,
} from './ui/controls.js';

const DAILY_RESOLUTIONS = new Set(['D', 'W', 'M', '1D', '1W', '1M']);
const POLL_MS = 5000;
const IST_OFFSET_SECONDS = 19800;

const RESOLUTION_LABELS = {
  1: '1m',
  2: '2m',
  3: '3m',
  5: '5m',
  10: '10m',
  15: '15m',
  20: '20m',
  30: '30m',
  60: '60m',
  120: '2h',
  240: '4h',
  D: '1D',
  W: '1W',
  M: '1M',
};

const clockFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const IST_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const { chart, series } = createSMCChart(document.getElementById('chart'));
const primitive = new SMCPrimitive();
series.attachPrimitive(primitive);

const state = {
  config: null,
  settings: null,
  bars: [],
  signature: '',
  pollTimer: null,
  loadedOnce: false,
  authenticated: false,
  demo: false,
};

const DEMO_MODE = new URLSearchParams(window.location.search).get('demo') === '1';

init();

async function init() {
  bindControls({
    onReload: () => loadData({ resetView: true }),
    onToggle: () => rerun(),
    onAuth: authenticate,
  });

  if (DEMO_MODE) {
    state.demo = true;
    loadDemo();
    return;
  }

  setStatus('Connecting to backend…', 'loading');

  try {
    const config = await fetchConfig();
    state.config = config;
    applyDefaults(config);

    if (!config.auth?.configured) {
      showAuthButton(true);
      setStatus(
        'Backend is running, but Fyers credentials are missing. Edit backend/.env.',
        'error',
      );
      state.settings = readSettings();
      startPolling();
      return;
    }

    if (!config.auth?.has_token) {
      showAuthButton(true);
      setStatus('Fyers login required. Click "Authenticate Fyers".', 'error');
      state.settings = readSettings();
      startPolling();
      return;
    }

    await loadData({ resetView: true });
    startPolling();
  } catch (error) {
    setStatus(
      `Backend not reachable (${error.message}). Start FastAPI on port 8000.`,
      'error',
    );
  }
}

async function loadData({ resetView = false } = {}) {
  if (state.demo) {
    loadDemo({ resetView });
    return;
  }

  const settings = readSettings();
  if (!settings.symbol) {
    setStatus('Enter a symbol such as NSE:NIFTY50-INDEX', 'error');
    return;
  }

  state.settings = settings;
  const { from, to } = rangeForDays(settings.rangeDays);

  setStatus(
    `Loading ${settings.symbol} ${RESOLUTION_LABELS[settings.resolution] || settings.resolution}…`,
    'loading',
  );

  try {
    const data = await fetchHistory({
      symbol: settings.symbol,
      resolution: settings.resolution,
      from,
      to,
    });
    const bars = normalizeBars(data.candles, settings.resolution);

    if (bars.length === 0) {
      setStatus('No candles returned for this symbol/range.', 'error');
      return;
    }

    state.bars = bars;
    state.signature = signatureOf(bars);
    series.setData(chartData(bars));
    rerun();

    if (resetView || !state.loadedOnce) {
      focusRecent(bars.length, settings.resolution);
    }

    state.loadedOnce = true;
    state.authenticated = true;
    showAuthButton(false);
    updateMeta();
    setStatus(`Loaded ${bars.length.toLocaleString('en-IN')} candles`, 'ok');
  } catch (error) {
    handleError(error);
  }
}

function loadDemo({ resetView = true } = {}) {
  state.settings = readSettings();
  const bars = makeDemoBars(1400);
  state.bars = bars;
  state.signature = signatureOf(bars);
  series.setData(chartData(bars));
  rerun();
  if (resetView || !state.loadedOnce) {
    focusRecent(bars.length, state.settings.resolution);
  }
  state.loadedOnce = true;
  updateMeta();
  setStatus('Demo data — remove ?demo=1 and start the backend for live Fyers data', 'ok');
}

function makeDemoBars(count) {
  const bars = [];
  let seed = 0x5eed1234;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const interval = 300;
  const end = Math.floor(Date.now() / 1000 / interval) * interval;
  const start = end - count * interval;
  let price = 24_500;

  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 85) * 26 + Math.sin(i / 23) * 7 + Math.sin(i / 9) * 2;
    const drift = wave * 0.06 + (random() - 0.5) * 14 + 0.02;
    const open = price;
    const close = open + drift;
    const high = Math.max(open, close) + random() * 8;
    const low = Math.min(open, close) - random() * 8;
    price = close;
    bars.push({
      time: start + i * interval,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: Math.round(800 + random() * 5000),
    });
  }

  return bars;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function rerun() {
  const current = readSettings();
  state.settings = state.settings
    ? { ...state.settings, config: current.config, autoRefresh: current.autoRefresh }
    : current;

  const engine = new SMCEngine(state.settings.config);
  primitive.setDrawables(engine.run(state.bars));
  updateMeta();
}

function normalizeBars(candles, resolution) {
  const daily = DAILY_RESOLUTIONS.has(resolution);
  const map = new Map();

  for (const candle of candles || []) {
    const time = daily ? istBusinessDay(candle.time) : Number(candle.time);
    map.set(time, {
      time,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume || 0),
    });
  }

  return [...map.values()].sort((a, b) => timeKey(a.time) - timeKey(b.time));
}

function mergeBars(existing, incoming) {
  const map = new Map();
  for (const bar of existing) map.set(bar.time, bar);
  for (const bar of incoming) map.set(bar.time, bar);
  return [...map.values()].sort((a, b) => timeKey(a.time) - timeKey(b.time));
}

function chartData(bars) {
  return bars.map((bar) => ({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));
}

function istBusinessDay(epochSeconds) {
  return new Date((Number(epochSeconds) + IST_OFFSET_SECONDS) * 1000)
    .toISOString()
    .slice(0, 10);
}

function timeKey(time) {
  if (typeof time === 'number') {
    return time;
  }
  const [year, month, day] = String(time).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 1000;
}

function signatureOf(bars) {
  if (!bars.length) return 'empty';
  const last = bars[bars.length - 1];
  return `${bars.length}|${last.time}|${last.open}|${last.high}|${last.low}|${last.close}`;
}

function focusRecent(count, resolution) {
  const visible = visibleBarsForResolution(resolution);
  chart.timeScale().setVisibleLogicalRange({
    from: Math.max(0, count - visible),
    to: count + 8,
  });
}

function startPolling() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
  }

  const tick = async () => {
    try {
      await poll();
    } finally {
      state.pollTimer = setTimeout(tick, POLL_MS);
    }
  };

  state.pollTimer = setTimeout(tick, POLL_MS);
}

async function poll() {
  const settings = state.settings;
  if (!settings || !state.authenticated || !settings.autoRefresh || document.hidden) {
    return;
  }
  if (!isMarketOpen()) {
    return;
  }

  try {
    const data = await fetchLatest({
      symbol: settings.symbol,
      resolution: settings.resolution,
      lookbackDays: 3,
    });
    const incoming = normalizeBars(data.candles, settings.resolution);
    if (incoming.length === 0) {
      return;
    }

    const merged = mergeBars(state.bars, incoming);
    const nextSignature = signatureOf(merged);
    if (nextSignature === state.signature) {
      return;
    }

    state.bars = merged;
    state.signature = nextSignature;
    series.setData(chartData(merged));
    rerun();
    updateMeta();
    setStatus(`Live · updated ${clockFormatter.format(new Date())} IST`, 'ok');
  } catch (error) {
    if (error.status === 401) {
      handleError(error);
    }
  }
}

function isMarketOpen(now = new Date()) {
  const parts = Object.fromEntries(
    IST_PARTS.formatToParts(now).map((part) => [part.type, part.value]),
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') {
    return false;
  }
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

function updateMeta() {
  if (!state.bars.length || !state.settings) {
    setMeta('');
    return;
  }
  const last = state.bars[state.bars.length - 1];
  const label = formatBarTime(last.time);
  const price = last.close.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const resolution = state.settings.resolution;
  setMeta(
    `${state.bars.length.toLocaleString('en-IN')} bars · ${
      RESOLUTION_LABELS[resolution] || resolution
    } · LTP ${price} · ${label}`,
  );
}

function formatBarTime(time) {
  if (typeof time === 'number') {
    return `${dateTimeFormatter.format(new Date(time * 1000))} IST`;
  }
  return String(time);
}

function handleError(error) {
  if (error.status === 401) {
    state.authenticated = false;
    showAuthButton(true);
    setStatus('Fyers login required or expired. Click "Authenticate Fyers".', 'error');
    return;
  }
  if (error.status === 500) {
    showAuthButton(true);
  }
  setStatus(error.message || 'Request failed', 'error');
}

async function authenticate() {
  try {
    const { url } = await fetchAuthUrl();
    window.open(url, 'fyers-auth', 'width=560,height=760');
  } catch (error) {
    setStatus(
      error.status === 500
        ? 'Set FYERS_CLIENT_ID, FYERS_SECRET_KEY and FYERS_REDIRECT_URI in backend/.env first.'
        : error.message,
      'error',
    );
  }
}

window.addEventListener('message', (event) => {
  if (event.data === 'fyers-auth-ok') {
    showAuthButton(false);
    loadData({ resetView: true });
  }
});
