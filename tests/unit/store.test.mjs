import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, memoryBackend, STORAGE_KEY, SCHEMA_VERSION, migrate } from '../../public/assets/js/storage/store.js';
import { isValidLocalDate, toLocalDateString } from '../../public/assets/js/lib/dates.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('a new store starts empty at the current schema version', () => {
  const s = new Store({ backend: memoryBackend() });
  assert.equal(s.data.schemaVersion, SCHEMA_VERSION);
  assert.equal(s.profile, null);
  assert.deepEqual(s.workouts, []);
  assert.equal(s.persistent, true);
});

test('records get stable UUIDs and UTC timestamps, and persist across instances', () => {
  const backend = memoryBackend();
  const a = new Store({ backend });
  const w = a.addWorkout({ localDate: '2026-11-09', activityId: 'yoga', durationMin: 30 });
  assert.match(w.id, UUID);
  assert.match(w.createdAt, ISO_UTC);
  const b = new Store({ backend });
  assert.equal(b.workouts.length, 1);
  assert.equal(b.workouts[0].id, w.id);
  assert.equal(b.workouts[0].localDate, '2026-11-09');
});

test('update keeps id and createdAt; delete removes only that record', () => {
  const s = new Store({ backend: memoryBackend() });
  const w1 = s.addWeight({ localDate: '2026-11-01', weightKg: 80 });
  const w2 = s.addWeight({ localDate: '2026-11-08', weightKg: 79.5 });
  const u = s.updateWeight(w1.id, { weightKg: 80.2, id: 'hijack', createdAt: 'x' });
  assert.equal(u.id, w1.id);
  assert.equal(u.createdAt, w1.createdAt);
  assert.equal(u.weightKg, 80.2);
  s.deleteWeight(w1.id);
  assert.deepEqual(s.weights.map((w) => w.id), [w2.id]);
  assert.throws(() => s.updateWeight('missing', { weightKg: 1 }));
});

test('lists are sorted newest local date first', () => {
  const s = new Store({ backend: memoryBackend() });
  s.addWeight({ localDate: '2026-10-01', weightKg: 80 });
  s.addWeight({ localDate: '2026-11-01', weightKg: 79 });
  s.addWeight({ localDate: '2026-10-15', weightKg: 79.5 });
  assert.deepEqual(s.weights.map((w) => w.localDate), ['2026-11-01', '2026-10-15', '2026-10-01']);
});

test('profile save keeps id and createdAt across edits', () => {
  const s = new Store({ backend: memoryBackend() });
  const p1 = s.saveProfile({ ageYears: 30, heightCm: 180, weightKg: 80 });
  const p2 = s.saveProfile({ ageYears: 31, heightCm: 180, weightKg: 80 });
  assert.equal(p1.id, p2.id);
  assert.equal(p1.createdAt, p2.createdAt);
  assert.equal(s.profile.ageYears, 31);
});

test('unversioned legacy data is migrated and rewritten', () => {
  const backend = memoryBackend();
  backend.setItem(STORAGE_KEY, JSON.stringify({ workouts: [{ id: 'a', localDate: '2026-01-01' }] }));
  const s = new Store({ backend });
  assert.equal(s.data.schemaVersion, SCHEMA_VERSION);
  assert.equal(s.workouts.length, 1);
  assert.deepEqual(s.weights, []);
  assert.equal(JSON.parse(backend.getItem(STORAGE_KEY)).schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrate(null), { schemaVersion: 3, preferences: { units: 'metric' }, profile: null, workouts: [], weights: [], foods: [], diary: [], draftSession: null });
});

test('Phase 1 (v1) data stays readable after the v2 upgrade', () => {
  const backend = memoryBackend();
  const v1 = {
    schemaVersion: 1,
    preferences: { units: 'imperial' },
    profile: { id: 'p1', ageYears: 40, heightCm: 175.3, weightKg: 79.8, sex: 'female', activityLevel: 'light', pregnantOrBreastfeeding: false },
    workouts: [{ id: 'w1', localDate: '2026-11-01', activityId: 'yoga', durationMin: 30, createdAt: '2026-11-01T10:00:00.000Z' }],
    weights: [{ id: 'k1', localDate: '2026-11-02', weightKg: 79.8, createdAt: '2026-11-02T07:00:00.000Z' }],
  };
  backend.setItem(STORAGE_KEY, JSON.stringify(v1));
  const s = new Store({ backend });
  assert.equal(s.data.schemaVersion, SCHEMA_VERSION);
  assert.equal(s.units, 'imperial');
  assert.deepEqual(s.profile, v1.profile);
  assert.deepEqual(s.workouts, v1.workouts.map((w) => ({ ...w, type: 'activity' })));
  assert.deepEqual(s.weights, v1.weights);
  assert.deepEqual(s.foods, []);
  assert.deepEqual(s.diary, []);
  const saved = JSON.parse(backend.getItem(STORAGE_KEY));
  assert.equal(saved.schemaVersion, SCHEMA_VERSION);
  assert.equal(saved.workouts[0].durationMin, 30);
  assert.equal(saved.workouts[0].type, 'activity');
});

