import { describe, it, expect } from 'vitest';
import { nextGap, isWeak, weakness, revisionMinutes, revisionStates, REVISION } from '../src/model/revision.js';
import { addDays } from '../src/model/time.js';

const D = '2026-10-19';
const day = (n) => addDays(D, n);
const topic = (id, fields = {}) => ({ id, subjectId: 'A', unitId: 'u', estMin: 60, difficulty: 2, ...fields });
const s = (topicId, date, fields = {}) => ({ topicId, date, minutes: 20, finished: false, rating: null, ...fields });
const state = (sessions, t = topic('a')) => revisionStates([t], sessions).get(t.id);

describe('nextGap', () => {
  it('follows 1, 3, 7, 21 days', () => {
    expect([0, 1, 2, 3].map((k) => nextGap(k, 'okay'))).toEqual(REVISION.gaps);
    expect(nextGap(1, null)).toBe(3);
  });
  it('hard halves the gap (at least a day), easy makes it 1.5× longer', () => {
    expect([0, 1, 2, 3].map((k) => nextGap(k, 'hard'))).toEqual([1, 2, 4, 11]);
    expect([0, 1, 2, 3].map((k) => nextGap(k, 'easy'))).toEqual([2, 5, 11, 32]);
  });
});

describe('revisionStates', () => {
  it('ignores topics not finished yet', () => {
    expect(state([s('a', day(0))])).toBeUndefined();
  });
  it('first review is a day after finishing; the finishing rating sets the gap', () => {
    expect(state([s('a', day(0), { finished: true })])).toMatchObject({ step: 0, due: day(1), mastered: false });
    expect(state([s('a', day(0), { finished: true, rating: 'easy' })]).due).toBe(day(2));
    // No rating on the finishing session: the last rating while learning counts.
    expect(state([s('a', day(-1), { rating: 'hard' }), s('a', day(0), { finished: true })]).due).toBe(day(1));
  });
  it('walks through the steps and is mastered after 4 reviews', () => {
    const list = [s('a', day(0), { finished: true })];
    const expectations = [
      [day(1), 1, day(4)],
      [day(4), 2, day(11)],
      [day(11), 3, day(32)],
    ];
    for (const [date, step, due] of expectations) {
      list.push(s('a', date, { rating: 'okay' }));
      expect(state(list)).toMatchObject({ step, due });
    }
    list.push(s('a', day(32)));
    expect(state(list)).toMatchObject({ step: 4, due: null, mastered: true });
  });
  it('a hard review repeats the step, sooner', () => {
    const st = state([s('a', day(0), { finished: true }), s('a', day(1)), s('a', day(4), { rating: 'hard' })]);
    expect(st).toMatchObject({ step: 1, due: day(6) });
  });
  it('an easy review moves on and waits longer', () => {
    expect(state([s('a', day(0), { finished: true }), s('a', day(1), { rating: 'easy' })]).due).toBe(day(6));
  });
  it('recognises reviews from their order alone (sessions saved before Milestone 4)', () => {
    const st = state([s('a', day(0), { finished: true }), s('a', day(2))]);
    expect(st).toMatchObject({ step: 1, lastDate: day(2), due: day(5) });
  });
  it('counts one review a day and nothing on the finishing day', () => {
    const st = state([s('a', day(0), { finished: true }), s('a', day(0)), s('a', day(1)), s('a', day(1))]);
    expect(st.step).toBe(1);
  });
  it('a late review counts from the day you did it', () => {
    expect(state([s('a', day(0), { finished: true }), s('a', day(9))]).due).toBe(day(12));
  });
  it('notes weakness from all ratings', () => {
    const st = state([s('a', day(0), { finished: true, rating: 'hard' })]);
    expect(st.weak).toBe(true);
    expect(st.ratings).toEqual(['hard']);
  });
});

describe('weak topics', () => {
  it('weak when the latest is hard, or 2 of the last 3', () => {
    expect(isWeak(['easy', 'hard'])).toBe(true);
    expect(isWeak(['hard', 'hard', 'okay'])).toBe(true);
    expect(isWeak(['hard', 'okay', 'okay'])).toBe(false);
    expect(isWeak(['hard', 'hard', 'okay', 'okay', 'easy'])).toBe(false); // only the last 3 count
    expect(isWeak([])).toBe(false);
  });
  it('weakness: latest hard counts double, harder topics a little more', () => {
    expect(weakness(['okay', 'hard'])).toBeGreaterThan(weakness(['hard', 'okay']));
    expect(weakness(['hard'], 3)).toBeGreaterThan(weakness(['hard'], 2));
    expect(weakness([], 1)).toBe(0);
  });
});

describe('revisionMinutes', () => {
  it('is about a quarter of the estimate, 10–30 min', () => {
    expect(revisionMinutes(topic('a', { estMin: 60 }))).toBe(15);
    expect(revisionMinutes(topic('a', { estMin: 20 }))).toBe(10);
    expect(revisionMinutes(topic('a', { estMin: 300 }))).toBe(30);
  });
  it('uses the typed estimate, not the paced one', () => {
    expect(revisionMinutes({ estMin: 120, baseEstMin: 60 })).toBe(15);
  });
  it('weak topics get a little longer', () => {
    expect(revisionMinutes(topic('a', { estMin: 60 }), true)).toBe(25);
    expect(revisionMinutes(topic('a', { estMin: 300 }), true)).toBe(40);
  });
});
