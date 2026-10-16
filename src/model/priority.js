// Which deadline each topic is preparing for, and how urgent it is. Pure functions.
import { addDays, daysBetween } from './time.js';

export const PRIORITY = {
  closenessDays: 7, // closeness = 7 / (7 + days to target)
  noDeadlineWeight: 30, // topics no deadline covers are treated like an end-sem of this weight
  difficulty: { 1: 0.8, 2: 1, 3: 1.3 },
  examModeDays: 21, // "exam mode" starts this many days before the first end-sem
  examModeBoost: 1.5, // end-sem topics count this much more in exam mode
};

const EXAM_TYPES = new Set(['midsem', 'endsem']);
export const isExam = (deadline) => EXAM_TYPES.has(deadline?.type);

/**
 * Does this deadline cover this topic?
 * Ticked units → topics in those units. No units ticked → an exam covers the whole subject,
 * while a quiz, assignment or lab record covers no particular topics.
 */
export function covers(deadline, topic) {
  if (deadline.subjectId !== topic.subjectId) return false;
  const units = deadline.unitIds ?? [];
  if (units.length) return units.includes(topic.unitId);
  return isExam(deadline);
}

/** Last day to study new material for a deadline. Exams keep `bufferDays` free before them. */
export function dueBy(deadline, bufferDays) {
  return isExam(deadline) ? addDays(deadline.date, -bufferDays - 1) : deadline.date;
}

/** A deadline still counts on `day` while it hasn't happened (quizzes etc. count on their own day). */
export function isActiveOn(deadline, day) {
  const n = daysBetween(day, deadline.date);
  return isExam(deadline) ? n > 0 : n >= 0;
}

/**
 * The deadline a topic is preparing for on `day`: the one with the earliest due-by date
 * among active deadlines that cover it. `covering` must already be filtered with covers().
 * Returns { deadline, dueBy } or, when nothing covers it, { deadline: null, dueBy: semesterEnd }.
 */
export function currentDeadline(covering, day, bufferDays, semesterEnd) {
  let best = null;
  let bestDue = null;
  for (const d of covering) {
    if (!isActiveOn(d, day)) continue;
    const due = dueBy(d, bufferDays);
    if (!best || due < bestDue || (due === bestDue && d.id < best.id)) {
      best = d;
      bestDue = due;
    }
  }
  return best ? { deadline: best, dueBy: bestDue } : { deadline: null, dueBy: semesterEnd };
}

/** "keepup" before the end-sems, "exam" in the last weeks before the first end-sem. */
export function phaseOn(day, deadlines, semesterEnd) {
  const endsems = deadlines.filter((d) => d.type === 'endsem').map((d) => d.date).sort();
  const first = endsems[0] ?? semesterEnd;
  return daysBetween(day, first) <= PRIORITY.examModeDays ? 'exam' : 'keepup';
}

/** Priority score: deadline closeness × weight × subject credits × topic difficulty. Higher goes first. */
export function topicScore({ topic, subject, deadline, dueBy: due, day, phase }) {
  const daysToTarget = Math.max(0, daysBetween(day, due));
  const closeness = PRIORITY.closenessDays / (PRIORITY.closenessDays + daysToTarget);
  const weight = deadline ? Number(deadline.weight) || 0 : PRIORITY.noDeadlineWeight;
  const weightFactor = 1 + weight / 10;
  const creditsFactor = Math.max(1, Number(subject?.credits) || 0);
  const difficultyFactor = PRIORITY.difficulty[topic.difficulty] ?? 1;
  const endsemLike = !deadline || deadline.type === 'endsem';
  const phaseFactor = phase === 'exam' && endsemLike ? PRIORITY.examModeBoost : 1;
  return closeness * weightFactor * creditsFactor * difficultyFactor * phaseFactor;
}
