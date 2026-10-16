// The exam countdown sky. Pure functions.
//
// The sun crosses the sky from the previous exam (or the semester start) to the next exam and sets
// on exam day. The light warms as the exam gets close; after the last exam it's a calm night.

import { daysBetween, isValidDate } from './time.js';
import { isExam } from './priority.js';

export const SKY = { maxStars: 8 };

const TYPE_NAMES = { midsem: 'mid-sem', endsem: 'end-sem' };

/** Mood from days left until the next exam. */
export function moodFor(daysLeft) {
  if (daysLeft <= 0) return 'examday';
  if (daysLeft <= 2) return 'dusk';
  if (daysLeft <= 6) return 'golden';
  if (daysLeft <= 13) return 'afternoon';
  return 'day';
}

/**
 * { mood, sun (0–1), next: { date, label, count } | null, daysLeft, stars, text }
 * subjects is used for names only.
 */
export function skyModel({ deadlines = [], subjects = [], semester, today }) {
  const exams = deadlines.filter((d) => isExam(d) && isValidDate(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const span = (from, to) => {
    const total = daysBetween(from, to);
    return total > 0 ? Math.min(1, Math.max(0, daysBetween(from, today) / total)) : 1;
  };

  if (!exams.length) {
    const sun = semester ? span(semester.startDate, semester.endDate) : 0.5;
    return { mood: 'day', sun, next: null, daysLeft: null, stars: 0, text: null };
  }

  const upcoming = exams.filter((d) => daysBetween(today, d.date) >= 0);
  if (!upcoming.length) {
    return { mood: 'night', sun: 1, next: null, daysLeft: null, stars: 0, text: 'Exams done. Rest well.' };
  }

  const date = upcoming[0].date;
  const sameDay = upcoming.filter((d) => d.date === date);
  const nameOf = (id) => subjects.find((s) => s.id === id)?.name ?? '';
  const label = sameDay.length === 1 ? `${nameOf(sameDay[0].subjectId)} ${TYPE_NAMES[sameDay[0].type]}`.trim() : `${sameDay.length} exams`;
  const previous = exams.filter((d) => daysBetween(d.date, today) > 0).at(-1)?.date;
  const from = previous ?? (semester?.startDate && semester.startDate < today ? semester.startDate : today);
  const daysLeft = daysBetween(today, date);

  return {
    mood: moodFor(daysLeft),
    sun: span(from, date),
    next: { date, label, count: sameDay.length },
    daysLeft,
    stars: Math.min(SKY.maxStars, upcoming.length),
    text: countdownText(label, sameDay.length, daysLeft),
  };
}

function countdownText(label, count, daysLeft) {
  const single = count === 1;
  if (daysLeft <= 0) return `${capital(label)} today. You’ve got this.`;
  if (daysLeft === 1) return single ? `The ${label} is tomorrow` : `${capital(label)} tomorrow`;
  return single ? `${daysLeft} days to the ${label}` : `${daysLeft} days to ${label}`;
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
