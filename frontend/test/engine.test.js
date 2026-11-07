import { describe, expect, it } from 'vitest';
import { BEARISH, BULLISH } from '../src/smc/config.js';
import { SMCEngine } from '../src/smc/engine.js';

function bar(time, open, high, low, close) {
  return { time, open, high, low, close, volume: 0 };
}

const SWING_CONFIG = {
  swingsLength: 2,
  internalLength: 2,
  equalHighsLowsLength: 2,
  showInternals: false,
  showInternalOrderBlocks: false,
  showHighLowSwings: false,
  showEqualHighLows: false,
  showSwings: false,
  showSwing: true,
  showSwingOrderBlocks: true,
};

// Pivot low at bar 0, pivot high at bar 2 (confirmed at bar 4), then a close
// above the pivot high at bar 5 -> Breaker + bullish order block.
const BARS = [
  bar(1, 9.5, 10, 9, 9.5),
  bar(2, 10.5, 11, 10, 10.5),
  bar(3, 11.5, 12, 11, 11.5),
  bar(4, 9.5, 10, 9, 9.5),
  bar(5, 9.5, 10, 8.5, 9.5),
  bar(6, 12.5, 12.5, 11.5, 12.5),
];

describe('SMCEngine', () => {
  it('handles empty input', () => {
    const engine = new SMCEngine(SWING_CONFIG);
    expect(engine.run([])).toEqual([]);
  });

  it('tracks swing pivots', () => {
    const engine = new SMCEngine(SWING_CONFIG);
    engine.run(BARS);
    expect(engine.swing.low.currentLevel).toBe(9);
    expect(engine.swing.high.currentLevel).toBe(12);
  });

  it('emits a bullish Breaker with a matching order block', () => {
    const engine = new SMCEngine(SWING_CONFIG);
    engine.run(BARS);

    expect(engine.structures).toHaveLength(1);
    const structure = engine.structures[0];
    expect(structure.tag).toBe('Breaker');
    expect(structure.bias).toBe(BULLISH);
    expect(structure.price).toBe(12);
    expect(structure.internal).toBe(false);

    expect(engine.swingOrderBlocks).toHaveLength(1);
    const orderBlock = engine.swingOrderBlocks[0];
    expect(orderBlock.bias).toBe(BULLISH);
    expect(orderBlock.barLow).toBe(8.5);
    expect(orderBlock.barHigh).toBe(10);
  });

  it('removes mitigated order blocks', () => {
    const engine = new SMCEngine(SWING_CONFIG);
    engine.bars = [bar(1, 8, 8, 7, 7.5)];
    engine.swingOrderBlocks = [
      { bias: BULLISH, barHigh: 9, barLow: 8, barTime: 1 },
      { bias: BEARISH, barHigh: 20, barLow: 19, barTime: 1 },
    ];

    engine.deleteOrderBlocks(0, false);

    expect(engine.swingOrderBlocks).toHaveLength(1);
    expect(engine.swingOrderBlocks[0].bias).toBe(BEARISH);
  });

  it('produces rect/line/text drawables', () => {
    const engine = new SMCEngine(SWING_CONFIG);
    const drawables = engine.run(BARS);

    expect(drawables.some((item) => item.kind === 'rect')).toBe(true);
    expect(drawables.some((item) => item.kind === 'segment')).toBe(true);
    expect(
      drawables.some((item) => item.kind === 'text' && item.text === 'Breaker'),
    ).toBe(true);
  });
});
