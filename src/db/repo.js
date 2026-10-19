// Domain-level data access. Screens talk to this, not to idb.js directly.
// Deletes return a "snapshot" ({ storeName: [records] }) that restore() can put back (for Undo).

import { tx, get, put, putMany, del, reqToPromise } from './idb.js';
import { BACKUP_STORES } from '../model/backup.js';

const ACTIVE_KEY = 'activeSemesterId';
const TIMER_KEY = 'activeTimer';

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
  const stores = ['subjects', 'units', 'topics', 'deadlines', 'classSlots', 'sessions', 'cards', 'attendance'];
  return tx(stores, 'readonly', async (t) => {
    const [subjects, units, topics, deadlines, slots, sessions, cards, attendance] = await Promise.all([
      reqToPromise(t.objectStore('subjects').index('semesterId').getAll(semesterId)),
      reqToPromise(t.objectStore('units').getAll()),
      reqToPromise(t.objectStore('topics').getAll()),
      reqToPromise(t.objectStore('deadlines').index('semesterId').getAll(semesterId)),
      reqToPromise(t.objectStore('classSlots').index('semesterId').getAll(semesterId)),
      reqToPromise(t.objectStore('sessions').index('semesterId').getAll(semesterId)),
      reqToPromise(t.objectStore('cards').getAll()),
      reqToPromise(t.objectStore('attendance').index('semesterId').getAll(semesterId)),
    ]);
    const subjectIds = new Set(subjects.map((s) => s.id));
    return {
      subjects,
      units: units.filter((u) => subjectIds.has(u.subjectId)),
      topics: topics.filter((tp) => subjectIds.has(tp.subjectId)),
      deadlines,
      slots,
      sessions,
      cards: cards.filter((c) => subjectIds.has(c.subjectId)),
      attendance,
    };
  });
}

// ---------- Small settings in the meta store ----------

export async function getMeta(key) {
  return (await get('meta', key))?.value ?? null;
}

export const setMeta = (key, value) => put('meta', { key, value });

// ---------- Focus timer (at most one, kept so it survives reloads) ----------

export async function getActiveTimer() {
  return (await get('meta', TIMER_KEY))?.value ?? null;
}

export const saveActiveTimer = (timer) => put('meta', { key: TIMER_KEY, value: timer });
export const clearActiveTimer = () => del('meta', TIMER_KEY);

