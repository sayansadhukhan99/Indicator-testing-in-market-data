import { BEARISH, BULLISH } from './smc/config.js';

const IST_OFFSET_SECONDS = 19800;

export function timeKey(time) {
  if (typeof time === 'number') {
    return time;
  }
  if (time == null) {
    return Number.NaN;
  }
  if (typeof time === 'object' && time.year) {
    return Date.UTC(time.year, time.month - 1, time.day) / 1000;
  }
  const [year, month, day] = String(time).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 1000;
}

export function istBusinessDay(epochSeconds) {
  return new Date((Number(epochSeconds) + IST_OFFSET_SECONDS) * 1000)
    .toISOString()
    .slice(0, 10);
}

export function barDateKey(time) {
  return typeof time === 'number' ? istBusinessDay(time) : String(time);
}

export function shiftIsoDate(isoDate, days) {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function warmupDaysFor(resolution) {
  if (resolution === 'D') {
    return 400;
  }
  const minutes = Number(resolution);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 30;
  }
  const barsPerDay = 375 / minutes;
  const tradingDays = Math.ceil(250 / barsPerDay) + 5;
  return Math.ceil((tradingDays * 7) / 5) + 5;
}

export function sliceBarsToRange(bars, from, to) {
  return (bars || []).filter((bar) => {
    const day = barDateKey(bar.time);
    return day >= from && day <= to;
  });
}

/**
 * Locate the first and last bar inside the requested range. Returns absolute
 * indices so replay can grow a slice from the start of the range.
 */
export function rangeIndices(bars, from, to) {
  let startIndex = -1;
  let endIndex = -1;

  (bars || []).forEach((bar, index) => {
    const day = barDateKey(bar.time);
    if (day >= from && day <= to) {
      if (startIndex === -1) startIndex = index;
      endIndex = index;
    }
  });

  if (startIndex === -1) {
    return null;
  }

  return {
    startIndex,
    endIndex,
    fromTime: bars[startIndex].time,
    toTime: bars[endIndex].time,
  };
}

/**
 * Keep only drawables that overlap the requested range, clamping lines and
 * boxes that started in the hidden warmup window. Right-edge labels are kept.
 */
export function clipDrawables(drawables, fromTime, toTime) {
  if (fromTime == null || toTime == null) {
    return [];
  }
  const start = timeKey(fromTime);
  const end = timeKey(toTime);
  const clipped = [];

  for (const drawable of drawables || []) {
    if (drawable.kind === 'text') {
      if (drawable.xRight || drawable.time == null) {
        clipped.push(drawable);
        continue;
      }
      const time = timeKey(drawable.time);
      if (time >= start && time <= end) {
        clipped.push(drawable);
      }
      continue;
    }

    const from = timeKey(drawable.fromTime);
    if (from > end) {
      continue;
    }
    const to = drawable.toTime == null ? Number.POSITIVE_INFINITY : timeKey(drawable.toTime);
    if (to < start) {
      continue;
    }

    if (from < start || (drawable.toTime != null && to > end)) {
      clipped.push({
        ...drawable,
        fromTime: from < start ? fromTime : drawable.fromTime,
        toTime:
          drawable.toTime == null
            ? null
            : to > end
              ? toTime
              : drawable.toTime,
      });
    } else {
      clipped.push(drawable);
    }
  }

  return clipped;
}

/**
 * Summarise what the indicator detected inside the visible date range.
 * `engine.bars` includes the hidden warmup window, so the caller passes the
 * number of visible bars explicitly.
 */
export function buildAnalysis(engine, fromTime, toTime, visibleBars) {
  const start = timeKey(fromTime);
  const end = timeKey(toTime);
  const inRange = (time) => {
    if (time == null) return false;
    const key = timeKey(time);
    return key >= start && key <= end;
  };

  const structures = engine.structures.filter((item) => inRange(item.toTime));
  const count = (predicate) => structures.filter(predicate).length;
  const equalDisplays = engine.equalDisplays.filter((item) => inRange(item.toTime));
  const swingPoints = engine.swingPoints.filter((item) => inRange(item.time));
  const alerts = engine.alerts.filter((item) => inRange(item.time));

  return {
    bars: visibleBars ?? engine.bars.length,
    swingTrend: engine.swingTrend,
    internalTrend: engine.internalTrend,
    swingHigh: engine.swing.high.currentLevel,
    swingLow: engine.swing.low.currentLevel,
    internalHigh: engine.internal.high.currentLevel,
    internalLow: engine.internal.low.currentLevel,
    structures: {
      total: structures.length,
      bullish: count((item) => item.bias === BULLISH),
      bearish: count((item) => item.bias === BEARISH),
      breaker: count((item) => item.tag === 'Breaker'),
      trap: count((item) => item.tag === 'Trap'),
    },
    internalOrderBlocks: engine.internalOrderBlocks.length,
    swingOrderBlocks: engine.swingOrderBlocks.length,
    equalDisplays: equalDisplays.length,
    swingPoints: swingPoints.length,
    alerts: alerts.slice(-12).reverse(),
  };
}
