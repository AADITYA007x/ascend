// A small promise wrapper around IndexedDB. No library.

const DB_NAME = 'ascend';
const DB_VERSION = 3;

// Stores and their indexes. Bump DB_VERSION and extend upgrade() for future changes.
function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('semesters', { keyPath: 'id' });

    const subjects = db.createObjectStore('subjects', { keyPath: 'id' });
    subjects.createIndex('semesterId', 'semesterId');

    const units = db.createObjectStore('units', { keyPath: 'id' });
    units.createIndex('subjectId', 'subjectId');

    const topics = db.createObjectStore('topics', { keyPath: 'id' });
    topics.createIndex('unitId', 'unitId');
    topics.createIndex('subjectId', 'subjectId');

    const deadlines = db.createObjectStore('deadlines', { keyPath: 'id' });
    deadlines.createIndex('semesterId', 'semesterId');
    deadlines.createIndex('subjectId', 'subjectId');

    const slots = db.createObjectStore('classSlots', { keyPath: 'id' });
    slots.createIndex('semesterId', 'semesterId');
    slots.createIndex('subjectId', 'subjectId');
  }
  if (oldVersion < 2) {
    // Milestone 2: a log of what was studied. The plan itself is never stored.
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('semesterId', 'semesterId');
    sessions.createIndex('subjectId', 'subjectId');
    sessions.createIndex('topicId', 'topicId');
  }
  if (oldVersion < 3) {
    // Milestone 8: flashcards. Quiz answers ride on sessions, so cards hold only front and back.
    const cards = db.createObjectStore('cards', { keyPath: 'id' });
    cards.createIndex('topicId', 'topicId');
    cards.createIndex('subjectId', 'subjectId');
  }
}

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      // Another tab opened a newer version: close so it can upgrade.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Ascend is open in another tab with an older version. Close it and reload.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Runs fn(tx) inside one transaction over the given stores and resolves
 * with fn's result once the transaction has committed.
 */
export async function tx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let value;
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
    Promise.resolve(fn(t)).then(
      (v) => {
        value = v;
      },
      (err) => {
        try {
          t.abort();
        } catch {
          /* already finished */
        }
        reject(err);
      },
    );
  });
}

export function get(store, key) {
  return tx([store], 'readonly', (t) => reqToPromise(t.objectStore(store).get(key)));
}

export function getAll(store) {
  return tx([store], 'readonly', (t) => reqToPromise(t.objectStore(store).getAll()));
}

export function getAllByIndex(store, index, value) {
  return tx([store], 'readonly', (t) => reqToPromise(t.objectStore(store).index(index).getAll(value)));
}

export function put(store, value) {
  return tx([store], 'readwrite', (t) => {
    t.objectStore(store).put(value);
    return value;
  });
}

export function putMany(store, values) {
  return tx([store], 'readwrite', (t) => {
    const os = t.objectStore(store);
    for (const v of values) os.put(v);
    return values;
  });
}

export function del(store, key) {
  return tx([store], 'readwrite', (t) => {
    t.objectStore(store).delete(key);
  });
}

export { reqToPromise };
