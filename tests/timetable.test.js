import { describe, it, expect } from 'vitest';
import {
  sortSlots,
  slotsForDay,
  slotsOverlap,
  findOverlaps,
  overlappingIds,
  classMinutesOnDay,
  freeMinutesPerDay,
} from '../src/model/timetable.js';

const slot = (id, day, start, end) => ({ id, day, start, end, subjectId: 's' });

describe('sortSlots', () => {
  it('sorts by day then start time', () => {
    const s = [slot('c', 1, '09:00', '10:00'), slot('b', 0, '11:00', '12:00'), slot('a', 0, '08:00', '09:00')];
    expect(sortSlots(s).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('filters to one day', () => {
    const s = [slot('a', 0, '08:00', '09:00'), slot('b', 2, '08:00', '09:00')];
    expect(slotsForDay(s, 2).map((x) => x.id)).toEqual(['b']);
  });
});

describe('overlaps', () => {
  it('touching slots do not overlap', () => {
    expect(slotsOverlap(slot('a', 0, '09:00', '10:00'), slot('b', 0, '10:00', '11:00'))).toBe(false);
  });
  it('same time on different days does not overlap', () => {
    expect(slotsOverlap(slot('a', 0, '09:00', '10:00'), slot('b', 1, '09:00', '10:00'))).toBe(false);
  });
  it('finds partial, nested and identical overlaps', () => {
    const s = [
      slot('a', 0, '09:00', '11:00'),
      slot('b', 0, '10:30', '11:30'), // partial with a
      slot('c', 0, '09:15', '09:45'), // nested in a
      slot('d', 0, '12:00', '13:00'), // alone
      slot('e', 3, '14:00', '15:00'),
      slot('f', 3, '14:00', '15:00'), // identical to e
    ];
    const pairs = findOverlaps(s).map((p) => p.slice().sort().join('-')).sort();
    expect(pairs).toEqual(['a-b', 'a-c', 'e-f']);
    expect([...overlappingIds(s)].sort()).toEqual(['a', 'b', 'c', 'e', 'f']);
  });
  it('finds overlaps with a long slot that started earlier', () => {
    const s = [slot('long', 0, '08:00', '17:00'), slot('x', 0, '09:00', '10:00'), slot('y', 0, '15:00', '16:00')];
    const pairs = findOverlaps(s).map((p) => p.join('-')).sort();
    expect(pairs).toEqual(['long-x', 'long-y']);
  });
  it('handles an empty timetable', () => {
    expect(findOverlaps([])).toEqual([]);
  });
});

describe('class and free minutes', () => {
  it('counts overlapping class time once', () => {
    const s = [slot('a', 0, '09:00', '11:00'), slot('b', 0, '10:00', '12:00'), slot('c', 0, '14:00', '15:00')];
    expect(classMinutesOnDay(s, 0)).toBe(240);
    expect(classMinutesOnDay(s, 1)).toBe(0);
  });
  it('gives free minutes per weekday inside the awake window', () => {
    const s = [
      slot('a', 0, '09:00', '13:00'), // 4 h on Monday
      slot('b', 1, '06:00', '08:00'), // only 07:00–08:00 counts
      slot('c', 2, '22:30', '23:30'), // only 22:30–23:00 counts
      slot('d', 3, '05:00', '06:00'), // fully outside
    ];
    const free = freeMinutesPerDay(s, '07:00', '23:00');
    expect(free).toEqual([960 - 240, 960 - 60, 960 - 30, 960, 960, 960, 960]);
  });
});
