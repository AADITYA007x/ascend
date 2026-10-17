// Validation for everything the user enters. Pure functions.
// Each validator returns { ok, errors, warnings } where errors/warnings map field → message.
// Errors block saving. Warnings are gentle notes that still allow saving.

import { toMinutes, isValidDate, daysBetween } from './time.js';

export const DEADLINE_TYPES = ['quiz', 'assignment', 'lab', 'midsem', 'endsem'];
export const DEADLINE_LABELS = {
  quiz: 'Quiz',
  assignment: 'Assignment',
  lab: 'Lab record',
  midsem: 'Mid-sem',
  endsem: 'End-sem',
};

export const LIMITS = {
  nameMax: 80,
  creditsMin: 0,
  creditsMax: 10,
  estMinMin: 5,
  estMinMax: 600,
  dailyLimitMin: 15,
  dailyLimitMax: 16 * 60,
  bufferDaysMax: 7,
};

function result(errors, warnings = {}) {
  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

function checkName(errors, value, field = 'name', label = 'a name') {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) errors[field] = `Please add ${label}.`;
  else if (v.length > LIMITS.nameMax) errors[field] = `Keep it under ${LIMITS.nameMax} characters.`;
}

function isNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

export function validateSemester(s) {
  const errors = {};
  checkName(errors, s?.name);
  if (!isValidDate(s?.startDate)) errors.startDate = 'Pick the first day of the semester.';
  if (!isValidDate(s?.endDate)) errors.endDate = 'Pick the last day of the semester.';
  if (!errors.startDate && !errors.endDate && daysBetween(s.startDate, s.endDate) < 1) {
    errors.endDate = 'The end should come after the start.';
  }
  if (!isNum(s?.dailyLimitMin) || s.dailyLimitMin < LIMITS.dailyLimitMin || s.dailyLimitMin > LIMITS.dailyLimitMax) {
    errors.dailyLimitMin = 'Choose between 15 minutes and 16 hours a day.';
  }
  // Planner settings (Milestone 2). Older semesters may not have them yet; defaults apply then.
  const from = s?.studyFrom === undefined ? 7 * 60 : toMinutes(s.studyFrom);
  const to = s?.studyTo === undefined ? 23 * 60 : toMinutes(s.studyTo);
  if (from === null) errors.studyFrom = 'Pick when your study day starts.';
  if (to === null) errors.studyTo = 'Pick when your study day ends.';
  if (from !== null && to !== null && to <= from) errors.studyTo = 'The end should come after the start.';
  const buffer = s?.bufferDays;
  if (buffer !== undefined && (!Number.isInteger(buffer) || buffer < 0 || buffer > LIMITS.bufferDaysMax)) {
    errors.bufferDays = `Choose between 0 and ${LIMITS.bufferDaysMax} days.`;
  }
  return result(errors);
}

export function validateSubject(s) {
  const errors = {};
  checkName(errors, s?.name);
  if (!isNum(s?.credits) || s.credits < LIMITS.creditsMin || s.credits > LIMITS.creditsMax) {
    errors.credits = `Credits should be between ${LIMITS.creditsMin} and ${LIMITS.creditsMax}.`;
  }
  if (s?.code && String(s.code).length > 20) errors.code = 'Keep the code short (20 characters max).';
  return result(errors);
}

export function validateUnit(u) {
  const errors = {};
  checkName(errors, u?.name);
  if (!u?.subjectId) errors.subjectId = 'This unit needs a subject.';
  return result(errors);
}

export function validateTopic(t) {
  const errors = {};
  checkName(errors, t?.name);
  if (!t?.unitId) errors.unitId = 'This topic needs a unit.';
  if (!isNum(t?.estMin) || t.estMin < LIMITS.estMinMin || t.estMin > LIMITS.estMinMax) {
    errors.estMin = 'Estimated time should be between 5 minutes and 10 hours.';
  }
  if (![1, 2, 3].includes(t?.difficulty)) errors.difficulty = 'Pick easy, medium or hard.';
  return result(errors);
}

/** semester is optional; when given, dates outside it give a warning. */
export function validateDeadline(d, semester) {
  const errors = {};
  const warnings = {};
  checkName(errors, d?.title, 'title', 'a title');
  if (!DEADLINE_TYPES.includes(d?.type)) errors.type = 'Pick a type.';
  if (!d?.subjectId) errors.subjectId = 'Pick a subject.';
  if (!isValidDate(d?.date)) errors.date = 'Pick a date.';
  if (!isNum(d?.weight) || d.weight < 0 || d.weight > 100) errors.weight = 'Weight should be between 0 and 100%.';
  if (!errors.date && semester && isValidDate(semester.startDate) && isValidDate(semester.endDate)) {
    if (daysBetween(semester.startDate, d.date) < 0 || daysBetween(d.date, semester.endDate) < 0) {
      warnings.date = 'This date is outside your semester. If that’s right, tap Save again.';
    }
  }
  return result(errors, warnings);
}

export const ATTENDANCE_LIMITS = { minMin: 50, minMax: 100, startMax: 500 };

/** A minimum attendance in %: a whole number from 50 to 100. */
export function validateAttendanceMin(min) {
  const errors = {};
  if (!Number.isInteger(min) || min < ATTENDANCE_LIMITS.minMin || min > ATTENDANCE_LIMITS.minMax) {
    errors.attendanceMin = `Pick a minimum between ${ATTENDANCE_LIMITS.minMin}% and ${ATTENDANCE_LIMITS.minMax}%.`;
  }
  return result(errors);
}

/** Classes from before Ascend: whole numbers, attended no more than held. */
export function validateStartCounts({ startAttended, startHeld }) {
  const errors = {};
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= ATTENDANCE_LIMITS.startMax;
  if (!ok(startHeld)) errors.startHeld = `Use a whole number from 0 to ${ATTENDANCE_LIMITS.startMax}.`;
  if (!ok(startAttended)) errors.startAttended = `Use a whole number from 0 to ${ATTENDANCE_LIMITS.startMax}.`;
  else if (!errors.startHeld && startAttended > startHeld) errors.startAttended = 'You can’t have attended more classes than were held.';
  return result(errors);
}

export const CARD_LIMITS = { frontMax: 300, backMax: 600 };

export function validateCard(c) {
  const errors = {};
  const front = typeof c?.front === 'string' ? c.front.trim() : '';
  const back = typeof c?.back === 'string' ? c.back.trim() : '';
  if (!front) errors.front = 'Please add a question or prompt.';
  else if (front.length > CARD_LIMITS.frontMax) errors.front = `Keep it under ${CARD_LIMITS.frontMax} characters.`;
  if (!back) errors.back = 'Please add the answer.';
  else if (back.length > CARD_LIMITS.backMax) errors.back = `Keep it under ${CARD_LIMITS.backMax} characters.`;
  if (!c?.topicId) errors.topicId = 'This card needs a topic.';
  return result(errors);
}

export function validateSlot(s) {
  const errors = {};
  if (!Number.isInteger(s?.day) || s.day < 0 || s.day > 6) errors.day = 'Pick a day.';
  const start = toMinutes(s?.start);
  const end = toMinutes(s?.end);
  if (start === null) errors.start = 'Pick a start time.';
  if (end === null) errors.end = 'Pick an end time.';
  if (start !== null && end !== null && end <= start) errors.end = 'The class should end after it starts.';
  if (!s?.subjectId && !(s?.label && s.label.trim())) {
    errors.subjectId = 'Pick a subject or give the class a name.';
  }
  return result(errors);
}
