import { describe, it, expect } from 'vitest';
import {
  toMinutes,
  fromMinutes,
  formatMinutes,
  isValidDate,
  daysBetween,
  addDays,
  weekdayMon0,
  formatDate,
  relativeDays,
  todayYMD,
} from '../src/model/time.js';

describe('toMinutes', () => {
  it('parses valid times', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('23:59')).toBe(1439);
  });
  it('rejects invalid times', () => {
    for (const bad of ['24:00', '9:30', '12:60', '', 'abc', null, undefined, 930]) {
      expect(toMinutes(bad)).toBeNull();
    }
  });
});

describe('fromMinutes', () => {
  it('formats and clamps', () => {
    expect(fromMinutes(570)).toBe('09:30');
    expect(fromMinutes(-5)).toBe('00:00');
    expect(fromMinutes(5000)).toBe('23:59');
  });
});

describe('formatMinutes', () => {
  it('reads naturally', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatMinutes('nope')).toBe('0 min');
  });
});

describe('dates', () => {
  it('validates real calendar dates', () => {
    expect(isValidDate('2026-10-15')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('15-10-2026')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });
  it('counts days across month and DST boundaries', () => {
    expect(daysBetween('2026-10-15', '2026-10-15')).toBe(0);
    expect(daysBetween('2026-10-15', '2026-11-02')).toBe(18);
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetween('2026-10-20', '2026-10-15')).toBe(-5);
  });
  it('adds days', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('gives Monday-first weekdays', () => {
    expect(weekdayMon0('2026-10-12')).toBe(0); // Monday
    expect(weekdayMon0('2026-10-15')).toBe(3); // Thursday
    expect(weekdayMon0('2026-10-18')).toBe(6); // Sunday
  });
  it('formats dates and relative days', () => {
    expect(formatDate('2026-10-15')).toBe('Thu, 15 Oct');
    expect(relativeDays('2026-10-15', '2026-10-15')).toBe('Today');
    expect(relativeDays('2026-10-15', '2026-10-16')).toBe('Tomorrow');
    expect(relativeDays('2026-10-15', '2026-10-20')).toBe('In 5 days');
    expect(relativeDays('2026-10-15', '2026-10-12')).toBe('3 days ago');
  });
  it('builds today from local time', () => {
    expect(todayYMD(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
