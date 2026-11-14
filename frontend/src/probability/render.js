function percent(value) {
  return `${Math.round(value * 100)}%`;
}

/**
 * Right-edge probability badges. They are separate from the Pine-faithful
 * labels so the original structure/order-block tags stay intact.
 */
export function buildProbabilityDrawables(
  levels,
  { atr, lastClose, config = {}, show = true } = {},
) {
  if (!show || !levels?.length) {
    return [];
  }

  const maxAtr = config.probabilityLabelMaxAtr ?? 12;
  const drawables = [];

  for (const level of levels) {
    if (level.price == null || level.type === 'trailing') {
      continue;
    }
    const distance =
      lastClose != null && atr ? Math.abs(level.price - lastClose) / atr : 0;
    if (distance > maxAtr) {
      continue;
    }

    const isHigh = level.side === 'high';
    const prefix = level.type.startsWith('ob-') ? 'OB ' : '';
    drawables.push({
      kind: 'text',
      layer: 'top',
      time: null,
      xRight: true,
      price: level.price,
      text: `${prefix}${percent(level.breakProbability)} B · ${percent(level.reversalProbability)} R`,
      color: isHigh ? '#f23645' : '#089981',
      align: 'right',
      baseline: isHigh ? 'bottom' : 'top',
      offsetY: isHigh ? -22 : 22,
      fontSize: 10,
      weight: 600,
      background: 'rgba(11, 13, 18, 0.88)',
      border: 'rgba(255, 255, 255, 0.10)',
      paddingX: 5,
      paddingY: 3,
      radius: 4,
      probability: true,
    });
  }

  drawables.sort((a, b) => b.price - a.price);
  return drawables;
}

export function alignmentLabel(alignment) {
  if (alignment === 'aligned') return 'With HTF';
  if (alignment === 'opposed') return 'Against HTF';
  return 'Mixed HTF';
}

export function methodLabel(method) {
  if (method === 'empirical') return 'historical';
  if (method === 'blended') return 'blended';
  return 'model';
}

export function levelSideColor(side) {
  return side === 'high' ? '#f23645' : '#089981';
}
