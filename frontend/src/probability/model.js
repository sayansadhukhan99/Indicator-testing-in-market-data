import { BEARISH, DEFAULT_CONFIG } from '../smc/config.js';
import { SMCEngine } from '../smc/engine.js';
import { timeKey } from '../range.js';

const CALIBRATION_CONFIG = {
  showInternals: true,
  showSwing: true,
  showSwings: false,
  showHighLowSwings: false,
  showEqualHighLows: true,
  showInternalOrderBlocks: true,
  showSwingOrderBlocks: true,
};

const DEFAULT_ATR_FRACTION = 0.002;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function atrAt(engine, index) {
  const value = engine.atr?.[index];
  if (value != null && Number.isFinite(value) && value > 0) {
    return value;
  }
  const price = engine.bars?.[index]?.close ?? 1;
  return Math.max(0.0001, price * DEFAULT_ATR_FRACTION);
}

function bucketType(type) {
  return type === 'trailing' ? 'swing' : type;
}

/**
 * Classify the first touch of a horizontal level as breakout or reversal.
 * Returns null for ambiguous/chop outcomes so they do not bias the rates.
 */
function classifyLevel(bars, level, touchIndex, horizon, config, atr) {
  const tol = config.probabilityTouchAtr * atr;
  const buffer = config.probabilityBreakAtr * atr;
  const target = config.probabilityTargetAtr * atr;
  const end = Math.min(bars.length - 1, touchIndex + horizon);

  if (level.type.startsWith('ob-')) {
    const isBearish = level.side === 'high';
    for (let i = touchIndex + 1; i <= end; i += 1) {
      const bar = bars[i];
      const broke = isBearish
        ? bar.close > level.top + buffer
        : bar.close < level.bottom - buffer;
      const rejected = isBearish
        ? bar.low <= level.bottom - target
        : bar.high >= level.top + target;

      if (broke && rejected) return null;
      if (broke) return { outcome: 'break', outcomeTime: bar.time, outcomeIndex: i };
      if (rejected) return { outcome: 'reject', outcomeTime: bar.time, outcomeIndex: i };
    }
    return null;
  }

  const isHigh = level.side === 'high';
  for (let i = touchIndex + 1; i <= end; i += 1) {
    const bar = bars[i];
    const broke = isHigh
      ? bar.close > level.price + buffer
      : bar.close < level.price - buffer;
    const rejected = isHigh
      ? bar.low <= level.price - target
      : bar.high >= level.price + target;

    if (broke && rejected) return null;
    if (broke) return { outcome: 'break', outcomeTime: bar.time, outcomeIndex: i };
    if (rejected) return { outcome: 'reject', outcomeTime: bar.time, outcomeIndex: i };
  }
  return null;
}

function firstTouchIndex(bars, level, config, atr) {
  const start = (level.confirmedIndex ?? -1) + 1;
  if (start <= 0 || start >= bars.length) {
    return -1;
  }

  const tol = config.probabilityTouchAtr * atr;
  const buffer = config.probabilityBreakAtr * atr;
  const isZone = level.type.startsWith('ob-');
  const end = level.removedIndex != null ? Math.min(level.removedIndex, bars.length - 1) : bars.length - 1;

  for (let i = start; i <= end; i += 1) {
    const bar = bars[i];

    if (isZone) {
      const touched = bar.low <= level.top + tol && bar.high >= level.bottom - tol;
      if (touched) {
        return i;
      }
      const alreadyBroken =
        level.side === 'high'
          ? bar.close > level.top + buffer
          : bar.close < level.bottom - buffer;
      if (alreadyBroken) {
        return -1;
      }
      continue;
    }

    const isHigh = level.side === 'high';
    const touched = isHigh ? bar.high >= level.price - tol : bar.low <= level.price + tol;
    if (touched) {
      return i;
    }
    const alreadyBroken = isHigh
      ? bar.close > level.price + buffer
      : bar.close < level.price - buffer;
    if (alreadyBroken) {
      return -1;
    }
  }

  return -1;
}

function levelFeatures(engine, level, touchIndex, context, config) {
  const alignmentInfo = context
    ? context.alignmentFor(level.side, engine.bars[touchIndex].time)
    : { alignment: 'neutral', alignmentScore: 0 };
  const age = Math.max(0, touchIndex - (level.confirmedIndex ?? touchIndex));
  return {
    alignment: alignmentInfo.alignment,
    alignmentScore: alignmentInfo.alignmentScore,
    typeBias: config.probabilityTypeBias?.[level.type] ?? 0,
    freshness: clamp(age / 100, 0, 1),
    momentum: engine.swingTrendSeries?.[touchIndex] ?? 0,
  };
}

