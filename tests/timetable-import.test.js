import { describe, it, expect } from 'vitest';
import {
  parseTime,
  parseTimes,
  parseDay,
  cleanRows,
  matchSubject,
  groupNames,
  defaultDecision,
  buildSlots,
  planSave,
  foundLine,
  IMPORT,
} from '../src/model/timetable-import.js';

const subjects = [
  { id: 'phy', name: 'Physics', code: 'PH101', color: '#2f6f6a' },
  { id: 'dsa', name: 'Data Structures and Algorithms', code: 'CS201', color: '#c7794a' },
  { id: 'pe', name: 'Physical Education', code: '', color: '#6b7fb3' },
  { id: 'math', name: 'Mathematics III', code: 'MA203', color: '#a06a9a' },
];

describe('parseTime', () => {
  it('reads the usual ways times are written', () => {
    expect(parseTime('9')).toBe('09:00');
    expect(parseTime('9:00')).toBe('09:00');
    expect(parseTime('09.30')).toBe('09:30');
    expect(parseTime('14:15')).toBe('14:15');
    expect(parseTime('9 am')).toBe('09:00');
    expect(parseTime('2:15 pm')).toBe('14:15');
    expect(parseTime('2:15PM')).toBe('14:15');
    expect(parseTime('11 a.m.')).toBe('11:00');
    expect(parseTime('noon')).toBe('12:00');
  });
  it('handles 12 am / 12 pm, and reads a bare 1–7 as the afternoon', () => {
    expect(parseTime('12 pm')).toBe('12:00');
    expect(parseTime('12 am')).toBe('00:00');
    expect(parseTime('12')).toBe('12:00');
    expect(parseTime('1')).toBe('13:00');
    expect(parseTime('4:30')).toBe('16:30');
    expect(parseTime('8')).toBe('08:00');
  });
  it('gives null for anything else', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('9:75')).toBeNull();
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('13 pm')).toBeNull();
    expect(parseTime('lunch')).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

describe('parseTimes', () => {
  it('reads a start and end together', () => {
    expect(parseTimes('9', '10')).toEqual({ start: '09:00', end: '10:00' });
    expect(parseTimes('12', '1')).toEqual({ start: '12:00', end: '13:00' });
    expect(parseTimes('2', '4')).toEqual({ start: '14:00', end: '16:00' });
  });
  it('fixes a wrong afternoon guess, and an afternoon end written as a morning hour', () => {
    expect(parseTimes('7', '8')).toEqual({ start: '07:00', end: '08:00' });
    expect(parseTimes('7 pm', '8')).toEqual({ start: '19:00', end: '20:00' });
  });
  it('refuses an end that isn’t after the start', () => {
    expect(parseTimes('10', '9')).toBeNull();
    expect(parseTimes('10', '10')).toBeNull();
    expect(parseTimes('x', '10')).toBeNull();
  });
});

describe('parseDay', () => {
  it('reads day names, short and long', () => {
    expect(['Mon', 'monday', 'MONDAY', 'Mo'].map(parseDay)).toEqual([0, 0, 0, 0]);
    expect(['Tue', 'Tues', 'tuesday'].map(parseDay)).toEqual([1, 1, 1]);
    expect(['Thu', 'Thur', 'Thurs', 'Thursday'].map(parseDay)).toEqual([3, 3, 3, 3]);
    expect(['Sat', 'Sun', 'Fri.', 'Wed'].map(parseDay)).toEqual([5, 6, 4, 2]);
  });
  it('takes clear single letters only', () => {
    expect(['M', 'W', 'F'].map(parseDay)).toEqual([0, 2, 4]);
    expect(parseDay('T')).toBeNull(); // Tuesday or Thursday?
    expect(parseDay('S')).toBeNull();
    expect(parseDay('')).toBeNull();
    expect(parseDay('Holiday')).toBeNull();
  });
});

describe('cleanRows', () => {
  it('tidies rows and keeps kind and room as the label', () => {
    const rows = cleanRows([
      { day: 'Mon', start: '9', end: '10', subject: '  Physics ', kind: 'Lecture', room: 'LH-2' },
      { day: 'Tue', start: '9-11', subject: 'DSA Lab', kind: 'Lab', room: '' },
    ]);
    expect(rows).toEqual([
      { day: 0, start: '09:00', end: '10:00', name: 'Physics', label: 'Lecture · LH-2' },
      { day: 1, start: '09:00', end: '11:00', name: 'DSA Lab', label: 'Lab' },
    ]);
  });
  it('drops rows it can’t use and exact duplicates', () => {
    const rows = cleanRows([
      { day: 'Mon', start: '9', end: '10', subject: 'Physics' },
      { day: 'mon', start: '9:00', end: '10:00', subject: 'physics' }, // same class
      { day: 'T', start: '9', end: '10', subject: 'Maths' }, // which day?
      { day: 'Wed', start: '10', end: '9', subject: 'Maths' },
      { day: 'Wed', start: '10', end: '11', subject: '   ' },
      null,
      'nonsense',
    ]);
    expect(rows).toHaveLength(1);
    expect(cleanRows(undefined)).toEqual([]);
  });
  it('keeps at most maxRows', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ day: 'Mon', start: '8', end: '9', subject: `S${i}` }));
    expect(cleanRows(many)).toHaveLength(IMPORT.maxRows);
  });
});

