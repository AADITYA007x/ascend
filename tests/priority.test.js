import { describe, it, expect } from 'vitest';
import { covers, dueBy, isActiveOn, currentDeadline, phaseOn, topicScore } from '../src/model/priority.js';

const topic = { id: 't1', subjectId: 's1', unitId: 'u1', difficulty: 2 };
const subject = { id: 's1', credits: 3 };
const dl = (fields) => ({ id: 'd', subjectId: 's1', type: 'quiz', date: '2026-10-20', weight: 10, unitIds: [], ...fields });

describe('covers', () => {
  it('matches ticked units of the same subject', () => {
    expect(covers(dl({ unitIds: ['u1'] }), topic)).toBe(true);
    expect(covers(dl({ unitIds: ['u2'] }), topic)).toBe(false);
    expect(covers(dl({ unitIds: ['u1'], subjectId: 's2' }), topic)).toBe(false);
  });
  it('an exam with no units covers the whole subject; a quiz with no units covers nothing', () => {
    expect(covers(dl({ type: 'midsem' }), topic)).toBe(true);
    expect(covers(dl({ type: 'endsem' }), topic)).toBe(true);
    expect(covers(dl({ type: 'quiz' }), topic)).toBe(false);
    expect(covers(dl({ type: 'assignment' }), topic)).toBe(false);
  });
});

describe('dueBy and isActiveOn', () => {
  it('exams keep buffer days before them, other deadlines do not', () => {
    expect(dueBy(dl({ type: 'midsem', date: '2026-10-20' }), 2)).toBe('2026-10-17');
    expect(dueBy(dl({ type: 'midsem', date: '2026-10-20' }), 0)).toBe('2026-10-19');
    expect(dueBy(dl({ type: 'quiz', date: '2026-10-20' }), 2)).toBe('2026-10-20');
  });
  it('a quiz still counts on its own day, an exam does not', () => {
    expect(isActiveOn(dl({ type: 'quiz' }), '2026-10-20')).toBe(true);
    expect(isActiveOn(dl({ type: 'quiz' }), '2026-10-21')).toBe(false);
    expect(isActiveOn(dl({ type: 'midsem' }), '2026-10-19')).toBe(true);
    expect(isActiveOn(dl({ type: 'midsem' }), '2026-10-20')).toBe(false);
  });
});

describe('currentDeadline', () => {
  const quiz = dl({ id: 'q', type: 'quiz', date: '2026-10-10', unitIds: ['u1'] });
  const end = dl({ id: 'e', type: 'endsem', date: '2026-12-01' });
  it('picks the earliest active deadline, then moves on once it has passed', () => {
    expect(currentDeadline([end, quiz], '2026-10-05', 2, '2026-12-10').deadline.id).toBe('q');
    const after = currentDeadline([end, quiz], '2026-10-11', 2, '2026-12-10');
    expect(after.deadline.id).toBe('e');
    expect(after.dueBy).toBe('2026-11-28');
  });
  it('falls back to the semester end', () => {
    expect(currentDeadline([], '2026-10-05', 2, '2026-12-10')).toEqual({ deadline: null, dueBy: '2026-12-10' });
  });
});

describe('phaseOn', () => {
  const deadlines = [dl({ type: 'endsem', date: '2026-12-01' }), dl({ type: 'endsem', date: '2026-12-05' })];
  it('switches to exam mode 3 weeks before the first end-sem', () => {
    expect(phaseOn('2026-11-09', deadlines, '2026-12-10')).toBe('keepup');
    expect(phaseOn('2026-11-10', deadlines, '2026-12-10')).toBe('exam');
  });
  it('uses the semester end when there are no end-sems', () => {
    expect(phaseOn('2026-11-20', [], '2026-12-10')).toBe('exam');
    expect(phaseOn('2026-10-01', [], '2026-12-10')).toBe('keepup');
  });
});

describe('topicScore', () => {
  const base = { topic, subject, deadline: dl({}), dueBy: '2026-10-20', day: '2026-10-10', phase: 'keepup' };
  const score = (over) => topicScore({ ...base, ...over });
  it('rises with a closer deadline, bigger weight, more credits and harder topics', () => {
    expect(score({ dueBy: '2026-10-12' })).toBeGreaterThan(score({}));
    expect(score({ deadline: dl({ weight: 30 }) })).toBeGreaterThan(score({}));
    expect(score({ subject: { credits: 4 } })).toBeGreaterThan(score({}));
    expect(score({ topic: { ...topic, difficulty: 3 } })).toBeGreaterThan(score({}));
    expect(score({ topic: { ...topic, difficulty: 1 } })).toBeLessThan(score({}));
  });
  it('treats overdue work as closest, and still scores 0-weight and 0-credit work', () => {
    expect(score({ dueBy: '2026-10-01' })).toBe(score({ dueBy: '2026-10-10' }));
    expect(score({ deadline: dl({ weight: 0 }), subject: { credits: 0 } })).toBeGreaterThan(0);
  });
  it('boosts end-sem topics in exam mode only', () => {
    const endsem = { deadline: dl({ type: 'endsem' }) };
    expect(score({ ...endsem, phase: 'exam' })).toBeCloseTo(score(endsem) * 1.5);
    expect(score({ phase: 'exam' })).toBe(score({}));
  });
});
