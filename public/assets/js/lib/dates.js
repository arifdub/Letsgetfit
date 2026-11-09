// Local calendar dates. Diary, workout and weight entries store the user's local date as
// "YYYY-MM-DD" so an entry made at 23:30 in Dublin stays on that day, whatever the time zone
// of a later device or server. Timestamps (createdAt / updatedAt) are ISO 8601 in UTC.

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidLocalDate(value) {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Parse a local date string into a Date at local midnight. */
export function parseLocalDate(value) {
  if (!isValidLocalDate(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatLocalDate(value, locale = 'en-IE') {
  const date = parseLocalDate(value);
  if (!date) return value;
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function nowUtcIso() {
  return new Date().toISOString();
}
