import { isoDate } from '../api.js';
import { shiftIsoDate } from '../range.js';

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
  if (!$('dateTo').value) {
    $('dateTo').value = isoDate(new Date());
  }
  if (!$('dateFrom').value) {
    $('dateFrom').value = shiftIsoDate($('dateTo').value, -6);
  }
}

export function readSettings() {
  return {
    mode: $('modeSelect').value,
    symbol: $('symbol').value.trim(),
    resolution: $('resolution').value,
    rangeDays: clampInt($('rangeDays').value, 1, 5000, 30),
    dateFrom: $('dateFrom').value,
    dateTo: $('dateTo').value,
    autoRefresh: $('autoRefresh').checked,
    replaySpeed: clampInt($('replaySpeed').value, 1, 16, 2),
    replayFollow: $('replayFollow').checked,
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

export function bindControls({
  onReload,
  onToggle,
  onAuth,
  onModeChange,
  onReplayPlay,
  onReplayBack,
  onReplayForward,
  onReplayReset,
  onReplayEnd,
  onReplaySeek,
  onReplaySpeed,
  onReplayFollow,
}) {
  $('loadBtn').addEventListener('click', onReload);
  $('authBtn').addEventListener('click', onAuth);
  $('symbol').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      onReload();
    }
  });

  for (const id of ['dateFrom', 'dateTo']) {
    $(id).addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        onReload();
      }
    });
  }

  $('modeSelect').addEventListener('change', (event) => {
    applyMode(event.target.value);
    onModeChange?.(event.target.value);
  });

  for (const id of TOGGLE_IDS) {
    $(id).addEventListener('change', onToggle);
  }

  $('replayPlay').addEventListener('click', () => onReplayPlay?.());
  $('replayBack').addEventListener('click', () => onReplayBack?.());
  $('replayForward').addEventListener('click', () => onReplayForward?.());
  $('replayReset').addEventListener('click', () => onReplayReset?.());
  $('replayEnd').addEventListener('click', () => onReplayEnd?.());
  $('replaySlider').addEventListener('input', (event) =>
    onReplaySeek?.(Number(event.target.value)),
  );
  $('replaySpeed').addEventListener('change', (event) =>
    onReplaySpeed?.(Number(event.target.value)),
  );
  $('replayFollow').addEventListener('change', (event) =>
    onReplayFollow?.(event.target.checked),
  );
}

export function applyMode(mode) {
  const rangeMode = mode === 'date' || mode === 'replay';
  $('rangeField').hidden = rangeMode;
  $('liveLabel').hidden = rangeMode;
  $('dateFields').hidden = !rangeMode;
  $('loadBtn').textContent =
    mode === 'replay' ? 'Load replay' : mode === 'date' ? 'Load range' : 'Load';
  if (mode !== 'replay') {
    showReplayBar(false);
  }
}

export function showReplayBar(visible) {
  $('replayBar').hidden = !visible;
}

export function setReplayState({
  position = 0,
  total = 0,
  label = '–',
  playing = false,
  canBack = false,
  canForward = false,
} = {}) {
  const slider = $('replaySlider');
  slider.min = '0';
  slider.max = String(Math.max(0, total));
  slider.value = String(Math.min(Math.max(0, position), Math.max(0, total)));

  $('replayLabel').textContent = label;
  $('replayPlay').textContent = playing ? 'Pause' : 'Play';
  $('replayBack').disabled = !canBack;
  $('replayForward').disabled = !canForward;
  $('replayReset').disabled = !canBack;
  $('replayEnd').disabled = !canForward;
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
