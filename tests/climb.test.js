import { describe, it, expect } from 'vitest';
import { climbModel, climbReadout, campReadout, trailPoint, trailPath, TRAIL } from '../src/model/climb.js';
import { addDays } from '../src/model/time.js';

const D = '2026-10-19';
const day = (n) => addDays(D, n);
const semester = { startDate: day(-20), endDate: day(50) };
const subjects = [
  { id: 'A', name: 'Maths' },
  { id: 'B', name: 'Physics' },
  { id: 'C', name: 'Chemistry' },
];
const topic = (id, unitId, estMin) => ({ id, unitId, subjectId: unitId[0], estMin, difficulty: 2 });
const exam = (id, subjectId, type, date, unitIds = []) => ({ id, subjectId, type, date, weight: 30, unitIds });
const finished = (topicId, minutes) => ({ topicId, subjectId: topicId[0].toUpperCase(), date: day(-1), minutes, finished: true });

// 300 min in all: Maths unit 1 = 120, Maths unit 2 = 60, Physics = 120.
const topics = [topic('a1', 'A-u1', 60), topic('a2', 'A-u1', 60), topic('a3', 'A-u2', 60), topic('b1', 'B-u1', 120)];
const deadlines = [
  exam('midA', 'A', 'midsem', day(10), ['A-u1']),
  exam('endA', 'A', 'endsem', day(40)),
  exam('endB', 'B', 'endsem', day(42)),
  { id: 'quiz', subjectId: 'A', type: 'quiz', date: day(5), weight: 10, unitIds: ['A-u1'] },
];
const model = (fields = {}) => climbModel({ subjects, topics, sessions: [], deadlines, semester, today: D, ...fields });

describe('climbModel', () => {
  it('height is the share of learning time done', () => {
    expect(model().height).toBe(0);
    expect(model({ sessions: [finished('a1', 60), finished('a2', 60)] }).height).toBeCloseTo(0.4);
  });
  it('places camps by the learning time covered by exams up to each date; the top one is the summit', () => {
    const c = model();
    expect(c.camps.map((x) => [x.label, Math.round(x.at * 100)])).toEqual([
      ['Maths mid-sem', 40],
      ['Maths end-sem', 60],
    ]);
    expect(c.summit).toEqual({ label: 'Physics end-sem', date: day(42), deadlineIds: ['endB'] });
  });
  it('quizzes are not camps, and exams with no topics are skipped', () => {
    const c = model({ deadlines: [...deadlines, exam('midC', 'C', 'midsem', day(12))] });
    expect(c.camps.flatMap((x) => x.deadlineIds)).toEqual(['midA', 'endA']);
  });
  it('the summit is the semester end when no exam reaches the top', () => {
    const c = model({ deadlines: [deadlines[0]] });
    expect(c.summit).toEqual({ label: 'Summit', date: semester.endDate, deadlineIds: [] });
  });
  it('merges camps that would sit on top of each other', () => {
    const ts = [topic('a1', 'A-u1', 60), topic('a2', 'A-u2', 140), topic('b1', 'B-u1', 10)];
    const ds = [exam('midA', 'A', 'midsem', day(10), ['A-u1']), exam('midB', 'B', 'midsem', day(12), ['B-u1']), exam('endA', 'A', 'endsem', day(40))];
    const c = climbModel({ subjects, topics: ts, sessions: [], deadlines: ds, semester, today: D });
    expect(c.camps).toHaveLength(1);
    expect(c.camps[0]).toMatchObject({ deadlineIds: ['midA', 'midB'], label: '2 mid-sems', date: day(10), dateEnd: day(12) });
    expect(c.camps[0].at).toBeCloseTo(70 / 210);
    expect(c.summit.label).toBe('Maths end-sem');
  });
  it('keeps camps apart when they are far apart in time, even at the same height', () => {
    const ds = [exam('midA', 'A', 'midsem', day(10)), exam('endA', 'A', 'endsem', day(40)), exam('endB', 'B', 'endsem', day(42))];
    const c = climbModel({ subjects, topics, sessions: [], deadlines: ds, semester, today: D });
    // Both Maths exams cover all of Maths (60%), but seven weeks apart: two camps.
    expect(c.camps.map((x) => [x.label, Math.round(x.at * 100)])).toEqual([
      ['Maths mid-sem', 60],
      ['Maths end-sem', 60],
    ]);
  });
  it('a merged camp counts down to its next exam still to come', () => {
    const ts = [topic('a1', 'A-u1', 60), topic('a2', 'A-u2', 140), topic('b1', 'B-u1', 10)];
    const ds = [exam('midA', 'A', 'midsem', day(10), ['A-u1']), exam('midB', 'B', 'midsem', day(12), ['B-u1']), exam('endA', 'A', 'endsem', day(40))];
    const c = climbModel({ subjects, topics: ts, sessions: [], deadlines: ds, semester, today: day(11) });
    expect(climbReadout(c, day(11))).toBe('You’re 0% of the way up · The 2 mid-sems camp is 33% above you · tomorrow');
  });
  it('marks camps reached, ahead or past, and finds the next one', () => {
    const ahead = model();
    expect(ahead.camps.map((x) => x.state)).toEqual(['ahead', 'ahead']);
    expect(ahead.next.deadlineIds).toEqual(['midA']);
    expect(ahead.gap).toBeCloseTo(0.4);

    const reached = model({ sessions: [finished('a1', 60), finished('a2', 60)] });
    expect(reached.camps[0].state).toBe('reached');
    expect(reached.gap).toBe(0);

    const later = model({ today: day(11) });
    expect(later.camps[0].state).toBe('past');
    expect(later.next.deadlineIds).toEqual(['endA']);
  });
});

