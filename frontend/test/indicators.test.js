import { describe, expect, it } from 'vitest';
import {
  atrSeries,
  cumulativeMeanRange,
  highestHigh,
  lowestLow,
  trueRange,
} from '../src/smc/indicators.js';

function makeBars(values) {
  return values.map((value, index) => ({
    time: 1_700_000_000 + index * 300,
    open: value,
    high: value + 1,
    low: value - 1,
    close: value,
    volume: 0,
  }));
}

describe('indicators', () => {
  it('computes true range', () => {
    const bars = makeBars([10, 12, 11]);
    expect(trueRange(bars, 0)).toBe(2);
    expect(trueRange(bars, 1)).toBe(3);
    expect(trueRange(bars, 2)).toBe(2);
  });

  it('computes Wilder ATR seeded with SMA', () => {
    const atr = atrSeries(makeBars([10, 10, 10, 10, 10]), 3);
    expect(atr[0]).toBeNull();
    expect(atr[1]).toBeNull();
    expect(atr[2]).toBe(2);
    expect(atr[3]).toBe(2);
    expect(atr[4]).toBe(2);
  });

  it('returns null ATR while warming up', () => {
    const atr = atrSeries(makeBars([10, 10]), 5);
    expect(atr).toEqual([null, null]);
  });

  it('computes cumulative mean range', () => {
    const values = cumulativeMeanRange(makeBars([10, 10, 10, 10]));
    expect(values[0]).toBeNull();
    expect(values[1]).toBe(4);
    expect(values[2]).toBe(3);
    expect(values[3]).toBeCloseTo(8 / 3);
  });

  it('computes highest/lowest with the current bar included', () => {
    const bars = makeBars([10, 15, 12, 11]);
    expect(highestHigh(bars, 3, 2)).toBe(13);
    expect(highestHigh(bars, 2, 3)).toBe(16);
    expect(lowestLow(bars, 3, 2)).toBe(10);
    expect(lowestLow(bars, 2, 3)).toBe(9);
  });
});
