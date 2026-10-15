import { describe, it, expect } from 'vitest';
import {
  validateSemester,
  validateSubject,
  validateUnit,
  validateTopic,
  validateDeadline,
  validateSlot,
} from '../src/model/validate.js';

const semester = { name: 'Sem 3', startDate: '2026-08-01', endDate: '2026-12-15', dailyLimitMin: 180 };

describe('validateSemester', () => {
  it('accepts a normal semester', () => {
    expect(validateSemester(semester).ok).toBe(true);
  });
  it('needs a name, real dates, end after start and a sensible daily limit', () => {
    const r = validateSemester({ name: '  ', startDate: '2026-12-15', endDate: '2026-12-15', dailyLimitMin: 5 });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['dailyLimitMin', 'endDate', 'name']);
    expect(validateSemester({ ...semester, startDate: 'x' }).errors.startDate).toBeTruthy();
  });
});

describe('validateSubject', () => {
  it('accepts credits 0..10', () => {
    expect(validateSubject({ name: 'Maths', credits: 4 }).ok).toBe(true);
    expect(validateSubject({ name: 'Seminar', credits: 0 }).ok).toBe(true);
  });
  it('rejects missing name and bad credits', () => {
    expect(validateSubject({ name: '', credits: 4 }).errors.name).toBeTruthy();
    expect(validateSubject({ name: 'X', credits: 11 }).errors.credits).toBeTruthy();
    expect(validateSubject({ name: 'X', credits: NaN }).errors.credits).toBeTruthy();
    expect(validateSubject({ name: 'X', credits: '3' }).errors.credits).toBeTruthy();
  });
  it('rejects very long names', () => {
    expect(validateSubject({ name: 'a'.repeat(81), credits: 3 }).errors.name).toBeTruthy();
  });
});

describe('validateUnit', () => {
  it('needs a name and subject', () => {
    expect(validateUnit({ name: 'Unit 1', subjectId: 's1' }).ok).toBe(true);
    expect(validateUnit({ name: 'Unit 1' }).errors.subjectId).toBeTruthy();
  });
});

describe('validateTopic', () => {
  const ok = { name: 'Eigenvalues', unitId: 'u1', estMin: 45, difficulty: 2 };
  it('accepts a normal topic', () => {
    expect(validateTopic(ok).ok).toBe(true);
  });
  it('needs a positive time in range and a difficulty', () => {
    expect(validateTopic({ ...ok, estMin: 0 }).errors.estMin).toBeTruthy();
    expect(validateTopic({ ...ok, estMin: 601 }).errors.estMin).toBeTruthy();
    expect(validateTopic({ ...ok, difficulty: 4 }).errors.difficulty).toBeTruthy();
  });
});

describe('validateDeadline', () => {
  const ok = { title: 'Quiz 1', type: 'quiz', subjectId: 's1', date: '2026-09-10', weight: 10 };
  it('accepts a normal deadline', () => {
    const r = validateDeadline(ok, semester);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual({});
  });
  it('checks weight range 0..100', () => {
    expect(validateDeadline({ ...ok, weight: 0 }).ok).toBe(true);
    expect(validateDeadline({ ...ok, weight: 100 }).ok).toBe(true);
    expect(validateDeadline({ ...ok, weight: -1 }).errors.weight).toBeTruthy();
    expect(validateDeadline({ ...ok, weight: 101 }).errors.weight).toBeTruthy();
  });
  it('needs a known type, subject and date', () => {
    const r = validateDeadline({ ...ok, type: 'exam', subjectId: '', date: '' });
    expect(Object.keys(r.errors).sort()).toEqual(['date', 'subjectId', 'type']);
  });
  it('warns (but allows) dates outside the semester', () => {
    const r = validateDeadline({ ...ok, date: '2027-01-05' }, semester);
    expect(r.ok).toBe(true);
    expect(r.warnings.date).toBeTruthy();
  });
  it('treats the first and last semester days as inside', () => {
    expect(validateDeadline({ ...ok, date: '2026-08-01' }, semester).warnings).toEqual({});
    expect(validateDeadline({ ...ok, date: '2026-12-15' }, semester).warnings).toEqual({});
  });
});

describe('validateSlot', () => {
  const ok = { day: 0, start: '09:00', end: '10:00', subjectId: 's1' };
  it('accepts a normal class', () => {
    expect(validateSlot(ok).ok).toBe(true);
    expect(validateSlot({ ...ok, subjectId: '', label: 'Library hour' }).ok).toBe(true);
  });
  it('needs end after start', () => {
    expect(validateSlot({ ...ok, end: '09:00' }).errors.end).toBeTruthy();
    expect(validateSlot({ ...ok, end: '08:00' }).errors.end).toBeTruthy();
  });
  it('needs a valid day and times', () => {
    expect(validateSlot({ ...ok, day: 7 }).errors.day).toBeTruthy();
    expect(validateSlot({ ...ok, start: '' }).errors.start).toBeTruthy();
  });
  it('needs a subject or a label', () => {
    expect(validateSlot({ ...ok, subjectId: '', label: '  ' }).errors.subjectId).toBeTruthy();
  });
});
