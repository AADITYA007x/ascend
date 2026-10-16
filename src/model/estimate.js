// Learning from real study: your pace per subject and how sessions felt. Pure functions.
//
// Nothing here is saved. Typed estimates are never overwritten; the planner works from
// planningTopics(), so undoing or deleting a session changes everything back automatically.

export const ESTIMATE = {
  priorMin: 90, // pace starts near 1 and moves toward your real pace as finished minutes add up
  minPace: 0.5,
  maxPace: 2,
  round: 5,
};

export const RATING_SHIFT = { easy: -1, okay: 0, hard: 1 };

/** Sessions oldest first: by date, then start time. Manual logs without a start time keep their order. */
function chronological(sessions) {
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.date.localeCompare(b.s.date) || (a.s.startedAt ?? 0) - (b.s.startedAt ?? 0) || a.i - b.i)
    .map((x) => x.s);
}

/** Map of topicId → minutes it took, for finished topics: every session up to the first one marked finished. */
export function actualMinutes(sessions) {
  const sum = new Map();
  const done = new Map();
  for (const s of chronological(sessions)) {
    if (done.has(s.topicId)) continue;
    const total = (sum.get(s.topicId) ?? 0) + (Number(s.minutes) || 0);
    sum.set(s.topicId, total);
    if (s.finished) done.set(s.topicId, total);
  }
  return done;
}

/** How long topics in this subject really take compared with their estimate (1 = as estimated). */
export function subjectPace(subjectId, topics, sessions, actual = actualMinutes(sessions)) {
  let est = 0;
  let real = 0;
  for (const t of topics) {
    if (t.subjectId !== subjectId || !actual.has(t.id)) continue;
    est += Number(t.estMin) || 0;
    real += actual.get(t.id);
  }
  const pace = (real + ESTIMATE.priorMin) / (est + ESTIMATE.priorMin);
  return Math.min(ESTIMATE.maxPace, Math.max(ESTIMATE.minPace, pace));
}

/** Map of topicId → the rating of its newest rated session. */
export function latestRatings(sessions) {
  const map = new Map();
  for (const s of chronological(sessions)) if (s.rating) map.set(s.topicId, s.rating);
  return map;
}

/** The rating of the newest rated session on a topic, or null. */
export const latestRating = (sessions, topicId) => latestRatings(sessions).get(topicId) ?? null;

/**
 * Topics as the planner should see them. Unfinished topics get an estimate scaled by their subject's
 * pace, and a difficulty moved by their latest rating (hard +1, easy −1, within 1–3).
 * Each copy keeps the typed estimate as baseEstMin.
 */
export function planningTopics(topics, sessions) {
  const actual = actualMinutes(sessions);
  const ratings = latestRatings(sessions);
  const paces = new Map();
  const paceOf = (subjectId) => {
    if (!paces.has(subjectId)) paces.set(subjectId, subjectPace(subjectId, topics, sessions, actual));
    return paces.get(subjectId);
  };
  return topics.map((t) => {
    if (actual.has(t.id)) return { ...t, baseEstMin: t.estMin };
    const base = Number(t.estMin) || 0;
    const pace = paceOf(t.subjectId);
    const estMin =
      base && pace !== 1 ? Math.max(ESTIMATE.round, Math.round((base * pace) / ESTIMATE.round) * ESTIMATE.round) : t.estMin;
    const shift = RATING_SHIFT[ratings.get(t.id)] ?? 0;
    const difficulty = Math.min(3, Math.max(1, (Number(t.difficulty) || 2) + shift));
    return { ...t, baseEstMin: t.estMin, estMin, difficulty };
  });
}
