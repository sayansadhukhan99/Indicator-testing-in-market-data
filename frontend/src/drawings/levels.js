export const LEVEL_COLOR_OPTIONS = [
  { value: '#3179f5', label: 'Blue' },
  { value: '#eab308', label: 'Yellow' },
];

export const LEVEL_COLORS = LEVEL_COLOR_OPTIONS.map((option) => option.value);

export const LEVEL_LINE_STYLE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'dotted', label: 'Dotted' },
];

export const DEFAULT_LEVEL_LINE_STYLE = 'solid';

export const LEVEL_STORAGE_KEY = 'smc.levels.v1';
export const LEVEL_SEED_KEY = 'smc.levels.seeded.v3';

const BLUE = LEVEL_COLORS[0];
const YELLOW = LEVEL_COLORS[1];

const DEFAULT_LEVEL_ROWS = {
  'NSE:NIFTY50-INDEX': [
    [26_205.9, BLUE],
    [26_086.45, BLUE],
    [25_916.75, BLUE],
    [25_648.35, BLUE],
    [25_378.4, BLUE],
    [25_200.0, BLUE],
    [25_044.65, YELLOW],
    [24_861.8, BLUE],
    [24_678.2, BLUE],
    [24_568.8, BLUE],
    [24_452.0, BLUE],
    [24_223.55, BLUE],
    [24_169.8, BLUE],
    [24_074.15, BLUE],
    [24_006.0, BLUE],
    [23_917.7, BLUE],
    [23_821.35, YELLOW],
    [23_630.6, YELLOW],
    [23_530.5, YELLOW],
    [23_468.95, YELLOW],
    [23_361.5, BLUE],
    [23_305.2, BLUE],
    [23_215.15, YELLOW],
    [23_155.3, YELLOW],
    [23_048.05, YELLOW],
    [22_987.6, YELLOW],
    [22_850.0, YELLOW],
    [22_763.75, YELLOW],
    [22_579.75, YELLOW],
    [22_477.55, YELLOW],
    [22_402.7, YELLOW],
    [22_209.5, BLUE],
  ],
};

let idCounter = 0;

function makeId() {
  idCounter += 1;
  return `lvl-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function normalizeLevelColor(color) {
  return String(color || '').toLowerCase() === YELLOW ? YELLOW : BLUE;
}

export function normalizeLineStyle(style) {
  return style === 'dotted' ? 'dotted' : DEFAULT_LEVEL_LINE_STYLE;
}

export function normalizeLevel(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  if (
    raw.price == null ||
    raw.price === '' ||
    typeof raw.price === 'boolean'
  ) {
    return null;
  }
  const price = Number(raw.price);
  if (!Number.isFinite(price)) {
    return null;
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    price,
    color: normalizeLevelColor(raw.color),
    lineStyle: normalizeLineStyle(raw.lineStyle),
    title: typeof raw.title === 'string' ? raw.title : '',
  };
}

export function normalizeLevels(levels) {
  return (Array.isArray(levels) ? levels : [])
    .map(normalizeLevel)
    .filter(Boolean);
}

export function nextLevelNumber(levels) {
  let highest = 0;
  for (const level of levels) {
    const match = /^L(\d+)$/.exec(level.title || '');
    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return Math.max(highest, levels.length) + 1;
}

export function addLevel(
  levels,
  { price, color, lineStyle, title } = {},
) {
  const clean = normalizeLevels(levels);
  const nextColor = normalizeLevelColor(
    color || LEVEL_COLORS[clean.length % LEVEL_COLORS.length],
  );
  const nextTitle = title || `L${nextLevelNumber(clean)}`;
  const level = normalizeLevel({
    price,
    color: nextColor,
    lineStyle,
    title: nextTitle,
  });
  return level ? [...clean, level] : clean;
}

export function removeLevel(levels, id) {
  return normalizeLevels(levels).filter((level) => level.id !== id);
}

export function updateLevel(levels, id, patch = {}) {
  return normalizeLevels(levels)
    .map((level) =>
      level.id === id ? normalizeLevel({ ...level, ...patch }) : level,
    )
    .filter(Boolean);
}

export function defaultLevelsFor(symbol) {
  const rows = DEFAULT_LEVEL_ROWS[symbol];
  if (!rows) {
    return [];
  }
  return normalizeLevels(
    rows.map(([price, color], index) => ({
      id: `seed-${index + 1}`,
      price,
      color,
      lineStyle: DEFAULT_LEVEL_LINE_STYLE,
      title: `L${index + 1}`,
    })),
  );
}

export function isLevelStoreSeeded(storage) {
  try {
    return Boolean(storage?.getItem?.(LEVEL_SEED_KEY));
  } catch {
    return false;
  }
}

export function markLevelStoreSeeded(storage) {
  try {
    storage?.setItem?.(LEVEL_SEED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function loadLevelStore(storage) {
  try {
    const raw = storage?.getItem(LEVEL_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const store = {};
    for (const [symbol, levels] of Object.entries(parsed)) {
      const clean = normalizeLevels(levels);
      if (clean.length) {
        store[symbol] = clean;
      }
    }
    return store;
  } catch {
    return {};
  }
}

export function saveLevelStore(storage, store) {
  try {
    storage?.setItem(LEVEL_STORAGE_KEY, JSON.stringify(store || {}));
    return true;
  } catch {
    return false;
  }
}
