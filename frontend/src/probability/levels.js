import { BEARISH, BULLISH } from '../smc/config.js';

const TYPE_LABELS = {
  swing: { high: 'Swing High', low: 'Swing Low' },
  internal: { high: 'Internal High', low: 'Internal Low' },
  equal: { high: 'EQH', low: 'EQL' },
  'ob-internal': { high: 'Internal OB', low: 'Internal OB' },
  'ob-swing': { high: 'Swing OB', low: 'Swing OB' },
  trailing: { high: 'Weak High', low: 'Weak Low' },
};

const TYPE_PRIORITY = {
  trailing: 0,
  swing: 1,
  equal: 2,
  'ob-swing': 3,
  'ob-internal': 4,
  internal: 5,
};

export function lastAtr(engine, fallbackPrice) {
  if (engine?.atr?.length) {
    for (let i = engine.atr.length - 1; i >= 0; i -= 1) {
      if (engine.atr[i] != null) {
        return engine.atr[i];
      }
    }
  }
  return Math.max(1, Number(fallbackPrice) * 0.002);
}

function trailingLabel(engine, side) {
  if (side === 'high') {
    return engine.swingTrend === BEARISH ? 'Institutional Selling' : 'Weak High';
  }
  return engine.swingTrend === BULLISH ? 'Institutional Buying' : 'Weak Low';
}

function latestEqual(engine, side) {
  const text = side === 'high' ? 'Same High' : 'Same Low';
  for (let i = engine.equalDisplays.length - 1; i >= 0; i -= 1) {
    const item = engine.equalDisplays[i];
    if (item.text === text) {
      return item;
    }
  }
  return null;
}

/**
 * Collect every active level the engine currently knows about. The probability
 * model scores this list; the sidebar/table and chart badges render it.
 */
export function extractActiveLevels(engine, atr) {
  const candidates = [];
  const push = (level) => {
    if (level.price == null || !Number.isFinite(Number(level.price))) {
      return;
    }
    const side = level.side;
    candidates.push({
      ...level,
      price: Number(level.price),
      label:
        level.label ||
        TYPE_LABELS[level.type]?.[side] ||
        level.type,
    });
  };

  if (engine.trailing.top != null) {
    push({
      type: 'trailing',
      side: 'high',
      price: engine.trailing.top,
      label: trailingLabel(engine, 'high'),
      confirmedTime: engine.trailing.lastTopTime,
      confirmedIndex: engine.swing.high.barIndex,
    });
  }
  if (engine.trailing.bottom != null) {
    push({
      type: 'trailing',
      side: 'low',
      price: engine.trailing.bottom,
      label: trailingLabel(engine, 'low'),
      confirmedTime: engine.trailing.lastBottomTime,
      confirmedIndex: engine.swing.low.barIndex,
    });
  }

  if (engine.swing.high.currentLevel != null) {
    push({
      type: 'swing',
      side: 'high',
      price: engine.swing.high.currentLevel,
      confirmedTime: engine.swing.high.barTime,
      confirmedIndex: engine.swing.high.barIndex,
    });
  }
  if (engine.swing.low.currentLevel != null) {
    push({
      type: 'swing',
      side: 'low',
      price: engine.swing.low.currentLevel,
      confirmedTime: engine.swing.low.barTime,
      confirmedIndex: engine.swing.low.barIndex,
    });
  }

  if (engine.internal.high.currentLevel != null) {
    push({
      type: 'internal',
      side: 'high',
      price: engine.internal.high.currentLevel,
      confirmedTime: engine.internal.high.barTime,
      confirmedIndex: engine.internal.high.barIndex,
    });
  }
  if (engine.internal.low.currentLevel != null) {
    push({
      type: 'internal',
      side: 'low',
      price: engine.internal.low.currentLevel,
      confirmedTime: engine.internal.low.barTime,
      confirmedIndex: engine.internal.low.barIndex,
    });
  }

  for (const side of ['high', 'low']) {
    const equal = latestEqual(engine, side);
    if (equal) {
      push({
        type: 'equal',
        side,
        price: equal.toPrice,
        confirmedTime: equal.toTime,
      });
    }
  }

  for (const [type, blocks] of [
    ['ob-internal', engine.internalOrderBlocks],
    ['ob-swing', engine.swingOrderBlocks],
  ]) {
    for (const block of blocks || []) {
      push({
        type,
        side: block.bias === BEARISH ? 'high' : 'low',
        price: (block.barHigh + block.barLow) / 2,
        top: block.barHigh,
        bottom: block.barLow,
        confirmedTime: block.confirmedTime ?? block.barTime,
        confirmedIndex: block.confirmedIndex,
      });
    }
  }

  return dedupeLevels(candidates, atr);
}

function dedupeLevels(levels, atr) {
  const tolerance = Math.max(0.0001, Number(atr) * 0.1);
  const sorted = [...levels].sort(
    (a, b) =>
      (TYPE_PRIORITY[a.type] ?? 99) - (TYPE_PRIORITY[b.type] ?? 99) ||
      a.price - b.price,
  );

  const kept = [];
  for (const level of sorted) {
    const duplicate = kept.find(
      (item) =>
        item.side === level.side && Math.abs(item.price - level.price) <= tolerance,
    );
    if (duplicate) {
      if (level.top != null && duplicate.top == null) {
        duplicate.top = level.top;
        duplicate.bottom = level.bottom;
      }
      continue;
    }
    kept.push(level);
  }

  return kept;
}

export function levelTypeLabel(type, side) {
  return TYPE_LABELS[type]?.[side] || type;
}
