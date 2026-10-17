import { describe, it, expect } from 'vitest';
import { pickSummit, resolveSummit, summitReached, isSummitSession, isSummitItem } from '../src/model/summit.js';

const D = '2026-10-16';
const topics = [
  { id: 'easy', subjectId: 'A', difficulty: 1 },
  { id: 'mid', subjectId: 'A', difficulty: 2 },
  { id: 'mid2', subjectId: 'B', difficulty: 2 },
  { id: 'hard', subjectId: 'B', difficulty: 3 },
  { id: 'hard2', subjectId: 'A', difficulty: 3 },
];
const learn = (topicId, minutes = 45) => ({ kind: 'learn', topicId, subjectId: 'A', minutes });
const review = (topicId, minutes = 15, weak = false) => ({ kind: 'review', topicId, subjectId: 'A', minutes, weak });

describe('pickSummit', () => {
  it('is null with nothing planned', () => {
    expect(pickSummit([], topics)).toBe(null);
    expect(pickSummit(undefined, topics)).toBe(null);
  });

  it('picks the hardest topic', () => {
    expect(pickSummit([learn('easy'), learn('hard'), learn('mid')], topics)).toMatchObject({ topicId: 'hard', kind: 'learn' });
  });

  it('counts a weak review as one step harder', () => {
    expect(pickSummit([learn('mid'), review('mid2', 15, true)], topics).topicId).toBe('mid2');
    expect(pickSummit([learn('hard'), review('mid2', 15, true)], topics).topicId).toBe('hard'); // tie → learning
  });

  it('breaks ties with learning first, then the longer block, then plan order', () => {
    expect(pickSummit([review('hard', 30), learn('hard2', 20)], topics).topicId).toBe('hard2');
    expect(pickSummit([learn('mid', 30), learn('mid2', 60)], topics).topicId).toBe('mid2');
    expect(pickSummit([learn('mid', 45), learn('mid2', 45)], topics).topicId).toBe('mid');
  });

  it('treats an unknown difficulty as medium and skips deleted topics', () => {
    expect(pickSummit([learn('gone'), learn('easy')], topics).topicId).toBe('easy');
    expect(pickSummit([learn('x')], [{ id: 'x' }, ...topics]).topicId).toBe('x');
  });
});

describe('resolveSummit', () => {
  const items = [learn('mid'), learn('hard')];

  it('picks a summit for a new day', () => {
    const r = resolveSummit({ stored: { date: '2026-10-15', topicId: 'easy', kind: 'learn' }, items, topics, today: D });
    expect(r.changed).toBe(true);
    expect(r.summit).toEqual({ date: D, topicId: 'hard', subjectId: 'A', kind: 'learn', celebrated: false });
  });

  it('keeps today’s summit even once its block has left the plan', () => {
    const stored = { date: D, topicId: 'hard', subjectId: 'B', kind: 'learn', celebrated: true };
    const r = resolveSummit({ stored, items: [learn('mid')], topics, today: D });
    expect(r).toEqual({ summit: stored, changed: false });
  });

  it('picks again when today’s summit topic was deleted', () => {
    const stored = { date: D, topicId: 'gone', kind: 'learn', celebrated: false };
    expect(resolveSummit({ stored, items, topics, today: D })).toMatchObject({ changed: true, summit: { topicId: 'hard' } });
  });

  it('has no summit when nothing is planned today', () => {
    expect(resolveSummit({ stored: null, items: [], topics, today: D })).toEqual({ summit: null, changed: false });
    expect(resolveSummit({ stored: { date: '2026-10-15', topicId: 'mid', kind: 'learn' }, items: [], topics, today: D }).summit).toBe(null);
  });
});

describe('reaching the summit', () => {
  const summit = { date: D, topicId: 'hard', kind: 'learn', celebrated: false };
  const session = (fields) => ({ date: D, topicId: 'hard', kind: 'learn', minutes: 30, ...fields });

  it('needs a session today on that topic, of the same kind', () => {
    expect(summitReached(summit, [session()], D)).toBe(true);
    expect(summitReached(summit, [session({ date: '2026-10-15' })], D)).toBe(false);
    expect(summitReached(summit, [session({ topicId: 'mid' })], D)).toBe(false);
    expect(summitReached(summit, [session({ kind: 'revision' })], D)).toBe(false);
    expect(summitReached({ ...summit, kind: 'review' }, [session({ kind: 'revision' })], D)).toBe(true);
  });

  it('is never reached for another day’s summit or none', () => {
    expect(summitReached(null, [session()], D)).toBe(false);
    expect(summitReached({ ...summit, date: '2026-10-15' }, [session()], D)).toBe(false);
  });

  it('isSummitSession only celebrates once', () => {
    expect(isSummitSession(summit, session(), D)).toBe(true);
    expect(isSummitSession({ ...summit, celebrated: true }, session(), D)).toBe(false);
    expect(isSummitSession(summit, session({ topicId: 'mid' }), D)).toBe(false);
    expect(isSummitSession(null, session(), D)).toBe(false);
  });

  it('isSummitItem matches the plan block', () => {
    expect(isSummitItem(summit, learn('hard'))).toBe(true);
    expect(isSummitItem(summit, review('hard'))).toBe(false);
    expect(isSummitItem(null, learn('hard'))).toBe(false);
  });
});
