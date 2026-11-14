import { describe, expect, it } from 'vitest';
import { BULLISH, DEFAULT_CONFIG } from '../src/smc/config.js';
import { SMCEngine } from '../src/smc/engine.js';
import {
  buildHtfSeries,
  buildMarketContext,
} from '../src/probability/context.js';
import { extractActiveLevels, lastAtr } from '../src/probability/levels.js';
import { buildProbabilityModel, scoreLevels } from '../src/probability/model.js';
import { buildProbabilityDrawables } from '../src/probability/render.js';

function makeBars(
  count,
  { interval = 300, seed = 0x5eed1234, startPrice = 24_500, driftScale = 1 } = {},
) {
  const bars = [];
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const end = 1_800_000_000;
  const start = end - count * interval;
  let price = startPrice;

  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 85) * 26 + Math.sin(i / 23) * 7 + Math.sin(i / 9) * 2;
    const drift =
      (wave * 0.06 + (random() - 0.5) * 14 + 0.02) * driftScale;
    const open = price;
    const close = open + drift;
    const high = Math.max(open, close) + random() * 8;
    const low = Math.min(open, close) - random() * 8;
    price = close;
    bars.push({
      time: start + i * interval,
      open,
      high,
      low,
      close,
      volume: Math.round(800 + random() * 5000),
    });
  }

  return bars;
}

function monotonicBars(count, interval, direction = 1) {
  return Array.from({ length: count }, (_, index) => {
    const base = 100 + index * direction;
    return {
      time: 1_700_000_000 + index * interval,
      open: base,
      high: base + 1,
      low: base - 1,
      close: base + 0.5 * direction,
      volume: 0,
    };
  });
}

describe('HTF context', () => {
  it('only exposes a bias after the HTF candle has closed', () => {
    const daily = monotonicBars(120, 86_400, 1);
    const series = buildHtfSeries({ bars: daily, daily: true });
    const last = daily[daily.length - 1];

    expect(series.at(last.time).time).toBe(daily[daily.length - 2].time);
    expect(series.at(last.time + 86_400).time).toBe(last.time);
    expect(series.at(last.time + 86_400).bias).toBe(BULLISH);
  });

  it('combines daily and hourly sentiment into per-side alignment', () => {
    const daily = monotonicBars(120, 86_400, 1);
    const hourly = monotonicBars(120, 3_600, 1);
    const context = buildMarketContext({ dailyBars: daily, hourlyBars: hourly });
    const asOf = hourly[hourly.length - 1].time + 3_600;

    expect(context.at(asOf).sentiment).toBeGreaterThan(0.2);
    expect(context.alignmentFor('high', asOf).alignment).toBe('aligned');
    expect(context.alignmentFor('low', asOf).alignment).toBe('opposed');
  });
});

describe('probability model', () => {
  const bars = makeBars(3_000);
  const engine = new SMCEngine({
    ...DEFAULT_CONFIG,
    showSwingOrderBlocks: true,
  });
  engine.run(bars);

  it('extracts and dedupes active levels', () => {
    const atr = lastAtr(engine, bars[bars.length - 1].close);
    const levels = extractActiveLevels(engine, atr);

    expect(levels.length).toBeGreaterThan(0);
    expect(levels.every((level) => Number.isFinite(level.price))).toBe(true);
    expect(new Set(levels.map((level) => `${level.type}:${level.side}:${level.price}`)).size)
      .toBe(levels.length);
  });

  it('builds calibration events and scores active levels', () => {
    const context = buildMarketContext({
      dailyBars: monotonicBars(120, 86_400, 1),
      hourlyBars: monotonicBars(120, 3_600, 1),
    });
    const model = buildProbabilityModel({
      calibrationBars: bars,
      config: { ...DEFAULT_CONFIG, probabilityHorizon: 20 },
      context,
    });
    const lastBar = bars[bars.length - 1];
    const atr = lastAtr(engine, lastBar.close);
    const levels = extractActiveLevels(engine, atr);
    const scored = scoreLevels({
      levels,
      model,
      asOfTime: lastBar.time,
      context,
      lastClose: lastBar.close,
      atr,
      momentum: engine.swingTrendSeries.at(-1) ?? 0,
      currentIndex: bars.length - 1,
    });

    expect(model.events.length).toBeGreaterThan(0);
    expect(model.horizon).toBe(20);
    expect(scored).toHaveLength(levels.length);
    for (const level of scored) {
      expect(level.breakProbability).toBeGreaterThanOrEqual(0.05);
      expect(level.breakProbability).toBeLessThanOrEqual(0.95);
      expect(level.reversalProbability).toBeCloseTo(1 - level.breakProbability);
      expect(['low', 'medium', 'high']).toContain(level.confidence);
      expect(['model', 'blended', 'empirical']).toContain(level.method);
    }
  });

  it('excludes calibration outcomes that are not yet complete', () => {
    const model = {
      config: { ...DEFAULT_CONFIG, probabilityHorizon: 20 },
      horizon: 20,
      events: [
        { type: 'swing', side: 'high', outcome: 'break', outcomeTime: 100, alignment: 'neutral' },
        { type: 'swing', side: 'high', outcome: 'reject', outcomeTime: 200, alignment: 'neutral' },
        { type: 'swing', side: 'high', outcome: 'break', outcomeTime: 300, alignment: 'neutral' },
      ],
    };
    const level = { type: 'swing', side: 'high', price: 100, confirmedIndex: 0 };
    const at = (asOfTime) =>
      scoreLevels({
        levels: [level],
        model,
        asOfTime,
        context: null,
        lastClose: 100,
        atr: 1,
        currentIndex: 10,
      })[0];

    expect(at(150).sampleSize).toBe(1);
    expect(at(250).sampleSize).toBe(2);
    expect(at(350).sampleSize).toBe(3);
  });

  it('renders nearest labels sorted by price and skips trailing labels', () => {
    const levels = [
      { type: 'trailing', side: 'low', price: 90, breakProbability: 0.5, reversalProbability: 0.5 },
      { type: 'swing', side: 'high', price: 110, breakProbability: 0.4, reversalProbability: 0.6 },
      { type: 'equal', side: 'low', price: 95, breakProbability: 0.6, reversalProbability: 0.4 },
      { type: 'swing', side: 'low', price: 20, breakProbability: 0.5, reversalProbability: 0.5 },
    ];
    const labels = buildProbabilityDrawables(levels, {
      atr: 1,
      lastClose: 100,
      config: DEFAULT_CONFIG,
      show: true,
    });

    expect(labels).toHaveLength(2);
    expect(labels[0].price).toBe(110);
    expect(labels[1].price).toBe(95);
    expect(labels[0].text).toContain('B');
    expect(labels[0].text).toContain('R');
    expect(
      buildProbabilityDrawables(levels, {
        atr: 1,
        lastClose: 100,
        config: DEFAULT_CONFIG,
        show: false,
      }),
    ).toEqual([]);
  });
});
