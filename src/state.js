// In-memory copy of the active semester's data. Screens read from here;
// after any save they call reload() and the router re-renders.
import { getActiveSemester, getActiveTimer, getMeta, loadSemesterData } from './db/repo.js';

export const state = {
  semester: null,
  subjects: [],
  units: [],
  topics: [],
  deadlines: [],
  slots: [],
  sessions: [],
  cards: [], // flashcards for this semester's topics
  attendance: [], // one record per class per date
  timer: null, // the running focus timer, if any
  storySeen: null, // Monday of the last weekly story dismissed on Today
  summit: null, // today's summit topic: { date, topicId, subjectId, kind, celebrated }
  installDismissed: false, // "Not now" on Today's install card
  room: null, // the focus room you're in: { code, status, members, selfId, clockOffset }
  roomMe: null, // { id, name } you use in focus rooms
  importBatch: '', // your section/batch, remembered for timetable import
};

// Things to run after every reload (e.g. telling your focus room the timer changed).
const reloadListeners = new Set();
export const afterReload = (fn) => reloadListeners.add(fn);

export async function reload() {
  state.semester = await getActiveSemester();
  state.timer = await getActiveTimer();
  state.storySeen = await getMeta('storySeen');
  state.summit = await getMeta('summit');
  state.installDismissed = Boolean(await getMeta('installDismissed'));
  state.roomMe = await getMeta('roomMe');
  state.importBatch = (await getMeta('importBatch')) ?? '';
  if (!state.semester) {
    Object.assign(state, { subjects: [], units: [], topics: [], deadlines: [], slots: [], sessions: [], cards: [], attendance: [] });
    return state;
  }
  Object.assign(state, await loadSemesterData(state.semester.id));
  state.subjects.sort((a, b) => a.name.localeCompare(b.name));
  for (const fn of reloadListeners) fn(state);
  return state;
}

export function subjectById(id) {
  return state.subjects.find((s) => s.id === id) ?? null;
}

/** A topic's flashcards, oldest first. */
export function cardsFor(topicId) {
  return state.cards.filter((c) => c.topicId === topicId).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}
