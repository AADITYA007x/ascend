import { describe, it, expect } from 'vitest';
import { weekStart, weekSummary, weekStory } from '../src/model/story.js';

const names = {
  topic: (id) => ({ t1: 'Eigenvalues', t2: 'Diagonalisation', t3: 'Kinematics' })[id] ?? id,
  subjectOfTopic: (id) => ({ t1: 'M', t2: 'M', t3: 'P' })[id],
  subject: (id) => ({ M: 'Maths', P: 'Physics' })[id],
};
const summary = (fields = {}) => ({
  from: '2026-10-19',
  to: '2026-10-25',
  minutes: 380,
  daysStudied: 5,
  topicsFinished: [],
  reviews: 0,
  focusSessions: 0,
  ratings: { easy: 0, okay: 0, hard: 0 },
  hardTopics: [],
  bySubject: [],
  bestDay: null,
  ...fields,
});

describe('weekStart', () => {
  it('is the Monday, across month and year ends', () => {
    expect(weekStart('2026-10-21')).toBe('2026-10-19');
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
  });
});

describe('weekSummary', () => {
  const s = (topicId, date, minutes, fields = {}) => ({ topicId, subjectId: 'M', date, minutes, finished: false, rating: null, ...fields });
  const sessions = [
    s('t1', '2026-10-12', 60, { finished: true }), // the week before
    s('t1', '2026-10-20', 15, { rating: 'hard', kind: 'revision' }),
    s('t2', '2026-10-21', 60, { finished: true, source: 'timer' }),
    s('t3', '2026-10-21', 30, { rating: 'easy', subjectId: 'P' }),
    s('t3', '2026-10-27', 30), // the week after
  ];
  it('sums one week and counts reviews apart from new learning', () => {
    expect(weekSummary({ sessions, from: '2026-10-19' })).toEqual({
      from: '2026-10-19',
      to: '2026-10-25',
      minutes: 105,
      daysStudied: 2,
      topicsFinished: ['t2'],
      reviews: 1,
      focusSessions: 1,
      ratings: { easy: 1, okay: 0, hard: 1 },
      hardTopics: ['t1'],
      bySubject: [
        { subjectId: 'M', minutes: 75 },
        { subjectId: 'P', minutes: 30 },
      ],
      bestDay: { date: '2026-10-21', minutes: 90 },
    });
  });
  it('an empty week is all zeros', () => {
    expect(weekSummary({ sessions, from: '2026-11-02' })).toMatchObject({ minutes: 0, daysStudied: 0, topicsFinished: [], reviews: 0, bestDay: null });
  });
});

describe('weekStory', () => {
  it('tells a typical week', () => {
    const story = weekStory(summary({ topicsFinished: ['t1', 't2', 't3'], reviews: 3, hardTopics: ['t1'] }), null, {
      names,
      upcoming: [{ label: 'Maths mid-sem', days: 9 }],
    });
    expect(story).toEqual([
      'You studied 6 h 20 min across 5 days.',
      'You finished 3 topics, most of them in Maths.',
      '3 reviews kept older topics fresh.',
      'Eigenvalues felt hard, so it’ll come back soon.',
      'Coming up: the Maths mid-sem in 9 days.',
    ]);
  });
  it('names a single topic, a single review and two hard topics', () => {
    const story = weekStory(summary({ daysStudied: 1, topicsFinished: ['t3'], reviews: 1, hardTopics: ['t1', 't2', 't3'] }), null, { names });
    expect(story).toEqual([
      'You studied 6 h 20 min across 1 day.',
      'You finished Kinematics.',
      'One review kept an older topic fresh.',
      'Eigenvalues and Diagonalisation felt hard, so they’ll come back soon.',
    ]);
  });
  it('says "all in" when every finished topic is from one subject', () => {
    expect(weekStory(summary({ topicsFinished: ['t1', 't2'] }), null, { names })[1]).toBe('You finished 2 topics, all in Maths.');
  });
  it('mentions a bigger week, and says nothing about a smaller one', () => {
    expect(weekStory(summary(), summary({ minutes: 300 }), { names })[1]).toBe('That’s 1 h 20 min more than the week before.');
    expect(weekStory(summary(), summary({ minutes: 500 }), { names })).toEqual(['You studied 6 h 20 min across 5 days.']);
  });
  it('keeps to five sentences, dropping the comparison first', () => {
    const story = weekStory(summary({ topicsFinished: ['t1'], reviews: 2, hardTopics: ['t2'] }), summary({ minutes: 100 }), {
      names,
      upcoming: [{ label: 'Physics quiz', days: 1 }],
    });
    expect(story).toHaveLength(5);
    expect(story.some((l) => l.includes('more than'))).toBe(false);
    expect(story.at(-1)).toBe('Coming up: the Physics quiz tomorrow.');
  });
  it('is gentle about a quiet week', () => {
    expect(weekStory(summary({ minutes: 0, daysStudied: 0 }), summary(), { names, upcoming: [{ label: 'Maths quiz', days: 0 }] })).toEqual([
      'A quiet week, and that’s okay.',
      'This week’s plan is ready when you are.',
      'Coming up: the Maths quiz today.',
    ]);
  });
  it('never uses guilt words', () => {
    const guilt = /\b(only|missed|failed|lazy|should have|behind|less|fewer|just)\b/i;
    const cases = [
      [summary({ minutes: 0, daysStudied: 0 }), summary()],
      [summary({ minutes: 20, daysStudied: 1 }), summary({ minutes: 600 })],
      [summary({ topicsFinished: ['t1', 't3'], reviews: 1, hardTopics: ['t1'] }), summary({ minutes: 10 })],
    ];
    for (const [s, prev] of cases) {
      for (const line of weekStory(s, prev, { names, upcoming: [{ label: 'Maths mid-sem', days: 3 }] })) expect(line).not.toMatch(guilt);
    }
  });
});

describe('weekSummary order', () => {
  it('lists hard topics in the order they happened, whatever order storage returns', () => {
    const s = (topicId, date) => ({ topicId, subjectId: 'M', date, minutes: 20, finished: false, rating: 'hard' });
    const a = weekSummary({ sessions: [s('t2', '2026-10-21'), s('t1', '2026-10-20')], from: '2026-10-19' });
    const b = weekSummary({ sessions: [s('t1', '2026-10-20'), s('t2', '2026-10-21')], from: '2026-10-19' });
    expect(a.hardTopics).toEqual(['t1', 't2']);
    expect(b.hardTopics).toEqual(['t1', 't2']);
  });
});
