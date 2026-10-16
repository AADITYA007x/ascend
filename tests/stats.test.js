import { describe, it, expect } from 'vitest';
import { subjectProgress, overallProgress, dailyMinutes, deadlineCoverage } from '../src/model/stats.js';
import { addDays } from '../src/model/time.js';

const D = '2026-10-19';
const day = (n) => addDays(D, n);
const subjects = [{ id: 'A' }, { id: 'B' }];
const topics = [
  { id: 'a1', subjectId: 'A', unitId: 'uA1', estMin: 60, difficulty: 2 },
  { id: 'a2', subjectId: 'A', unitId: 'uA2', estMin: 60, difficulty: 2 },
  { id: 'b1', subjectId: 'B', unitId: 'uB1', estMin: 30, difficulty: 2 },
];
const s = (topicId, date, minutes, fields = {}) => ({ topicId, subjectId: topicId[0].toUpperCase(), date, minutes, finished: false, rating: null, ...fields });
const sessions = [
  s('a1', day(0), 60, { finished: true, rating: 'hard' }),
  s('a2', day(1), 20),
  s('a1', day(2), 15, { kind: 'revision' }),
];

describe('subjectProgress', () => {
  const [a, b] = subjectProgress({ subjects, topics, sessions });
  it('counts topics, time, reviews and weak topics per subject', () => {
    expect(a).toMatchObject({ subjectId: 'A', topicsDone: 1, topicsTotal: 2, studiedMin: 95, reviewsDone: 1, weakCount: 1, masteredCount: 0 });
    expect(b).toMatchObject({ subjectId: 'B', topicsDone: 0, topicsTotal: 1, studiedMin: 0, reviewsDone: 0, weakCount: 0 });
  });
  it('measures what is left in planning minutes', () => {
    expect(a).toMatchObject({ estMin: 120, learnLeftMin: 40 });
    expect(a.donePct).toBeCloseTo(80 / 120);
    expect(b.donePct).toBe(0);
  });
  it('a subject with no topics is 0% without dividing by zero', () => {
    expect(subjectProgress({ subjects: [{ id: 'C' }], topics, sessions })[0].donePct).toBe(0);
  });
});

describe('overallProgress', () => {
  it('adds subjects up', () => {
    const all = overallProgress(subjectProgress({ subjects, topics, sessions }));
    expect(all).toMatchObject({ topicsDone: 1, topicsTotal: 3, estMin: 150, learnLeftMin: 70, studiedMin: 95, reviewsDone: 1 });
    expect(all.donePct).toBeCloseTo(80 / 150);
  });
});

describe('dailyMinutes', () => {
  it('lists every day, with review time apart', () => {
    expect(dailyMinutes(sessions, day(0), day(3))).toEqual([
      { date: day(0), minutes: 60, reviewMin: 0 },
      { date: day(1), minutes: 20, reviewMin: 0 },
      { date: day(2), minutes: 15, reviewMin: 15 },
      { date: day(3), minutes: 0, reviewMin: 0 },
    ]);
    expect(dailyMinutes(sessions, day(3), day(1))).toEqual([]);
  });
});

describe('deadlineCoverage', () => {
  it('counts the topics a deadline covers and how many are done', () => {
    expect(deadlineCoverage({ subjectId: 'A', type: 'quiz', unitIds: ['uA1'] }, topics, sessions)).toEqual({ done: 1, total: 1 });
    expect(deadlineCoverage({ subjectId: 'A', type: 'midsem', unitIds: [] }, topics, sessions)).toEqual({ done: 1, total: 2 });
    expect(deadlineCoverage({ subjectId: 'A', type: 'quiz', unitIds: [] }, topics, sessions)).toEqual({ done: 0, total: 0 });
  });
});
