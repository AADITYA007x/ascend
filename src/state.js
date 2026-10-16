// In-memory copy of the active semester's data. Screens read from here;
// after any save they call reload() and the router re-renders.
import { getActiveSemester, getActiveTimer, loadSemesterData } from './db/repo.js';

export const state = {
  semester: null,
  subjects: [],
  units: [],
  topics: [],
  deadlines: [],
  slots: [],
  sessions: [],
  timer: null, // the running focus timer, if any
};

export async function reload() {
  state.semester = await getActiveSemester();
  state.timer = await getActiveTimer();
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
