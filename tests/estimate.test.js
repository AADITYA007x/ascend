import { describe, it, expect } from 'vitest';
import { actualMinutes, subjectPace, latestRating, planningTopics, ESTIMATE } from '../src/model/estimate.js';

const topic = (id, estMin, fields = {}) => ({ id, subjectId: 'A', unitId: 'u', estMin, difficulty: 2, ...fields });
const session = (topicId, date, minutes, fields = {}) => ({ topicId, date, minutes, finished: false, rating: null, ...fields });

describe('actualMinutes', () => {
  it('adds up sessions until the topic is finished, ignoring later ones', () => {
    const a = actualMinutes([
      session('a', '2026-10-01', 30),
      session('a', '2026-10-02', 40, { finished: true }),
      session('a', '2026-10-09', 20), // later revision
      session('b', '2026-10-01', 25),
    ]);
    expect(a.get('a')).toBe(70);
    expect(a.has('b')).toBe(false);
  });
  it('orders sessions on the same day by start time', () => {
    const a = actualMinutes([
      session('a', '2026-10-01', 15, { startedAt: 2000 }),
      session('a', '2026-10-01', 25, { startedAt: 1000, finished: true }),
    ]);
    expect(a.get('a')).toBe(25);
  });
});

describe('subjectPace', () => {
  const topics = [topic('a', 60), topic('b', 60), topic('c', 60), topic('x', 60, { subjectId: 'B' })];
  it('is 1 before anything is finished', () => {
    expect(subjectPace('A', topics, [])).toBe(1);
  });
  it('moves toward your real pace, shrunk toward 1 with little data', () => {
    const one = subjectPace('A', topics, [session('a', '2026-10-01', 90, { finished: true })]);
    expect(one).toBeCloseTo((90 + ESTIMATE.priorMin) / (60 + ESTIMATE.priorMin));
    expect(one).toBeGreaterThan(1);
    expect(one).toBeLessThan(1.5);
    const two = subjectPace('A', topics, [
      session('a', '2026-10-01', 90, { finished: true }),
      session('b', '2026-10-02', 90, { finished: true }),
    ]);
    expect(two).toBeGreaterThan(one);
  });
  it('faster than estimated lowers it', () => {
    expect(subjectPace('A', topics, [session('a', '2026-10-01', 30, { finished: true })])).toBeLessThan(1);
  });
  it('only uses topics of that subject', () => {
    expect(subjectPace('A', topics, [session('x', '2026-10-01', 200, { finished: true })])).toBe(1);
  });
  it('is clamped', () => {
    const big = [topic('a', 600)];
    expect(subjectPace('A', big, [session('a', '2026-10-01', 6000, { finished: true })])).toBe(ESTIMATE.maxPace);
    expect(subjectPace('A', big, [session('a', '2026-10-01', 5, { finished: true })])).toBe(ESTIMATE.minPace);
  });
});

describe('latestRating', () => {
  it('is the newest rated session', () => {
    const s = [
      session('a', '2026-10-03', 20, { rating: 'easy' }),
      session('a', '2026-10-01', 20, { rating: 'hard' }),
      session('a', '2026-10-04', 20), // unrated: doesn't clear it
    ];
    expect(latestRating(s, 'a')).toBe('easy');
    expect(latestRating(s, 'b')).toBe(null);
  });
});

describe('planningTopics', () => {
  it('leaves topics alone when there is nothing to learn from', () => {
    const t = [topic('a', 45)];
    expect(planningTopics(t, [])).toEqual([{ ...t[0], baseEstMin: 45 }]);
  });
  it('scales unfinished topics by the pace, in 5-minute steps, keeping the typed estimate', () => {
    const t = [topic('a', 60), topic('b', 60)];
    const [a, b] = planningTopics(t, [session('a', '2026-10-01', 150, { finished: true })]);
    // pace = (150 + 90) / (60 + 90) = 1.6 → 96 → 95
    expect(b).toMatchObject({ estMin: 95, baseEstMin: 60 });
    expect(a).toMatchObject({ estMin: 60, baseEstMin: 60 }); // finished: unchanged
  });
  it('moves difficulty by the latest rating of an unfinished topic, within 1–3', () => {
    const t = [topic('a', 60, { difficulty: 2 }), topic('b', 60, { difficulty: 3 }), topic('c', 60, { difficulty: 1 })];
    const s = [
      session('a', '2026-10-01', 25, { rating: 'hard' }),
      session('b', '2026-10-01', 25, { rating: 'hard' }),
      session('c', '2026-10-01', 25, { rating: 'easy' }),
    ];
    const [a, b, c] = planningTopics(t, s);
    expect(a.difficulty).toBe(3);
    expect(b.difficulty).toBe(3);
    expect(c.difficulty).toBe(1);
    expect(planningTopics([topic('a', 60)], [session('a', '2026-10-01', 25, { rating: 'easy' })])[0].difficulty).toBe(1);
    expect(planningTopics([topic('a', 60)], [session('a', '2026-10-01', 25, { rating: 'okay' })])[0].difficulty).toBe(2);
  });
  it('does not change the topics it was given', () => {
    const t = [topic('a', 60), topic('b', 60)];
    planningTopics(t, [session('a', '2026-10-01', 150, { finished: true, rating: 'hard' })]);
    expect(t[1]).toEqual(topic('b', 60));
  });
});
