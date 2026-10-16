// How much of the semester is done, from the session log. Pure functions.

import { addDays, daysBetween } from './time.js';
import { topicProgress, remainingMin } from './progress.js';
import { planningTopics } from './estimate.js';
import { revisionStates } from './revision.js';
import { covers } from './priority.js';

/**
 * One entry per subject:
 * { subjectId, topicsDone, topicsTotal, estMin, learnLeftMin, donePct, studiedMin, reviewsDone, weakCount, masteredCount }
 * Estimates are the ones the planner uses (scaled by your pace), so "left" matches the plan.
 */
export function subjectProgress({ subjects = [], topics = [], sessions = [] }) {
  const progress = topicProgress(sessions);
  const planned = planningTopics(topics, sessions);
  const reviews = revisionStates(topics, sessions);
  return subjects.map((s) => {
    const mine = planned.filter((t) => t.subjectId === s.id);
    const entry = {
      subjectId: s.id,
      topicsDone: 0,
      topicsTotal: mine.length,
      estMin: 0,
      learnLeftMin: 0,
      donePct: 0,
      studiedMin: sessions.reduce((sum, x) => (x.subjectId === s.id ? sum + (Number(x.minutes) || 0) : sum), 0),
      reviewsDone: 0,
      weakCount: 0,
      masteredCount: 0,
    };
    for (const t of mine) {
      const p = progress.get(t.id);
      if (p?.done) entry.topicsDone += 1;
      entry.estMin += Number(t.estMin) || 0;
      entry.learnLeftMin += remainingMin(t, p);
      const r = reviews.get(t.id);
      if (r) {
        entry.reviewsDone += r.reviews;
        if (r.weak) entry.weakCount += 1;
        if (r.mastered) entry.masteredCount += 1;
      }
    }
    entry.donePct = pct(entry.estMin, entry.learnLeftMin);
    return entry;
  });
}

/** Share of the estimated learning time that is done, 0–1. */
function pct(est, left) {
  return est > 0 ? Math.min(1, Math.max(0, 1 - left / est)) : 0;
}

/** Totals across subjects, in the same shape. */
export function overallProgress(perSubject) {
  const keys = ['topicsDone', 'topicsTotal', 'estMin', 'learnLeftMin', 'studiedMin', 'reviewsDone', 'weakCount', 'masteredCount'];
  const total = Object.fromEntries(keys.map((k) => [k, perSubject.reduce((sum, s) => sum + s[k], 0)]));
  return { ...total, donePct: pct(total.estMin, total.learnLeftMin) };
}

/** [{ date, minutes, reviewMin }] for every day from `from` to `to`, including days with no study. */
export function dailyMinutes(sessions, from, to) {
  const n = daysBetween(from, to);
  if (n < 0) return [];
  const days = Array.from({ length: n + 1 }, (_, i) => ({ date: addDays(from, i), minutes: 0, reviewMin: 0 }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const s of sessions) {
    const d = byDate.get(s.date);
    if (!d) continue;
    const m = Number(s.minutes) || 0;
    d.minutes += m;
    if (s.kind === 'revision') d.reviewMin += m;
  }
  return days;
}

/** { done, total } topics covered by a deadline. */
export function deadlineCoverage(deadline, topics, sessions) {
  const progress = topicProgress(sessions);
  const mine = topics.filter((t) => covers(deadline, t));
  return { done: mine.filter((t) => progress.get(t.id)?.done).length, total: mine.length };
}
