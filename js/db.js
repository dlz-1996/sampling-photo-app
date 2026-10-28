/* IndexedDB 数据层：批次、照片、设置 */

const DB_NAME = 'sampling-photo-db';
const DB_VERSION = 1;
let dbPromise = null;

const CAT_ORDER = Object.fromEntries(
  ['license', 'invoice', 'sample', 'sealed', 'slip', 'transport'].map((k, i) => [k, i])
);

export const DEFAULT_SETTINGS = {
  inspectorDefault: '',
  maxEdge: 1600,
  quality: 0.85,
  showTime: true,
  showGps: true,
  required: 1,
  lastBackupAt: 0,
  keepOriginal: false,
};

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('batches')) {
        const s = db.createObjectStore('batches', { keyPath: 'id' });
        s.createIndex('byNo', 'batchNo', { unique: false });
        s.createIndex('byStatus', 'status', { unique: false });
        s.createIndex('byUpdated', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('byBatch', 'batchId', { unique: false });
        s.createIndex('byBatchCat', ['batchId', 'category'], { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

async function withStore(store, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(store, mode);
  const result = fn(tx.objectStore(store), tx);
  await txDone(tx);
  return result;
}

/* ---------------- 批次 ---------------- */

export async function listBatches() {
  const db = await openDB();
  const tx = db.transaction('batches', 'readonly');
  const all = await reqPromise(tx.objectStore('batches').getAll());
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getBatch(id) {
  const db = await openDB();
  const tx = db.transaction('batches', 'readonly');
  return reqPromise(tx.objectStore('batches').get(id));
}

export async function putBatch(batch) {
  batch.updatedAt = Date.now();
  await withStore('batches', 'readwrite', s => s.put(batch));
  return batch;
}

export async function deleteBatch(id) {
  const db = await openDB();
  const tx = db.transaction(['batches', 'photos'], 'readwrite');
  tx.objectStore('batches').delete(id);
  const idx = tx.objectStore('photos').index('byBatch');
  const cursorReq = idx.openCursor(IDBKeyRange.only(id));
  cursorReq.onsuccess = () => {
    const cur = cursorReq.result;
    if (cur) { cur.delete(); cur.continue(); }
  };
  await txDone(tx);
}

/* ---------------- 照片 ---------------- */

export async function listPhotos(batchId) {
  const db = await openDB();
  const tx = db.transaction('photos', 'readonly');
  const idx = tx.objectStore('photos').index('byBatch');
  const rows = await reqPromise(idx.getAll(IDBKeyRange.only(batchId)));
  return rows.sort((a, b) => {
    const ca = CAT_ORDER[a.category] ?? 99;
    const cb = CAT_ORDER[b.category] ?? 99;
    if (ca !== cb) return ca - cb;
    return (a.seq || 0) - (b.seq || 0);
  });
}

export async function listPhotosByCategory(batchId, category) {
  const all = await listPhotos(batchId);
  return all.filter(p => p.category === category);
}

export async function getPhoto(id) {
  const db = await openDB();
  const tx = db.transaction('photos', 'readonly');
  return reqPromise(tx.objectStore('photos').get(id));
}

export async function addPhoto(photo) {
  await withStore('photos', 'readwrite', s => s.add(photo));
  return photo;
}

export async function putPhoto(photo) {
  await withStore('photos', 'readwrite', s => s.put(photo));
  return photo;
}

export async function deletePhoto(id) {
  await withStore('photos', 'readwrite', s => s.delete(id));
}

/** 只统计数量，不读取照片 Blob，列表页用 */
export async function countPhotos(batchId) {
  const db = await openDB();
  const tx = db.transaction('photos', 'readonly');
  const idx = tx.objectStore('photos').index('byBatchCat');
  const range = IDBKeyRange.bound([batchId, ''], [batchId, '\uffff']);
  const counts = {};
  let total = 0;
  await new Promise((resolve, reject) => {
    const req = idx.openKeyCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      const key = cur.key;
      const category = Array.isArray(key) ? key[1] : '';
      counts[category] = (counts[category] || 0) + 1;
      total++;
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return { counts, total, bytes: 0 };
}

export async function allPhotos() {
  const db = await openDB();
  const tx = db.transaction('photos', 'readonly');
  return reqPromise(tx.objectStore('photos').getAll());
}

export async function stats() {
  const db = await openDB();
  const tx = db.transaction(['batches', 'photos'], 'readonly');
  const batches = await reqPromise(tx.objectStore('batches').count());
  const photos = await reqPromise(tx.objectStore('photos').count());
  const est = await storageEstimate();
  const bytes = est?.usage || 0;
  return { batches, photos, bytes };
}

/* ---------------- 设置 ---------------- */

export async function getSettings() {
  const db = await openDB();
  const tx = db.transaction('meta', 'readonly');
  const row = await reqPromise(tx.objectStore('meta').get('settings'));
  return { ...DEFAULT_SETTINGS, ...(row?.value || {}) };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await withStore('meta', 'readwrite', s => s.put({ key: 'settings', value: next }));
  return next;
}

/* ---------------- 维护 ---------------- */

export async function requirePersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

export async function clearEverything() {
  const db = await openDB();
  const tx = db.transaction(['batches', 'photos', 'meta'], 'readwrite');
  tx.objectStore('batches').clear();
  tx.objectStore('photos').clear();
  tx.objectStore('meta').clear();
  await txDone(tx);
}