describe('matchSubject', () => {
  it('matches the exact name or code, ignoring case, spaces and words like Lab', () => {
    expect(matchSubject('physics', subjects)).toEqual({ subjectId: 'phy', confidence: 'exact' });
    expect(matchSubject('PH 101', subjects)).toEqual({ subjectId: 'phy', confidence: 'exact' });
    expect(matchSubject('Physics Lab', subjects)).toEqual({ subjectId: 'phy', confidence: 'exact' });
  });
  it('finds a code inside the name, initials and a prefix', () => {
    expect(matchSubject('CS201 Practical', subjects)).toEqual({ subjectId: 'dsa', confidence: 'exact' }); // code alone once Practical is dropped
    expect(matchSubject('CS201-B', subjects)).toEqual({ subjectId: 'dsa', confidence: 'likely' });
    expect(matchSubject('DSA', subjects)).toEqual({ subjectId: 'dsa', confidence: 'likely' });
    expect(matchSubject('DSA Lab', subjects)).toEqual({ subjectId: 'dsa', confidence: 'likely' });
    expect(matchSubject('Maths', subjects)).toEqual({ subjectId: 'math', confidence: 'likely' });
  });
  it('doesn’t guess between Physics and Physical Education', () => {
    expect(matchSubject('Phy', subjects)).toBeNull();
    expect(matchSubject('Physical Education', subjects)).toEqual({ subjectId: 'pe', confidence: 'exact' });
    expect(matchSubject('PE', subjects)).toEqual({ subjectId: 'pe', confidence: 'likely' });
  });
  it('gives null for names it doesn’t know', () => {
    expect(matchSubject('Economics', subjects)).toBeNull();
    expect(matchSubject('', subjects)).toBeNull();
  });
});

describe('groupNames and defaultDecision', () => {
  const rows = cleanRows([
    { day: 'Mon', start: '9', end: '10', subject: 'DSA' },
    { day: 'Tue', start: '9', end: '10', subject: 'dsa' },
    { day: 'Wed', start: '9', end: '10', subject: 'Economics Lab' },
  ]);
  it('groups names, most classes first, with a suggestion', () => {
    const groups = groupNames(rows, subjects);
    expect(groups.map((g) => [g.name, g.count, g.match?.subjectId ?? null])).toEqual([
      ['DSA', 2, 'dsa'],
      ['Economics Lab', 1, null],
    ]);
  });
  it('matches when it can, otherwise creates a subject named without "Lab"', () => {
    const [dsa, eco] = groupNames(rows, subjects);
    expect(defaultDecision(dsa)).toEqual({ action: 'match', subjectId: 'dsa' });
    expect(defaultDecision(eco)).toEqual({ action: 'create', name: 'Economics', credits: 3 });
  });
});

