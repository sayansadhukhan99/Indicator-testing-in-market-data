import { atrSeries, emaSeries } from '../smc/indicators.js';
import { SMCEngine } from '../smc/engine.js';
import { timeKey } from '../range.js';

const DAY_SECONDS = 86400;

const HTF_ENGINE_CONFIG = {
  swingsLength: 20,
  internalLength: 5,
  showInternals: true,
  showSwing: true,
  showSwings: false,
  showHighLowSwings: false,
  showEqualHighLows: false,
  showInternalOrderBlocks: false,
  showSwingOrderBlocks: false,
};

const NEUTRAL_STATE = {
  bias: 0,
  trend: 0,
  internalTrend: 0,
  ema20: null,
  ema50: null,
  atr: null,
  readyTime: null,
};

/**
 * Build a causal HTF bias series. Each entry only becomes available after its
 * candle has closed (`readyTime`), so replay and date mode cannot look ahead.
 */
export function buildHtfSeries({ bars, intervalMinutes = 0, daily = false } = {}) {
  const clean = (bars || []).filter((bar) => bar && bar.time != null);
  if (clean.length === 0) {
    return { bars: clean, series: [], at: () => NEUTRAL_STATE };
  }

  const engine = new SMCEngine(HTF_ENGINE_CONFIG);
  engine.run(clean);

  const closes = clean.map((bar) => bar.close);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const atr14 = atrSeries(clean, 14);

  const series = clean.map((bar, index) => {
    const close = bar.close;
    const fast = ema20[index];
    const slow = ema50[index];
    const trend = engine.swingTrendSeries[index] ?? 0;
    const internalTrend = engine.internalTrendSeries[index] ?? 0;

    let score = 0;
    if (fast != null) score += 0.4 * Math.sign(close - fast);
    if (fast != null && slow != null) score += 0.3 * Math.sign(fast - slow);
    score += 0.3 * trend;

    const base = timeKey(bar.time);
    const readyTime = daily
      ? base + DAY_SECONDS
      : base + Math.max(0, intervalMinutes) * 60;

    return {
      time: bar.time,
      readyTime,
      bias: score > 0.25 ? 1 : score < -0.25 ? -1 : 0,
      trend,
      internalTrend,
      ema20: fast,
      ema50: slow,
      atr: atr14[index],
    };
  });

  return {
    bars: clean,
    series,
    at(time) {
      const key = timeKey(time);
      if (!Number.isFinite(key)) {
        return NEUTRAL_STATE;
      }
      let found = null;
      for (const entry of series) {
        if (entry.readyTime <= key) {
          found = entry;
        } else {
          break;
        }
      }
      return found || NEUTRAL_STATE;
    },
  };
}

export function buildMarketContext({ dailyBars = [], hourlyBars = [] } = {}) {
  const daily = buildHtfSeries({ bars: dailyBars, daily: true });
  const hourly = buildHtfSeries({ bars: hourlyBars, intervalMinutes: 60 });

  return {
    daily,
    hourly,
    at(time) {
      const dailyState = daily.at(time);
      const hourlyState = hourly.at(time);
      const sentiment = 0.6 * dailyState.bias + 0.4 * hourlyState.bias;
      return {
        dailyBias: dailyState.bias,
        hourlyBias: hourlyState.bias,
        dailyTrend: dailyState.trend,
        hourlyTrend: hourlyState.trend,
        dailyAtr: dailyState.atr,
        hourlyAtr: hourlyState.atr,
        sentiment,
      };
    },
    alignmentFor(side, time) {
      const state = this.at(time);
      const sideSign = side === 'high' ? 1 : -1;
      const score = state.sentiment * sideSign;
      const alignment = score > 0.2 ? 'aligned' : score < -0.2 ? 'opposed' : 'neutral';
      return { ...state, alignment, alignmentScore: score };
    },
  };
}

export function biasLabel(bias) {
  if (bias > 0) return 'Bullish';
  if (bias < 0) return 'Bearish';
  return 'Neutral';
}
