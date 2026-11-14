import { describe, expect, it } from 'vitest';
import {
  ALLIGATOR_DEFAULTS,
  alligatorSeries,
  shiftRight,
  smmaSeries,
} from '../src/indicators/alligator.js';

describe('Williams Alligator', () => {
  it('computes the SMMA using the SMA seed and Wilder smoothing', () => {
    const values = smmaSeries([1, 2, 3, 4, 5], 3);
    expect(values.slice(0, 2)).toEqual([null, null]);
    expect(values[2]).toBe(2);
    expect(values[3]).toBeCloseTo(8 / 3, 10);
    expect(values[4]).toBeCloseTo(10 / 3 + 1 / 9, 10);
  });

  it('shifts the values to the right for plot offsets', () => {
    expect(shiftRight([1, 2, 3], 2)).toEqual([null, null, 1]);
    expect(shiftRight([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });

  it('applies the default 13/8/5 periods and 8/5/3 offsets', () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      high: i * 2 + 1,
      low: i * 2 - 1,
      close: i * 2,
    }));
    const result = alligatorSeries(bars);

    expect(result.jaw).toHaveLength(30);
    expect(result.teeth).toHaveLength(30);
    expect(result.lips).toHaveLength(30);
    expect(result.jaw.slice(0, 19).every((value) => value == null)).toBe(true);
    expect(result.teeth.slice(0, 11).every((value) => value == null)).toBe(true);
    expect(result.lips[6]).toBeNull();
    expect(result.lips[7]).toBe(4);
    expect(ALLIGATOR_DEFAULTS).toMatchObject({
      jawLength: 13,
      teethLength: 8,
      lipsLength: 5,
    });
  });
});
