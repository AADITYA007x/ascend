// What has actually been studied, from the session log. Pure functions.

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

/** Minutes of study a topic still needs, given its progress (or undefined if never studied). */
export function remainingMin(topic, progress) {
  const est = Number(topic.estMin) || 0;
  if (!progress) return est;
  if (progress.done) return 0;
  return Math.max(MIN_LEFT_WHEN_OVER, est - progress.studiedMin);
}
