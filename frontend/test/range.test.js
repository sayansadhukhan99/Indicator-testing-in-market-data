import { describe, expect, it } from 'vitest';
import { BEARISH, BULLISH } from '../src/smc/config.js';
import {
  buildAnalysis,
  clipDrawables,
  shiftIsoDate,
  sliceBarsToRange,
  timeKey,
  warmupDaysFor,
} from '../src/range.js';

const bar = (time) => ({ time, open: 0, high: 0, low: 0, close: 0, volume: 0 });

describe('date range helpers', () => {
  it('shifts ISO dates across month boundaries', () => {
    expect(shiftIsoDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('uses enough warmup for higher timeframes', () => {
    expect(warmupDaysFor('D')).toBe(400);
    expect(warmupDaysFor('5')).toBeGreaterThan(0);
    expect(warmupDaysFor('60')).toBeGreaterThan(warmupDaysFor('5'));
  });

  it('slices intraday bars by IST business day', () => {
    const bars = [
      bar(Date.UTC(2026, 10, 6, 17, 0) / 1000), // 2026-11-06 22:30 IST
      bar(Date.UTC(2026, 10, 6, 18, 30) / 1000), // 2026-11-07 00:00 IST
      bar(Date.UTC(2026, 10, 7, 18, 30) / 1000), // 2026-11-08 00:00 IST
    ];

    const sliced = sliceBarsToRange(bars, '2026-11-07', '2026-11-07');
    expect(sliced).toHaveLength(1);
    expect(sliced[0].time).toBe(bars[1].time);
  });

  it('clips drawables to the visible range', () => {
    const from = 1000;
    const to = 2000;
    const drawables = [
      { kind: 'segment', fromTime: 500, toTime: 1500, fromPrice: 1, toPrice: 1 },
      { kind: 'segment', fromTime: 500, toTime: 900, fromPrice: 1, toPrice: 1 },
      { kind: 'rect', fromTime: 500, toTime: null, top: 2, bottom: 1 },
      { kind: 'text', time: 500, text: 'old' },
      { kind: 'text', time: null, xRight: true, text: 'right' },
      { kind: 'segment', fromTime: 1500, toTime: 2500, fromPrice: 1, toPrice: 1 },
    ];

    const clipped = clipDrawables(drawables, from, to);
    expect(clipped).toHaveLength(4);
    expect(clipped[0]).toMatchObject({ fromTime: 1000, toTime: 1500 });
    expect(clipped[1]).toMatchObject({ fromTime: 1000, toTime: null });
    expect(clipped[2]).toMatchObject({ xRight: true });
    expect(clipped[3]).toMatchObject({ fromTime: 1500, toTime: 2000 });
  });

  it('summarises only signals inside the range', () => {
    const engine = {
      bars: [bar(100), bar(200)],
      swingTrend: BULLISH,
      internalTrend: BEARISH,
      swing: { high: { currentLevel: 120 }, low: { currentLevel: 100 } },
      internal: { high: { currentLevel: 115 }, low: { currentLevel: 105 } },
      structures: [
        { toTime: 150, bias: BULLISH, tag: 'Breaker' },
        { toTime: 250, bias: BEARISH, tag: 'Trap' },
      ],
      equalDisplays: [{ toTime: 160 }, { toTime: 300 }],
      swingPoints: [{ time: 170 }, { time: 90 }],
      alerts: [
        { time: 150, side: BULLISH, internal: false, tag: 'Breaker' },
        { time: 50, side: BEARISH, internal: true, tag: 'Trap' },
        { time: 250, side: BEARISH, internal: false, tag: 'Trap' },
      ],
      internalOrderBlocks: [{}, {}],
      swingOrderBlocks: [{}],
    };

    const analysis = buildAnalysis(engine, 100, 200, 2);
    expect(analysis.bars).toBe(2);
    expect(analysis.swingTrend).toBe(BULLISH);
    expect(analysis.internalTrend).toBe(BEARISH);
    expect(analysis.structures).toMatchObject({
      total: 1,
      bullish: 1,
      bearish: 0,
      breaker: 1,
      trap: 0,
    });
    expect(analysis.equalDisplays).toBe(1);
    expect(analysis.swingPoints).toBe(1);
    expect(analysis.internalOrderBlocks).toBe(2);
    expect(analysis.swingOrderBlocks).toBe(1);
    expect(analysis.alerts).toHaveLength(1);
    expect(analysis.alerts[0].time).toBe(150);
  });

  it('keeps epoch and business-day keys comparable', () => {
    expect(timeKey(123)).toBe(123);
    expect(timeKey('2026-11-07')).toBe(Date.UTC(2026, 10, 7) / 1000);
  });
});
