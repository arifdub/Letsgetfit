// Reminder choices for push notifications. Pure logic (no DOM), shared by the settings card and
// tests. Times are local "HH:MM"; days are 1 (Monday) to 7 (Sunday).

export const REMINDER_TYPES = [
  { type: 'meals', label: 'Food diary', hint: 'A nudge to add what you have eaten', defaultTime: '19:30' },
  { type: 'weight', label: 'Weigh-in', hint: 'A nudge to log your weight', defaultTime: '08:00' },
  { type: 'workout', label: 'Workouts', hint: 'A nudge to log any activity', defaultTime: '18:00' },
];

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Build the list the server expects from the form's choices.
 * @param {Record<string, { on: boolean, time: string, days?: number[] }>} choices
 * @returns {{ reminders: Array<{type: string, time: string, days: number[]}>, error: string | null }}
 */
export function buildReminders(choices) {
  const reminders = [];
  for (const { type, label } of REMINDER_TYPES) {
    const c = choices[type];
    if (!c?.on) continue;
    if (!TIME.test(String(c.time))) return { reminders: [], error: `Choose a time for “${label}”.` };
    const days = [...new Set((c.days ?? ALL_DAYS).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
    if (!days.length) return { reminders: [], error: `Choose at least one day for “${label}”.` };
    reminders.push({ type, time: c.time, days });
  }
  return { reminders, error: null };
}

/** The reverse: saved reminders back into form choices (defaults for types not set). */
export function choicesFrom(reminders = []) {
  const out = {};
  for (const { type, defaultTime } of REMINDER_TYPES) {
    const r = reminders.find((x) => x.type === type);
    out[type] = r ? { on: true, time: r.time, days: r.days } : { on: false, time: defaultTime, days: ALL_DAYS };
  }
  return out;
}

/** VAPID public key (base64url) to the bytes PushManager.subscribe() needs. */
export function urlBase64ToBytes(base64url) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
