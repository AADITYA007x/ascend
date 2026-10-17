import { describe, it, expect } from 'vitest';
import { cardStates, dueCards, quizRating, quizLine, cleanDrafts, CARDS } from '../src/model/cards.js';
import { validateCard } from '../src/model/validate.js';
import { addDays } from '../src/model/time.js';

const D = '2026-10-19';
const day = (n) => addDays(D, n);
const card = (id, fields = {}) => ({ id, topicId: 't', subjectId: 'A', front: `Q ${id}`, back: `A ${id}`, createdAt: 0, ...fields });
const quiz = (date, got = [], missed = [], fields = {}) => ({ topicId: 't', date, minutes: 5, quiz: { got, missed }, ...fields });
const state = (sessions, c = card('a')) => cardStates([c], sessions).get(c.id);

describe('cardStates', () => {
  it('a new card is due right away', () => {
    expect(state([])).toEqual({ box: 0, due: null, lastDate: null, lastResult: null, misses: 0 });
  });
  it('each "got it" moves it a box on: back after 1, 3, 7, then every 21 days', () => {
    const list = [];
    const expected = [
      [day(0), 1, day(1)],
      [day(1), 2, day(4)],
      [day(4), 3, day(11)],
      [day(11), 4, day(32)],
      [day(32), 5, day(53)],
    ];
    for (const [date, box, due] of expected) {
      list.push(quiz(date, ['a']));
      expect(state(list)).toMatchObject({ box, due, lastResult: 'got' });
    }
  });
  it('a miss goes back to the start and returns the next day', () => {
    const st = state([quiz(day(0), ['a']), quiz(day(1), ['a']), quiz(day(4), [], ['a'])]);
    expect(st).toMatchObject({ box: 0, due: day(5), lastResult: 'missed', misses: 1 });
  });
  it('only the first answer on a day counts', () => {
    const st = state([quiz(day(0), [], ['a']), quiz(day(0), ['a'])]);
    expect(st).toMatchObject({ box: 0, due: day(1), lastResult: 'missed' });
  });
  it('reads sessions oldest first and ignores sessions without a quiz or unknown cards', () => {
    const st = state([quiz(day(1), ['a']), { topicId: 't', date: day(0), quiz: null }, quiz(day(0), [], ['a', 'gone'])]);
    expect(st).toMatchObject({ box: 1, due: day(2), misses: 1 });
  });
});

describe('dueCards', () => {
  const cards = [
    card('new-old', { createdAt: 1 }),
    card('new-young', { createdAt: 2 }),
    card('missed'),
    card('overdue'),
    card('later'),
    card('other', { topicId: 'x' }),
  ];
  const sessions = [quiz(day(-10), ['overdue']), quiz(day(-1), [], ['missed']), quiz(day(0), ['later'])];
  const states = cardStates(cards, sessions);

  it('missed first, then new (oldest first), then most overdue; not future cards or other topics', () => {
    expect(dueCards(cards, states, 't', D).map((c) => c.id)).toEqual(['missed', 'new-old', 'new-young', 'overdue']);
  });
  it('keeps a quiz short', () => {
    expect(dueCards(cards, states, 't', D, 2).map((c) => c.id)).toEqual(['missed', 'new-old']);
    const many = Array.from({ length: 15 }, (_, i) => card(`c${i}`));
    expect(dueCards(many, cardStates(many, []), 't', D)).toHaveLength(CARDS.quizMax);
  });
  it('is empty when nothing is due', () => {
    expect(dueCards([card('a')], cardStates([card('a')], [quiz(D, ['a'])]), 't', D)).toEqual([]);
  });
});

describe('quizRating', () => {
  const q = (got, missed) => ({ got: Array(got).fill('x'), missed: Array(missed).fill('y') });
  it('suggests easy from 85%, okay from 60%, hard below', () => {
    expect(quizRating(q(17, 3))).toBe('easy'); // 0.85
    expect(quizRating(q(5, 1))).toBe('okay'); // 0.83
    expect(quizRating(q(3, 2))).toBe('okay'); // 0.6
    expect(quizRating(q(1, 1))).toBe('hard'); // 0.5
    expect(quizRating(q(0, 3))).toBe('hard');
  });
  it('suggests nothing when nothing was answered', () => {
    expect(quizRating(q(0, 0))).toBeNull();
    expect(quizRating(null)).toBeNull();
  });
  it('says how many were remembered', () => {
    expect(quizLine(q(7, 2))).toBe('7 of 9 remembered');
    expect(quizLine(null)).toBe('No cards answered');
  });
});

describe('cleanDrafts', () => {
  it('trims, drops blanks and removes duplicates, also against existing cards', () => {
    const raw = [
      { front: '  What is a matrix?  ', back: ' A grid ' },
      { front: 'what is  a MATRIX?', back: 'dup' },
      { front: 'Existing one', back: 'x' },
      { front: '', back: 'no front' },
      { front: 'No back', back: '   ' },
      null,
      { front: 'Rank?', back: 'Independent rows' },
    ];
    expect(cleanDrafts(raw, [{ front: 'existing ONE' }])).toEqual([
      { front: 'What is a matrix?', back: 'A grid' },
      { front: 'Rank?', back: 'Independent rows' },
    ]);
  });
  it('shortens long text and keeps at most draftMax', () => {
    const long = cleanDrafts([{ front: 'q'.repeat(400), back: 'a'.repeat(700) }])[0];
    expect(long.front).toHaveLength(CARDS.maxFront);
    expect(long.back).toHaveLength(CARDS.maxBack);
    expect(long.front.endsWith('…')).toBe(true);
    const many = Array.from({ length: 30 }, (_, i) => ({ front: `Q${i}`, back: 'A' }));
    expect(cleanDrafts(many)).toHaveLength(CARDS.draftMax);
  });
  it('copes with anything that is not a list', () => {
    expect(cleanDrafts(undefined)).toEqual([]);
    expect(cleanDrafts({ front: 'x' })).toEqual([]);
  });
});

describe('validateCard', () => {
  it('accepts a normal card', () => {
    expect(validateCard(card('a')).ok).toBe(true);
  });
  it('needs a front, a back and a topic, within limits', () => {
    const r = validateCard({ front: ' ', back: '', topicId: '' });
    expect(Object.keys(r.errors).sort()).toEqual(['back', 'front', 'topicId']);
    expect(validateCard(card('a', { front: 'x'.repeat(301) })).errors.front).toBeTruthy();
    expect(validateCard(card('a', { back: 'x'.repeat(601) })).errors.back).toBeTruthy();
  });
});
