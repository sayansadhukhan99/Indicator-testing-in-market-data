import './styles.css';
import { SMCEngine } from './smc/engine.js';
import { BEARISH, BULLISH } from './smc/config.js';
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
  barDateKey,
  buildAnalysis,
  clipDrawables,
  istBusinessDay,
  rangeIndices,
  shiftIsoDate,
  timeKey,
  warmupDaysFor,
} from './range.js';
import {
  applyDefaults,
  applyMode,
  bindControls,
  readSettings,
  setMeta,
  setReplayState,
  setStatus,
  showAuthButton,
  showReplayBar,
} from './ui/controls.js';

const DAILY_RESOLUTIONS = new Set(['D', 'W', 'M', '1D', '1W', '1M']);
const POLL_MS = 5000;

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
  mode: 'live',
  bars: [],
  displayBars: [],
  range: null,
  signature: '',
  pollTimer: null,
  loadedOnce: false,
  authenticated: false,
  demo: false,
  replay: {
    active: false,
    index: 0,
    start: 0,
    end: 0,
    playing: false,
    timer: null,
    speed: 2,
    follow: true,
  },
};

const DEMO_MODE = new URLSearchParams(window.location.search).get('demo') === '1';

init();

async function init() {
  bindControls({
    onReload: () => loadData({ resetView: true }),
    onToggle: () => rerun(),
    onAuth: authenticate,
    onModeChange: () => {
      pauseReplay();
      clearReplay();
      loadData({ resetView: true });
    },
    onReplayPlay: toggleReplay,
    onReplayBack: () => replayStep(-1),
    onReplayForward: () => replayStep(1),
    onReplayReset: replayReset,
    onReplayEnd: replayEnd,
    onReplaySeek: replaySeek,
    onReplaySpeed: (speed) => {
      state.replay.speed = speed;
      if (state.replay.playing) scheduleReplayTick();
    },
    onReplayFollow: (follow) => {
      state.replay.follow = follow;
      if (follow && state.replay.active) {
        focusReplay(state.displayBars.length, state.settings.resolution);
      }
    },
  });
  bindReplayKeyboard();
  applyDefaults({});
  applyMode(readSettings().mode);

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

  const rangeMode = settings.mode === 'date' || settings.mode === 'replay';
  if (rangeMode) {
    if (!settings.dateFrom || !settings.dateTo) {
      setStatus('Choose both a From and To date for this mode.', 'error');
      return;
    }
    if (settings.dateFrom > settings.dateTo) {
      setStatus('From date must be on or before the To date.', 'error');
      return;
    }
  }

  state.settings = settings;
  state.mode = settings.mode;

  const { from, to } = rangeMode
    ? { from: settings.dateFrom, to: settings.dateTo }
    : rangeForDays(settings.rangeDays);
  const fetchFrom = rangeMode
    ? shiftIsoDate(from, -warmupDaysFor(settings.resolution))
    : from;
  const label = RESOLUTION_LABELS[settings.resolution] || settings.resolution;

  setStatus(
    rangeMode
      ? `Loading ${settings.symbol} ${label} · ${from} → ${to}…`
      : `Loading ${settings.symbol} ${label}…`,
    'loading',
  );

  try {
    const data = await fetchHistory({
      symbol: settings.symbol,
      resolution: settings.resolution,
      from: fetchFrom,
      to,
    });
    const bars = normalizeBars(data.candles, settings.resolution);
    state.bars = bars;

    if (rangeMode) {
      const bounds = rangeIndices(bars, from, to);
      if (!bounds) {
        setStatus(`No candles returned for ${from} → ${to}.`, 'error');
        return;
      }
      state.range = {
        from,
        to,
        fromTime: bounds.fromTime,
        toTime: bounds.toTime,
      };

      if (settings.mode === 'replay') {
        setupReplay(bounds);
      } else {
        clearReplay();
        state.displayBars = bars.slice(bounds.startIndex, bounds.endIndex + 1);
        state.signature = signatureOf(state.displayBars);
        series.setData(chartData(state.displayBars));
        rerun();
        if (resetView || !state.loadedOnce) {
          chart.timeScale().fitContent();
        }
      }
    } else {
      clearReplay();
      state.displayBars = bars;
      state.range = null;
      state.signature = signatureOf(bars);
      series.setData(chartData(bars));
      rerun();
      if (resetView || !state.loadedOnce) {
        focusRecent(bars.length, settings.resolution);
      }
    }

    state.loadedOnce = true;
    state.authenticated = true;
    showAuthButton(false);
    updateMeta();

    if (settings.mode === 'replay') {
      const total = state.replay.end - state.replay.start + 1;
      setStatus(
        `Replay ready · ${total.toLocaleString('en-IN')} candles · ${from} → ${to}`,
        'ok',
      );
    } else if (rangeMode) {
      setStatus(
        `Date mode · ${state.displayBars.length.toLocaleString('en-IN')} candles · ${from} → ${to}`,
        'ok',
      );
    } else {
      setStatus(`Loaded ${bars.length.toLocaleString('en-IN')} candles`, 'ok');
    }
  } catch (error) {
    handleError(error);
  }
}

