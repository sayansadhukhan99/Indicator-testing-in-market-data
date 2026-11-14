import { LineStyle } from 'lightweight-charts';
import {
  addLevel,
  defaultLevelsFor,
  isLevelStoreSeeded,
  loadLevelStore,
  markLevelStoreSeeded,
  normalizeLevels,
  removeLevel,
  saveLevelStore,
  updateLevel,
} from './levels.js';

const MAX_HISTORY = 100;

function lineStyleValue(style) {
  return style === 'dotted' ? LineStyle.Dotted : LineStyle.Solid;
}

function priceLineOptions(level) {
  return {
    price: level.price,
    color: level.color,
    lineWidth: 1,
    lineStyle: lineStyleValue(level.lineStyle),
    axisLabelVisible: true,
    title: level.title || 'Level',
  };
}

function sameLevels(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Renders user-drawn horizontal price levels with the chart's native price
 * lines and keeps them in localStorage, grouped by symbol.
 */
export class LevelOverlay {
  constructor({ series, storage = globalThis.localStorage, onChange = null } = {}) {
    this.series = series;
    this.storage = storage;
    this.onChange = onChange;
    this.store = loadLevelStore(storage);
    this.symbol = '';
    this.levels = [];
    this.lines = new Map();
    this.history = [];
    this.future = [];
    this.transactionStart = null;
  }

  setSymbol(symbol) {
    const next = String(symbol || '');
    if (next === this.symbol) {
      return;
    }
    this.symbol = next;
    this.levels = normalizeLevels(this.store[this.symbol] || []);
    this.history = [];
    this.future = [];
    this.transactionStart = null;
    this.seedDefaultsIfNeeded();
    this.render();
    this.emit();
  }

  seedDefaultsIfNeeded() {
    const defaults = defaultLevelsFor(this.symbol);
    if (!defaults.length || isLevelStoreSeeded(this.storage)) {
      return;
    }
    const custom = this.levels.filter(
      (level) => !String(level.id || '').startsWith('seed-'),
    );
    const customPrices = new Set(
      custom.map((level) => level.price.toFixed(4)),
    );
    const merged = [
      ...custom,
      ...defaults.filter(
        (level) => !customPrices.has(level.price.toFixed(4)),
      ),
    ].sort((a, b) => b.price - a.price);
    if (!sameLevels(merged, this.levels)) {
      this.levels = merged;
      this.persist();
    }
    markLevelStoreSeeded(this.storage);
  }

  snapshot() {
    return this.levels.map((level) => ({ ...level }));
  }

  recordHistory() {
    this.history.push(this.snapshot());
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.future = [];
  }

  beginTransaction() {
    if (!this.transactionStart) {
      this.transactionStart = this.snapshot();
    }
  }

  endTransaction({ persist = true } = {}) {
    if (!this.transactionStart) {
      return false;
    }
    const before = this.transactionStart;
    this.transactionStart = null;
    if (sameLevels(before, this.levels)) {
      return false;
    }
    this.history.push(before);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.future = [];
    if (persist) {
      this.persist();
    }
    return true;
  }

  undo() {
    if (!this.history.length) {
      return false;
    }
    this.future.push(this.snapshot());
    this.levels = this.history.pop();
    this.persist();
    this.render();
    this.emit();
    return true;
  }

  redo() {
    if (!this.future.length) {
      return false;
    }
    this.history.push(this.snapshot());
    this.levels = this.future.pop();
    this.persist();
    this.render();
    this.emit();
    return true;
  }

  getLevels() {
    return this.levels.slice();
  }

  addAtPrice(price) {
    const value = Number(price);
    if (!Number.isFinite(value)) {
      return null;
    }
    const before = this.levels.length;
    const next = addLevel(this.levels, { price: value });
    if (next.length === before) {
      return null;
    }
    this.recordHistory();
    this.levels = next;
    const added = this.levels[this.levels.length - 1];
    this.persist();
    this.render();
    this.emit();
    return added;
  }

  remove(id) {
    const next = removeLevel(this.levels, id);
    if (next.length === this.levels.length) {
      return;
    }
    this.recordHistory();
    this.levels = next;
    this.persist();
    this.render();
    this.emit();
  }

  clear() {
    if (this.levels.length === 0) {
      return;
    }
    this.recordHistory();
    this.levels = [];
    this.persist();
    this.render();
    this.emit();
  }

  update(id, patch = {}) {
    const next = updateLevel(this.levels, id, patch);
    const level = next.find((item) => item.id === id);
    if (!level) {
      return null;
    }
    if (sameLevels(next, this.levels)) {
      return level;
    }
    this.recordHistory();
    this.levels = next;
    const line = this.lines.get(id);
    if (line) {
      line.applyOptions(priceLineOptions(level));
    }
    this.persist();
    this.emit();
    return level;
  }

  moveTo(id, price, { persist = true } = {}) {
    const value = Number(price);
    if (!Number.isFinite(value)) {
      return;
    }
    const next = updateLevel(this.levels, id, { price: value });
    const level = next.find((item) => item.id === id);
    if (!level || sameLevels(next, this.levels)) {
      return;
    }
    if (persist && !this.transactionStart) {
      this.recordHistory();
    }
    this.levels = next;
    const line = this.lines.get(id);
    if (level && line) {
      line.applyOptions({ price: level.price });
    }
    if (persist) {
      this.persist();
    }
    this.emit();
  }

  nearestAtY(y, maxPixels = 8) {
    if (!this.series || y == null) {
      return null;
    }
    let best = null;
    let bestDistance = maxPixels;
    for (const level of this.levels) {
      const lineY = this.series.priceToCoordinate(level.price);
      if (lineY == null) {
        continue;
      }
      const distance = Math.abs(lineY - y);
      if (distance <= bestDistance) {
        best = level;
        bestDistance = distance;
      }
    }
    return best;
  }

  persist() {
    if (!this.symbol) {
      return;
    }
    if (this.levels.length) {
      this.store[this.symbol] = this.levels;
    } else {
      delete this.store[this.symbol];
    }
    saveLevelStore(this.storage, this.store);
  }

  render() {
    if (!this.series) {
      return;
    }
    for (const line of this.lines.values()) {
      this.series.removePriceLine(line);
    }
    this.lines.clear();

    for (const level of this.levels) {
      const line = this.series.createPriceLine(priceLineOptions(level));
      this.lines.set(level.id, line);
    }
  }

  emit() {
    this.onChange?.(this.getLevels());
  }
}