test('diary entries and foods: add, filter by date, update, delete', () => {
  const s = new Store({ backend: memoryBackend() });
  const food = s.addFood({ source: 'custom', name: 'Porridge', per100g: { energy: 70 } });
  const e1 = s.addDiaryEntry({ localDate: '2026-11-09', meal: 'breakfast', foodId: food.id, servingG: 250 });
  s.addDiaryEntry({ localDate: '2026-11-08', meal: 'lunch', servingG: 100 });
  assert.equal(s.diaryFor('2026-11-09').length, 1);
  s.updateDiaryEntry(e1.id, { servingG: 300 });
  assert.equal(s.diaryFor('2026-11-09')[0].servingG, 300);
  // Deleting the library food leaves the diary entry alone.
  s.deleteFood(food.id);
  assert.equal(s.foods.length, 0);
  assert.equal(s.diaryFor('2026-11-09').length, 1);
  s.deleteDiaryEntry(e1.id);
  assert.equal(s.diaryFor('2026-11-09').length, 0);
});

test('unit preference defaults to metric and persists', () => {
  const backend = memoryBackend();
  const s = new Store({ backend });
  assert.equal(s.units, 'metric');
  s.setUnits('imperial');
  assert.equal(new Store({ backend }).units, 'imperial');
  s.setUnits('furlongs');
  assert.equal(s.units, 'metric');
});

test('unreadable data is backed up, not silently lost', () => {
  const backend = memoryBackend();
  backend.setItem(STORAGE_KEY, '{not json');
  const s = new Store({ backend });
  assert.equal(s.profile, null);
  assert.match(s.notice, /could not be read/);
  // the original is still in its own key, and the main key has not been overwritten yet
  assert.equal(backend.getItem(STORAGE_KEY), '{not json');
});

test('data from a newer schema opens read-only', () => {
  const backend = memoryBackend();
  const future = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, profile: null, workouts: [], weights: [] });
  backend.setItem(STORAGE_KEY, future);
  const s = new Store({ backend });
  assert.equal(s.readOnly, true);
  assert.throws(() => s.addWeight({ localDate: '2026-11-01', weightKg: 80 }), /read-only/);
  assert.equal(backend.getItem(STORAGE_KEY), future);
});

test('write failures surface a clear error and leave state unchanged', () => {
  const backend = memoryBackend();
  backend.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  const s = new Store({ backend });
  assert.throws(() => s.addWeight({ localDate: '2026-11-01', weightKg: 80 }), /would not save/);
  assert.deepEqual(s.weights, []);
});

test('memory-only mode when browser storage is unavailable', () => {
  const s = new Store({ backend: null });
  assert.equal(s.persistent, false);
  s.addWeight({ localDate: '2026-11-01', weightKg: 80 });
  assert.equal(s.weights.length, 1);
});

test('clearAll removes everything and notifies listeners', () => {
  const backend = memoryBackend();
  const s = new Store({ backend });
  s.saveProfile({ ageYears: 30 });
  s.addWorkout({ localDate: '2026-11-09', activityId: 'yoga', durationMin: 10 });
  let notified = false;
  s.subscribe(() => (notified = true));
  s.clearAll();
  assert.equal(notified, true);
  assert.equal(backend.getItem(STORAGE_KEY), null);
  assert.equal(new Store({ backend }).profile, null);
});

test('export is valid JSON containing the data', () => {
  const s = new Store({ backend: memoryBackend() });
  s.addWeight({ localDate: '2026-11-01', weightKg: 80 });
  const out = JSON.parse(s.exportJson());
  assert.equal(out.app, 'LetsGetFit');
  assert.equal(out.weights.length, 1);
});

test('local dates', () => {
  assert.equal(toLocalDateString(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
  assert.equal(isValidLocalDate('2024-02-29'), true);
  assert.equal(isValidLocalDate('2026-02-29'), false);
  assert.equal(isValidLocalDate('2026-1-5'), false);
});

test('v2 data (Phase 2) upgrades to v3 keeping diary and foods', () => {
  const backend = memoryBackend();
  const v2 = {
    schemaVersion: 2, preferences: { units: 'metric' }, profile: null,
    workouts: [{ id: 'w', localDate: '2026-11-01', activityId: 'yoga', durationMin: 20 }],
    weights: [], foods: [{ id: 'f', name: 'Oats' }], diary: [{ id: 'd', localDate: '2026-11-01', name: 'Oats' }],
  };
  backend.setItem(STORAGE_KEY, JSON.stringify(v2));
  const s = new Store({ backend });
  assert.equal(s.data.schemaVersion, 3);
  assert.equal(s.workouts[0].type, 'activity');
  assert.equal(s.foods.length, 1);
  assert.equal(s.diary.length, 1);
  assert.equal(s.draftSession, null);
});

test('draft session persists without notifying listeners, and clears', () => {
  const backend = memoryBackend();
  const s = new Store({ backend });
  let calls = 0;
  s.subscribe(() => (calls += 1));
  s.saveDraftSession({ title: 'Gym A', exercises: [] });
  assert.equal(calls, 0);
  assert.equal(new Store({ backend }).draftSession.title, 'Gym A');
  s.saveDraftSession(null);
  assert.equal(new Store({ backend }).draftSession, null);
});
