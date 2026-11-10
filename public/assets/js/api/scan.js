// Client for /api/scan.php. The photo goes to our server, which removes metadata and asks
// OpenAI for food suggestions; nutrients are always taken from the food database.

import { foodFromApi } from '../lib/food.js';

const TIMEOUT_MS = 60000;

export class ScanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {Blob} photo  already re-encoded JPEG
 * @param {{ requestId: string, signal?: AbortSignal }} options  the same requestId for retries
 */
export async function scanMeal(photo, { requestId, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), TIMEOUT_MS);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const form = new FormData();
  form.append('photo', photo, 'meal.jpg');
  let res;
  try {
    res = await fetch('api/scan.php', {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
      headers: { 'X-Scan-Consent': 'yes', 'X-Request-Id': requestId, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    if (signal?.aborted) throw new ScanError('cancelled', 'Scan cancelled.');
    if (controller.signal.aborted) throw new ScanError('timeout', 'The photo took too long to analyse. Try again, or add the food yourself.');
    throw new ScanError('offline', 'Could not reach LetsGetFit. Check your connection, or add the food yourself.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body || !Array.isArray(body.items)) {
    const message = typeof body?.message === 'string' && body.message.length < 240 ? body.message : 'Photo analysis is not available right now. Add the food yourself.';
    throw new ScanError(body?.error ?? `http_${res.status}`, message);
  }
  // Re-validate everything from the server.
  const items = body.items.slice(0, 10).map((item) => ({
    name: String(item.name ?? '').slice(0, 80),
    gramsEstimate: clampGrams(item.gramsEstimate),
    gramsLow: clampGrams(item.gramsLow),
    gramsHigh: clampGrams(item.gramsHigh),
    confidence: ['low', 'medium', 'high'].includes(item.confidence) ? item.confidence : 'low',
    candidates: (Array.isArray(item.candidates) ? item.candidates : []).map(foodFromApi).filter(Boolean).slice(0, 3),
  })).filter((i) => i.name && i.gramsEstimate);
  return {
    isFood: body.isFood === true,
    imageQuality: ['good', 'poor', 'unusable'].includes(body.imageQuality) ? body.imageQuality : 'poor',
    items,
    questions: (Array.isArray(body.questions) ? body.questions : []).filter((q) => typeof q === 'string').slice(0, 3).map((q) => q.slice(0, 160)),
    disclaimer: typeof body.disclaimer === 'string' ? body.disclaimer : '',
  };
}

function clampGrams(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 2000 ? Math.round(n) : null;
}
