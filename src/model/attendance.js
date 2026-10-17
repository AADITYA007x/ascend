// Attendance: which classes you went to, your % per subject, and how much room is left. Pure functions.
//
// Only classes you mark count, so the % is never a guess. A record is one class on one date:
// { id: attendanceKey(slotId, date), semesterId, subjectId, slotId, date, status }.

import { addDays, toMinutes, weekdayMon0 } from './time.js';
import { slotsForDay } from './timetable.js';

export const ATTENDANCE = {
  defaultMin: 75, // a common college minimum, in %
  catchUpDays: 14, // unmarked classes older than this are left alone
  closeMargin: 1, // "close" when you can miss this many or fewer
  statuses: ['present', 'absent', 'cancelled'],
};

export const STATUS_LABELS = { present: 'Present', absent: 'Absent', cancelled: 'Cancelled' };

/** One record per class per date. */
export const attendanceKey = (slotId, date) => `${slotId}|${date}`;

/** A date's classes that belong to a subject, by start time: [{ slot, date, key }]. */
export function classesOn(slots, date) {
  return slotsForDay(
    slots.filter((s) => s.subjectId),
    weekdayMon0(date),
  ).map((slot) => ({ slot, date, key: attendanceKey(slot.id, date) }));
}

/**
 * Classes from the last catchUpDays (today included once a class has started) that aren't marked yet.
 * Never before the semester starts or after it ends. Newest day first, then by start time.
 */
export function unmarkedClasses({ slots, records, semester, today, nowMin = null }) {
  const marked = new Set(records.map((r) => r.id));
  const out = [];
  for (let k = 0; k < ATTENDANCE.catchUpDays; k++) {
    const date = addDays(today, -k);
    if (semester?.startDate && date < semester.startDate) break;
    if (semester?.endDate && date > semester.endDate) continue;
    for (const c of classesOn(slots, date)) {
      if (marked.has(c.key)) continue;
      if (date === today && (nowMin === null || nowMin < toMinutes(c.slot.start))) continue;
      out.push(c);
    }
  }
  return out;
}

/** { attended, held, pct } for one subject. Cancelled classes don't count. pct is null until a class is held. */
export function subjectAttendance(records, subject) {
  let attended = Math.max(0, Number(subject?.startAttended) || 0);
  let held = Math.max(0, Number(subject?.startHeld) || 0);
  for (const r of records) {
    if (r.subjectId !== subject?.id) continue;
    if (r.status === 'present') {
      attended += 1;
      held += 1;
    } else if (r.status === 'absent') {
      held += 1;
    }
  }
  return { attended, held, pct: held ? Math.floor((attended * 100) / held) : null };
}

/** The minimum (in %) for a subject: its own, else the semester's, else 75. */
export function minFor(subject, semester) {
  const own = Number(subject?.attendanceMin);
  if (own > 0) return own;
  const sem = Number(semester?.attendanceMin);
  return sem > 0 ? sem : ATTENDANCE.defaultMin;
}

const isBelow = (attended, held, min) => attended * 100 < min * held;

/** Classes in a row you can miss and still be at the minimum (0 when already below it). */
export function canMiss(attended, held, min) {
  if (isBelow(attended, held, min)) return 0;
  if (min <= 0) return Infinity;
  return Math.floor((attended * 100 - min * held) / min);
}

/** Classes in a row to attend to reach the minimum again (0 when already there). */
export function toRecover(attended, held, min) {
  const short = min * held - attended * 100;
  if (short <= 0) return 0;
  if (min >= 100) return Infinity;
  return Math.ceil(short / (100 - min));
}

/**
 * { level, text, pct, attended, held, min, canMiss, toRecover }
 * level: 'none' (nothing held yet) | 'safe' | 'close' (can miss closeMargin or fewer) | 'below'
 */
export function attendanceStatus(records, subject, semester) {
  const { attended, held, pct } = subjectAttendance(records, subject);
  const min = minFor(subject, semester);
  const base = { pct, attended, held, min, canMiss: 0, toRecover: 0 };
  if (!held) return { ...base, level: 'none', text: 'Nothing marked yet.' };
  if (isBelow(attended, held, min)) {
    const n = toRecover(attended, held, min);
    const text =
      n === Infinity
        ? `At ${pct}%. This subject needs every class, so it may be worth a word with your teacher.`
        : `At ${pct}%. Going to the next ${n === 1 ? 'class' : `${n}`} brings you back to ${min}%.`;
    return { ...base, level: 'below', toRecover: n, text };
  }
  const k = canMiss(attended, held, min);
  if (k <= ATTENDANCE.closeMargin) {
    const text = k === 0 ? `Right at ${min}%. Worth going to the next few.` : `Close to ${min}%. You can miss 1 more.`;
    return { ...base, level: 'close', canMiss: k, text };
  }
  return { ...base, level: 'safe', canMiss: k, text: `You can miss ${k} more and still be at ${min}%.` };
}

/** Keys of classes marked cancelled, so the planner can treat that time as free. */
export function cancelledKeys(records) {
  return new Set(records.filter((r) => r.status === 'cancelled').map((r) => r.id));
}
