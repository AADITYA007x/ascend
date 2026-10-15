// Domain-level data access. Screens talk to this, not to idb.js directly.
// Deletes return a "snapshot" ({ storeName: [records] }) that restore() can put back (for Undo).

import { tx, get, put, putMany, reqToPromise } from './idb.js';

const ACTIVE_KEY = 'activeSemesterId';

// ---------- Semester ----------

export async function getActiveSemester() {
  const meta = await get('meta', ACTIVE_KEY);
  if (!meta?.value) return null;
  return (await get('semesters', meta.value)) ?? null;
}

export function saveSemester(semester) {
  return tx(['semesters', 'meta'], 'readwrite', (t) => {
    t.objectStore('semesters').put(semester);
    t.objectStore('meta').put({ key: ACTIVE_KEY, value: semester.id });
    return semester;
  });
}

/** Everything for one semester, in one read transaction. */
export function loadSemesterData(semesterId) {
  const stores = ['subjects', 'units', 'topics', 'deadlines', 'classSlots'];
  return tx(stores, 'readonly', async (t) => {
    const [subjects, units, topics, deadlines, slots] = await Promise.all([
      reqToPromise(t.objectStore('subjects').index('semesterId').getAll(semesterId)),
      reqToPromise(t.objectStore('units').getAll()),
      reqToPromise(t.objectStore('topics').getAll()),
      reqToPromise(t.objectStore('deadlines').index('semesterId').getAll(semesterId)),
      reqToPromise(t.objectStore('classSlots').index('semesterId').getAll(semesterId)),
    ]);
    const subjectIds = new Set(subjects.map((s) => s.id));
    return {
      subjects,
      units: units.filter((u) => subjectIds.has(u.subjectId)),
      topics: topics.filter((tp) => subjectIds.has(tp.subjectId)),
      deadlines,
      slots,
    };
  });
}

// ---------- Simple saves ----------

export const saveSubject = (s) => put('subjects', s);
export const saveUnit = (u) => put('units', u);
export const saveTopic = (tp) => put('topics', tp);
export const saveDeadline = (d) => put('deadlines', d);
export const saveSlot = (s) => put('classSlots', s);
export const saveUnits = (list) => putMany('units', list);
export const saveTopics = (list) => putMany('topics', list);

// ---------- Deletes (with snapshot for undo) ----------

async function deleteWithSnapshot(storeNames, collect) {
  return tx(storeNames, 'readwrite', async (t) => {
    const snapshot = await collect(t);
    for (const [store, records] of Object.entries(snapshot.removed)) {
      const os = t.objectStore(store);
      for (const r of records) os.delete(r.id);
    }
    for (const [store, records] of Object.entries(snapshot.updated ?? {})) {
      const os = t.objectStore(store);
      for (const r of records.after) os.put(r);
    }
    // For restore: removed records go back as they were; updated records go back to "before".
    const restore = { ...snapshot.removed };
    for (const [store, records] of Object.entries(snapshot.updated ?? {})) {
      restore[store] = [...(restore[store] ?? []), ...records.before];
    }
    return restore;
  });
}

const byIndex = (t, store, index, value) => reqToPromise(t.objectStore(store).index(index).getAll(value));
const byKey = (t, store, key) => reqToPromise(t.objectStore(store).get(key));

/** Removes a subject and everything that belongs to it. */
export function deleteSubject(subjectId) {
  const stores = ['subjects', 'units', 'topics', 'deadlines', 'classSlots'];
  return deleteWithSnapshot(stores, async (t) => {
    const [subject, units, topics, deadlines, slots] = await Promise.all([
      byKey(t, 'subjects', subjectId),
      byIndex(t, 'units', 'subjectId', subjectId),
      byIndex(t, 'topics', 'subjectId', subjectId),
      byIndex(t, 'deadlines', 'subjectId', subjectId),
      byIndex(t, 'classSlots', 'subjectId', subjectId),
    ]);
    return {
      removed: {
        subjects: subject ? [subject] : [],
        units,
        topics,
        deadlines,
        classSlots: slots,
      },
    };
  });
}

/** Removes a unit, its topics, and unlinks it from deadlines. */
export function deleteUnit(unitId, subjectId) {
  return deleteWithSnapshot(['units', 'topics', 'deadlines'], async (t) => {
    const [unit, topics, deadlines] = await Promise.all([
      byKey(t, 'units', unitId),
      byIndex(t, 'topics', 'unitId', unitId),
      byIndex(t, 'deadlines', 'subjectId', subjectId),
    ]);
    const linked = deadlines.filter((d) => d.unitIds?.includes(unitId));
    return {
      removed: { units: unit ? [unit] : [], topics },
      updated: {
        deadlines: {
          before: linked,
          after: linked.map((d) => ({ ...d, unitIds: d.unitIds.filter((id) => id !== unitId) })),
        },
      },
    };
  });
}

function deleteOne(store, id) {
  return deleteWithSnapshot([store], async (t) => {
    const rec = await byKey(t, store, id);
    return { removed: { [store]: rec ? [rec] : [] } };
  });
}

export const deleteTopic = (id) => deleteOne('topics', id);
export const deleteDeadline = (id) => deleteOne('deadlines', id);
export const deleteSlot = (id) => deleteOne('classSlots', id);

/** Puts back records from a delete snapshot. */
export function restore(snapshot) {
  const stores = Object.keys(snapshot).filter((s) => snapshot[s].length);
  if (!stores.length) return Promise.resolve();
  return tx(stores, 'readwrite', (t) => {
    for (const s of stores) {
      const os = t.objectStore(s);
      for (const r of snapshot[s]) os.put(r);
    }
  });
}
