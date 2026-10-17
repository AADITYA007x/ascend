import { describe, it, expect } from 'vitest';
import {
  attendanceKey,
  classesOn,
  unmarkedClasses,
  subjectAttendance,
  minFor,
  canMiss,
  toRecover,
  attendanceStatus,
  cancelledKeys,
  ATTENDANCE,
} from '../src/model/attendance.js';
import { validateAttendanceMin, validateStartCounts } from '../src/model/validate.js';
import { addDays } from '../src/model/time.js';

// 2026-10-19 is a Monday.
const START = '2026-10-19';
const day = (n) => addDays(START, n);
const slot = (id, fields = {}) => ({ id, subjectId: 'A', day: 0, start: '09:00', end: '10:00', ...fields });
const rec = (slotId, date, status, subjectId = 'A') => ({ id: attendanceKey(slotId, date), slotId, subjectId, date, status });
const subject = (fields = {}) => ({ id: 'A', name: 'Physics', startAttended: 0, startHeld: 0, attendanceMin: null, ...fields });
const many = (n, status, from = 0) => Array.from({ length: n }, (_, i) => rec('s', day(from + i), status));

describe('canMiss and toRecover', () => {
  it('counts how many classes you can miss and still be at the minimum', () => {
    expect(canMiss(30, 36, 75)).toBe(4); // 30 of 40 is exactly 75%
    expect(canMiss(15, 20, 75)).toBe(0); // right at 75%
    expect(canMiss(14, 20, 75)).toBe(0); // already below
    expect(canMiss(0, 0, 75)).toBe(0);
    expect(canMiss(10, 10, 100)).toBe(0);
  });
  it('counts how many classes in a row bring you back to the minimum', () => {
    expect(toRecover(15, 21, 75)).toBe(3); // 18 of 24 = 75%
    expect(toRecover(15, 20, 80)).toBe(5); // 20 of 25 = 80%
    expect(toRecover(15, 20, 75)).toBe(0);
    expect(toRecover(0, 1, 75)).toBe(3); // 3 of 4
    expect(toRecover(9, 10, 100)).toBe(Infinity);
  });
});

describe('subjectAttendance', () => {
  it('counts present and absent, not cancelled, and adds the starting counts', () => {
    const records = [rec('s', day(0), 'present'), rec('s', day(7), 'absent'), rec('s', day(14), 'cancelled'), rec('x', day(0), 'present', 'B')];
    expect(subjectAttendance(records, subject())).toEqual({ attended: 1, held: 2, pct: 50 });
    expect(subjectAttendance(records, subject({ startAttended: 9, startHeld: 10 }))).toEqual({ attended: 10, held: 12, pct: 83 });
  });
  it('has no % until a class is held, and rounds down so 74.9% never shows as 75%', () => {
    expect(subjectAttendance([rec('s', day(0), 'cancelled')], subject()).pct).toBeNull();
    expect(subjectAttendance([], subject({ startAttended: 299, startHeld: 400 })).pct).toBe(74);
  });
});

describe('minFor', () => {
  it('uses the subject’s own minimum, else the semester’s, else 75%', () => {
    expect(minFor(subject({ attendanceMin: 80 }), { attendanceMin: 70 })).toBe(80);
    expect(minFor(subject(), { attendanceMin: 70 })).toBe(70);
    expect(minFor(subject(), {})).toBe(ATTENDANCE.defaultMin);
  });
});

