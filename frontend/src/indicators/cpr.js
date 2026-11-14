import { barDateKey } from '../range.js';

/**
 * Central Pivot Range levels for one HLC period.
 * Pivot = (H + L + C) / 3, BC = (H + L) / 2, TC = 2 * Pivot - BC.
 */
export function cprLevels(bar) {
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  if (![high, low, close].every(Number.isFinite)) {
    return null;
  }

  const pivot = (high + low + close) / 3;
  const bc = (high + low) / 2;
  const tc = 2 * pivot - bc;

  return {
    pivot,
    bc,
    tc,
    top: Math.max(tc, bc),
    bottom: Math.min(tc, bc),
  };
}

function sessionSummary(bars) {
  const sessions = new Map();

  for (const bar of bars) {
    const key = barDateKey(bar.time);
    const current = sessions.get(key);
    if (!current) {
      sessions.set(key, {
        key,
        fromTime: bar.time,
        toTime: bar.time,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
      continue;
    }
    current.toTime = bar.time;
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
  }

  return [...sessions.values()];
}

/**
 * CPR for every session after the first one, using the previous session's
 * high/low/close. The range is drawn from the first to the last bar of the
 * session it applies to.
 */
export function cprPeriods(bars) {
  const sessions = sessionSummary(bars || []);
  const periods = [];

  for (let i = 1; i < sessions.length; i += 1) {
    const levels = cprLevels(sessions[i - 1]);
    if (!levels) {
      continue;
    }
    periods.push({
      ...levels,
      fromTime: sessions[i].fromTime,
      toTime: sessions[i].toTime,
      periodKey: sessions[i].key,
    });
  }

  return periods;
}

export function latestCprPeriod(bars) {
  const periods = cprPeriods(bars);
  return periods.length ? periods[periods.length - 1] : null;
}