/** Saves the session and clears the timer together, so a finished timer can't be saved twice. */
export function saveTimerSession(session) {
  return tx(['sessions', 'meta'], 'readwrite', (t) => {
    t.objectStore('sessions').put(session);
    t.objectStore('meta').delete(TIMER_KEY);
    return session;
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
export const saveSession = (s) => put('sessions', s);
export const saveCard = (c) => put('cards', c);
export const saveCards = (list) => putMany('cards', list);
export const saveAttendance = (r) => put('attendance', r);

/** Saves several marks at once. Returns what undoAttendance needs: the records they replaced and the new ids. */
export function saveAttendanceMany(list) {
  return tx(['attendance'], 'readwrite', async (t) => {
    const os = t.objectStore('attendance');
    const before = (await Promise.all(list.map((r) => reqToPromise(os.get(r.id))))).filter(Boolean);
    for (const r of list) os.put(r);
    const had = new Set(before.map((r) => r.id));
    return { before, added: list.filter((r) => !had.has(r.id)).map((r) => r.id) };
  });
}

export function undoAttendance({ before, added }) {
  return tx(['attendance'], 'readwrite', (t) => {
    const os = t.objectStore('attendance');
    for (const id of added) os.delete(id);
    for (const r of before) os.put(r);
  });
}

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
  const stores = ['subjects', 'units', 'topics', 'deadlines', 'classSlots', 'sessions', 'cards', 'attendance'];
  return deleteWithSnapshot(stores, async (t) => {
    const [subject, units, topics, deadlines, slots, sessions, cards, attendance] = await Promise.all([
      byKey(t, 'subjects', subjectId),
      byIndex(t, 'units', 'subjectId', subjectId),
      byIndex(t, 'topics', 'subjectId', subjectId),
      byIndex(t, 'deadlines', 'subjectId', subjectId),
      byIndex(t, 'classSlots', 'subjectId', subjectId),
      byIndex(t, 'sessions', 'subjectId', subjectId),
      byIndex(t, 'cards', 'subjectId', subjectId),
      byIndex(t, 'attendance', 'subjectId', subjectId),
    ]);
    return {
      removed: {
        subjects: subject ? [subject] : [],
        units,
        topics,
        deadlines,
        classSlots: slots,
        sessions,
        cards,
        attendance,
      },
    };
  });
}

/** Removes a unit, its topics, their study sessions and cards, and unlinks it from deadlines. */
export function deleteUnit(unitId, subjectId) {
  return deleteWithSnapshot(['units', 'topics', 'deadlines', 'sessions', 'cards'], async (t) => {
    const [unit, topics, deadlines, subjectSessions, subjectCards] = await Promise.all([
      byKey(t, 'units', unitId),
      byIndex(t, 'topics', 'unitId', unitId),
      byIndex(t, 'deadlines', 'subjectId', subjectId),
      byIndex(t, 'sessions', 'subjectId', subjectId),
      byIndex(t, 'cards', 'subjectId', subjectId),
    ]);
    const linked = deadlines.filter((d) => d.unitIds?.includes(unitId));
    const topicIds = new Set(topics.map((tp) => tp.id));
    const sessions = subjectSessions.filter((s) => topicIds.has(s.topicId));
    const cards = subjectCards.filter((c) => topicIds.has(c.topicId));
    return {
      removed: { units: unit ? [unit] : [], topics, sessions, cards },
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

/** Removes a topic, its study sessions and its cards. */
export function deleteTopic(id) {
  return deleteWithSnapshot(['topics', 'sessions', 'cards'], async (t) => {
    const [topic, sessions, cards] = await Promise.all([
      byKey(t, 'topics', id),
      byIndex(t, 'sessions', 'topicId', id),
      byIndex(t, 'cards', 'topicId', id),
    ]);
    return { removed: { topics: topic ? [topic] : [], sessions, cards } };
  });
}

export const deleteSession = (id) => deleteOne('sessions', id);
export const deleteDeadline = (id) => deleteOne('deadlines', id);
/** Removes a class from the timetable and its attendance records. */
export function deleteSlot(id) {
  return deleteWithSnapshot(['classSlots', 'attendance'], async (t) => {
    const [slot, attendance] = await Promise.all([byKey(t, 'classSlots', id), byIndex(t, 'attendance', 'slotId', id)]);
    return { removed: { classSlots: slot ? [slot] : [], attendance } };
  });
}

export const deleteAttendance = (id) => deleteOne('attendance', id);

/**
 * Saves an imported timetable in one go: new subjects, new classes, and (when replacing) removes
 * old classes with their attendance marks. Returns what undoImport needs.
 */
export function saveImport({ subjects = [], slots = [], removeSlotIds = [] }) {
  return tx(['subjects', 'classSlots', 'attendance'], 'readwrite', async (t) => {
    const slotStore = t.objectStore('classSlots');
    const marks = t.objectStore('attendance');
    const [removedSlots, removedMarks] = await Promise.all([
      Promise.all(removeSlotIds.map((id) => reqToPromise(slotStore.get(id)))).then((list) => list.filter(Boolean)),
      Promise.all(removeSlotIds.map((id) => reqToPromise(marks.index('slotId').getAll(id)))).then((list) => list.flat()),
    ]);
    for (const s of removedSlots) slotStore.delete(s.id);
    for (const r of removedMarks) marks.delete(r.id);
    for (const s of subjects) t.objectStore('subjects').put(s);
    for (const s of slots) slotStore.put(s);
    return {
      added: { subjects: subjects.map((s) => s.id), classSlots: slots.map((s) => s.id) },
      removed: { classSlots: removedSlots, attendance: removedMarks },
    };
  });
}

/** Saves an imported syllabus (only new records). Returns what undoImport needs. */
export function saveSyllabusImport({ subjects = [], units = [], topics = [] }) {
  return tx(['subjects', 'units', 'topics'], 'readwrite', (t) => {
    for (const s of subjects) t.objectStore('subjects').put(s);
    for (const u of units) t.objectStore('units').put(u);
    for (const tp of topics) t.objectStore('topics').put(tp);
    return { added: { subjects: subjects.map((s) => s.id), units: units.map((u) => u.id), topics: topics.map((tp) => tp.id) }, removed: {} };
  });
}

/**
 * Saves and removes sessions together (marking a topic done / not done).
 * Returns what undoImport needs to put things back as they were.
 */
export function saveSessionChanges({ save = [], remove = [] }) {
  return tx(['sessions'], 'readwrite', async (t) => {
    const os = t.objectStore('sessions');
    const ids = [...save.map((s) => s.id), ...remove];
    const before = (await Promise.all(ids.map((id) => reqToPromise(os.get(id))))).filter(Boolean);
    for (const id of remove) os.delete(id);
    for (const s of save) os.put(s);
    const existed = new Set(before.map((s) => s.id));
    return { added: { sessions: save.filter((s) => !existed.has(s.id)).map((s) => s.id) }, removed: { sessions: before } };
  });
}

/** Takes an import back: removes what it added and puts back what it replaced. */
export function undoImport({ added, removed }) {
  const stores = [...new Set([...Object.keys(added), ...Object.keys(removed)])];
  return tx(stores, 'readwrite', (t) => {
    for (const [store, ids] of Object.entries(added)) for (const id of ids) t.objectStore(store).delete(id);
    for (const [store, records] of Object.entries(removed)) for (const r of records) t.objectStore(store).put(r);
  });
}
export const deleteCard = (id) => deleteOne('cards', id);

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

// ---------- Backup ----------

/** Every record in every store, read in one transaction: { storeName: [records] }. */
export function exportAll() {
  return tx(BACKUP_STORES, 'readonly', async (t) => {
    const lists = await Promise.all(BACKUP_STORES.map((s) => reqToPromise(t.objectStore(s).getAll())));
    return Object.fromEntries(BACKUP_STORES.map((s, i) => [s, lists[i]]));
  });
}

/** Replaces everything with a checked backup. One transaction: if anything fails, nothing changes. */
export function replaceAll(stores) {
  return tx(BACKUP_STORES, 'readwrite', (t) => {
    for (const s of BACKUP_STORES) {
      const os = t.objectStore(s);
      os.clear();
      for (const r of stores[s] ?? []) os.put(r);
    }
  });
}