describe('attendanceStatus', () => {
  const sem = { attendanceMin: 75 };
  it('says nothing much before any class is held', () => {
    expect(attendanceStatus([], subject(), sem)).toMatchObject({ level: 'none', pct: null });
  });
  it('is safe with room to spare', () => {
    const st = attendanceStatus(many(10, 'present'), subject(), sem);
    expect(st).toMatchObject({ level: 'safe', canMiss: 3, pct: 100 });
    expect(st.text).toBe('You can miss 3 more and still be at 75%.');
  });
  it('is close when one or no misses are left', () => {
    expect(attendanceStatus([], subject({ startAttended: 15, startHeld: 20 }), sem)).toMatchObject({ level: 'close', canMiss: 0, text: 'Right at 75%. Worth going to the next few.' });
    expect(attendanceStatus([], subject({ startAttended: 16, startHeld: 20 }), sem)).toMatchObject({ level: 'close', canMiss: 1, text: 'Close to 75%. You can miss 1 more.' });
  });
  it('is below with the way back', () => {
    const st = attendanceStatus([rec('s', day(0), 'absent')], subject({ startAttended: 15, startHeld: 20 }), sem);
    expect(st).toMatchObject({ level: 'below', pct: 71, toRecover: 3 });
    expect(st.text).toBe('At 71%. Going to the next 3 brings you back to 75%.');
    expect(attendanceStatus([], subject({ startAttended: 2, startHeld: 3 }), sem).text).toBe('At 66%. Going to the next class brings you back to 75%.');
  });
  it('follows a subject’s own minimum', () => {
    expect(attendanceStatus([], subject({ startAttended: 15, startHeld: 20, attendanceMin: 80 }), sem)).toMatchObject({ level: 'below', toRecover: 5, min: 80 });
  });
  it('has a calm line when every class is needed and one was missed', () => {
    expect(attendanceStatus([], subject({ startAttended: 9, startHeld: 10, attendanceMin: 100 }), sem).text).toMatch(/needs every class/);
  });
});

describe('classesOn and unmarkedClasses', () => {
  const slots = [slot('s'), slot('late', { start: '14:00', end: '15:00' }), slot('free', { subjectId: '' }), slot('tue', { day: 1 })];
  const semester = { startDate: START, endDate: day(60) };
  const today = day(14); // a Monday

  it('lists a date’s subject classes by start time', () => {
    expect(classesOn(slots, day(0)).map((c) => c.key)).toEqual([attendanceKey('s', day(0)), attendanceKey('late', day(0))]);
    expect(classesOn(slots, day(2))).toEqual([]);
  });
  it('looks back 14 days, newest first, and counts today’s classes once they’ve started', () => {
    const at = (nowMin) => unmarkedClasses({ slots, records: [], semester, today, nowMin }).map((c) => `${c.slot.id}@${c.date}`);
    // day(0) is 14 days back, outside the window.
    expect(at(8 * 60)).toEqual([`tue@${day(8)}`, `s@${day(7)}`, `late@${day(7)}`, `tue@${day(1)}`]);
    expect(at(9 * 60)[0]).toBe(`s@${today}`);
    expect(at(14 * 60).slice(0, 2)).toEqual([`s@${today}`, `late@${today}`]);
    expect(at(null)).toEqual(at(8 * 60)); // no clock: today waits
  });
  it('skips marked classes and anything before the semester starts', () => {
    const records = [rec('s', day(7), 'present'), rec('late', day(7), 'cancelled')];
    const list = unmarkedClasses({ slots, records, semester: { ...semester, startDate: day(5) }, today, nowMin: 8 * 60 });
    expect(list.map((c) => `${c.slot.id}@${c.date}`)).toEqual([`tue@${day(8)}`]);
  });
  it('skips days after the semester has ended', () => {
    expect(unmarkedClasses({ slots, records: [], semester: { startDate: START, endDate: day(3) }, today, nowMin: 8 * 60 }).map((c) => c.date)).toEqual([day(1)]);
  });
});

describe('cancelledKeys', () => {
  it('collects only cancelled classes', () => {
    const keys = cancelledKeys([rec('s', day(0), 'cancelled'), rec('s', day(7), 'absent')]);
    expect([...keys]).toEqual([attendanceKey('s', day(0))]);
  });
});

describe('attendance validation', () => {
  it('takes a whole-number minimum from 50 to 100', () => {
    expect(validateAttendanceMin(75).ok).toBe(true);
    expect(validateAttendanceMin(100).ok).toBe(true);
    expect(validateAttendanceMin(45).ok).toBe(false);
    expect(validateAttendanceMin(75.5).ok).toBe(false);
  });
  it('needs whole starting counts with attended no more than held', () => {
    expect(validateStartCounts({ startAttended: 15, startHeld: 20 }).ok).toBe(true);
    expect(validateStartCounts({ startAttended: 0, startHeld: 0 }).ok).toBe(true);
    expect(validateStartCounts({ startAttended: 21, startHeld: 20 }).errors.startAttended).toBeTruthy();
    expect(validateStartCounts({ startAttended: -1, startHeld: 2 }).errors.startAttended).toBeTruthy();
    expect(validateStartCounts({ startAttended: 1, startHeld: 1.5 }).errors.startHeld).toBeTruthy();
  });
});
