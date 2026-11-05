// Local-first journal store with field-level merge into GitHub.
//
// The whole journal lives in one JSON file in the data repo (journal.json),
// photos live next to it under photos/<visitId>/. Every local edit records
// which fields changed; on sync we fetch the latest remote journal, re-apply
// only our changed fields on top of it, and write it back. That way Stefan
// editing the memories and Marleen adding her rating to the same visit at the
// same time never overwrite each other.

import { db, settings } from './db.js';
import { createClient, utf8ToBase64, blobToBase64 } from './github.js';

const JOURNAL_PATH = 'journal.json';
export const COLLECTIONS = ['restaurants', 'visits', 'chefs', 'wines', 'wishes'];
const EMPTY = () => ({ schema: 1, restaurants: {}, visits: {}, chefs: {}, wines: {}, wishes: {} });
function normalise(j) { for (const c of COLLECTIONS) j[c] ||= {}; return j; }

let journal = EMPTY();
let meta = { remoteSha: null, lastSyncAt: null, dirty: {}, removedPhotos: {}, seq: 0 };
let status = { state: 'idle', message: '' };
const listeners = new Set();
const urlCache = new Map();
let syncing = null;
let syncTimer = null;

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {});
  const last = keys[keys.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = clone(value);
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function me() { return settings.get('user'); }

function client() {
  const repo = settings.get('repo');
  const token = settings.get('token');
  return repo && token ? createClient({ repo, token }) : null;
}

function emit(kind = 'data') { for (const fn of listeners) fn(kind); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function setStatus(state, message = '') { status = { state, message }; emit('status'); }
export function getStatus() {
  return {
    ...status,
    pending: Object.keys(meta.dirty).length,
    lastSyncAt: meta.lastSyncAt,
    connected: !!client(),
  };
}

async function persist() {
  await db.set('kv', 'journal', journal);
  await db.set('kv', 'meta', meta);
}

export async function load() {
  journal = normalise((await db.get('kv', 'journal')) || EMPTY());
  meta = { ...meta, ...((await db.get('kv', 'meta')) || {}) };
  emit();
}

// ---------- reading ----------

export function restaurants() {
  return Object.values(journal.restaurants).filter((r) => !r.deleted);
}
export function restaurant(id) {
  const r = journal.restaurants[id];
  return r && !r.deleted ? r : null;
}
export function list(coll) {
  return Object.values(journal[coll] || {}).filter((x) => !x.deleted);
}
export function get(coll, id) {
  const x = journal[coll]?.[id];
  return x && !x.deleted ? x : null;
}
export function visit(id) {
  const v = journal.visits[id];
  return v && !v.deleted ? v : null;
}
export function visits() {
  return Object.values(journal.visits)
    .filter((v) => !v.deleted && restaurant(v.restaurantId))
    .sort(compareVisits);
}
export function visitsOf(restaurantId) {
  return visits().filter((v) => v.restaurantId === restaurantId);
}

export function sortKey(v) {
  const d = v.date || {};
  if (!d.y || d.precision === 'unknown') return -1;
  return d.y * 10000 + (d.m || 0) * 100 + (d.d || 0);
}
function compareVisits(a, b) {
  const ka = sortKey(a), kb = sortKey(b);
  if (ka !== kb) return kb - ka; // newest first, undated last
  return (b.createdAt || '').localeCompare(a.createdAt || '');
}

// ---------- writing ----------

function markDirty(coll, id, fields) {
  const key = `${coll}/${id}`;
  const entry = meta.dirty[key] || (meta.dirty[key] = {});
  for (const f of fields) entry[f] = ++meta.seq;
}

// patch: { fieldPath: value } using dot paths for nested fields ("ratings.Stefan").
export async function save(coll, id, patch) {
  const now = new Date().toISOString();
  const rec = journal[coll][id] || (journal[coll][id] = { id, createdAt: now, createdBy: me() });
  const fields = Object.keys(patch);
  for (const f of fields) setPath(rec, f, patch[f]);
  rec.updatedAt = now;
  rec.updatedBy = me();
  const touched = [...fields, 'updatedAt', 'updatedBy'];
  if (rec.createdAt === now) touched.push('id', 'createdAt', 'createdBy');
  markDirty(coll, id, touched);
  await persist();
  emit();
  scheduleSync();
  return rec;
}

export async function remove(coll, id) {
  await save(coll, id, { deleted: true });
}

// ---------- photos ----------

export async function addPhotoBlob(path, blob) {
  await db.set('blobs', path, blob);
  await db.set('outbox', path, { path, addedAt: Date.now() });
}

export async function forgetPhoto(visitId, photoId) {
  const list = meta.removedPhotos[visitId] || (meta.removedPhotos[visitId] = []);
  if (!list.includes(photoId)) list.push(photoId);
  await persist();
}

export async function photoURL(path) {
  if (!path) return null;
  if (urlCache.has(path)) return urlCache.get(path);
  let blob = await db.get('blobs', path);
  if (!blob) {
    const c = client();
    if (!c) return null;
    try {
      blob = await c.readBlob(path);
      await db.set('blobs', path, blob);
    } catch { return null; }
  }
  const url = URL.createObjectURL(blob);
  urlCache.set(path, url);
  return url;
}

// ---------- sync ----------

function mergeInto(base, local, dirty, removedPhotos) {
  const out = clone(base);
  normalise(out);
  for (const key of Object.keys(dirty)) {
    const [coll, id] = key.split('/');
    const src = local[coll]?.[id];
    if (!src) continue;
    const dst = out[coll][id] || (out[coll][id] = {});
    for (const field of Object.keys(dirty[key])) {
      if (field === 'photos') {
        const mine = src.photos || [];
        const ids = new Set(mine.map((p) => p.id));
        const removed = new Set(removedPhotos[id] || []);
        const theirs = (dst.photos || []).filter((p) => !ids.has(p.id) && !removed.has(p.id));
        dst.photos = clone([...mine, ...theirs]);
      } else {
        setPath(dst, field, getPath(src, field));
      }
    }
  }
  return out;
}

export function scheduleSync(delay = 1500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync(), delay);
}

export function sync() {
  if (!syncing) syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function uploadOutbox(c) {
  const paths = await db.keys('outbox');
  for (const path of paths) {
    const blob = await db.get('blobs', path);
    if (!blob) { await db.del('outbox', path); continue; }
    try {
      await c.writeFile(path, await blobToBase64(blob), `${me() || 'App'}: add photo`);
    } catch (e) {
      // 422 = file already exists (an earlier upload that we never heard back from).
      if (e.status !== 422) throw e;
    }
    await db.del('outbox', path);
  }
}

async function doSync() {
  const c = client();
  if (!c) { setStatus('local'); return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  setStatus('syncing');
  try {
    await uploadOutbox(c);

    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await c.readText(JOURNAL_PATH);
      const remoteJournal = normalise(remote ? JSON.parse(remote.text) : EMPTY());
      const snapshot = clone(meta.dirty);
      const removedSnapshot = clone(meta.removedPhotos);
      const hasChanges = Object.keys(snapshot).length > 0;

      let merged = remoteJournal;
      let newSha = remote?.sha || null;
      if (hasChanges) {
        merged = mergeInto(remoteJournal, journal, snapshot, removedSnapshot);
        const summary = describeChanges(snapshot, merged);
        try {
          newSha = await c.writeFile(
            JOURNAL_PATH,
            utf8ToBase64(JSON.stringify(merged, null, 1) + '\n'),
            `${me() || 'App'}: ${summary}`,
            remote?.sha,
          );
        } catch (e) {
          if (e.status === 409 || e.status === 422) continue; // someone else wrote first: retry
          throw e;
        }
      }

      // Drop the dirty marks we just wrote, unless the field was edited again meanwhile.
      for (const key of Object.keys(snapshot)) {
        for (const f of Object.keys(snapshot[key])) {
          if (meta.dirty[key]?.[f] === snapshot[key][f]) delete meta.dirty[key][f];
        }
        if (meta.dirty[key] && !Object.keys(meta.dirty[key]).length) delete meta.dirty[key];
      }
      for (const vid of Object.keys(removedSnapshot)) delete meta.removedPhotos[vid];

      const before = JSON.stringify(journal);
      journal = mergeInto(merged, journal, meta.dirty, meta.removedPhotos);
      meta.remoteSha = newSha;
      if (JSON.stringify(journal) !== before) emit('data');
      meta.lastSyncAt = new Date().toISOString();
      await persist();
      setStatus('idle');
      if (Object.keys(meta.dirty).length) scheduleSync(500);
      return;
    }
    setStatus('error', 'Could not merge with the latest version, will retry.');
    scheduleSync(10000);
  } catch (e) {
    console.error(e);
    if (e.status === 401) setStatus('error', 'GitHub rejected the access key. Check it in Settings.');
    else if (e.status === 404) setStatus('error', 'Data repository not found, or the key has no access to it.');
    else if (e instanceof TypeError) setStatus('offline');
    else setStatus('error', e.message || 'Sync failed');
  }
}

function describeChanges(dirty, merged) {
  const keys = Object.keys(dirty);
  if (keys.length === 1) {
    const [coll, id] = keys[0].split('/');
    const rec = merged[coll][id];
    const name = coll === 'visits' ? merged.restaurants[rec?.restaurantId]?.name : rec?.name;
    const noun = { chefs: 'chef ', wines: 'wine ', wishes: 'wish list: ' }[coll] || '';
    if (rec?.deleted) return `remove ${coll === 'visits' ? 'visit to ' : noun}${name || id}`;
    return `${coll === 'visits' ? 'update visit to' : 'update ' + noun}${coll === 'visits' ? ' ' : ''}${name || id}`;
  }
  return `update ${keys.length} entries`;
}

// Throw away local cache and re-download everything (used from Settings).
export async function resetLocal() {
  journal = EMPTY();
  meta = { remoteSha: null, lastSyncAt: null, dirty: {}, removedPhotos: {}, seq: 0 };
  await persist();
  emit();
  return sync();
}

export function exportJSON() {
  return JSON.stringify(journal, null, 1);
}
