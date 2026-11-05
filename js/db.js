// Tiny IndexedDB wrapper. Stores:
//  kv      – small values (journal, sync meta, settings)
//  blobs   – photo blobs keyed by repo path (local cache + not-yet-uploaded)
//  outbox  – photo paths waiting to be uploaded

const DB_NAME = 'table-for-two';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['kv', 'blobs', 'outbox']) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  set: (store, key, value) => tx(store, 'readwrite', (s) => { s.put(value, key); }),
  del: (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); }),
  keys: (store) => tx(store, 'readonly', (s) => s.getAllKeys()),
  clear: (store) => tx(store, 'readwrite', (s) => { s.clear(); }),
};

// Settings live in localStorage so they are available synchronously at boot.
export const settings = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('t42.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('t42.' + key, JSON.stringify(value)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem('t42.' + key); } catch {}
  },
};
