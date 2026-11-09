// Client for /api/account.php. Same-origin requests with the session cookie and CSRF token.

import { batches } from '../lib/sync.js';

const TIMEOUT_MS = 15000;
let csrfToken = '';

export class AccountError extends Error {
  constructor(code, message, { status = 0, field = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

async function call(action, { method = 'GET', body, query = '' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = { Accept: 'application/json' };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = csrfToken;
  }
  let res;
  try {
    res = await fetch(`api/account.php?action=${encodeURIComponent(action)}${query}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new AccountError('offline', 'Could not reach LetsGetFit. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (json?.csrfToken) csrfToken = json.csrfToken;
  if (!res.ok) {
    throw new AccountError(json?.error ?? `http_${res.status}`, typeof json?.message === 'string' ? json.message : 'Something went wrong. Try again.', { status: res.status, field: json?.field ?? null });
  }
  return json ?? {};
}

/** { enabled, user } — enabled is false when accounts are switched off or unreachable. */
export async function getAccountState() {
  try {
    const me = await call('me');
    return { enabled: me.enabled === true, user: me.user ?? null };
  } catch {
    return { enabled: false, user: null };
  }
}

export const register = (email, password, healthConsent) => call('register', { method: 'POST', body: { email, password, healthConsent } });
export const verifyEmail = (token) => call('verify', { method: 'POST', body: { token } });
export const resendVerification = (email) => call('resend', { method: 'POST', body: { email } });
export const login = (email, password) => call('login', { method: 'POST', body: { email, password } });
export const logout = () => call('logout', { method: 'POST', body: {} });
export const requestReset = (email) => call('request-reset', { method: 'POST', body: { email } });
export const resetPassword = (token, password) => call('reset', { method: 'POST', body: { token, password } });
export const deleteAccount = (password) => call('delete', { method: 'POST', body: { password } });
export const exportAccount = () => call('export');

/** Pull every page of changes after the cursor. */
export async function pullAll(cursor) {
  const records = [];
  let next = cursor ?? null;
  for (let page = 0; page < 100; page += 1) {
    const res = await call('pull', { query: next ? `&since=${encodeURIComponent(next)}` : '' });
    records.push(...(res.records ?? []));
    next = res.cursor ?? next;
    if (!res.more) break;
  }
  return { records, cursor: next };
}

/** Push records in server-sized batches. Returns totals. */
export async function pushAll(records) {
  const totals = { accepted: 0, unchanged: 0, rejected: 0 };
  for (const batch of batches(records)) {
    const res = await call('push', { method: 'POST', body: { records: batch } });
    totals.accepted += res.accepted ?? 0;
    totals.unchanged += res.unchanged ?? 0;
    totals.rejected += (res.rejected ?? []).length;
  }
  return totals;
}
