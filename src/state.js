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
  timer: null, // the running focus timer, if any
  storySeen: null, // Monday of the last weekly story dismissed on Today
  summit: null, // today's summit topic: { date, topicId, subjectId, kind, celebrated }
};

export async function reload() {
  state.semester = await getActiveSemester();
  state.timer = await getActiveTimer();
  state.storySeen = await getMeta('storySeen');
  state.summit = await getMeta('summit');
  if (!state.semester) {
    Object.assign(state, { subjects: [], units: [], topics: [], deadlines: [], slots: [], sessions: [] });
    return state;
  }
  Object.assign(state, await loadSemesterData(state.semester.id));
  state.subjects.sort((a, b) => a.name.localeCompare(b.name));
  return state;
}

export function subjectById(id) {
  return state.subjects.find((s) => s.id === id) ?? null;
}
