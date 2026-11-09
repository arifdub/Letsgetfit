// Sync between this device and an optional account. Pure functions; no network or DOM.
//
// Model: every synced item is a record { collection, id, updatedAt, deleted, data }.
//  - Collections with many items (workouts, weights, foods, diary) use each item's stable UUID.
//  - profile and preferences are single records with id equal to the collection name.
// Conflicts resolve last-write-wins on updatedAt (UTC ISO 8601). Deleting an item on a linked
// device leaves a tombstone so the deletion reaches other devices.

export const LIST_COLLECTIONS = Object.freeze(['workouts', 'weights', 'foods', 'diary']);
export const SINGLETONS = Object.freeze(['profile', 'preferences']);
export const COLLECTION_LABELS = Object.freeze({
  profile: 'Your details',
  preferences: 'Settings',
  workouts: 'Workouts',
  weights: 'Weight entries',
  foods: 'Saved foods',
  diary: 'Food diary entries',
});

const isNewer = (a, b) => String(a ?? '') > String(b ?? '');

/** All local items as sync records. */
export function toRecords(data) {
  const out = [];
  for (const collection of LIST_COLLECTIONS) {
    for (const item of data[collection] ?? []) {
      if (!item?.id) continue;
      out.push({ collection, id: item.id, updatedAt: item.updatedAt ?? item.createdAt ?? new Date(0).toISOString(), deleted: false, data: item });
    }
  }
  if (data.profile) out.push({ collection: 'profile', id: 'profile', updatedAt: data.profile.updatedAt ?? new Date(0).toISOString(), deleted: false, data: data.profile });
  if (data.preferences?.updatedAt) out.push({ collection: 'preferences', id: 'preferences', updatedAt: data.preferences.updatedAt, deleted: false, data: data.preferences });
  return out;
}

/** Records to push: local changes since the last push, plus pending deletions. */
export function pendingChanges(data, lastPushAt) {
  const changed = toRecords(data).filter((r) => !lastPushAt || isNewer(r.updatedAt, lastPushAt));
  const deletions = (data.tombstones ?? []).map((t) => ({ collection: t.collection, id: t.id, updatedAt: t.deletedAt, deleted: true, data: null }));
  return [...changed, ...deletions];
}

/**
 * Merge records from the server into local data (last write wins).
 * @returns {{ data: object, applied: number, kept: number }}
 */
export function applyRemote(data, remote) {
  const next = { ...data };
  for (const c of LIST_COLLECTIONS) next[c] = [...(data[c] ?? [])];
  let applied = 0;
  let kept = 0;
  for (const r of remote) {
    if (SINGLETONS.includes(r.collection)) {
      const local = next[r.collection];
      const localUpdated = local?.updatedAt;
      if (r.deleted) continue; // singletons are never deleted remotely
      if (!localUpdated || isNewer(r.updatedAt, localUpdated)) {
        next[r.collection] = r.data;
        applied += 1;
      } else kept += 1;
      continue;
    }
    if (!LIST_COLLECTIONS.includes(r.collection)) continue;
    const list = next[r.collection];
    const index = list.findIndex((item) => item.id === r.id);
    const local = index === -1 ? null : list[index];
    const localUpdated = local?.updatedAt ?? local?.createdAt;
    if (r.deleted) {
      if (local && !isNewer(localUpdated, r.updatedAt)) {
        list.splice(index, 1);
        applied += 1;
      } else if (local) kept += 1;
      continue;
    }
    if (!local) {
      list.push({ ...r.data, id: r.id });
      applied += 1;
    } else if (isNewer(r.updatedAt, localUpdated)) {
      list[index] = { ...r.data, id: r.id };
      applied += 1;
    } else kept += 1;
  }
  return { data: next, applied, kept };
}

/** A content key that spots the same entry saved under different IDs (for example on two devices). */
export function contentKey(collection, item) {
  if (!item) return null;
  const n = (v) => String(v ?? '').trim().toLowerCase();
  switch (collection) {
    case 'weights':
      return `w|${item.localDate}|${Number(item.weightKg).toFixed(1)}`;
    case 'workouts':
      return `x|${item.localDate}|${item.type ?? 'activity'}|${n(item.title ?? item.activityId)}|${item.durationMin}`;
    case 'diary':
      return `d|${item.localDate}|${item.meal}|${n(item.name)}|${item.servingG}`;
    case 'foods':
      return item.source && item.source !== 'custom' && item.sourceId ? `f|${item.source}|${item.sourceId}` : `f|custom|${n(item.name)}|${n(item.brand)}|${item.preparation ?? ''}`;
    default:
      return null;
  }
}

/**
 * Preview copying this device's data into an account that already holds `remote` records.
 * Nothing is changed. Likely duplicates (same content, different ID) are skipped by default.
 */
export function previewImport(localData, remote) {
  const local = toRecords(localData);
  const remoteById = new Map(remote.filter((r) => !r.deleted).map((r) => [`${r.collection}|${r.id}`, r]));
  const remoteKeys = new Set(remote.filter((r) => !r.deleted).map((r) => contentKey(r.collection, r.data)).filter(Boolean));
  const localById = new Set(local.map((r) => `${r.collection}|${r.id}`));
  const toUpload = [];
  const duplicates = [];
  const alreadyThere = [];
  const conflicts = [];
  for (const r of local) {
    const match = remoteById.get(`${r.collection}|${r.id}`);
    if (match) {
      if (isNewer(r.updatedAt, match.updatedAt)) conflicts.push({ record: r, winner: 'device' });
      else if (isNewer(match.updatedAt, r.updatedAt)) conflicts.push({ record: r, winner: 'account' });
      else alreadyThere.push(r);
      continue;
    }
    if (SINGLETONS.includes(r.collection)) {
      // The account has no copy: upload. (A copy with another ID cannot exist for singletons.)
      toUpload.push(r);
      continue;
    }
    const key = contentKey(r.collection, r.data);
    if (key && remoteKeys.has(key)) duplicates.push(r);
    else toUpload.push(r);
  }
  // Account items that match something on this device by content are the same entry: not downloaded twice.
  const localKeys = new Set(local.map((r) => contentKey(r.collection, r.data)).filter(Boolean));
  const toDownload = remote.filter((r) => !r.deleted && !localById.has(`${r.collection}|${r.id}`) && !localKeys.has(contentKey(r.collection, r.data)));
  const byCollection = (list) =>
    list.reduce((acc, r) => {
      const c = r.collection ?? r.record?.collection;
      acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    }, {});
  return {
    toUpload,
    duplicates,
    alreadyThere,
    conflicts,
    toDownload,
    summary: {
      upload: byCollection(toUpload),
      download: byCollection(toDownload),
      duplicates: duplicates.length,
      alreadyThere: alreadyThere.length,
      conflicts: conflicts.length,
    },
  };
}

/** Split into batches the server accepts. */
export function batches(records, size = 500) {
  const out = [];
  for (let i = 0; i < records.length; i += size) out.push(records.slice(i, i + size));
  return out;
}
