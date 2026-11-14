import './styles.css';
import { LineStyle } from 'lightweight-charts';
import { SMCEngine } from './smc/engine.js';
import { BEARISH, BULLISH } from './smc/config.js';
import { SMCPrimitive } from './primitives/smc.js';
import { createSMCChart, visibleBarsForResolution } from './chart.js';
import { alligatorSeries } from './indicators/alligator.js';
import { latestCprPeriod } from './indicators/cpr.js';
import { LevelOverlay } from './drawings/overlay.js';
import {
  LEVEL_COLOR_OPTIONS,
  LEVEL_LINE_STYLE_OPTIONS,
} from './drawings/levels.js';
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
  calibrationDaysFor,
  clipDrawables,
  earliestHistoryDate,
  firstIndexFromDate,
  historyLimitDays,
  istBusinessDay,
  rangeIndices,
  shiftIsoDate,
  timeKey,
  warmupDaysFor,
} from './range.js';
import { biasLabel, buildMarketContext } from './probability/context.js';
import { extractActiveLevels, lastAtr, levelTypeLabel } from './probability/levels.js';
import { buildProbabilityModel, scoreLevels } from './probability/model.js';
import {
  alignmentLabel,
  buildProbabilityDrawables,
  methodLabel,
} from './probability/render.js';
import {
  applyDefaults,
  applyMode,
  bindControls,
  readSettings,
  setMeta,
  setReplayFollow,
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

const { chart, series, alligator } = createSMCChart(document.getElementById('chart'));
const primitive = new SMCPrimitive();
series.attachPrimitive(primitive);
const levelOverlay = new LevelOverlay({
  series,
  storage: window.localStorage,
  onChange: renderLevelsPanel,
});

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
  calibrationBars: [],
  context: null,
  probabilityModel: null,
  scoredLevels: [],
  htfFetch: null,
  lastHtfRefresh: 0,
  levelMode: false,
  cprLines: [],
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
  bindReplayChartInteractions();
  bindLevelTools();
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

  const { from: displayFrom, to } = rangeMode
    ? { from: settings.dateFrom, to: settings.dateTo }
    : rangeForDays(settings.rangeDays);
  const label = RESOLUTION_LABELS[settings.resolution] || settings.resolution;
  const earliest = earliestHistoryDate(settings.resolution);
  if (displayFrom < earliest) {
    const span = historyLimitDays(settings.resolution) > 365 ? '5 years' : '1 year';
    setStatus(
      `${label} history is limited to the last ${span} on the Fyers Standard plan. ` +
        `Choose a From date on or after ${earliest}, switch to Daily, or upgrade to Fyers Prime.`,
      'error',
    );
    return;
  }
  const warmup = warmupDaysFor(settings.resolution);
  const calibration = calibrationDaysFor(settings.resolution);
  const fetchFromRaw = shiftIsoDate(displayFrom, -Math.max(warmup, calibration));
  // Never request a start date older than the plan allows; this is what caused
  // the 502 when the calibration window pushed past the 1-year intraday limit.
  const fetchFrom = fetchFromRaw < earliest ? earliest : fetchFromRaw;
  const engineFrom = shiftIsoDate(displayFrom, -warmup);

  setStatus(
    rangeMode
      ? `Loading ${settings.symbol} ${label} · ${displayFrom} → ${to}…`
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
    const allBars = normalizeBars(data.candles, settings.resolution);
    if (allBars.length === 0) {
      setStatus(
        rangeMode
          ? `No candles returned for ${displayFrom} → ${to}.`
          : 'No candles returned for this symbol/range.',
        'error',
      );
      return;
    }

    state.calibrationBars = allBars;
    const engineStart = Math.max(0, firstIndexFromDate(allBars, engineFrom));
    state.bars = allBars.slice(engineStart);
    levelOverlay.setSymbol(settings.symbol);

    const htf = await fetchHtfContext({ settings, displayFrom, to });
    state.context = htf.context;
    state.htfFetch = htf.fetch;
    state.lastHtfRefresh = Date.now();
    rebuildProbabilityModel();

    if (rangeMode) {
      const bounds = rangeIndices(state.bars, displayFrom, to);
      if (!bounds) {
        setStatus(`No candles returned for ${displayFrom} → ${to}.`, 'error');
        return;
      }
      state.range = {
        from: displayFrom,
        to,
        fromTime: bounds.fromTime,
        toTime: bounds.toTime,
      };

      if (settings.mode === 'replay') {
        setupReplay(bounds);
      } else {
        clearReplay();
        state.displayBars = state.bars.slice(bounds.startIndex, bounds.endIndex + 1);
        state.signature = signatureOf(state.displayBars);
        series.setData(chartData(state.displayBars));
        rerun();
        if (resetView || !state.loadedOnce) {
          chart.timeScale().fitContent();
        }
      }
    } else {
      clearReplay();
      const displayStart = Math.max(0, firstIndexFromDate(state.bars, displayFrom));
      state.displayBars = state.bars.slice(displayStart);
      if (state.displayBars.length === 0) {
        setStatus('No candles returned for the selected range.', 'error');
        return;
      }
      state.range = null;
      state.signature = signatureOf(state.displayBars);
      series.setData(chartData(state.displayBars));
      rerun();
      if (resetView || !state.loadedOnce) {
        focusRecent(state.displayBars.length, settings.resolution);
      }
    }

    state.loadedOnce = true;
    state.authenticated = true;
    showAuthButton(false);
    updateMeta();

    if (settings.mode === 'replay') {
      const total = state.replay.end - state.replay.start + 1;
      setStatus(
        `Replay ready · ${total.toLocaleString('en-IN')} candles · ${displayFrom} → ${to}`,
        'ok',
      );
    } else if (rangeMode) {
      setStatus(
        `Date mode · ${state.displayBars.length.toLocaleString('en-IN')} candles · ${displayFrom} → ${to}`,
        'ok',
      );
    } else {
      setStatus(
        `Loaded ${state.displayBars.length.toLocaleString('en-IN')} candles`,
        'ok',
      );
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
  levelOverlay.setSymbol(settings.symbol || 'DEMO');

  const bars = makeDemoBars(6000);
  state.calibrationBars = bars;
  state.bars = bars;
  state.context = buildMarketContext({
    dailyBars: makeDemoHtfBars('D'),
    hourlyBars: makeDemoHtfBars('60'),
  });
  state.htfFetch = null;
  state.lastHtfRefresh = Date.now();
  rebuildProbabilityModel();

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

async function fetchHtfContext({ settings, displayFrom, to }) {
  const earliestHourly = earliestHistoryDate('60');
  const earliestDaily = earliestHistoryDate('D');
  const hourlyFromRaw = shiftIsoDate(displayFrom, -90);
  const dailyFromRaw = shiftIsoDate(displayFrom, -500);
  const hourlyFrom = hourlyFromRaw < earliestHourly ? earliestHourly : hourlyFromRaw;
  const dailyFrom = dailyFromRaw < earliestDaily ? earliestDaily : dailyFromRaw;
  const [hourlyData, dailyData] = await Promise.all([
    fetchHistory({
      symbol: settings.symbol,
      resolution: '60',
      from: hourlyFrom,
      to,
    }).catch(() => null),
    fetchHistory({
      symbol: settings.symbol,
      resolution: 'D',
      from: dailyFrom,
      to,
    }).catch(() => null),
  ]);

  const hourlyBars = hourlyData ? normalizeBars(hourlyData.candles, '60') : [];
  const dailyBars = dailyData ? normalizeBars(dailyData.candles, 'D') : [];

  return {
    context: buildMarketContext({ dailyBars, hourlyBars }),
    fetch: { symbol: settings.symbol, displayFrom, to },
  };
}

function rebuildProbabilityModel() {
  if (!state.settings || !state.calibrationBars.length) {
    state.probabilityModel = null;
    return;
  }
  state.probabilityModel = buildProbabilityModel({
    calibrationBars: state.calibrationBars,
    config: state.settings.config,
    context: state.context,
  });
}

function makeDemoBars(count) {
  return makeSyntheticBars({
    count,
    interval: 300,
    seed: 0x5eed1234,
    startPrice: 24_500,
    driftScale: 1,
  });
}

function makeDemoHtfBars(kind) {
  if (kind === 'D') {
    return makeSyntheticBars({
      count: 450,
      interval: 86_400,
      seed: 0x0d123456,
      startPrice: 23_000,
      driftScale: 4,
    });
  }
  return makeSyntheticBars({
    count: 750,
    interval: 3_600,
    seed: 0x60ab12cd,
    startPrice: 24_000,
    driftScale: 2.5,
  });
}

function makeSyntheticBars({ count, interval, seed, startPrice, driftScale }) {
  const bars = [];
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const end = Math.floor(Date.now() / 1000 / interval) * interval;
  const start = end - count * interval;
  let price = startPrice;

  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 85) * 26 + Math.sin(i / 23) * 7 + Math.sin(i / 9) * 2;
    const drift =
      (wave * 0.06 + (random() - 0.5) * 14 + 0.02) * (driftScale || 1);
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

  if (
    state.probabilityModel &&
    current.config.probabilityHorizon !== state.probabilityModel.horizon
  ) {
    rebuildProbabilityModel();
  }

  const engine = new SMCEngine(state.settings.config);
  const engineBars = state.replay.active
    ? state.bars.slice(0, state.replay.index + 1)
    : state.bars;
  const cpr = updateCpr(engineBars, state.settings.config.showCpr);
  updateAlligator(engineBars, state.settings.config.showAlligator);

  const drawables = [
    ...engine.run(engineBars),
    ...buildCprBand(cpr),
  ];
  const visible = state.range
    ? clipDrawables(drawables, state.range.fromTime, currentRangeTo())
    : drawables;

  const scored = computeProbabilities(engine);
  state.scoredLevels = scored;

  const lastBar = engineBars[engineBars.length - 1];
  const atr = lastAtr(engine, lastBar?.close ?? 1);
  const probabilityDrawables = buildProbabilityDrawables(scored, {
    atr,
    lastClose: lastBar?.close,
    config: state.settings.config,
    show: state.settings.config.showProbabilities,
  });

  primitive.setDrawables([...visible, ...probabilityDrawables]);
  updateAnalysis(engine);
  updateMeta();
}

function updateAlligator(bars, show) {
  if (!show) {
    alligator.jaw.setData([]);
    alligator.teeth.setData([]);
    alligator.lips.setData([]);
    return;
  }

  const display = state.displayBars.length ? state.displayBars : bars;
  const times = new Set(display.map((bar) => bar.time));
  const values = alligatorSeries(bars);
  alligator.jaw.setData(lineData(bars, values.jaw, times));
  alligator.teeth.setData(lineData(bars, values.teeth, times));
  alligator.lips.setData(lineData(bars, values.lips, times));
}

function lineData(bars, values, times) {
  const points = [];
  for (let i = 0; i < bars.length; i += 1) {
    const value = values[i];
    if (value == null || !Number.isFinite(value) || !times.has(bars[i].time)) {
      continue;
    }
    points.push({ time: bars[i].time, value });
  }
  return points;
}

function updateCpr(bars, show) {
  for (const line of state.cprLines) {
    series.removePriceLine(line);
  }
  state.cprLines = [];
  if (!show) {
    return null;
  }

  const cpr = latestCprPeriod(bars);
  if (!cpr) {
    return null;
  }

  state.cprLines = [
    series.createPriceLine({
      price: cpr.pivot,
      color: '#eab308',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: 'CPR P',
    }),
    series.createPriceLine({
      price: cpr.tc,
      color: '#3179f5',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: 'CPR TC',
    }),
    series.createPriceLine({
      price: cpr.bc,
      color: '#3179f5',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: 'CPR BC',
    }),
  ];
  return cpr;
}

function buildCprBand(cpr) {
  if (!cpr) {
    return [];
  }
  return [
    {
      kind: 'rect',
      layer: 'bottom',
      fromTime: cpr.fromTime,
      toTime: null,
      top: cpr.top,
      bottom: cpr.bottom,
      fill: 'rgba(49, 121, 245, 0.06)',
      border: 'rgba(49, 121, 245, 0.18)',
    },
  ];
}

function computeProbabilities(engine) {
  if (!state.probabilityModel || !state.settings?.config.showProbabilities) {
    return [];
  }

  const index = engine.bars.length - 1;
  const lastBar = engine.bars[index];
  if (!lastBar) {
    return [];
  }

  const atr = lastAtr(engine, lastBar.close);
  const levels = extractActiveLevels(engine, atr);
  return scoreLevels({
    levels,
    model: state.probabilityModel,
    asOfTime: lastBar.time,
    context: state.context,
    lastClose: lastBar.close,
    atr,
    momentum: engine.swingTrendSeries?.[index] ?? 0,
    currentIndex: index,
  });
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

function bindReplayChartInteractions() {
  const container = document.getElementById('chart');
  let dragging = false;
  let startX = 0;
  let startY = 0;

  const stopFollowing = () => {
    const replay = state.replay;
    if (!replay.active || !replay.playing || !replay.follow) {
      return;
    }
    // The user took control of the viewport; stop snapping back to the newest
    // bar on every replay tick so they can pan/zoom freely while it plays.
    replay.follow = false;
    setReplayFollow(false);
  };

  container.addEventListener('pointerdown', (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
  });
  container.addEventListener('pointermove', (event) => {
    if (!dragging) {
      return;
    }
    if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > 4) {
      stopFollowing();
    }
  });
  container.addEventListener('pointerup', () => {
    dragging = false;
  });
  container.addEventListener('pointercancel', () => {
    dragging = false;
  });
  container.addEventListener('wheel', stopFollowing, { passive: true });
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

function bindLevelTools() {
  const container = document.getElementById('chart');
  const levelBtn = document.getElementById('levelBtn');
  const clearBtn = document.getElementById('clearLevelsBtn');
  let drag = null;

  const setLevelMode = (active) => {
    state.levelMode = active;
    levelBtn.classList.toggle('active', active);
    levelBtn.setAttribute('aria-pressed', String(active));
    container.classList.toggle('drawing', active);
    setStatus(
      active
        ? 'Level mode · click the chart to place a level (Esc to exit)'
        : 'Level mode off',
      active ? 'ok' : 'idle',
    );
  };

  levelBtn.addEventListener('click', () => setLevelMode(!state.levelMode));
  clearBtn.addEventListener('click', () => levelOverlay.clear());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.levelMode) {
      setLevelMode(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const target = event.target;
    const tag = target?.tagName;
    if (
      target?.isContentEditable ||
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT'
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        levelOverlay.redo();
      } else {
        levelOverlay.undo();
      }
    } else if (key === 'y') {
      event.preventDefault();
      levelOverlay.redo();
    }
  });

  chart.subscribeClick((param) => {
    if (!state.levelMode || !param.point) {
      return;
    }
    const price = series.coordinateToPrice(param.point.y);
    if (price != null) {
      levelOverlay.addAtPrice(price);
    }
  });

  const pointerY = (event) => {
    const rect = container.getBoundingClientRect();
    return event.clientY - rect.top;
  };

  const pointerInPane = (event) => {
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const pane = chart.paneSize();
    return x >= 0 && x <= pane.width && y >= 0 && y <= pane.height;
  };

  container.addEventListener(
    'pointerdown',
    (event) => {
      if (
        state.levelMode ||
        event.button !== 0 ||
        !pointerInPane(event)
      ) {
        return;
      }
      const level = levelOverlay.nearestAtY(pointerY(event), 8);
      if (!level) {
        return;
      }
      drag = { id: level.id, price: level.price };
      levelOverlay.beginTransaction();
      container.classList.add('dragging-level');
      chart.applyOptions({ handleScroll: false, handleScale: false });
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  window.addEventListener('pointermove', (event) => {
    if (!drag) {
      return;
    }
    const price = series.coordinateToPrice(pointerY(event));
    if (price != null) {
      drag.price = price;
      levelOverlay.moveTo(drag.id, price, { persist: false });
    }
    event.preventDefault();
  });

  const endDrag = () => {
    if (!drag) {
      return;
    }
    levelOverlay.endTransaction();
    drag = null;
    container.classList.remove('dragging-level');
    chart.applyOptions({ handleScroll: true, handleScale: true });
  };

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);
}

function renderLevelsPanel(levels) {
  const panel = document.getElementById('levelsPanel');
  const list = document.getElementById('levelsList');
  const count = document.getElementById('levelsCount');
  if (!panel || !list) {
    return;
  }

  list.replaceChildren();
  if (!levels.length) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  count.textContent = String(levels.length);

  for (const level of levels) {
    const row = document.createElement('li');
    row.className = 'level-row';

    const main = document.createElement('div');
    main.className = 'level-main';

    const dot = document.createElement('i');
    dot.className = 'level-dot';
    dot.style.background = level.color;

    const title = document.createElement('span');
    title.className = 'level-title';
    title.textContent = level.title || 'Level';

    const price = document.createElement('span');
    price.className = 'level-price';
    price.textContent = formatPrice(level.price);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'level-delete';
    remove.title = 'Remove level';
    remove.textContent = '×';
    remove.addEventListener('click', () => levelOverlay.remove(level.id));

    main.append(dot, title, price, remove);

    const controls = document.createElement('div');
    controls.className = 'level-controls';

    const colorSelect = document.createElement('select');
    colorSelect.className = 'level-color';
    colorSelect.title = 'Level color';
    colorSelect.setAttribute('aria-label', `Color for ${level.title || 'level'}`);
    for (const option of LEVEL_COLOR_OPTIONS) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      colorSelect.append(item);
    }
    colorSelect.value = level.color;
    colorSelect.addEventListener('change', () =>
      levelOverlay.update(level.id, { color: colorSelect.value }),
    );

    const styleSelect = document.createElement('select');
    styleSelect.className = 'level-style';
    styleSelect.title = 'Line style';
    styleSelect.setAttribute('aria-label', `Line style for ${level.title || 'level'}`);
    for (const option of LEVEL_LINE_STYLE_OPTIONS) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      styleSelect.append(item);
    }
    styleSelect.value = level.lineStyle;
    styleSelect.addEventListener('change', () =>
      levelOverlay.update(level.id, { lineStyle: styleSelect.value }),
    );

    controls.append(colorSelect, styleSelect);
    row.append(main, controls);
    list.append(row);
  }
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
    if (Date.now() - state.lastHtfRefresh > 15 * 60 * 1000) {
      try {
        const { from: displayFrom, to } = rangeForDays(settings.rangeDays);
        const htf = await fetchHtfContext({ settings, displayFrom, to });
        if (htf.context.daily.series.length || htf.context.hourly.series.length) {
          state.context = htf.context;
          state.htfFetch = htf.fetch;
          state.lastHtfRefresh = Date.now();
          rebuildProbabilityModel();
        }
      } catch (error) {
        if (error.status === 401) {
          throw error;
        }
      }
    }

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
    const displayFrom = rangeForDays(settings.rangeDays).from;
    const displayStart = Math.max(0, firstIndexFromDate(merged, displayFrom));
    const display = merged.slice(displayStart);
    const nextSignature = signatureOf(display);
    if (nextSignature === state.signature) {
      return;
    }

    state.bars = merged;
    state.displayBars = display;
    state.signature = nextSignature;
    series.setData(chartData(display));
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

function currentAsOfTime() {
  if (state.replay.active) {
    return state.bars[state.replay.index]?.time;
  }
  const bars = state.displayBars.length ? state.displayBars : state.bars;
  return bars[bars.length - 1]?.time;
}

function updateContextPanel() {
  if (!state.context) {
    setText('ctxDaily', '–');
    setText('ctxHourly', '–');
    setText('ctxAlignment', '–');
    setText('ctxAtr', '–');
    return;
  }

  const ctx = state.context.at(currentAsOfTime());
  setText('ctxDaily', biasLabel(ctx.dailyBias));
  setText('ctxHourly', biasLabel(ctx.hourlyBias));
  const alignment =
    ctx.sentiment > 0.2 ? 'Bullish' : ctx.sentiment < -0.2 ? 'Bearish' : 'Mixed';
  setText('ctxAlignment', alignment);
  const atr = ctx.dailyAtr ?? ctx.hourlyAtr;
  setText('ctxAtr', atr != null ? formatPrice(atr) : '–');
}

function updateProbabilityPanel() {
  const section = document.getElementById('probabilitySection');
  const tbody = document.getElementById('probabilityRows');
  const show = Boolean(state.settings?.config?.showProbabilities);

  if (!show) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  tbody.replaceChildren();

  const levels = [...(state.scoredLevels || [])].sort((a, b) => {
    const da = a.distanceAtr == null ? Infinity : Math.abs(a.distanceAtr);
    const db = b.distanceAtr == null ? Infinity : Math.abs(b.distanceAtr);
    return da - db;
  });

  if (levels.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'events-empty';
    td.textContent = state.probabilityModel
      ? 'No active levels to score.'
      : 'Probability model unavailable.';
    tr.append(td);
    tbody.append(tr);
    setText('probabilityNote', '');
    return;
  }

  for (const level of levels) {
    const tr = document.createElement('tr');
    const levelCell = document.createElement('td');
    const name = document.createElement('span');
    name.className = 'prob-level';
    name.textContent = levelTypeLabel(level.type, level.side);
    const price = document.createElement('span');
    price.className = 'prob-price';
    price.textContent = formatPrice(level.price);
    levelCell.append(name, price);

    const breakCell = document.createElement('td');
    breakCell.className = 'prob-break';
    breakCell.textContent = `${Math.round(level.breakProbability * 100)}%`;

    const rejectCell = document.createElement('td');
    rejectCell.className = 'prob-reject';
    rejectCell.textContent = `${Math.round(level.reversalProbability * 100)}%`;

    const nCell = document.createElement('td');
    nCell.className = 'prob-n';
    nCell.textContent = level.sampleSize ? String(level.sampleSize) : '—';
    nCell.title = `${level.confidence} confidence · ${methodLabel(level.method)}`;

    const htfCell = document.createElement('td');
    htfCell.className = `prob-htf ${level.htfAlignment}`;
    htfCell.textContent = alignmentLabel(level.htfAlignment);

    tr.append(levelCell, breakCell, rejectCell, nCell, htfCell);
    tr.title = `${methodLabel(level.method)} · ${level.confidence} confidence · horizon ${
      state.probabilityModel?.horizon ?? 20
    } bars`;
    tbody.append(tr);
  }

  const htfNote = state.context ? '' : ' HTF context unavailable, using the heuristic prior.';
  setText(
    'probabilityNote',
    `Historical base rate over ${
      state.probabilityModel?.horizon ?? 20
    } bars; n = completed similar touches. Small samples blend with the model estimate.${htfNote}`,
  );
}

function updateAnalysis(engine) {
  const panel = document.getElementById('analysis');
  const mode = state.settings?.mode;
  const rangeMode = mode === 'date' || mode === 'replay';
  const showProbs = Boolean(state.settings?.config?.showProbabilities);

  if (!state.settings || (!rangeMode && !showProbs)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const replay = state.replay.active;
  setText(
    'analysisTitle',
    replay
      ? 'Replay · indicator readout'
      : rangeMode
        ? 'Date mode · indicator readout'
        : 'Live · indicator readout',
  );

  updateContextPanel();
  updateProbabilityPanel();

  const stats = document.getElementById('analysisStats');
  const eventsSection = document.getElementById('analysisEventsSection');
  const note = document.getElementById('analysisNote');

  if (!rangeMode || !state.range) {
    stats.hidden = true;
    eventsSection.hidden = true;
    note.hidden = true;
    setText('analysisRange', `${state.displayBars.length.toLocaleString('en-IN')} bars`);
    return;
  }

  stats.hidden = false;
  eventsSection.hidden = false;
  note.hidden = false;

  const toTime = replay ? state.bars[state.replay.index].time : state.range.toTime;
  const analysis = buildAnalysis(
    engine,
    state.range.fromTime,
    toTime,
    state.displayBars.length,
  );

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
