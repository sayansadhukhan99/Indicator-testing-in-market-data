import { describe, expect, it } from 'vitest';
import {
  cprLevels,
  cprPeriods,
  latestCprPeriod,
} from '../src/indicators/cpr.js';

const bars = [
  { time: '2026-01-01', high: 110, low: 100, close: 105 },
  { time: '2026-01-01', high: 112, low: 104, close: 108 },
  { time: '2026-01-02', high: 120, low: 116, close: 118 },
];

describe('Central Pivot Range', () => {
  it('computes pivot, top central and bottom central levels', () => {
    const levels = cprLevels({ high: 112, low: 100, close: 108 });
    expect(levels.pivot).toBeCloseTo(320 / 3, 10);
    expect(levels.bc).toBe(106);
    expect(levels.tc).toBeCloseTo(2 * (320 / 3) - 106, 10);
    expect(levels.top).toBe(levels.tc);
    expect(levels.bottom).toBe(levels.bc);
  });

  it('uses the previous session HLC for the next session CPR', () => {
    const periods = cprPeriods(bars);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      pivot: 320 / 3,
      bc: 106,
      fromTime: '2026-01-02',
      toTime: '2026-01-02',
      periodKey: '2026-01-02',
    });
    expect(latestCprPeriod(bars)).toEqual(periods[0]);
  });

  it('has no CPR until a previous session exists', () => {
    expect(cprPeriods([{ time: '2026-01-01', high: 1, low: 0, close: 0.5 }])).toEqual([]);
    expect(latestCprPeriod([])).toBeNull();
  });
});
