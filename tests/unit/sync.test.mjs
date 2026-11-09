import test from 'node:test';
import assert from 'node:assert/strict';
import { toRecords, pendingChanges, applyRemote, previewImport, contentKey, batches } from '../../public/assets/js/lib/sync.js';

const T = (h) => `2026-11-0${h}T10:00:00.000Z`;
function sample() {
  return {
    profile: { id: 'p', ageYears: 30, updatedAt: T(1) },
    preferences: { units: 'metric', updatedAt: T(1) },
    workouts: [{ id: 'w1', type: 'activity', localDate: '2026-11-01', activityId: 'yoga', durationMin: 30, updatedAt: T(1) }],
    weights: [
      { id: 'k1', localDate: '2026-11-01', weightKg: 80, updatedAt: T(1) },
      { id: 'k2', localDate: '2026-11-02', weightKg: 79.5, updatedAt: T(3) },
    ],
    foods: [],
    diary: [],
    tombstones: [],
  };
}

test('toRecords covers lists and singletons with stable IDs', () => {
  const r = toRecords(sample());
  assert.deepEqual(r.map((x) => `${x.collection}:${x.id}`).sort(), ['preferences:preferences', 'profile:profile', 'weights:k1', 'weights:k2', 'workouts:w1']);
  // Preferences without a timestamp (never changed) are not synced.
  assert.ok(!toRecords({ ...sample(), preferences: { units: 'metric' } }).some((x) => x.collection === 'preferences'));
});

test('pendingChanges: only records changed since the last push, plus deletions', () => {
  const d = { ...sample(), tombstones: [{ collection: 'weights', id: 'gone', deletedAt: T(4) }] };
  const p = pendingChanges(d, T(2));
  assert.deepEqual(p.map((x) => `${x.collection}:${x.id}:${x.deleted}`), ['weights:k2:false', 'weights:gone:true']);
  assert.equal(pendingChanges(d, null).length, 6);
});

test('applyRemote: last write wins, deletions respect newer local edits', () => {
  const d = sample();
  const { data, applied, kept } = applyRemote(d, [
    { collection: 'weights', id: 'k1', updatedAt: T(2), deleted: false, data: { id: 'k1', localDate: '2026-11-01', weightKg: 81, updatedAt: T(2) } }, // newer -> applied
    { collection: 'weights', id: 'k2', updatedAt: T(2), deleted: false, data: { id: 'k2', weightKg: 1, updatedAt: T(2) } }, // older -> kept
    { collection: 'workouts', id: 'w1', updatedAt: T(2), deleted: true, data: null }, // delete newer -> removed
    { collection: 'weights', id: 'k3', updatedAt: T(2), deleted: false, data: { id: 'k3', localDate: '2026-11-03', weightKg: 78, updatedAt: T(2) } }, // new
    { collection: 'profile', id: 'profile', updatedAt: T(5), deleted: false, data: { ageYears: 31, updatedAt: T(5) } },
    { collection: 'secrets', id: 'x', updatedAt: T(9), deleted: false, data: {} }, // ignored
  ]);
  assert.equal(data.weights.find((w) => w.id === 'k1').weightKg, 81);
  assert.equal(data.weights.find((w) => w.id === 'k2').weightKg, 79.5);
  assert.equal(data.workouts.length, 0);
  assert.ok(data.weights.some((w) => w.id === 'k3'));
  assert.equal(data.profile.ageYears, 31);
  assert.equal(applied, 4);
  assert.equal(kept, 1);
  assert.equal(d.weights[0].weightKg, 80, 'input not mutated');
  // A remote deletion older than a local edit keeps the local item.
  const keep = applyRemote(sample(), [{ collection: 'weights', id: 'k2', updatedAt: T(2), deleted: true, data: null }]);
  assert.ok(keep.data.weights.some((w) => w.id === 'k2'));
});

test('preview: uploads, downloads, already there, conflicts and likely duplicates', () => {
  const remote = [
    { collection: 'weights', id: 'k1', updatedAt: T(1), deleted: false, data: { id: 'k1', localDate: '2026-11-01', weightKg: 80 } }, // same
    { collection: 'weights', id: 'other', updatedAt: T(1), deleted: false, data: { id: 'other', localDate: '2026-11-02', weightKg: 79.5 } }, // same content as k2
    { collection: 'workouts', id: 'w1', updatedAt: T(5), deleted: false, data: { id: 'w1' } }, // account newer
    { collection: 'diary', id: 'd9', updatedAt: T(1), deleted: false, data: { id: 'd9', localDate: '2026-11-01', meal: 'lunch', name: 'Apple', servingG: 100 } }, // download
    { collection: 'weights', id: 'dead', updatedAt: T(1), deleted: true, data: null },
  ];
  const p = previewImport(sample(), remote);
  assert.deepEqual(p.toUpload.map((r) => r.id).sort(), ['preferences', 'profile']);
  assert.deepEqual(p.duplicates.map((r) => r.id), ['k2']);
  assert.deepEqual(p.alreadyThere.map((r) => r.id), ['k1']);
  assert.deepEqual(p.conflicts.map((c) => [c.record.id, c.winner]), [['w1', 'account']]);
  assert.deepEqual(p.toDownload.map((r) => r.id), ['d9']);
  assert.deepEqual(p.summary, { upload: { profile: 1, preferences: 1 }, download: { diary: 1 }, duplicates: 1, alreadyThere: 1, conflicts: 1 });
  // Empty account: everything uploads, nothing to download.
  const fresh = previewImport(sample(), []);
  assert.equal(fresh.toUpload.length, 5);
  assert.equal(fresh.toDownload.length, 0);
});

test('content keys', () => {
  assert.equal(contentKey('weights', { localDate: '2026-11-01', weightKg: 80 }), 'w|2026-11-01|80.0');
  assert.equal(contentKey('foods', { source: 'usda-fdc', sourceId: '171688', name: 'x' }), 'f|usda-fdc|171688');
  assert.equal(contentKey('foods', { source: 'custom', name: ' Oats ', brand: null, preparation: 'raw' }), 'f|custom|oats||raw');
  assert.equal(contentKey('profile', {}), null);
});

test('batches', () => {
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(batches([], 500), []);
});
