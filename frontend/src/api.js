async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options,
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = body?.detail || body?.message || `HTTP ${response.status}`;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return body;
}

export function fetchConfig() {
  return requestJson('/api/config');
}

export function fetchHistory({ symbol, resolution, from, to, days }) {
  const params = new URLSearchParams({ symbol, resolution });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (days) params.set('days', String(days));
  return requestJson(`/api/history?${params.toString()}`);
}

export function fetchLatest({ symbol, resolution, lookbackDays = 3 }) {
  const params = new URLSearchParams({
    symbol,
    resolution,
    lookbackDays: String(lookbackDays),
  });
  return requestJson(`/api/history/latest?${params.toString()}`);
}

export function fetchAuthUrl() {
  return requestJson('/api/auth/url');
}

export function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function rangeForDays(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}
