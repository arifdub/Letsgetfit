// Client for /api/account.php and /api/admin.php. Same-origin requests with the session cookie
// and CSRF token (shared by both endpoints, as they use the same session).

import { batches } from '../lib/sync.js';

const TIMEOUT_MS = 15000;
let csrfToken = '';

export class AccountError extends Error {
  constructor(code, message, { status = 0, field = null, fields = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.field = field;
    this.fields = fields;
  }
}

export async function call(action, { method = 'GET', body, query = '', endpoint = 'account' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = { Accept: 'application/json' };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = csrfToken;
  }
  let res;
  try {
    res = await fetch(`api/${endpoint}.php?action=${encodeURIComponent(action)}${query}`, {
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
    throw new AccountError(json?.error ?? `http_${res.status}`, typeof json?.message === 'string' ? json.message : 'Something went wrong. Try again.', { status: res.status, field: json?.field ?? null, fields: json?.fields ?? null });
  }
  return json ?? {};
}

/** { enabled, user, signupsOpen, privacyContact }: enabled is false when accounts are off or unreachable. */
export async function getAccountState() {
  try {
    const me = await call('me');
    return { enabled: me.enabled === true, user: me.user ?? null, signupsOpen: me.signupsOpen !== false, privacyContact: me.privacyContact ?? null };
  } catch {
    return { enabled: false, user: null, signupsOpen: false, privacyContact: null };
  }
}

const post = (action, body = {}) => call(action, { method: 'POST', body });
export const requestCode = (email) => post('request-code', { email });
export const verifyCode = (email, code, healthConsent) => post('verify-code', { email, code, healthConsent });
export const login = (email, password) => post('login', { email, password });
export const setPassword = (password, currentPassword) => post('set-password', { password, currentPassword });
export const removePassword = (currentPassword) => post('set-password', { remove: true, currentPassword });
export const logout = () => post('logout');
export const logoutEverywhere = () => post('logout-everywhere');
export const deleteAccount = (password) => post('delete', { confirm: 'DELETE', password });
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