describe('buildSlots', () => {
  const rows = cleanRows([
    { day: 'Mon', start: '9', end: '10', subject: 'DSA', kind: 'Lecture' },
    { day: 'Mon', start: '9', end: '10', subject: 'CS201' }, // the same class under another name
    { day: 'Tue', start: '2', end: '4', subject: 'Economics Lab', kind: 'Lab' },
    { day: 'Wed', start: '9', end: '10', subject: 'Economics' },
    { day: 'Thu', start: '9', end: '10', subject: 'Library' },
  ]);
  const decisions = new Map([
    ['dsa', { action: 'match', subjectId: 'dsa' }],
    ['cs201', { action: 'match', subjectId: 'dsa' }],
    ['economics lab', { action: 'create', name: 'Economics', credits: 4 }],
    ['economics', { action: 'create', name: 'economics', credits: 4 }],
    ['library', { action: 'skip' }],
  ]);
  it('creates each new subject once, skips what you skipped, and keeps identical classes once', () => {
    const { newSubjects, slots } = buildSlots(rows, decisions, { semesterId: 'S', subjects });
    expect(newSubjects.map((s) => [s.name, s.credits, s.semesterId])).toEqual([['Economics', 4, 'S']]);
    expect(subjects.map((s) => s.color)).not.toContain(newSubjects[0].color);
    expect(slots.map((s) => [s.day, s.start, s.end, s.subjectId === 'dsa' ? 'dsa' : s.subjectId === newSubjects[0].id ? 'eco' : '?', s.label])).toEqual([
      [0, '09:00', '10:00', 'dsa', 'Lecture'],
      [1, '14:00', '16:00', 'eco', 'Lab'],
      [2, '09:00', '10:00', 'eco', ''],
    ]);
    expect(slots.every((s) => s.semesterId === 'S' && s.id)).toBe(true);
  });
  it('uses an existing subject when a "new" name already exists', () => {
    const { newSubjects, slots } = buildSlots(rows.slice(0, 1), new Map([['dsa', { action: 'create', name: 'physics' }]]), { semesterId: 'S', subjects });
    expect(newSubjects).toEqual([]);
    expect(slots[0].subjectId).toBe('phy');
  });
});

describe('planSave', () => {
  const existing = [
    { id: 'e1', subjectId: 'phy', day: 0, start: '09:00', end: '10:00' },
    { id: 'e2', subjectId: 'math', day: 1, start: '11:00', end: '12:00' },
  ];
  const imported = [
    { id: 'n1', subjectId: 'phy', day: 0, start: '09:00', end: '10:00' }, // already there
    { id: 'n2', subjectId: 'dsa', day: 1, start: '11:30', end: '12:30' }, // overlaps e2
    { id: 'n3', subjectId: 'dsa', day: 2, start: '09:00', end: '10:00' },
  ];
  it('adds only new classes and counts overlaps with what you have', () => {
    const p = planSave(existing, imported, 'add');
    expect(p.save.map((s) => s.id)).toEqual(['n2', 'n3']);
    expect(p).toMatchObject({ removeIds: [], skipped: 1, overlaps: 2 });
  });
  it('replaces the whole timetable', () => {
    const p = planSave(existing, imported, 'replace');
    expect(p.save).toHaveLength(3);
    expect(p).toMatchObject({ removeIds: ['e1', 'e2'], skipped: 0, overlaps: 0 });
  });
  it('says what it found', () => {
    expect(foundLine(cleanRows([{ day: 'Mon', start: '9', end: '10', subject: 'A' }, { day: 'Tue', start: '9', end: '10', subject: 'A' }]))).toBe('Found 2 classes on 2 days');
  });
});
