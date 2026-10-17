// Builders for new records, with sensible defaults. Pure apart from id creation.

export const SUBJECT_COLORS = ['#2f6f6a', '#c7794a', '#6b7fb3', '#a06a9a', '#7a9a4f', '#b8913a', '#4f8fa8', '#b5655f'];

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** First colour not used yet, cycling when all are taken. */
export function pickColor(usedColors = []) {
  const free = SUBJECT_COLORS.find((c) => !usedColors.includes(c));
  return free ?? SUBJECT_COLORS[usedColors.length % SUBJECT_COLORS.length];
}

// Planner settings added in Milestone 2, focus lengths in Milestone 3. Older saved semesters don't have them.
export const SEMESTER_DEFAULTS = {
  dailyLimitMin: 180,
  studyFrom: '07:00',
  studyTo: '23:00',
  bufferDays: 2,
  offDays: [],
  focusMin: 25,
  breakMin: 5,
  keepAwake: true, // keep the screen on while the focus timer runs
  streakMinMin: 10, // Milestone 7: study a day needs to count for the streak
};

export function makeSemester(fields = {}) {
  return { id: newId(), name: '', startDate: '', endDate: '', ...SEMESTER_DEFAULTS, offDays: [], ...fields };
}

/** The semester with any missing planner settings filled in. */
export function withSemesterDefaults(semester) {
  const s = { ...SEMESTER_DEFAULTS, ...semester };
  if (!Array.isArray(s.offDays)) s.offDays = [];
  return s;
}

export function makeSession(fields = {}) {
  return {
    id: newId(),
    semesterId: '',
    subjectId: '',
    topicId: '',
    date: '',
    minutes: 0,
    finished: false,
    kind: 'learn', // 'learn' | 'revision'
    rating: null, // 'easy' | 'okay' | 'hard'
    source: 'manual', // 'manual' | 'timer'
    startedAt: null, // ms, for timer sessions
    rounds: 0,
    quiz: null, // Milestone 8: { got: [cardId], missed: [cardId] } from a flashcard quiz
    ...fields,
  };
}

export function makeSubject(fields = {}) {
  return { id: newId(), semesterId: '', name: '', code: '', credits: 3, color: SUBJECT_COLORS[0], ...fields };
}

export function makeUnit(fields = {}) {
  return { id: newId(), subjectId: '', name: '', order: 0, ...fields };
}

export function makeTopic(fields = {}) {
  return { id: newId(), unitId: '', subjectId: '', name: '', estMin: 45, difficulty: 2, order: 0, ...fields };
}

export function makeCard(fields = {}) {
  return { id: newId(), topicId: '', subjectId: '', front: '', back: '', source: 'manual', createdAt: Date.now(), ...fields };
}

export function makeDeadline(fields = {}) {
  return {
    id: newId(),
    semesterId: '',
    subjectId: '',
    type: 'quiz',
    title: '',
    date: '',
    weight: 10,
    unitIds: [],
    ...fields,
  };
}

export function makeSlot(fields = {}) {
  return { id: newId(), semesterId: '', subjectId: '', label: '', day: 0, start: '09:00', end: '10:00', ...fields };
}

export const DIFFICULTY_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
export const RATING_LABELS = { easy: 'Easy', okay: 'Okay', hard: 'Hard' };
