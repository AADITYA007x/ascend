// What has actually been studied, from the session log. Pure functions.

import { makeSession } from './factory.js';

// A topic you haven't marked finished keeps at least this much time left,
// even when you've gone past its estimate, so it never disappears silently.
export const MIN_LEFT_WHEN_OVER = 10;

/** Map of topicId → { studiedMin, done, doneOn }. */
export function topicProgress(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const p = map.get(s.topicId) ?? { studiedMin: 0, done: false, doneOn: null };
    p.studiedMin += Number(s.minutes) || 0;
    if (s.finished) {
      p.done = true;
      if (!p.doneOn || s.date > p.doneOn) p.doneOn = s.date;
    }
    map.set(s.topicId, p);
  }
  return map;
}

/** Minutes studied on one date. */
export function minutesStudiedOn(sessions, date) {
  return sessions.reduce((sum, s) => (s.date === date ? sum + (Number(s.minutes) || 0) : sum), 0);
}

/**
 * "Mark as done" without a study session (you learned it in class, or already knew it): a finished
 * session with no minutes. Spaced revision starts from `date`, like any finished topic.
 */
export function markDoneSession(topic, { semesterId, date }) {
  return makeSession({ semesterId, subjectId: topic.subjectId, topicId: topic.id, date, finished: true, source: 'mark' });
}

/**
 * "Mark as not done": what to change so a topic counts as unfinished again.
 * Mark-only sessions are removed; real study sessions stay (their minutes count) but lose "finished".
 * Returns { save: [sessions], remove: [ids] }.
 */
export function unmarkDone(sessions, topicId) {
  const finished = sessions.filter((s) => s.topicId === topicId && s.finished);
  return {
    save: finished.filter((s) => s.source !== 'mark').map((s) => ({ ...s, finished: false })),
    remove: finished.filter((s) => s.source === 'mark').map((s) => s.id),
  };
}

/** Minutes of study a topic still needs, given its progress (or undefined if never studied). */
export function remainingMin(topic, progress) {
  const est = Number(topic.estMin) || 0;
  if (!progress) return est;
  if (progress.done) return 0;
  return Math.max(MIN_LEFT_WHEN_OVER, est - progress.studiedMin);
}
