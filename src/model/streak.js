// The study streak and its rest tokens. Pure functions.
//
// Nothing here is saved: the streak is read from the session log on every render, so undoing a
// session puts everything back. A day counts when its study adds up to the daily minimum.
// Rest tokens (2 a month, refilled on the 1st) are spent on their own on a past day without
// study, but only when there is a streak to keep. Today is never judged until it's over.

import { addDays, isValidDate } from './time.js';

export const STREAK = {
  tokensPerMonth: 2,
  defaultMinMin: 10, // about one short focus session
  minChoices: [10, 25, 60],
};

/** Map of date → minutes studied that day (learning and reviews). */
export function studyMinutesByDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!s.date) continue;
    map.set(s.date, (map.get(s.date) ?? 0) + (Number(s.minutes) || 0));
  }
  return map;
}

const monthOf = (ymd) => ymd.slice(0, 7);
const nextMonthStart = (ymd) => {
  const [y, m] = ymd.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

/**
 * { current, best, todayDone, tokensLeft, tokensPerMonth, refillDate, freshStart, minMin,
 *   days: [{ date, state }] }
 * state: 'studied', 'rested' (a token kept the streak), 'missed', 'before' (before your first
 * study day) or 'today' (not judged yet). Days run from the semester start to today or its end.
 */
export function streakModel({ sessions = [], semester, today, minMin }) {
  const min = Number(minMin ?? semester?.streakMinMin) || STREAK.defaultMinMin;
  const perMonth = STREAK.tokensPerMonth;
  const out = {
    current: 0,
    best: 0,
    todayDone: false,
    tokensLeft: perMonth,
    tokensPerMonth: perMonth,
    refillDate: isValidDate(today) ? nextMonthStart(today) : null,
    freshStart: false,
    minMin: min,
    days: [],
  };
  if (!semester || !isValidDate(semester.startDate) || !isValidDate(semester.endDate) || !isValidDate(today)) return out;
  if (today < semester.startDate) return out;

  const byDay = studyMinutesByDay(sessions);
  const studied = (date) => (byDay.get(date) ?? 0) >= min;
  const lastPast = semester.endDate < today ? semester.endDate : addDays(today, -1);

  let run = 0;
  let best = 0;
  let tokens = perMonth;
  let month = null;
  let started = false;
  let broke = false;
  for (let date = semester.startDate; date <= lastPast; date = addDays(date, 1)) {
    if (monthOf(date) !== month) {
      month = monthOf(date);
      tokens = perMonth;
    }
    let state;
    if (studied(date)) {
      started = true;
      run += 1;
      state = 'studied';
    } else if (!started) {
      state = 'before';
    } else if (run > 0 && tokens > 0) {
      tokens -= 1;
      state = 'rested';
    } else {
      if (run > 0) broke = true;
      run = 0;
      state = 'missed';
    }
    best = Math.max(best, run);
    out.days.push({ date, state });
  }

  if (today <= semester.endDate) {
    out.todayDone = studied(today);
    if (out.todayDone) run += 1;
    best = Math.max(best, run);
    out.days.push({ date: today, state: 'today' });
  }

  out.current = run;
  out.best = best;
  out.tokensLeft = month === monthOf(today) ? tokens : perMonth;
  out.freshStart = run === 0 && broke;
  return out;
}

const tokens = (n) => (n === 1 ? '1 rest token' : `${n} rest tokens`);

/** The main streak line: "6-day streak · 2 rest tokens left". */
export function streakLine(m) {
  if (m.current > 0) {
    const left = m.tokensLeft > 0 ? `${tokens(m.tokensLeft)} left` : 'no rest tokens left this month';
    return `${m.current}-day streak · ${left}`;
  }
  if (m.freshStart) return `A fresh start · ${m.minMin} min of study begins a new streak`;
  return `Your streak begins with ${m.minMin} min of study`;
}

/** A small second line while the streak is running. */
export function streakNudge(m) {
  if (m.current > 0 && m.todayDone) return 'Today counts. Well done.';
  if (m.current > 0) return `${m.minMin} min today makes it ${m.current + 1} days`;
  return '';
}

/** What taking today off means for the streak (for the "Take today off" sheet). */
export function restTokenNote(m) {
  if (m.todayDone) return 'You’ve already studied today, so your streak is safe.';
  if (m.current === 0) return '';
  if (m.tokensLeft === 0) return 'Your streak will rest too, and a new one starts whenever you’re ready.';
  if (m.tokensLeft === 1) return `Your ${m.current}-day streak stays. This uses your last rest token this month.`;
  return `Your ${m.current}-day streak stays. This uses 1 of your ${m.tokensLeft} rest tokens this month.`;
}