function loadDemo({ resetView = true } = {}) {
  const settings = readSettings();
  const rangeMode = settings.mode === 'date' || settings.mode === 'replay';
  if (rangeMode) {
    if (!settings.dateFrom || !settings.dateTo) {
      setStatus('Choose both a From and To date for this mode.', 'error');
      return;
    }
    if (settings.dateFrom > settings.dateTo) {
      setStatus('From date must be on or before the To date.', 'error');
      return;
    }
  }

  state.settings = settings;
  state.mode = settings.mode;

  const bars = makeDemoBars(3000);
  state.bars = bars;

  if (rangeMode) {
    const bounds = rangeIndices(bars, settings.dateFrom, settings.dateTo);
    if (!bounds) {
      setStatus(
        `No demo candles for ${settings.dateFrom} → ${settings.dateTo}.`,
        'error',
      );
      return;
    }
    state.range = {
      from: settings.dateFrom,
      to: settings.dateTo,
      fromTime: bounds.fromTime,
      toTime: bounds.toTime,
    };

    if (settings.mode === 'replay') {
      setupReplay(bounds);
    } else {
      clearReplay();
      state.displayBars = bars.slice(bounds.startIndex, bounds.endIndex + 1);
      state.signature = signatureOf(state.displayBars);
      series.setData(chartData(state.displayBars));
      rerun();
      if (resetView || !state.loadedOnce) {
        chart.timeScale().fitContent();
      }
    }
  } else {
    clearReplay();
    state.displayBars = bars;
    state.range = null;
    state.signature = signatureOf(bars);
    series.setData(chartData(bars));
    rerun();
    if (resetView || !state.loadedOnce) {
      focusRecent(bars.length, settings.resolution);
    }
  }

  state.loadedOnce = true;
  updateMeta();

  if (settings.mode === 'replay') {
    const total = state.replay.end - state.replay.start + 1;
    setStatus(
      `Replay ready (demo) · ${total.toLocaleString('en-IN')} candles · ${settings.dateFrom} → ${settings.dateTo}`,
      'ok',
    );
  } else if (rangeMode) {
    setStatus(
      `Date mode (demo) · ${state.displayBars.length.toLocaleString('en-IN')} candles · ${settings.dateFrom} → ${settings.dateTo}`,
      'ok',
    );
  } else {
    setStatus(
      'Demo data — remove ?demo=1 and start the backend for live Fyers data',
      'ok',
    );
  }
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
  const engineBars = state.replay.active
    ? state.bars.slice(0, state.replay.index + 1)
    : state.bars;
  const drawables = engine.run(engineBars);
  const visible = state.range
    ? clipDrawables(drawables, state.range.fromTime, currentRangeTo())
    : drawables;
  primitive.setDrawables(visible);
  updateAnalysis(engine);
  updateMeta();
}

