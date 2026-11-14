import { describe, expect, it } from 'vitest';
import {
  LEVEL_COLORS,
  LEVEL_SEED_KEY,
  LEVEL_STORAGE_KEY,
  addLevel,
  defaultLevelsFor,
  isLevelStoreSeeded,
  loadLevelStore,
  markLevelStoreSeeded,
  normalizeLevel,
  normalizeLevels,
  removeLevel,
  saveLevelStore,
  updateLevel,
} from '../src/drawings/levels.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

describe('level store', () => {
  it('normalizes invalid entries and keeps valid prices', () => {
    expect(normalizeLevel(null)).toBeNull();
    expect(normalizeLevel({ price: 'nope' })).toBeNull();
    expect(normalizeLevel({ price: 24_500 })).toMatchObject({
      price: 24_500,
      color: LEVEL_COLORS[0],
      lineStyle: 'solid',
    });
    expect(normalizeLevels([{ price: 1 }, { price: null }, null])).toHaveLength(1);
  });

  it('only allows blue and yellow colors', () => {
    expect(LEVEL_COLORS).toEqual(['#3179f5', '#eab308']);
    expect(normalizeLevel({ price: 1, color: '#f23645' }).color).toBe('#3179f5');
    expect(normalizeLevel({ price: 1, color: '#eab308' }).color).toBe('#eab308');
    expect(normalizeLevel({ price: 1, lineStyle: 'dashed' }).lineStyle).toBe('solid');
  });

  it('adds levels with cycling colors and sequential labels', () => {
    const first = addLevel([], { price: 100 });
    expect(first[0].title).toBe('L1');
    expect(first[0].color).toBe(LEVEL_COLORS[0]);

    const second = addLevel(first, { price: 200 });
    expect(second[1].title).toBe('L2');
    expect(second[1].color).toBe(LEVEL_COLORS[1]);

    const renamed = updateLevel(second, second[1].id, { title: 'Resistance' });
    const third = addLevel(renamed, { price: 300 });
    expect(third[2].title).toBe('L3');
  });

  it('allows two levels to share the same color and style', () => {
    const levels = addLevel(addLevel([], { price: 100 }), { price: 200 });
    const same = updateLevel(levels, levels[1].id, {
      color: levels[0].color,
      lineStyle: 'dotted',
    });
    expect(same[0].color).toBe(same[1].color);
    expect(same[1].lineStyle).toBe('dotted');
  });

  it('removes and updates levels by id', () => {
    const levels = addLevel(addLevel([], { price: 100 }), { price: 200 });
    const removed = removeLevel(levels, levels[0].id);
    expect(removed).toHaveLength(1);
    expect(removed[0].price).toBe(200);

    const moved = updateLevel(levels, levels[0].id, { price: 150 });
    expect(moved.find((level) => level.id === levels[0].id).price).toBe(150);
  });

  it('round-trips per-symbol levels through storage', () => {
    const storage = memoryStorage();
    const store = {
      'NSE:NIFTY50-INDEX': [{ price: 24_500, title: 'Support' }],
    };

    expect(saveLevelStore(storage, store)).toBe(true);
    expect(storage.getItem(LEVEL_STORAGE_KEY)).toContain('NSE:NIFTY50-INDEX');

    const loaded = loadLevelStore(storage);
    expect(loaded['NSE:NIFTY50-INDEX']).toHaveLength(1);
    expect(loaded['NSE:NIFTY50-INDEX'][0].price).toBe(24_500);
  });

  it('provides the seeded Nifty level set with blue and yellow colors', () => {
    const levels = defaultLevelsFor('NSE:NIFTY50-INDEX');
    expect(levels).toHaveLength(32);
    expect(new Set(levels.map((level) => level.color))).toEqual(
      new Set(['#3179f5', '#eab308']),
    );
    expect(levels[0]).toMatchObject({ price: 26_205.9, title: 'L1' });
    expect(defaultLevelsFor('OTHER')).toEqual([]);
  });

  it('tracks whether the default levels have already been seeded', () => {
    const storage = memoryStorage();
    expect(isLevelStoreSeeded(storage)).toBe(false);
    expect(markLevelStoreSeeded(storage)).toBe(true);
    expect(storage.getItem(LEVEL_SEED_KEY)).toBe('1');
    expect(isLevelStoreSeeded(storage)).toBe(true);
  });

  it('ignores malformed storage payloads', () => {
    expect(loadLevelStore(memoryStorage())).toEqual({});
    expect(loadLevelStore(memoryStorage({ [LEVEL_STORAGE_KEY]: 'not json' }))).toEqual({});
    expect(
      loadLevelStore(memoryStorage({ [LEVEL_STORAGE_KEY]: JSON.stringify({ A: [{ price: 'x' }] }) })),
    ).toEqual({});
  });
});
