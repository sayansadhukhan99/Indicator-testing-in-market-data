const $ = (id) => document.getElementById(id);

const TOGGLE_IDS = [
  'showInternals',
  'showSwing',
  'showWeak',
  'showEQ',
  'showSwings',
  'showInternalOB',
  'showSwingOB',
  'iobSize',
];

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function applyDefaults(config) {
  if (config.defaultSymbol) {
    $('symbol').value = config.defaultSymbol;
  }
  if (config.defaultResolution) {
    $('resolution').value = config.defaultResolution;
  }
  if (config.defaultRangeDays) {
    const select = $('rangeDays');
    const value = String(config.defaultRangeDays);
    if ([...select.options].some((option) => option.value === value)) {
      select.value = value;
    }
  }
}

export function readSettings() {
  return {
    symbol: $('symbol').value.trim(),
    resolution: $('resolution').value,
    rangeDays: clampInt($('rangeDays').value, 1, 5000, 30),
    autoRefresh: $('autoRefresh').checked,
    config: {
      showInternals: $('showInternals').checked,
      showSwing: $('showSwing').checked,
      showHighLowSwings: $('showWeak').checked,
      showEqualHighLows: $('showEQ').checked,
      showSwings: $('showSwings').checked,
      showInternalOrderBlocks: $('showInternalOB').checked,
      internalOrderBlocksSize: clampInt($('iobSize').value, 1, 20, 5),
      showSwingOrderBlocks: $('showSwingOB').checked,
      swingOrderBlocksSize: 5,
    },
  };
}

export function bindControls({ onReload, onToggle, onAuth }) {
  $('loadBtn').addEventListener('click', onReload);
  $('authBtn').addEventListener('click', onAuth);
  $('symbol').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      onReload();
    }
  });

  for (const id of TOGGLE_IDS) {
    $(id).addEventListener('change', onToggle);
  }
}

export function setStatus(text, tone = 'idle') {
  const dot = $('statusDot');
  dot.className = 'dot';
  if (tone === 'ok') dot.classList.add('ok');
  if (tone === 'error') dot.classList.add('err');
  if (tone === 'loading') dot.classList.add('loading');
  $('statusText').textContent = text;
}

export function setMeta(text) {
  $('metaText').textContent = text;
}

export function showAuthButton(visible) {
  $('authBtn').hidden = !visible;
}
