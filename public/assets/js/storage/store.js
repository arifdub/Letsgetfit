// Versioned on-device storage.
//
// Everything is kept in one localStorage key as JSON:
//   { schemaVersion, preferences, profile, workouts[], weights[], foods[], diary[] }
// v1 (Phase 1): profile, workouts, weights. v2 (Phase 2): adds the food library and diary.
// v3 (Phase 3): workouts get a `type` ('activity' or 'session'); adds `draftSession`.
// Units are canonical metric (cm, kg, kcal). Entry dates are local "YYYY-MM-DD"; createdAt and
// updatedAt are ISO 8601 UTC timestamps. Each record has a stable random ID so that a later
// opt-in sync (Phase 4) can de-duplicate safely.
//
// To change the shape, bump SCHEMA_VERSION and add a migration that upgrades the previous
// version. Old data is always upgraded on load, never discarded. Data written by a newer app
// version is opened read-only so an older cached copy of the app cannot damage it.

import { nowUtcIso } from '../lib/dates.js';

export const STORAGE_KEY = 'letsgetfit.data';
export const SCHEMA_VERSION = 3;

/** migrations[n] upgrades data from version n-1 to version n. */
export const migrations = {
  1: (data) => ({
    schemaVersion: 1,
    preferences: { units: data?.preferences?.units === 'imperial' ? 'imperial' : 'metric' },
    profile: data?.profile ?? null,
    workouts: Array.isArray(data?.workouts) ? data.workouts : [],
    weights: Array.isArray(data?.weights) ? data.weights : [],
  }),
  2: (data) => ({
    ...data,
    schemaVersion: 2,
    foods: Array.isArray(data?.foods) ? data.foods : [],
    diary: Array.isArray(data?.diary) ? data.diary : [],
  }),
  3: (data) => ({
    ...data,
    schemaVersion: 3,
    workouts: (Array.isArray(data?.workouts) ? data.workouts : []).map((w) => (w && !w.type ? { ...w, type: 'activity' } : w)),
    draftSession: data?.draftSession ?? null,
  }),
};

export function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, preferences: { units: 'metric' }, profile: null, workouts: [], weights: [], foods: [], diary: [], draftSession: null };
}