describe('readouts', () => {
  it('says how far up you are and where the next camp is', () => {
    expect(climbReadout(model(), D)).toBe('You’re 0% of the way up · The Maths mid-sem camp is 40% above you · 10 days to go');
    const reached = model({ sessions: [finished('a1', 60), finished('a2', 60)] });
    expect(climbReadout(reached, D)).toBe('You’re 40% of the way up · You’ve passed the Maths mid-sem camp · 10 days to go');
    expect(climbReadout(model({ today: day(9) }), day(9))).toContain('· tomorrow');
  });
  it('describes one camp', () => {
    const c = model();
    expect(campReadout(c.camps[0], c.height, D)).toBe('Maths mid-sem camp · 40% up by Thu, 29 Oct · 40% above you · 10 days to go');
    const later = model({ today: day(11) });
    expect(campReadout(later.camps[0], later.height, day(11))).toBe('Maths mid-sem camp · Thu, 29 Oct · done');
  });
});

describe('the trail', () => {
  it('runs from the base to the summit', () => {
    expect(trailPoint(0)).toEqual({ x: TRAIL[0][0], y: TRAIL[0][1] });
    expect(trailPoint(1)).toEqual({ x: TRAIL.at(-1)[0], y: TRAIL.at(-1)[1] });
    expect(trailPoint(-1)).toEqual(trailPoint(0));
    expect(trailPoint(2)).toEqual(trailPoint(1));
  });
  it('only goes up', () => {
    let y = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const p = trailPoint(t);
      expect(p.y).toBeLessThanOrEqual(y + 1e-9);
      y = p.y;
    }
  });
  it('measures t by length along the trail', () => {
    const steps = 2000;
    let total = 0;
    let half = 0;
    for (let i = 1; i <= steps; i++) {
      const a = trailPoint((i - 1) / steps);
      const b = trailPoint(i / steps);
      total += Math.hypot(b.x - a.x, b.y - a.y);
      if (i === steps / 2) half = total;
    }
    expect(half / total).toBeCloseTo(0.5, 2);
  });
  it('draws a part of the trail as a path', () => {
    expect(trailPath(0, 1).startsWith(`M${TRAIL[0][0]},${TRAIL[0][1]}`)).toBe(true);
    expect(trailPath(0, 1).split('L')).toHaveLength(TRAIL.length);
    expect(trailPath(0.5, 0.5)).toBe('');
    expect(trailPath(0.6, 0.2)).toBe('');
  });
});