function currentRangeTo() {
  if (state.replay.active) {
    return state.bars[state.replay.index].time;
  }
  return state.range?.toTime;
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

function focusReplay(count, resolution) {
  const visible = Math.min(count, 180);
  chart.timeScale().setVisibleLogicalRange({
    from: Math.max(0, count - visible),
    to: count + 8,
  });
}

function setupReplay(bounds) {
  const replay = state.replay;
  replay.active = true;
  replay.start = bounds.startIndex;
  replay.end = bounds.endIndex;
  replay.index = bounds.startIndex;
  replay.playing = false;
  replay.speed = state.settings?.replaySpeed ?? 2;
  replay.follow = state.settings?.replayFollow ?? true;
  showReplayBar(true);
  renderReplay({ resetView: true });
}

function clearReplay() {
  const replay = state.replay;
  if (replay.timer) {
    clearTimeout(replay.timer);
    replay.timer = null;
  }
  replay.active = false;
  replay.playing = false;
  replay.index = 0;
  replay.start = 0;
  replay.end = 0;
  showReplayBar(false);
}

function renderReplay({ resetView = false } = {}) {
  const replay = state.replay;
  if (!replay.active) {
    return;
  }

  replay.index = Math.min(replay.end, Math.max(replay.start, replay.index));
  state.displayBars = state.bars.slice(replay.start, replay.index + 1);
  state.signature = signatureOf(state.displayBars);
  series.setData(chartData(state.displayBars));
  rerun();

  if (resetView || replay.follow) {
    focusReplay(state.displayBars.length, state.settings.resolution);
  }

  renderReplayControls();
}

function renderReplayControls() {
  const replay = state.replay;
  if (!replay.active) {
    return;
  }
  const current = state.bars[replay.index];
  setReplayState({
    position: replay.index - replay.start,
    total: replay.end - replay.start,
    label: `${(replay.index - replay.start + 1).toLocaleString('en-IN')} / ${(replay.end - replay.start + 1).toLocaleString('en-IN')} · ${formatBarTime(current.time)}`,
    playing: replay.playing,
    canBack: replay.index > replay.start,
    canForward: replay.index < replay.end,
  });
}

function replayStep(delta) {
  const replay = state.replay;
  if (!replay.active) {
    return;
  }
  pauseReplay();
  const next = Math.min(replay.end, Math.max(replay.start, replay.index + delta));
  if (next === replay.index) {
    return;
  }
  replay.index = next;
  renderReplay();
}

function replaySeek(position) {
  const replay = state.replay;
  if (!replay.active) {
    return;
  }
  pauseReplay();
  replay.index = replay.start + Number(position);
  renderReplay();
}

function replayReset() {
  const replay = state.replay;
  if (!replay.active) {
    return;
  }
  pauseReplay();
  replay.index = replay.start;
  renderReplay({ resetView: true });
}

function replayEnd() {
  const replay = state.replay;
  if (!replay.active) {
    return;
  }
  pauseReplay();
  replay.index = replay.end;
  renderReplay({ resetView: true });
}

function toggleReplay() {
  if (state.replay.playing) {
    pauseReplay();
  } else {
    playReplay();
  }
}

function playReplay() {
  const replay = state.replay;
  if (!replay.active) {
    return;
  }
  if (replay.index >= replay.end) {
    replay.index = replay.start;
    renderReplay({ resetView: true });
  }
  replay.playing = true;
  scheduleReplayTick();
  renderReplayControls();
}

function pauseReplay() {
  const replay = state.replay;
  if (replay.timer) {
    clearTimeout(replay.timer);
    replay.timer = null;
  }
  if (replay.playing) {
    replay.playing = false;
    renderReplayControls();
  }
}

function scheduleReplayTick() {
  const replay = state.replay;
  if (replay.timer) {
    clearTimeout(replay.timer);
  }
  const delay = Math.max(50, Math.round(1000 / replay.speed));
  replay.timer = setTimeout(() => {
    replay.timer = null;
    if (!replay.playing) {
      return;
    }
    if (replay.index >= replay.end) {
      pauseReplay();
      return;
    }
    replay.index += 1;
    renderReplay();
    if (replay.index >= replay.end) {
      pauseReplay();
      return;
    }
    scheduleReplayTick();
  }, delay);
}

function bindReplayKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (!state.replay.active) {
      return;
    }
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') {
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      toggleReplay();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      replayStep(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      replayStep(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      replayReset();
    } else if (event.key === 'End') {
      event.preventDefault();
      replayEnd();
    }
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
  if (
    !settings ||
    settings.mode !== 'live' ||
    !state.authenticated ||
    !settings.autoRefresh ||
    document.hidden
  ) {
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
    state.displayBars = merged;
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
  const bars = state.displayBars.length ? state.displayBars : state.bars;
  if (!bars.length || !state.settings) {
    setMeta('');
    return;
  }
  const last = bars[bars.length - 1];
  const label = formatBarTime(last.time);
  const price = last.close.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const resolution = state.settings.resolution;
  let range = '';
  if (state.replay.active) {
    range = ` · ${state.range.from} → ${barDateKey(last.time)}`;
  } else if (state.range) {
    range = ` · ${state.range.from} → ${state.range.to}`;
  }
  setMeta(
    `${bars.length.toLocaleString('en-IN')} bars · ${
      RESOLUTION_LABELS[resolution] || resolution
    } · LTP ${price} · ${label}${range}`,
  );
}

function updateAnalysis(engine) {
  const panel = document.getElementById('analysis');
  const mode = state.settings?.mode;
  const rangeMode = mode === 'date' || mode === 'replay';
  if (!state.range || !rangeMode) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const replay = state.replay.active;
  const toTime = replay ? state.bars[state.replay.index].time : state.range.toTime;
  const analysis = buildAnalysis(
    engine,
    state.range.fromTime,
    toTime,
    state.displayBars.length,
  );

  setText('analysisTitle', replay ? 'Replay · indicator readout' : 'Date mode · indicator readout');
  setText(
    'analysisRange',
    replay
      ? `${state.range.from} → ${barDateKey(toTime)}`
      : `${state.range.from} → ${state.range.to}`,
  );
  setText(
    'analysisNote',
    replay
      ? `Replaying bar ${(state.replay.index - state.replay.start + 1).toLocaleString('en-IN')} of ${(state.replay.end - state.replay.start + 1).toLocaleString('en-IN')}. Levels are recomputed using only candles up to the current bar.`
      : 'Computed with hidden warmup candles; the chart shows only the selected dates.',
  );
  setText('aBars', analysis.bars.toLocaleString('en-IN'));
  setText('aSwingTrend', trendLabel(analysis.swingTrend));
  setText('aInternalTrend', trendLabel(analysis.internalTrend));
  setText(
    'aStructures',
    `${analysis.structures.total} (${analysis.structures.bullish}↑ / ${analysis.structures.bearish}↓)`,
  );
  setText('aSignals', `${analysis.structures.breaker} / ${analysis.structures.trap}`);
  setText(
    'aObs',
    `Int ${analysis.internalOrderBlocks} · Swing ${analysis.swingOrderBlocks}`,
  );
  setText('aEq', String(analysis.equalDisplays));
  setText('aSwingPoints', String(analysis.swingPoints));
  setText(
    'aLevels',
    `Swing ${formatPrice(analysis.swingHigh)} / ${formatPrice(analysis.swingLow)} · Int ${formatPrice(analysis.internalHigh)} / ${formatPrice(analysis.internalLow)}`,
  );

  const events = document.getElementById('analysisEvents');
  events.replaceChildren();

  if (analysis.alerts.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'events-empty';
    empty.textContent = 'No signals in this range.';
    events.append(empty);
    return;
  }

  for (const alert of analysis.alerts) {
    const item = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = `event-tag ${alert.side === BULLISH ? 'bull' : 'bear'}`;
    tag.textContent = alert.tag === 'OrderBlockBreak' ? 'OB break' : alert.tag;
    const meta = document.createElement('span');
    meta.className = 'event-meta';
    meta.textContent = `${alert.internal ? 'Internal' : 'Swing'} · ${formatBarTime(alert.time)}`;
    item.append(tag, meta);
    events.append(item);
  }
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function trendLabel(trend) {
  if (trend === BULLISH) return 'Bullish';
  if (trend === BEARISH) return 'Bearish';
  return '—';
}

function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