export function migrate(data) {
  let current = data && typeof data === 'object' ? data : {};
  let version = Number.isInteger(current.schemaVersion) ? current.schemaVersion : 0;
  while (version < SCHEMA_VERSION) {
    version += 1;
    current = migrations[version](current);
  }
  return current;
}

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function memoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** Returns window.localStorage if it works, otherwise null (private mode, blocked storage). */
export function browserBackend() {
  try {
    const ls = globalThis.localStorage;
    const probe = `${STORAGE_KEY}.probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

const byDateDesc = (a, b) =>
  a.localDate === b.localDate ? (b.createdAt ?? '').localeCompare(a.createdAt ?? '') : b.localDate.localeCompare(a.localDate);

export class Store {
  /**
   * @param {{ backend?: Storage|null }} options  Pass null to force memory-only storage.
   */
  constructor({ backend } = {}) {
    const real = backend === undefined ? browserBackend() : backend;
    this.persistent = Boolean(real);
    this.backend = real ?? memoryBackend();
    this.readOnly = false;
    this.notice = null; // a message for the UI about recovery or storage limits
    this.listeners = new Set();
    this.data = this.#load();
  }

  #load() {
    let raw;
    try {
      raw = this.backend.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (raw === null || raw === undefined) return emptyData();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep the unreadable copy so it can be inspected, then start fresh.
      const backupKey = `${STORAGE_KEY}.unreadable-${Date.now()}`;
      try {
        this.backend.setItem(backupKey, raw);
      } catch {
        /* storage full; nothing more we can do */
      }
      this.notice = 'Saved data on this device could not be read, so the app started fresh. A copy of the unreadable data was kept in browser storage.';
      return emptyData();
    }
    if (Number.isInteger(parsed?.schemaVersion) && parsed.schemaVersion > SCHEMA_VERSION) {
      this.readOnly = true;
      this.notice = 'This data was saved by a newer version of LetsGetFit. It is shown read-only. Reload the page to get the latest version.';
      return { ...emptyData(), ...parsed };
    }
    const migrated = migrate(parsed);
    if (migrated.schemaVersion !== parsed.schemaVersion) this.#write(migrated);
    return migrated;
  }

  #write(data) {
    if (this.readOnly) throw new Error('Storage is read-only');
    try {
      this.backend.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      const e = new Error('Your browser would not save this data. Storage may be full or blocked.');
      e.cause = error;
      throw e;
    }
  }

  #commit(next) {
    this.#write(next);
    this.data = next;
    for (const fn of this.listeners) fn(this.data);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get profile() {
    return this.data.profile;
  }

  get workouts() {
    return [...this.data.workouts].sort(byDateDesc);
  }

  get weights() {
    return [...this.data.weights].sort(byDateDesc);
  }

  /** Food library, most recently used first. */
  get foods() {
    return [...(this.data.foods ?? [])].sort((a, b) => (b.lastUsedAt ?? b.updatedAt ?? '').localeCompare(a.lastUsedAt ?? a.updatedAt ?? ''));
  }

  get diary() {
    return [...(this.data.diary ?? [])];
  }

  /** Diary entries for one local date, in the order they were added. */
  diaryFor(localDate) {
    return (this.data.diary ?? []).filter((e) => e.localDate === localDate).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }

  saveProfile(profile) {
    const now = nowUtcIso();
    const existing = this.data.profile;
    const next = {
      id: existing?.id ?? createId(),
      ...profile,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.#commit({ ...this.data, profile: next });
    return next;
  }

  get units() {
    return this.data.preferences?.units === 'imperial' ? 'imperial' : 'metric';
  }

  /** Display and entry units only. Stored values are always metric. */
  setUnits(units) {
    const next = units === 'imperial' ? 'imperial' : 'metric';
    this.#commit({ ...this.data, preferences: { ...this.data.preferences, units: next } });
  }

  #add(collection, value) {
    const now = nowUtcIso();
    const record = { id: createId(), ...value, createdAt: now, updatedAt: now };
    this.#commit({ ...this.data, [collection]: [...this.data[collection], record] });
    return record;
  }

  #update(collection, id, value) {
    const list = this.data[collection];
    const index = list.findIndex((r) => r.id === id);
    if (index === -1) throw new Error('That entry no longer exists.');
    const record = { ...list[index], ...value, id, createdAt: list[index].createdAt, updatedAt: nowUtcIso() };
    const next = [...list];
    next[index] = record;
    this.#commit({ ...this.data, [collection]: next });
    return record;
  }

  #remove(collection, id) {
    this.#commit({ ...this.data, [collection]: this.data[collection].filter((r) => r.id !== id) });
  }

  addWorkout(value) {
    return this.#add('workouts', value);
  }
  updateWorkout(id, value) {
    return this.#update('workouts', id, value);
  }
  deleteWorkout(id) {
    this.#remove('workouts', id);
  }

  addWeight(value) {
    return this.#add('weights', value);
  }
  updateWeight(id, value) {
    return this.#update('weights', id, value);
  }
  deleteWeight(id) {
    this.#remove('weights', id);
  }

  addFood(value) {
    return this.#add('foods', value);
  }
  updateFood(id, value) {
    return this.#update('foods', id, value);
  }
  /** Deleting a food never touches diary entries: they keep their own snapshot. */
  deleteFood(id) {
    this.#remove('foods', id);
  }

  addDiaryEntry(value) {
    return this.#add('diary', value);
  }
  updateDiaryEntry(id, value) {
    return this.#update('diary', id, value);
  }
  deleteDiaryEntry(id) {
    this.#remove('diary', id);
  }

  /** A training session in progress (survives reloads). */
  get draftSession() {
    return this.data.draftSession ?? null;
  }

  saveDraftSession(draft) {
    // No listeners: the draft changes on every keystroke and views do not depend on it.
    const next = { ...this.data, draftSession: draft ? { ...draft, savedAt: nowUtcIso() } : null };
    this.#write(next);
    this.data = next;
  }

  /** Removes all LetsGetFit data from this device. */
  clearAll() {
    if (this.readOnly) throw new Error('Storage is read-only');
    try {
      const keys = [STORAGE_KEY];
      // Also remove any unreadable-data backups this app made.
      if (typeof this.backend.length === 'number' && typeof this.backend.key === 'function') {
        for (let i = 0; i < this.backend.length; i += 1) {
          const key = this.backend.key(i);
          if (key?.startsWith(`${STORAGE_KEY}.`)) keys.push(key);
        }
      }
      for (const key of keys) this.backend.removeItem(key);
    } catch {
      /* ignore */
    }
    this.data = emptyData();
    for (const fn of this.listeners) fn(this.data);
  }

  exportJson() {
    return JSON.stringify({ app: 'LetsGetFit', exportedAt: nowUtcIso(), ...this.data }, null, 2);
  }
}
