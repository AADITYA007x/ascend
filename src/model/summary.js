// Totals and setup progress. Pure functions.

/** { units, topics, estMin } for one subject. */
export function subjectTotals(subjectId, units, topics) {
  const myUnits = units.filter((u) => u.subjectId === subjectId);
  const myTopics = topics.filter((t) => t.subjectId === subjectId);
  return {
    units: myUnits.length,
    topics: myTopics.length,
    estMin: myTopics.reduce((sum, t) => sum + (Number(t.estMin) || 0), 0),
  };
}

/** Totals across the whole semester. */
export function semesterTotals({ subjects = [], units = [], topics = [], deadlines = [], slots = [] }) {
  return {
    subjects: subjects.length,
    credits: subjects.reduce((sum, s) => sum + (Number(s.credits) || 0), 0),
    units: units.length,
    topics: topics.length,
    estMin: topics.reduce((sum, t) => sum + (Number(t.estMin) || 0), 0),
    deadlines: deadlines.length,
    slots: slots.length,
  };
}

/**
 * Setup checklist so the app can gently suggest the next step.
 * Returns the steps with done flags and the first step not done (or null).
 */
export function setupProgress({ semester, subjects = [], topics = [], deadlines = [], slots = [] }) {
  const steps = [
    { key: 'semester', label: 'Semester dates', done: Boolean(semester) },
    { key: 'subjects', label: 'Subjects', done: subjects.length > 0 },
    { key: 'topics', label: 'Units and topics', done: topics.length > 0 },
    { key: 'deadlines', label: 'Deadlines', done: deadlines.length > 0 },
    { key: 'timetable', label: 'Class timetable', done: slots.length > 0 },
  ];
  return { steps, next: steps.find((s) => !s.done) ?? null, doneCount: steps.filter((s) => s.done).length };
}

/** Sort items by their `order` field, then by name. Returns a new array. */
export function byOrder(items) {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
}

/** Next `order` value for a new item in a list. */
export function nextOrder(items) {
  return items.reduce((max, i) => Math.max(max, i.order ?? -1), -1) + 1;
}

/**
 * Move an item up (-1) or down (+1) among its siblings.
 * Returns the siblings with fresh 0..n-1 order values (only changed ones need saving).
 */
export function moveItem(siblings, id, dir) {
  const list = byOrder(siblings);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list.map((x, k) => ({ ...x, order: k }));
  [list[i], list[j]] = [list[j], list[i]];
  return list.map((x, k) => ({ ...x, order: k }));
}
