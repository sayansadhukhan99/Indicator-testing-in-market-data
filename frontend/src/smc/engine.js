import {
  atrSeries,
  crossover,
  crossunder,
  cumulativeMeanRange,
  highestHigh,
  lowestLow,
} from './indicators.js';
import { BEARISH, BULLISH, COLORS, DEFAULT_CONFIG } from './config.js';

const FONT_SIZES = { tiny: 11, small: 12, normal: 13 };

class Pivot {
  constructor() {
    this.currentLevel = null;
    this.lastLevel = null;
    this.crossed = false;
    this.barTime = null;
    this.barIndex = null;
  }
}

class Tracker {
  constructor(size) {
    this.size = size;
    this.leg = 0;
    this.low = new Pivot();
    this.high = new Pivot();
  }
}

/**
 * Bar-by-bar port of the core LuxAlgo Smart Money Concepts logic
 * (structure, order blocks, equal highs/lows, weak/strong highs/lows).
 *
 * Kept close to the Pine implementation on purpose: state persists across the
 * replay and every branch mirrors the original `leg`, `getCurrentStructure`,
 * `displayStructure`, `storeOrdeBlock` and `deleteOrderBlocks` routines.
 */
export class SMCEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reset();
  }

  reset() {
    this.bars = [];
    this.swing = new Tracker(this.config.swingsLength);
    this.internal = new Tracker(this.config.internalLength);
    this.equal = new Tracker(this.config.equalHighsLowsLength);

    this.swingTrend = 0;
    this.internalTrend = 0;

    this.parsedHighs = [];
    this.parsedLows = [];
    this.highs = [];
    this.lows = [];
    this.times = [];

    this.trailing = {
      top: null,
      bottom: null,
      barTime: null,
      barIndex: null,
      lastTopTime: null,
      lastBottomTime: null,
    };

    this.swingOrderBlocks = [];
    this.internalOrderBlocks = [];

    this.structures = [];
    this.swingPoints = [];
    this.equalDisplays = [];
    this.alerts = [];

    this.atr = null;
    this.volatility = null;
  }

  run(bars) {
    this.reset();
    this.bars = bars;
    const n = bars.length;
    if (n === 0) {
      return this.buildDrawables();
    }

    this.atr = atrSeries(bars, 200);
    this.volatility =
      this.config.orderBlockFilter === 'Range' ? cumulativeMeanRange(bars) : this.atr;

    for (let i = 0; i < n; i += 1) {
      const bar = bars[i];
      const volatility = this.volatility[i];
      const highVolatilityBar =
        volatility != null && bar.high - bar.low >= 2 * volatility;

      this.parsedHighs.push(highVolatilityBar ? bar.low : bar.high);
      this.parsedLows.push(highVolatilityBar ? bar.high : bar.low);
      this.highs.push(bar.high);
      this.lows.push(bar.low);
      this.times.push(bar.time);

      if (this.config.showHighLowSwings || this.config.showPremiumDiscountZones) {
        this.updateTrailingExtremes(i);
      }

      this.getCurrentStructure(this.swing, i, false, false);
      this.getCurrentStructure(this.internal, i, false, true);

      if (this.config.showEqualHighLows) {
        this.getCurrentStructure(this.equal, i, true, false);
      }

      if (this.config.showInternals || this.config.showInternalOrderBlocks) {
        this.displayStructure(i, true);
      }
      if (
        this.config.showSwing ||
        this.config.showSwingOrderBlocks ||
        this.config.showHighLowSwings
      ) {
        this.displayStructure(i, false);
      }

      if (this.config.showInternalOrderBlocks) {
        this.deleteOrderBlocks(i, true);
      }
      if (this.config.showSwingOrderBlocks) {
        this.deleteOrderBlocks(i, false);
      }
    }

    return this.buildDrawables();
  }

  // ------------------------------------------------------------------ pivots
  getCurrentStructure(tracker, index, equalHighLow, internal) {
    const size = tracker.size;
    if (index < size) {
      return;
    }

    const pivotBar = this.bars[index - size];
    const highest = highestHigh(this.bars, index, size);
    const lowest = lowestLow(this.bars, index, size);

    const previousLeg = tracker.leg;
    let leg = tracker.leg;
    if (pivotBar.high > highest) {
      leg = 0; // BEARISH_LEG
    } else if (pivotBar.low < lowest) {
      leg = 1; // BULLISH_LEG
    }
    tracker.leg = leg;

    const change = leg - previousLeg;
    if (change === 0) {
      return;
    }

    const isNewLow = change === 1;
    const level = isNewLow ? pivotBar.low : pivotBar.high;
    const pivot = isNewLow ? tracker.low : tracker.high;
    const oldLevel = pivot.currentLevel;

    if (equalHighLow && oldLevel != null && this.atr[index] != null) {
      const threshold = this.config.equalHighsLowsThreshold * this.atr[index];
      if (Math.abs(oldLevel - level) < threshold) {
        this.emitEqualDisplay(pivot, oldLevel, level, index - size, isNewLow);
      }
    }

    pivot.lastLevel = oldLevel;
    pivot.currentLevel = level;
    pivot.crossed = false;
    pivot.barTime = pivotBar.time;
    pivot.barIndex = index - size;

    if (equalHighLow || internal) {
      return;
    }

    if (isNewLow) {
      this.trailing.bottom = level;
      this.trailing.barTime = pivotBar.time;
      this.trailing.barIndex = index - size;
      this.trailing.lastBottomTime = pivotBar.time;
    } else {
      this.trailing.top = level;
      this.trailing.barTime = pivotBar.time;
      this.trailing.barIndex = index - size;
      this.trailing.lastTopTime = pivotBar.time;
    }

    if (this.config.showSwings) {
      if (isNewLow) {
        const text = pivot.lastLevel != null && level < pivot.lastLevel ? 'LL' : 'HL';
        this.swingPoints.push({
          time: pivotBar.time,
          price: level,
          text,
          color: this.bullColor(false),
          position: 'below',
        });
      } else {
        const text = pivot.lastLevel != null && level > pivot.lastLevel ? 'HH' : 'LH';
        this.swingPoints.push({
          time: pivotBar.time,
          price: level,
          text,
          color: this.bearColor(false),
          position: 'above',
        });
      }
    }
  }

  emitEqualDisplay(pivot, oldLevel, newLevel, newIndex, isLow) {
    const oldIndex = pivot.barIndex;
    const labelIndex = Math.round(0.5 * (oldIndex + newIndex));
    this.equalDisplays.push({
      fromTime: pivot.barTime,
      fromPrice: oldLevel,
      toTime: this.bars[newIndex].time,
      toPrice: newLevel,
      labelTime: this.bars[Math.max(0, Math.min(this.bars.length - 1, labelIndex))].time,
      labelPrice: newLevel,
      text: isLow ? 'Same Low' : 'Same High',
      color: isLow ? this.bullColor(false) : this.bearColor(false),
      position: isLow ? 'below' : 'above',
    });
  }

  // -------------------------------------------------------------- structure
  displayStructure(index, internal) {
    const bar = this.bars[index];
    const previousClose = index > 0 ? this.bars[index - 1].close : bar.close;
    const tracker = internal ? this.internal : this.swing;

    let bullishBar = true;
    let bearishBar = true;
    if (internal && this.config.internalFilterConfluence) {
      bullishBar =
        bar.high - Math.max(bar.close, bar.open) > Math.min(bar.close, bar.open - bar.low);
      bearishBar =
        bar.high - Math.max(bar.close, bar.open) < Math.min(bar.close, bar.open - bar.low);
    }

    // Bullish break -------------------------------------------------------
    let pivot = tracker.high;
    let extraCondition = true;
    if (internal) {
      extraCondition =
        pivot.currentLevel != null &&
        this.swing.high.currentLevel != null &&
        pivot.currentLevel !== this.swing.high.currentLevel &&
        bullishBar;
    }

    if (
      pivot.currentLevel != null &&
      !pivot.crossed &&
      crossover(bar.close, previousClose, pivot.currentLevel) &&
      extraCondition
    ) {
      const tag = this.swingOrInternalTrend(internal) === BEARISH ? 'Trap' : 'Breaker';
      pivot.crossed = true;
      if (internal) {
        this.internalTrend = BULLISH;
      } else {
        this.swingTrend = BULLISH;
      }
      this.alerts.push({ side: BULLISH, internal, tag, time: bar.time });

      const filter = internal
        ? this.config.internalBullishStructure
        : this.config.swingBullishStructure;
      const visible = internal ? this.config.showInternals : this.config.showSwing;
      if (visible && (filter === 'All' || filter === tag)) {
        this.structures.push(
          this.makeStructure(index, pivot, tag, BULLISH, internal, 'above'),
        );
      }

      if (
        internal
          ? this.config.showInternalOrderBlocks
          : this.config.showSwingOrderBlocks
      ) {
        this.storeOrderBlock(index, pivot, internal, BULLISH);
      }
    }

    // Bearish break -------------------------------------------------------
    pivot = tracker.low;
    extraCondition = true;
    if (internal) {
      extraCondition =
        pivot.currentLevel != null &&
        this.swing.low.currentLevel != null &&
        pivot.currentLevel !== this.swing.low.currentLevel &&
        bearishBar;
    }

    if (
      pivot.currentLevel != null &&
      !pivot.crossed &&
      crossunder(bar.close, previousClose, pivot.currentLevel) &&
      extraCondition
    ) {
      const tag = this.swingOrInternalTrend(internal) === BULLISH ? 'Trap' : 'Breaker';
      pivot.crossed = true;
      if (internal) {
        this.internalTrend = BEARISH;
      } else {
        this.swingTrend = BEARISH;
      }
      this.alerts.push({ side: BEARISH, internal, tag, time: bar.time });

      const filter = internal
        ? this.config.internalBearishStructure
        : this.config.swingBearishStructure;
      const visible = internal ? this.config.showInternals : this.config.showSwing;
      if (visible && (filter === 'All' || filter === tag)) {
        this.structures.push(
          this.makeStructure(index, pivot, tag, BEARISH, internal, 'below'),
        );
      }

      if (
        internal
          ? this.config.showInternalOrderBlocks
          : this.config.showSwingOrderBlocks
      ) {
        this.storeOrderBlock(index, pivot, internal, BEARISH);
      }
    }
  }

  swingOrInternalTrend(internal) {
    return internal ? this.internalTrend : this.swingTrend;
  }

  makeStructure(index, pivot, tag, bias, internal, position) {
    return {
      internal,
      bias,
      tag,
      color: bias === BULLISH ? this.bullColor(internal) : this.bearColor(internal),
      fromTime: pivot.barTime,
      fromIndex: pivot.barIndex,
      toTime: this.bars[index].time,
      toIndex: index,
      labelTime:
        this.bars[Math.round(0.5 * (pivot.barIndex + index))]?.time ??
        this.bars[index].time,
      price: pivot.currentLevel,
      position,
      fontSize: FONT_SIZES[
        internal ? this.config.internalStructureSize : this.config.swingStructureSize
      ],
      dash: internal ? 'dash' : 'solid',
    };
  }

  // ----------------------------------------------------------- order blocks
  storeOrderBlock(index, pivot, internal, bias) {
    if (pivot.barIndex == null) {
      return;
    }

    const start = pivot.barIndex;
    let bestIndex = -1;
    let bestValue = null;

    for (let i = start; i < index; i += 1) {
      const value = bias === BEARISH ? this.parsedHighs[i] : this.parsedLows[i];
      if (
        bestValue == null ||
        (bias === BEARISH ? value > bestValue : value < bestValue)
      ) {
        bestValue = value;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) {
      return;
    }

    const orderBlock = {
      barHigh: this.parsedHighs[bestIndex],
      barLow: this.parsedLows[bestIndex],
      barTime: this.times[bestIndex],
      bias,
    };

    const orderBlocks = internal ? this.internalOrderBlocks : this.swingOrderBlocks;
    orderBlocks.unshift(orderBlock);
    if (orderBlocks.length > 100) {
      orderBlocks.pop();
    }
  }

  deleteOrderBlocks(index, internal) {
    const bar = this.bars[index];
    const bearishSource =
      this.config.orderBlockMitigation === 'Close' ? bar.close : bar.high;
    const bullishSource =
      this.config.orderBlockMitigation === 'Close' ? bar.close : bar.low;

    const orderBlocks = internal ? this.internalOrderBlocks : this.swingOrderBlocks;
    for (let i = orderBlocks.length - 1; i >= 0; i -= 1) {
      const orderBlock = orderBlocks[i];
      const crossed =
        (orderBlock.bias === BEARISH && bearishSource > orderBlock.barHigh) ||
        (orderBlock.bias === BULLISH && bullishSource < orderBlock.barLow);

      if (crossed) {
        this.alerts.push({
          side: orderBlock.bias,
          internal,
          tag: 'OrderBlockBreak',
          time: bar.time,
        });
        orderBlocks.splice(i, 1);
      }
    }
  }

  // --------------------------------------------------------------- trailing
  updateTrailingExtremes(index) {
    const bar = this.bars[index];
    if (this.trailing.top != null) {
      this.trailing.top = Math.max(bar.high, this.trailing.top);
      if (this.trailing.top === bar.high) {
        this.trailing.lastTopTime = bar.time;
      }
    }
    if (this.trailing.bottom != null) {
      this.trailing.bottom = Math.min(bar.low, this.trailing.bottom);
      if (this.trailing.bottom === bar.low) {
        this.trailing.lastBottomTime = bar.time;
      }
    }
  }

  // ----------------------------------------------------------------- colors
  bullColor(internal) {
    if (this.config.style === 'Monochrome') {
      return COLORS.monoBull;
    }
    return internal ? this.config.internalBullColor : this.config.swingBullColor;
  }

  bearColor(internal) {
    if (this.config.style === 'Monochrome') {
      return COLORS.monoBear;
    }
    return internal ? this.config.internalBearColor : this.config.swingBearColor;
  }

  orderBlockColor(internal, bias) {
    if (this.config.style === 'Monochrome') {
      return bias === BEARISH
        ? 'rgba(93, 96, 107, 0.20)'
        : 'rgba(178, 181, 190, 0.20)';
    }
    if (internal) {
      return bias === BEARISH ? COLORS.internalBearOB : COLORS.internalBullOB;
    }
    return bias === BEARISH ? COLORS.swingBearOB : COLORS.swingBullOB;
  }

  orderBlockBorder(internal, bias) {
    if (internal) {
      return null; // Pine leaves internal OB borders transparent
    }
    if (this.config.style === 'Monochrome') {
      return bias === BEARISH
        ? 'rgba(93, 96, 107, 0.55)'
        : 'rgba(178, 181, 190, 0.55)';
    }
    return bias === BEARISH
      ? COLORS.swingBearOBBorder
      : COLORS.swingBullOBBorder;
  }

  // -------------------------------------------------------------- drawables
  buildDrawables() {
    const drawables = [];

    // Order blocks (oldest drawn first so the newest sit on top).
    if (this.config.showInternalOrderBlocks) {
      const blocks = this.internalOrderBlocks
        .slice(0, this.config.internalOrderBlocksSize)
        .slice()
        .reverse();
      for (const block of blocks) {
        drawables.push({
          kind: 'rect',
          layer: 'bottom',
          fromTime: block.barTime,
          toTime: null,
          top: block.barHigh,
          bottom: block.barLow,
          fill: this.orderBlockColor(true, block.bias),
          border: this.orderBlockBorder(true, block.bias),
          borderWidth: 1,
        });
      }
    }

    if (this.config.showSwingOrderBlocks) {
      const blocks = this.swingOrderBlocks
        .slice(0, this.config.swingOrderBlocksSize)
        .slice()
        .reverse();
      for (const block of blocks) {
        drawables.push({
          kind: 'rect',
          layer: 'bottom',
          fromTime: block.barTime,
          toTime: null,
          top: block.barHigh,
          bottom: block.barLow,
          fill: this.orderBlockColor(false, block.bias),
          border: this.orderBlockBorder(false, block.bias),
          borderWidth: 1,
        });
      }
    }

    // Structure lines and labels (Pine keeps max 500 of each).
    for (const structure of this.structures.slice(-500)) {
      drawables.push({
        kind: 'segment',
        layer: 'top',
        fromTime: structure.fromTime,
        toTime: structure.toTime,
        fromPrice: structure.price,
        toPrice: structure.price,
        color: structure.color,
        dash: structure.dash,
        width: 1,
      });
      drawables.push({
        kind: 'text',
        layer: 'top',
        time: structure.labelTime,
        price: structure.price,
        text: structure.tag,
        color: structure.color,
        align: 'center',
        baseline: structure.position === 'above' ? 'bottom' : 'top',
        offsetY: structure.position === 'above' ? -5 : 5,
        fontSize: structure.fontSize,
        weight: 600,
      });
    }

    // Swing points (LL / HL / HH / LH).
    for (const point of this.swingPoints.slice(-500)) {
      drawables.push({
        kind: 'text',
        layer: 'top',
        time: point.time,
        price: point.price,
        text: point.text,
        color: point.color,
        align: 'center',
        baseline: point.position === 'above' ? 'bottom' : 'top',
        offsetY: point.position === 'above' ? -5 : 5,
        fontSize: 11,
        weight: 600,
      });
    }

    // Equal highs / lows.
    for (const equal of this.equalDisplays.slice(-300)) {
      drawables.push({
        kind: 'segment',
        layer: 'top',
        fromTime: equal.fromTime,
        toTime: equal.toTime,
        fromPrice: equal.fromPrice,
        toPrice: equal.toPrice,
        color: equal.color,
        dash: 'dot',
        width: 1,
      });
      drawables.push({
        kind: 'text',
        layer: 'top',
        time: equal.labelTime,
        price: equal.labelPrice,
        text: equal.text,
        color: equal.color,
        align: 'center',
        baseline: equal.position === 'above' ? 'bottom' : 'top',
        offsetY: equal.position === 'above' ? -4 : 4,
        fontSize: 11,
        weight: 600,
      });
    }

    // Strong / weak highs & lows.
    if (this.config.showHighLowSwings) {
      if (this.trailing.top != null && this.trailing.lastTopTime != null) {
        drawables.push({
          kind: 'segment',
          layer: 'top',
          fromTime: this.trailing.lastTopTime,
          toTime: null,
          fromPrice: this.trailing.top,
          toPrice: this.trailing.top,
          color: this.bearColor(false),
          dash: 'solid',
          width: 1,
        });
        drawables.push({
          kind: 'text',
          layer: 'top',
          time: null,
          xRight: true,
          price: this.trailing.top,
          text:
            this.swingTrend === BEARISH ? 'Institutional Selling' : 'Weak High',
          color: this.bearColor(false),
          align: 'right',
          baseline: 'bottom',
          offsetY: -4,
          fontSize: 11,
          weight: 600,
        });
      }

      if (this.trailing.bottom != null && this.trailing.lastBottomTime != null) {
        drawables.push({
          kind: 'segment',
          layer: 'top',
          fromTime: this.trailing.lastBottomTime,
          toTime: null,
          fromPrice: this.trailing.bottom,
          toPrice: this.trailing.bottom,
          color: this.bullColor(false),
          dash: 'solid',
          width: 1,
        });
        drawables.push({
          kind: 'text',
          layer: 'top',
          time: null,
          xRight: true,
          price: this.trailing.bottom,
          text:
            this.swingTrend === BULLISH ? 'Institutional Buying' : 'Weak Low',
          color: this.bullColor(false),
          align: 'right',
          baseline: 'top',
          offsetY: 4,
          fontSize: 11,
          weight: 600,
        });
      }
    }

    return drawables;
  }
}
