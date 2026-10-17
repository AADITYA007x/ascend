import { describe, it, expect } from 'vitest';
import {
  makeRoomCode,
  normalizeCode,
  cleanName,
  presenceFromTimer,
  memberView,
  sortMembers,
  focusingCount,
  focusingLine,
  backoffMs,
  shouldRejoin,
  ROOM,
} from '../src/model/room.js';
import { startTimer, pauseTimer, startBreak } from '../src/model/timer.js';
import { validateRoomName } from '../src/model/validate.js';

const MIN = 60000;
const T0 = 1_800_000_000_000;

describe('room codes', () => {
  it('makes 6-character codes from the easy-to-read alphabet', () => {
    const code = makeRoomCode();
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(makeRoomCode(() => 0)).toBe('222222');
    expect(makeRoomCode(() => 0.9999)).toBe('ZZZZZZ');
  });
  it('tidies what you type and refuses what can’t be a code', () => {
    expect(normalizeCode(' k7q-f3m ')).toBe('K7QF3M');
    expect(normalizeCode('K7QF3')).toBeNull();
    expect(normalizeCode('K7QF3MX')).toBeNull();
    expect(normalizeCode('K0QF3M')).toBeNull(); // 0 and O are left out on purpose
    expect(normalizeCode('KIQF3M')).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });
});

describe('names', () => {
  it('trims, joins spaces, drops control characters and keeps it short', () => {
    expect(cleanName('  Asha   K  ')).toBe('Asha K');
    expect(cleanName('A\u0000s\u200bha\n')).toBe('Asha');
    expect(cleanName('x'.repeat(40))).toHaveLength(ROOM.nameMax);
  });
  it('needs at least 2 letters', () => {
    expect(validateRoomName('Al').ok).toBe(true);
    expect(validateRoomName('A').ok).toBe(false);
  });
});

describe('presenceFromTimer', () => {
  const timer = startTimer({ topicId: 't', subjectId: 'A', focusMin: 25, breakMin: 5 }, T0);
  it('is taking it easy without a timer', () => {
    expect(presenceFromTimer(null, T0, { todayMin: 40 })).toEqual({ status: 'idle', endsAt: null, subject: null, todayMin: 40, rounds: 0 });
  });
  it('focusing, with when the round ends in the server’s clock', () => {
    expect(presenceFromTimer(timer, T0 + 5 * MIN, { subjectName: 'Physics', todayMin: 5 })).toEqual({
      status: 'focus',
      endsAt: T0 + 25 * MIN,
      subject: 'Physics',
      todayMin: 5,
      rounds: 0,
    });
    expect(presenceFromTimer(timer, T0, { clockOffset: 3000 }).endsAt).toBe(T0 + 25 * MIN + 3000);
  });
  it('on a break, paused, and a finished round waiting for you', () => {
    const brk = startBreak(timer, T0 + 25 * MIN);
    expect(presenceFromTimer(brk, T0 + 26 * MIN)).toMatchObject({ status: 'break', endsAt: T0 + 30 * MIN, rounds: 1 });
    expect(presenceFromTimer(pauseTimer(timer, T0 + MIN), T0 + 2 * MIN)).toMatchObject({ status: 'paused', endsAt: null });
    expect(presenceFromTimer(timer, T0 + 30 * MIN)).toMatchObject({ status: 'paused', endsAt: null, rounds: 1 });
  });
});

describe('memberView', () => {
  const m = (fields) => ({ id: 'x', name: 'Asha', status: 'idle', endsAt: null, subject: null, todayMin: 0, ...fields });
  it('counts down in your clock, corrected by the server offset', () => {
    expect(memberView(m({ status: 'focus', endsAt: T0 + 18 * MIN }), T0).label).toBe('Focusing · 18 min left');
    // This device is 2 min behind the server.
    expect(memberView(m({ status: 'focus', endsAt: T0 + 18 * MIN }), T0 - 2 * MIN, 2 * MIN).label).toBe('Focusing · 18 min left');
    expect(memberView(m({ status: 'focus', endsAt: T0 + 30000 }), T0).label).toBe('Focusing · 1 min left');
    expect(memberView(m({ status: 'focus', endsAt: T0 - 1 }), T0).label).toBe('Finishing a round');
    expect(memberView(m({ status: 'break', endsAt: T0 + 3 * MIN }), T0).label).toBe('On a break · 3 min left');
  });
  it('reads calmly when paused or idle, with subject and minutes today', () => {
    expect(memberView(m({ status: 'paused' }), T0).label).toBe('Paused');
    expect(memberView(m({}), T0).label).toBe('Taking it easy');
    expect(memberView(m({ subject: 'Physics', todayMin: 95 }), T0).detail).toBe('Physics · 1 h 35 min today');
    expect(memberView(m({}), T0).detail).toBe('');
  });
});

describe('sorting and counting', () => {
  const members = [
    { id: 'c', name: 'Chen', status: 'idle' },
    { id: 'b', name: 'Bea', status: 'break' },
    { id: 'me', name: 'Zoe', status: 'idle' },
    { id: 'a2', name: 'Arun', status: 'focus' },
    { id: 'a1', name: 'Asha', status: 'focus' },
  ];
  it('puts you first, then focusing, break, paused, idle, then by name', () => {
    expect(sortMembers(members, 'me').map((x) => x.id)).toEqual(['me', 'a2', 'a1', 'b', 'c']);
  });
  it('counts friends focusing, not you', () => {
    expect(focusingCount(members, 'me')).toBe(2);
    expect(focusingCount(members, 'a1')).toBe(1);
    expect(focusingLine(1)).toBe('1 friend focusing with you');
    expect(focusingLine(3)).toBe('3 friends focusing with you');
  });
});

describe('reconnecting and rejoining', () => {
  it('waits 1, 2, 5, 10, then 30 seconds', () => {
    expect([0, 1, 2, 3, 4, 9].map(backoffMs)).toEqual([1000, 2000, 5000, 10000, 30000, 30000]);
  });
  it('rejoins a room joined in the last 12 hours', () => {
    expect(shouldRejoin({ code: 'K7QF3M', joinedAt: T0 }, T0 + 60 * MIN)).toBe(true);
    expect(shouldRejoin({ code: 'K7QF3M', joinedAt: T0 }, T0 + 13 * 60 * MIN)).toBe(false);
    expect(shouldRejoin({ code: 'bad', joinedAt: T0 }, T0)).toBe(false);
    expect(shouldRejoin(null, T0)).toBe(false);
  });
});
