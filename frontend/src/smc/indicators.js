// Ports of the handful of Pine built-ins used by the LuxAlgo SMC script.

export function trueRange(bars, index) {
  const bar = bars[index];
  if (index === 0) {
    return bar.high - bar.low;
  }
  const prevClose = bars[index - 1].close;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose),
  );
}

/**
 * Pine `ta.atr(length)`.
 * RMA of true range, seeded with the SMA of the first `length` values.
 * Returns null while the series is warming up.
 */
export function atrSeries(bars, length) {
  const n = bars.length;
  const out = new Array(n).fill(null);
  if (length <= 0 || n === 0) {
    return out;
  }

  const tr = new Array(n);
  for (let i = 0; i < n; i += 1) {
    tr[i] = trueRange(bars, i);
  }

  if (n < length) {
    return out;
  }

  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += tr[i];
  }

  let previous = sum / length;
  out[length - 1] = previous;
  for (let i = length; i < n; i += 1) {
    previous = (previous * (length - 1) + tr[i]) / length;
    out[i] = previous;
  }
  return out;
}

/** Pine `ta.cum(ta.tr) / bar_index`. */
export function cumulativeMeanRange(bars) {
  const n = bars.length;
  const out = new Array(n).fill(null);
  let cumulative = 0;
  for (let i = 0; i < n; i += 1) {
    cumulative += trueRange(bars, i);
    out[i] = i === 0 ? null : cumulative / i;
  }
  return out;
}

/** Pine `ta.highest(size)` evaluated at `end` (current bar included). */
export function highestHigh(bars, end, size) {
  const start = end - size + 1;
  if (start < 0) {
    return null;
  }
  let value = -Infinity;
  for (let i = start; i <= end; i += 1) {
    if (bars[i].high > value) {
      value = bars[i].high;
    }
  }
  return value;
}

/** Pine `ta.lowest(size)` evaluated at `end` (current bar included). */
export function lowestLow(bars, end, size) {
  const start = end - size + 1;
  if (start < 0) {
    return null;
  }
  let value = Infinity;
  for (let i = start; i <= end; i += 1) {
    if (bars[i].low < value) {
      value = bars[i].low;
    }
  }
  return value;
}

export function crossover(current, previous, level) {
  return previous <= level && current > level;
}

export function crossunder(current, previous, level) {
  return previous >= level && current < level;
}
