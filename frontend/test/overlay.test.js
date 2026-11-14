import { describe, expect, it } from 'vitest';
import { LineStyle } from 'lightweight-charts';
import { LevelOverlay } from '../src/drawings/overlay.js';
import {
  LEVEL_SEED_KEY,
  LEVEL_STORAGE_KEY,
  defaultLevelsFor,
} from '../src/drawings/levels.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

function fakeSeries() {
  const lines = [];
  return {
    lines,
    createPriceLine(options) {
      const line = {
        options: { ...options },
        applyOptions(patch) {
          Object.assign(this.options, patch);
        },
      };
      lines.push(line);
      return line;
    },
    removePriceLine(line) {
      const index = lines.indexOf(line);
      if (index >= 0) {
        lines.splice(index, 1);
      }
    },
    priceToCoordinate(price) {
      return price;
    },
  };
}

describe('LevelOverlay', () => {
  it('adds, renders and persists levels for the active symbol', () => {
    const storage = memoryStorage();
    const series = fakeSeries();
    const overlay = new LevelOverlay({ series, storage });

    overlay.setSymbol('TEST:SYMBOL');
    const level = overlay.addAtPrice(24_500);

    expect(level.price).toBe(24_500);
    expect(series.lines).toHaveLength(1);
    expect(series.lines[0].options.price).toBe(24_500);
    expect(series.lines[0].options.title).toBe('L1');
    expect(JSON.parse(storage.getItem(LEVEL_STORAGE_KEY))['TEST:SYMBOL']).toHaveLength(1);
  });

  it('seeds the Nifty levels once and keeps them after clearing', () => {
    const storage = memoryStorage();
    const series = fakeSeries();
    const overlay = new LevelOverlay({ series, storage });

    overlay.setSymbol('NSE:NIFTY50-INDEX');
    expect(series.lines).toHaveLength(32);
    expect(storage.getItem(LEVEL_SEED_KEY)).toBe('1');
    expect(
      JSON.parse(storage.getItem(LEVEL_STORAGE_KEY))['NSE:NIFTY50-INDEX'],
    ).toHaveLength(32);

    overlay.clear();
    expect(overlay.getLevels()).toEqual([]);

    const again = new LevelOverlay({ series: fakeSeries(), storage });
    again.setSymbol('NSE:NIFTY50-INDEX');
    expect(again.getLevels()).toEqual([]);
  });

  it('replaces old seeded levels and keeps custom Nifty levels', () => {
    const storage = memoryStorage({
      [LEVEL_STORAGE_KEY]: JSON.stringify({
        'NSE:NIFTY50-INDEX': [
          { id: 'seed-1', price: 1, color: '#3179f5' },
          { price: 25_000, color: '#3179f5' },
        ],
      }),
    });
    const overlay = new LevelOverlay({ series: fakeSeries(), storage });

    overlay.setSymbol('NSE:NIFTY50-INDEX');
    expect(overlay.getLevels()).toHaveLength(33);
    expect(overlay.getLevels().some((level) => level.price === 25_000)).toBe(true);
    expect(
      overlay.getLevels().find((level) => level.id === 'seed-1').price,
    ).toBe(26_205.9);
  });

  it('undoes and redoes level changes', () => {
    const overlay = new LevelOverlay({
      series: fakeSeries(),
      storage: memoryStorage(),
    });
    overlay.setSymbol('TEST:SYMBOL');

    overlay.addAtPrice(100);
    overlay.addAtPrice(200);
    expect(overlay.undo()).toBe(true);
    expect(overlay.getLevels().map((level) => level.price)).toEqual([100]);
    expect(overlay.undo()).toBe(true);
    expect(overlay.getLevels()).toEqual([]);
    expect(overlay.redo()).toBe(true);
    expect(overlay.getLevels().map((level) => level.price)).toEqual([100]);
  });

  it('records a drag as a single undoable change', () => {
    const storage = memoryStorage();
    const overlay = new LevelOverlay({ series: fakeSeries(), storage });
    overlay.setSymbol('TEST:SYMBOL');
    const level = overlay.addAtPrice(100);

    overlay.beginTransaction();
    overlay.moveTo(level.id, 150, { persist: false });
    overlay.moveTo(level.id, 175, { persist: false });
    overlay.endTransaction();

    expect(overlay.getLevels()[0].price).toBe(175);
    expect(JSON.parse(storage.getItem(LEVEL_STORAGE_KEY))['TEST:SYMBOL'][0].price).toBe(175);

    overlay.undo();
    expect(overlay.getLevels()[0].price).toBe(100);
    expect(JSON.parse(storage.getItem(LEVEL_STORAGE_KEY))['TEST:SYMBOL'][0].price).toBe(100);
  });

  it('updates color and line style and allows duplicate colors', () => {
    const storage = memoryStorage();
    const series = fakeSeries();
    const overlay = new LevelOverlay({ series, storage });
    overlay.setSymbol('TEST:SYMBOL');

    const first = overlay.addAtPrice(100);
    const second = overlay.addAtPrice(200);
    overlay.update(second.id, { color: first.color, lineStyle: 'dotted' });

    expect(series.lines[1].options.color).toBe(series.lines[0].options.color);
    expect(series.lines[1].options.lineStyle).toBe(LineStyle.Dotted);
    expect(JSON.parse(storage.getItem(LEVEL_STORAGE_KEY))['TEST:SYMBOL'][1]).toMatchObject({
      color: first.color,
      lineStyle: 'dotted',
    });
  });

  it('keeps the seeded defaults available in the level factory', () => {
    expect(defaultLevelsFor('NSE:NIFTY50-INDEX')).toHaveLength(32);
  });

  it('restores levels when the same symbol is selected again', () => {
    const storage = memoryStorage();
    const first = new LevelOverlay({ series: fakeSeries(), storage });
    first.setSymbol('A');
    first.addAtPrice(100);
    first.addAtPrice(200);

    const series = fakeSeries();
    const second = new LevelOverlay({ series, storage });
    second.setSymbol('B');
    expect(series.lines).toHaveLength(0);

    second.setSymbol('A');
    expect(series.lines).toHaveLength(2);
    expect(second.getLevels().map((level) => level.price)).toEqual([100, 200]);
  });

  it('moves, removes and clears levels', () => {
    const storage = memoryStorage();
    const series = fakeSeries();
    const overlay = new LevelOverlay({ series, storage });
    overlay.setSymbol('A');

    const level = overlay.addAtPrice(100);
    overlay.moveTo(level.id, 150, { persist: false });
    expect(series.lines[0].options.price).toBe(150);
    expect(JSON.parse(storage.getItem(LEVEL_STORAGE_KEY)).A[0].price).toBe(100);

    overlay.moveTo(level.id, 175);
    expect(JSON.parse(storage.getItem(LEVEL_STORAGE_KEY)).A[0].price).toBe(175);

    overlay.remove(level.id);
    expect(series.lines).toHaveLength(0);
    expect(storage.getItem(LEVEL_STORAGE_KEY)).toBe('{}');

    overlay.addAtPrice(200);
    overlay.clear();
    expect(overlay.getLevels()).toEqual([]);
    expect(storage.getItem(LEVEL_STORAGE_KEY)).toBe('{}');
  });

  it('finds the nearest level within the pixel tolerance', () => {
    const overlay = new LevelOverlay({ series: fakeSeries(), storage: memoryStorage() });
    overlay.setSymbol('A');
    const first = overlay.addAtPrice(100);
    const second = overlay.addAtPrice(200);

    expect(overlay.nearestAtY(104).id).toBe(first.id);
    expect(overlay.nearestAtY(198).id).toBe(second.id);
    expect(overlay.nearestAtY(150)).toBeNull();
  });
});
