import { describe, it, expect } from 'vitest';
import { topicProgress, minutesStudiedOn, remainingMin, MIN_LEFT_WHEN_OVER } from '../src/model/progress.js';

const session = (topicId, date, minutes, finished = false) => ({ topicId, date, minutes, finished });

describe('topicProgress', () => {
  it('adds up minutes and notes when a topic was finished', () => {
    const p = topicProgress([
      session('a', '2026-10-01', 30),
      session('a', '2026-10-03', 20, true),
      session('b', '2026-10-02', 45),
    ]);
    expect(p.get('a')).toEqual({ studiedMin: 50, done: true, doneOn: '2026-10-03' });
    expect(p.get('b')).toEqual({ studiedMin: 45, done: false, doneOn: null });
    expect(p.has('c')).toBe(false);
  });
});

describe('minutesStudiedOn', () => {
  it('counts only that date', () => {
    const s = [session('a', '2026-10-01', 30), session('b', '2026-10-01', 15), session('a', '2026-10-02', 60)];
    expect(minutesStudiedOn(s, '2026-10-01')).toBe(45);
    expect(minutesStudiedOn(s, '2026-10-05')).toBe(0);
  });
});

describe('remainingMin', () => {
  const topic = { estMin: 60 };
  it('is the full estimate before any study', () => {
    expect(remainingMin(topic, undefined)).toBe(60);
  });
  it('shrinks with study and is 0 once finished', () => {
    expect(remainingMin(topic, { studiedMin: 25, done: false })).toBe(35);
    expect(remainingMin(topic, { studiedMin: 10, done: true })).toBe(0);
  });
  it('keeps a little time for an unfinished topic past its estimate', () => {
    expect(remainingMin(topic, { studiedMin: 90, done: false })).toBe(MIN_LEFT_WHEN_OVER);
  });
});
