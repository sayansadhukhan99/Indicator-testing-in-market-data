export const BULLISH = 1;
export const BEARISH = -1;

export const COLORS = {
  green: '#089981',
  red: '#f23645',
  blue: '#2157f3',
  gray: '#878b94',
  monoBull: '#b2b5be',
  monoBear: '#5d606b',
  internalBullOB: 'rgba(49, 121, 245, 0.20)',
  internalBearOB: 'rgba(247, 124, 128, 0.20)',
  internalBullOBBorder: 'rgba(49, 121, 245, 0.55)',
  internalBearOBBorder: 'rgba(247, 124, 128, 0.55)',
  swingBullOB: 'rgba(24, 72, 204, 0.22)',
  swingBearOB: 'rgba(178, 40, 51, 0.22)',
  swingBullOBBorder: 'rgba(24, 72, 204, 0.60)',
  swingBearOBBorder: 'rgba(178, 40, 51, 0.60)',
};

export const DEFAULT_CONFIG = {
  // Pine defaults
  swingsLength: 50,
  internalLength: 5,
  equalHighsLowsLength: 3,
  equalHighsLowsThreshold: 0.1,

  showInternals: true,
  showSwing: true,
  showSwings: false,
  showHighLowSwings: true,

  showInternalOrderBlocks: true,
  internalOrderBlocksSize: 5,
  showSwingOrderBlocks: false,
  swingOrderBlocksSize: 5,
  orderBlockFilter: 'Atr', // 'Atr' | 'Range'
  orderBlockMitigation: 'High/Low', // 'High/Low' | 'Close'

  showEqualHighLows: true,
  showPremiumDiscountZones: false,
  showFairValueGaps: false,

  internalFilterConfluence: false,
  style: 'Colored', // 'Colored' | 'Monochrome'

  internalBullishStructure: 'All',
  internalBearishStructure: 'All',
  swingBullishStructure: 'All',
  swingBearishStructure: 'All',

  internalStructureSize: 'tiny',
  swingStructureSize: 'small',

  internalBullColor: COLORS.green,
  internalBearColor: COLORS.red,
  swingBullColor: COLORS.green,
  swingBearColor: COLORS.red,
};