function buildEvents(engine, config, context) {
  const events = [];
  const horizon = config.probabilityHorizon;
  const bars = engine.bars;
  const levels = [
    ...(engine.levelHistory || []),
    ...(engine.orderBlockHistory || []),
  ];

  for (const level of levels) {
    if (level.confirmedIndex == null || level.confirmedIndex >= bars.length - 1) {
      continue;
    }
    if (level.type.startsWith('ob-') && level.removedIndex != null && level.removedIndex <= level.confirmedIndex) {
      continue;
    }

    const touchIndex = firstTouchIndex(bars, level, config, atrAt(engine, level.confirmedIndex));
    if (touchIndex < 0) {
      continue;
    }

    const atr = atrAt(engine, touchIndex);
    const result = classifyLevel(bars, level, touchIndex, horizon, config, atr);
    if (!result) {
      continue;
    }

    events.push({
      type: bucketType(level.type),
      side: level.side,
      outcome: result.outcome,
      eventTime: bars[touchIndex].time,
      outcomeTime: result.outcomeTime,
      ...levelFeatures(engine, level, touchIndex, context, config),
    });
  }

  return events;
}

export function buildProbabilityModel({ calibrationBars, config = {}, context = null } = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config, ...CALIBRATION_CONFIG };
  const engine = new SMCEngine(merged);
  engine.run(calibrationBars || []);
  const events = buildEvents(engine, merged, context);
  return {
    events,
    config: merged,
    horizon: merged.probabilityHorizon,
    calibrationBars: calibrationBars || [],
  };
}

function countRates(events) {
  let breaks = 0;
  let rejects = 0;
  for (const event of events) {
    if (event.outcome === 'break') breaks += 1;
    else if (event.outcome === 'reject') rejects += 1;
  }
  const total = breaks + rejects;
  return { breaks, rejects, total, rate: total ? breaks / total : null };
}

function heuristicProbability({ alignmentScore, typeBias, freshness, momentum }, config) {
  const weights = config.probabilityHeuristic || {};
  const logit =
    (weights.alignment ?? 0.9) * alignmentScore +
    (weights.type ?? 0.35) * typeBias +
    (weights.freshness ?? 0.1) * freshness +
    (weights.momentum ?? 0.2) * momentum;
  return clamp(sigmoid(logit), 0.1, 0.9);
}

export function scoreLevels({
  levels = [],
  model,
  asOfTime,
  context = null,
  lastClose,
  atr,
  momentum = 0,
  currentIndex = null,
} = {}) {
  if (!model) {
    return [];
  }

  const config = model.config;
  const asOfKey = timeKey(asOfTime);
  const completed = model.events.filter(
    (event) => timeKey(event.outcomeTime) < asOfKey,
  );
  return levels.map((level) => {
    const alignmentInfo = context
      ? context.alignmentFor(level.side, asOfTime)
      : { alignment: 'neutral', alignmentScore: 0 };
    const type = bucketType(level.type);

    let pool = completed.filter(
      (event) =>
        event.type === type &&
        event.side === level.side &&
        event.alignment === alignmentInfo.alignment,
    );
    let usedAlignment = alignmentInfo.alignment;

    if (pool.length < 5) {
      const parent = completed.filter(
        (event) => event.type === type && event.side === level.side,
      );
      if (parent.length > pool.length) {
        pool = parent;
        usedAlignment = 'all';
      }
    }

    const counts = countRates(pool);
    const n = counts.total;
    const age =
      currentIndex != null && level.confirmedIndex != null
        ? Math.max(0, currentIndex - level.confirmedIndex)
        : 0;
    const heuristic = heuristicProbability(
      {
        alignmentScore: alignmentInfo.alignmentScore,
        typeBias: config.probabilityTypeBias?.[level.type] ?? 0,
        freshness: clamp(age / 100, 0, 1),
        momentum,
      },
      config,
    );

    const lambda = config.probabilityShrinkage ?? 20;
    const probability = n > 0 ? (counts.breaks + lambda * heuristic) / (n + lambda) : heuristic;
    const breakProbability = clamp(probability, 0.05, 0.95);
    const minSamples = config.probabilityMinSamples ?? 15;

    return {
      ...level,
      distanceAtr:
        lastClose != null && atr
          ? (level.price - lastClose) / atr
          : null,
      breakProbability,
      reversalProbability: 1 - breakProbability,
      sampleSize: n,
      confidence: n >= 40 ? 'high' : n >= minSamples ? 'medium' : 'low',
      method: n >= minSamples ? 'empirical' : n > 0 ? 'blended' : 'model',
      empiricalRate: counts.rate,
      heuristicRate: heuristic,
      htfAlignment: alignmentInfo.alignment,
      htfAlignmentScore: alignmentInfo.alignmentScore,
      htfUsed: usedAlignment,
      htf: alignmentInfo,
    };
  });
}
