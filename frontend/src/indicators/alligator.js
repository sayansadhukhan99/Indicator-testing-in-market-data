// Williams Alligator: three SMMAs of the median price, shifted into the future.

export const ALLIGATOR_DEFAULTS = {
  jawLength: 13,
  jawOffset: 8,
  teethLength: 8,
  teethOffset: 5,
  lipsLength: 5,
  lipsOffset: 3,
};

/**
 * Smoothed moving average (Wilder/RMA): seeded with the SMA of the first
 * `length` values, then `(previous * (length - 1) + value) / length`.
 */
export function smmaSeries(values, length) {
  const n = values.length;
  const out = new Array(n).fill(null);
  if (length <= 0 || n < length) {
    return out;
  }

  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += Number(values[i]);
  }

  let previous = sum / length;
  out[length - 1] = previous;
  for (let i = length; i < n; i += 1) {
    previous = (previous * (length - 1) + Number(values[i])) / length;
    out[i] = previous;
  }
  return out;
}

export function shiftRight(values, offset) {
  if (offset <= 0) {
    return values.slice();
  }
  return values.map((value, index) =>
    index >= offset ? values[index - offset] : null,
  );
}

export function alligatorSeries(bars, options = {}) {
  const config = { ...ALLIGATOR_DEFAULTS, ...options };
  const median = bars.map((bar) => (bar.high + bar.low) / 2);

  return {
    jaw: shiftRight(
      smmaSeries(median, config.jawLength),
      config.jawOffset,
    ),
    teeth: shiftRight(
      smmaSeries(median, config.teethLength),
      config.teethOffset,
    ),
    lips: shiftRight(
      smmaSeries(median, config.lipsLength),
      config.lipsOffset,
    ),
  };
}
