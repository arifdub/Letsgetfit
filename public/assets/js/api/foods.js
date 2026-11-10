// Client for the server's food search endpoint (public/api/foods.php).
// The app keeps working without it: every failure ends in a message that points to manual entry.

import { foodFromApi } from '../lib/food.js';

const SEARCH_TIMEOUT_MS = 12000;
const HEALTH_TIMEOUT_MS = 5000;

let healthPromise = null;

async function fetchJson(url, timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Whether food search can be offered. Checked once per page load. */
export function getServerHealth() {
  healthPromise ??= fetchJson('api/health.php', HEALTH_TIMEOUT_MS)
    .then(({ status, body }) => (status === 200 && body?.ok === true ? body : null))
    .catch(() => null);
  return healthPromise;
}

export function checkSearchAvailable() {
  return getServerHealth().then((h) => Boolean(h) && h.foodSearch !== 'unavailable');
}

/** Photo scanning needs an OpenAI key and image processing on the server. */
export function checkScanAvailable() {
  return getServerHealth().then((h) => h?.aiScan === 'enabled');
}

/** For tests and after network changes. */
export function resetSearchAvailability() {
  healthPromise = null;
}

export class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Search foods. Resolves to { results, attribution, cached }; rejects with SearchError.
 * Pass an AbortSignal to cancel an older search when a new one starts.
 */
export async function searchFoods(query, { type = 'all', signal } = {}) {
  const url = `api/foods.php?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`;
  let response;
  try {
    response = await fetchJson(url, SEARCH_TIMEOUT_MS, signal);
  } catch (error) {
    if (signal?.aborted) throw new SearchError('cancelled', 'Search cancelled.');
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new SearchError('timeout', 'Food search took too long. Try again, or add the food yourself.');
    }
    throw new SearchError('offline', 'Food search could not be reached. Check your connection, or add the food yourself.');
  }
  const { status, body } = response;
  if (status !== 200 || !Array.isArray(body?.results)) {
    const message = typeof body?.message === 'string' && body.message.length < 200 ? body.message : 'Food search is not available right now. Add the food yourself.';
    throw new SearchError(body?.error ?? `http_${status}`, message);
  }
  const results = body.results.map(foodFromApi).filter(Boolean);
  return { results, attribution: typeof body.attribution === 'string' ? body.attribution : '', cached: Boolean(body.cached) };
}
