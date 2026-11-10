// Client for /api/push.php. No account or session is needed: the push subscription identifies
// this device. Only same-origin JSON requests.

export class PushError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function call(action, body) {
  let res;
  try {
    res = await fetch(`api/push.php?action=${action}`, body === undefined
      ? { credentials: 'same-origin', headers: { Accept: 'application/json' } }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new PushError('offline', 'Could not reach LetsGetFit. Check your connection and try again.');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) throw new PushError(json?.error ?? `http_${res.status}`, typeof json?.message === 'string' ? json.message : 'Something went wrong. Try again.');
  return json ?? {};
}

/** { enabled, publicKey } — enabled is false when the server has notifications switched off. */
export async function getPushConfig() {
  try {
    const r = await call('key');
    return r.enabled === true && typeof r.publicKey === 'string' ? { enabled: true, publicKey: r.publicKey } : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

export const savePush = (subscription, reminders) =>
  call('subscribe', { subscription, reminders, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
export const removePush = (endpoint) => call('unsubscribe', { endpoint });
export const pushStatus = (endpoint) => call('status', { endpoint });
export const testPush = (endpoint) => call('test', { endpoint });
