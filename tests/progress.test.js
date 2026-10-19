import { describe, it, expect } from 'vitest';
import { topicProgress, minutesStudiedOn, remainingMin, markDoneSession, unmarkDone, MIN_LEFT_WHEN_OVER } from '../src/model/progress.js';

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

describe('markDoneSession and unmarkDone', () => {
  const topic = { id: 't1', subjectId: 's1', estMin: 60 };

  it('marks a topic done with no study time', () => {
    const s = markDoneSession(topic, { semesterId: 'sem', date: '2026-10-19' });
    expect(s).toMatchObject({ semesterId: 'sem', subjectId: 's1', topicId: 't1', date: '2026-10-19', minutes: 0, finished: true, kind: 'learn', source: 'mark' });
    expect(typeof s.id).toBe('string');
    const p = topicProgress([s]).get('t1');
    expect(p).toEqual({ studiedMin: 0, done: true, doneOn: '2026-10-19' });
    expect(remainingMin(topic, p)).toBe(0);
  });

  it('undoes "done": removes marks, keeps real study but unfinished', () => {
    const sessions = [
      { id: 'a', topicId: 't1', date: '2026-10-01', minutes: 30, finished: false, source: 'timer' },
      { id: 'b', topicId: 't1', date: '2026-10-02', minutes: 20, finished: true, source: 'timer' },
      { id: 'c', topicId: 't1', date: '2026-10-03', minutes: 0, finished: true, source: 'mark' },
      { id: 'd', topicId: 't2', date: '2026-10-03', minutes: 40, finished: true, source: 'timer' },
    ];
    const { save, remove } = unmarkDone(sessions, 't1');
    expect(remove).toEqual(['c']);
    expect(save).toEqual([{ ...sessions[1], finished: false }]);
    const after = sessions.filter((s) => !remove.includes(s.id)).map((s) => save.find((x) => x.id === s.id) ?? s);
    const p = topicProgress(after).get('t1');
    expect(p.done).toBe(false);
    expect(p.studiedMin).toBe(50);
    expect(topicProgress(after).get('t2').done).toBe(true);
  });

  it('changes nothing for a topic that isn’t done', () => {
    expect(unmarkDone([{ id: 'a', topicId: 't1', minutes: 30, finished: false }], 't1')).toEqual({ save: [], remove: [] });
  });
});
