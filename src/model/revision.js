// Spaced revision: when a finished topic comes back, and which topics are weak. Pure functions.
//
// Nothing here is saved. The schedule is read from the session log: the first session marked
// finished ends learning, and every session on that topic on a later day is a review.

import { addDays } from './time.js';
import { chronological } from './estimate.js';

export const REVISION = {
  gaps: [1, 3, 7, 21], // days to the 1st, 2nd, 3rd and 4th review
  hardFactor: 0.5, // hard: sooner, and the same step again
  easyFactor: 1.5, // easy: later
  share: { keepup: 0.3, exam: 0.5 }, // most of a day's study time reviews take before new work
  fraction: 0.25, // a review takes about this share of the topic's estimate
  minMin: 10,
  maxMin: 30,
  weakExtraMin: 10,
  weakMaxMin: 40,
  round: 5,
};

export const REVIEWS = REVISION.gaps.length;

/** Days from a review at `step` (0 = just finished) to the next one, given how it felt. */
export function nextGap(step, rating) {
  const base = REVISION.gaps[Math.min(step, REVIEWS - 1)];
  if (rating === 'hard') return Math.max(1, Math.round(base * REVISION.hardFactor));
  if (rating === 'easy') return Math.round(base * REVISION.easyFactor);
  return base;
}

/** Weak: the latest rating was hard, or 2 of the last 3 were. Ratings are oldest first. */
export function isWeak(ratings) {
  const last = ratings.slice(-3);
  return last.at(-1) === 'hard' || last.filter((r) => r === 'hard').length >= 2;
}

/** For ordering reviews: hard ratings among the last 3 (the latest counts double), plus difficulty. */
export function weakness(ratings, difficulty = 2) {
  const last = ratings.slice(-3);
  const hards = last.filter((r) => r === 'hard').length + (last.at(-1) === 'hard' ? 1 : 0);
  return hards + ((Number(difficulty) || 2) - 1) * 0.5;
}

/** Review length: about a quarter of the typed estimate, 10–30 min; weak topics get a little longer. */
export function revisionMinutes(topic, weak = false) {
  const est = Number(topic.baseEstMin ?? topic.estMin) || 0;
  const r = REVISION.round;
  const base = Math.min(REVISION.maxMin, Math.max(REVISION.minMin, Math.round((est * REVISION.fraction) / r) * r));
  return weak ? Math.min(REVISION.weakMaxMin, base + REVISION.weakExtraMin) : base;
}

/** Map of topicId → its ratings, oldest first. */
export function topicRatings(sessions) {
  const map = new Map();
  for (const s of chronological(sessions)) {
    if (!s.rating) continue;
    if (!map.has(s.topicId)) map.set(s.topicId, []);
    map.get(s.topicId).push(s.rating);
  }
  return map;
}

/**
 * Where each finished topic stands. Map of topicId →
 * { step, due, lastDate, mastered, weak, weakness, ratings }
 * step = reviews done (0–4); due = next review date, or null once mastered.
 * Only one review a day counts as a step, and nothing on the day the topic was finished.
 */
export function revisionStates(topics, sessions) {
  const byTopic = new Map();
  for (const s of chronological(sessions)) {
    if (!byTopic.has(s.topicId)) byTopic.set(s.topicId, []);
    byTopic.get(s.topicId).push(s);
  }
  const states = new Map();
  for (const topic of topics) {
    const list = byTopic.get(topic.id) ?? [];
    const f = list.findIndex((s) => s.finished);
    if (f < 0) continue;
    const ratings = list.filter((s) => s.rating).map((s) => s.rating);
    const learnRating = list[f].rating ?? [...list.slice(0, f)].reverse().find((s) => s.rating)?.rating ?? null;
    const st = { step: 0, lastDate: list[f].date, due: addDays(list[f].date, nextGap(0, learnRating)), mastered: false };
    for (const s of list.slice(f + 1)) {
      if (s.date <= st.lastDate) continue;
      st.lastDate = s.date;
      if (st.mastered) continue;
      if (s.rating === 'hard') {
        st.due = addDays(s.date, nextGap(st.step, 'hard'));
        continue;
      }
      st.step += 1;
      if (st.step >= REVIEWS) {
        st.mastered = true;
        st.due = null;
      } else {
        st.due = addDays(s.date, nextGap(st.step, s.rating));
      }
    }
    states.set(topic.id, { ...st, weak: isWeak(ratings), weakness: weakness(ratings, topic.difficulty), ratings });
  }
  return states;
}
