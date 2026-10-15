import { describe, it, expect } from 'vitest';
import { subjectTotals, semesterTotals, setupProgress, byOrder, nextOrder, moveItem } from '../src/model/summary.js';
import { pickColor, SUBJECT_COLORS } from '../src/model/factory.js';

const subjects = [
  { id: 's1', name: 'Maths', credits: 4 },
  { id: 's2', name: 'Physics', credits: 3 },
];
const units = [
  { id: 'u1', subjectId: 's1', name: 'U1' },
  { id: 'u2', subjectId: 's1', name: 'U2' },
  { id: 'u3', subjectId: 's2', name: 'U1' },
];
const topics = [
  { id: 't1', unitId: 'u1', subjectId: 's1', estMin: 30 },
  { id: 't2', unitId: 'u2', subjectId: 's1', estMin: 60 },
  { id: 't3', unitId: 'u3', subjectId: 's2', estMin: 45 },
];

describe('totals', () => {
  it('sums one subject', () => {
    expect(subjectTotals('s1', units, topics)).toEqual({ units: 2, topics: 2, estMin: 90 });
    expect(subjectTotals('nope', units, topics)).toEqual({ units: 0, topics: 0, estMin: 0 });
  });
  it('sums the semester', () => {
    expect(semesterTotals({ subjects, units, topics, deadlines: [{}], slots: [{}, {}] })).toEqual({
      subjects: 2,
      credits: 7,
      units: 3,
      topics: 3,
      estMin: 135,
      deadlines: 1,
      slots: 2,
    });
    expect(semesterTotals({}).estMin).toBe(0);
  });
});

describe('setupProgress', () => {
  it('points to the first missing step', () => {
    expect(setupProgress({}).next.key).toBe('semester');
    expect(setupProgress({ semester: {}, subjects }).next.key).toBe('topics');
    const done = setupProgress({ semester: {}, subjects, topics, deadlines: [{}], slots: [{}] });
    expect(done.next).toBeNull();
    expect(done.doneCount).toBe(5);
  });
});

describe('ordering', () => {
  const list = [
    { id: 'a', name: 'A', order: 0 },
    { id: 'b', name: 'B', order: 1 },
    { id: 'c', name: 'C', order: 2 },
  ];
  it('sorts by order and finds the next order', () => {
    expect(byOrder([list[2], list[0], list[1]]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(nextOrder(list)).toBe(3);
    expect(nextOrder([])).toBe(0);
  });
  it('moves items up and down, and ignores moves past the ends', () => {
    expect(moveItem(list, 'b', -1).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(moveItem(list, 'b', 1).map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(moveItem(list, 'a', -1).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(moveItem(list, 'b', -1).map((x) => x.order)).toEqual([0, 1, 2]);
  });
});

describe('pickColor', () => {
  it('uses unused colours first, then cycles', () => {
    expect(pickColor([])).toBe(SUBJECT_COLORS[0]);
    expect(pickColor([SUBJECT_COLORS[0]])).toBe(SUBJECT_COLORS[1]);
    expect(SUBJECT_COLORS).toContain(pickColor(SUBJECT_COLORS));
  });
});
