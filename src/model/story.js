// The weekly story: a few warm sentences about a week of study. Pure functions.
// Weeks run Monday to Sunday. The story celebrates what happened and never counts what didn't.

import { addDays, weekdayMon0, formatMinutes } from './time.js';
import { chronological } from './estimate.js';

/** Monday of the week `date` is in. */
export const weekStart = (date) => addDays(date, -weekdayMon0(date));

/**
 * What happened in the week starting `from` (a Monday):
 * { from, to, minutes, daysStudied, topicsFinished: [topicId], reviews, focusSessions,
 *   ratings: { easy, okay, hard }, hardTopics: [topicId], bySubject: [{ subjectId, minutes }], bestDay }
 * A review is a session on a topic on a later day than it was first finished.
 */
export function weekSummary({ sessions = [], from }) {
  const to = addDays(from, 6);
  const finishedOn = new Map(); // topicId → first date marked finished
  for (const s of chronological(sessions)) if (s.finished && !finishedOn.has(s.topicId)) finishedOn.set(s.topicId, s.date);

  // Oldest first, so names come out in the order you met them (storage order is random).
  const week = chronological(sessions.filter((s) => s.date >= from && s.date <= to));
  const perDay = new Map();
  const perSubject = new Map();
  const reviewKeys = new Set();
  const hard = new Set();
  const ratings = { easy: 0, okay: 0, hard: 0 };
  let minutes = 0;
  let focusSessions = 0;
  for (const s of week) {
    const m = Number(s.minutes) || 0;
    minutes += m;
    perDay.set(s.date, (perDay.get(s.date) ?? 0) + m);
    perSubject.set(s.subjectId, (perSubject.get(s.subjectId) ?? 0) + m);
    if (s.source === 'timer') focusSessions += 1;
    if (s.rating in ratings) ratings[s.rating] += 1;
    if (s.rating === 'hard') hard.add(s.topicId);
    const done = finishedOn.get(s.topicId);
    if (done && s.date > done) reviewKeys.add(`${s.topicId}|${s.date}`);
  }
  const topicsFinished = [...finishedOn].filter(([, d]) => d >= from && d <= to).map(([id]) => id);
  let bestDay = null;
  for (const [date, m] of perDay) if (!bestDay || m > bestDay.minutes) bestDay = { date, minutes: m };

  return {
    from,
    to,
    minutes,
    daysStudied: [...perDay.values()].filter((m) => m > 0).length,
    topicsFinished,
    reviews: reviewKeys.size,
    focusSessions,
    ratings,
    hardTopics: [...hard],
    bySubject: [...perSubject].map(([subjectId, m]) => ({ subjectId, minutes: m })).sort((a, b) => b.minutes - a.minutes),
    bestDay,
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const when = (days) => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

/**
 * 2–5 short sentences.
 * names: { topic(id) → name, subjectOfTopic(id) → subjectId, subject(id) → name }
 * upcoming: [{ label, days }] — e.g. { label: 'Maths mid-sem', days: 9 }; the first is mentioned.
 */
export function weekStory(summary, previous, { names, upcoming = [] } = {}) {
  const ahead = upcoming[0] ? `Coming up: the ${upcoming[0].label} ${when(upcoming[0].days)}.` : null;
  if (summary.minutes <= 0) {
    return ['A quiet week, and that’s okay.', 'This week’s plan is ready when you are.', ahead].filter(Boolean);
  }

  const lines = [`You studied ${formatMinutes(summary.minutes)} across ${plural(summary.daysStudied, 'day')}.`];
  let more = null;
  if (previous && previous.minutes > 0 && summary.minutes > previous.minutes) {
    more = `That’s ${formatMinutes(summary.minutes - previous.minutes)} more than the week before.`;
    lines.push(more);
  }

  const finished = summary.topicsFinished;
  if (finished.length === 1) {
    lines.push(`You finished ${names.topic(finished[0])}.`);
  } else if (finished.length > 1) {
    const counts = new Map();
    for (const id of finished) {
      const sid = names.subjectOfTopic(id);
      counts.set(sid, (counts.get(sid) ?? 0) + 1);
    }
    const [topId, topCount] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const where =
      topCount === finished.length ? `, all in ${names.subject(topId)}` : topCount > finished.length / 2 ? `, most of them in ${names.subject(topId)}` : '';
    lines.push(`You finished ${finished.length} topics${where}.`);
  }

  if (summary.reviews === 1) lines.push('One review kept an older topic fresh.');
  else if (summary.reviews > 1) lines.push(`${summary.reviews} reviews kept older topics fresh.`);

  const hard = summary.hardTopics.slice(0, 2).map((id) => names.topic(id));
  if (hard.length === 1) lines.push(`${hard[0]} felt hard, so it’ll come back soon.`);
  else if (hard.length === 2) lines.push(`${hard[0]} and ${hard[1]} felt hard, so they’ll come back soon.`);

  if (ahead) lines.push(ahead);
  // Keep it short: the comparison is the first to go.
  if (lines.length > 5 && more) lines.splice(lines.indexOf(more), 1);
  return lines.slice(0, 5);
}
