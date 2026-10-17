import { describe, it, expect } from 'vitest';
import { streakModel, studyMinutesByDay, streakLine, streakNudge, restTokenNote, STREAK } from '../src/model/streak.js';
import { addDays } from '../src/model/time.js';

const semester = { startDate: '2026-08-01', endDate: '2026-12-15' };
const s = (date, minutes = 25, kind = 'learn') => ({ date, minutes, kind });
/** Sessions of `minutes` on each date from `from` for `n` days. */
const run = (from, n, minutes = 25) => Array.from({ length: n }, (_, i) => s(addDays(from, i), minutes));
const model = (sessions, today, fields = {}) => streakModel({ sessions, semester, today, ...fields });
const stateOn = (m, date) => m.days.find((d) => d.date === date)?.state;

describe('studyMinutesByDay', () => {
  it('adds up the minutes of each day', () => {
    const map = studyMinutesByDay([s('2026-10-01', 5), s('2026-10-01', 7), s('2026-10-02', 30), { date: '2026-10-02', minutes: 'x' }]);
    expect(map.get('2026-10-01')).toBe(12);
    expect(map.get('2026-10-02')).toBe(30);
  });
});

describe('streakModel', () => {
  it('is all zeros with no sessions', () => {
    const m = model([], '2026-10-16');
    expect(m).toMatchObject({ current: 0, best: 0, todayDone: false, tokensLeft: 2, freshStart: false });
    expect(m.days.every((d) => d.state === 'before' || d.state === 'today')).toBe(true);
  });

  it('counts a day once its study reaches the minimum, adding short sessions together', () => {
    expect(model([s('2026-10-15', 10)], '2026-10-16').current).toBe(1);
    expect(model([s('2026-10-15', 9)], '2026-10-16').current).toBe(0);
    expect(model([s('2026-10-15', 5), s('2026-10-15', 5, 'revision')], '2026-10-16').current).toBe(1);
    expect(model([s('2026-10-15', 20)], '2026-10-16', { minMin: 25 }).current).toBe(0);
  });

  it('counts a run of days, and today only adds once studied', () => {
    const sessions = run('2026-10-10', 6); // 10th–15th
    const m = model(sessions, '2026-10-16');
    expect(m.current).toBe(6);
    expect(m.todayDone).toBe(false);
    expect(stateOn(m, '2026-10-16')).toBe('today');
    const done = model([...sessions, s('2026-10-16')], '2026-10-16');
    expect(done.current).toBe(7);
    expect(done.todayDone).toBe(true);
    expect(done.best).toBe(7);
  });

  it('uses a rest token on a missed day and keeps the streak', () => {
    const sessions = [...run('2026-10-10', 3), ...run('2026-10-14', 2)]; // missed the 13th
    const m = model(sessions, '2026-10-16');
    expect(stateOn(m, '2026-10-13')).toBe('rested');
    expect(m.current).toBe(5);
    expect(m.tokensLeft).toBe(1);
  });

  it('starts fresh on the third missed day in a month, and keeps the best run', () => {
    const sessions = [...run('2026-10-01', 5), ...run('2026-10-07', 1), ...run('2026-10-09', 1)];
    // missed: 6th (token), 8th (token), 10th → fresh start
    const m = model(sessions, '2026-10-12');
    expect(stateOn(m, '2026-10-06')).toBe('rested');
    expect(stateOn(m, '2026-10-08')).toBe('rested');
    expect(stateOn(m, '2026-10-10')).toBe('missed');
    expect(stateOn(m, '2026-10-11')).toBe('missed');
    expect(m.current).toBe(0);
    expect(m.best).toBe(7);
    expect(m.tokensLeft).toBe(0);
    expect(m.freshStart).toBe(true);
  });

  it('refills tokens on the 1st of each month', () => {
    const sessions = [...run('2026-10-20', 9), ...run('2026-10-30', 1), ...run('2026-11-02', 2)];
    // used tokens on 29 Oct and 31 Oct, then 1 Nov uses November's first token
    const m = model(sessions, '2026-11-04');
    expect(stateOn(m, '2026-10-29')).toBe('rested');
    expect(stateOn(m, '2026-10-31')).toBe('rested');
    expect(stateOn(m, '2026-11-01')).toBe('rested');
    expect(m.current).toBe(12);
    expect(m.tokensLeft).toBe(1);
    expect(m.refillDate).toBe('2026-12-01');
  });

  it('gives a full month of tokens when the month has just begun', () => {
    const m = model(run('2026-10-20', 12), '2026-11-01');
    expect(m.tokensLeft).toBe(2);
    expect(m.current).toBe(12);
  });

  it('spends no token when there is no streak to keep', () => {
    const sessions = [s('2026-10-05'), s('2026-10-10')]; // 6th (token), 7th (token), 8th (fresh), 9th (none)
    const m = model(sessions, '2026-10-11');
    expect(stateOn(m, '2026-10-08')).toBe('missed');
    expect(stateOn(m, '2026-10-09')).toBe('missed');
    expect(m.current).toBe(1);
    expect(m.tokensLeft).toBe(0);
  });

  it('marks days before the first study day as before, not missed', () => {
    const m = model([s('2026-10-10')], '2026-10-12');
    expect(stateOn(m, '2026-08-01')).toBe('before');
    expect(stateOn(m, '2026-10-09')).toBe('before');
    expect(stateOn(m, '2026-10-11')).toBe('rested');
    expect(m.tokensLeft).toBe(1);
  });

  it('treats a day taken off like any missed day (it uses a token)', () => {
    const semesterOff = { ...semester, offDays: ['2026-10-13'] };
    const m = streakModel({ sessions: [...run('2026-10-10', 3), s('2026-10-14')], semester: semesterOff, today: '2026-10-15' });
    expect(stateOn(m, '2026-10-13')).toBe('rested');
    expect(m.current).toBe(4);
  });

  it('ignores study outside the semester', () => {
    const m = model([s('2026-07-30'), s('2026-07-31'), s('2026-08-01')], '2026-08-02');
    expect(m.current).toBe(1);
    expect(m.days[0].date).toBe('2026-08-01');
  });

  it('stops judging days once the semester has ended', () => {
    const m = model(run('2026-12-10', 6), '2026-12-20');
    expect(m.current).toBe(6);
    expect(m.days.at(-1).date).toBe('2026-12-15');
    expect(m.todayDone).toBe(false);
  });

  it('is empty before the semester starts or without dates', () => {
    expect(model([], '2026-07-01').days).toEqual([]);
    expect(streakModel({ sessions: [], semester: null, today: '2026-10-16' }).current).toBe(0);
  });
});

describe('wording', () => {
  const base = { current: 0, best: 0, todayDone: false, tokensLeft: 2, tokensPerMonth: 2, minMin: 10, freshStart: false };
  const guilt = /lost|broke|fail|miss|shame|should/i;

  it('streakLine', () => {
    expect(streakLine({ ...base, current: 6 })).toBe('6-day streak · 2 rest tokens left');
    expect(streakLine({ ...base, current: 1, tokensLeft: 1 })).toBe('1-day streak · 1 rest token left');
    expect(streakLine({ ...base, current: 3, tokensLeft: 0 })).toBe('3-day streak · no rest tokens left this month');
    expect(streakLine(base)).toBe('Your streak begins with 10 min of study');
    expect(streakLine({ ...base, best: 9, freshStart: true })).toBe('A fresh start · 10 min of study begins a new streak');
  });

  it('streakNudge', () => {
    expect(streakNudge({ ...base, current: 4 })).toBe('10 min today makes it 5 days');
    expect(streakNudge({ ...base, current: 5, todayDone: true })).toBe('Today counts. Well done.');
    expect(streakNudge(base)).toBe('');
  });

  it('restTokenNote', () => {
    expect(restTokenNote({ ...base, current: 5 })).toBe('Your 5-day streak stays. This uses 1 of your 2 rest tokens this month.');
    expect(restTokenNote({ ...base, current: 5, tokensLeft: 1 })).toBe('Your 5-day streak stays. This uses your last rest token this month.');
    expect(restTokenNote({ ...base, current: 5, tokensLeft: 0 })).toBe('Your streak will rest too, and a new one starts whenever you’re ready.');
    expect(restTokenNote({ ...base, current: 5, todayDone: true })).toBe('You’ve already studied today, so your streak is safe.');
    expect(restTokenNote(base)).toBe('');
  });

  it('never uses guilt words', () => {
    const variants = [base, { ...base, current: 4 }, { ...base, current: 2, tokensLeft: 0 }, { ...base, best: 8, freshStart: true }];
    for (const v of variants) for (const text of [streakLine(v), streakNudge(v), restTokenNote(v)]) expect(text).not.toMatch(guilt);
  });

  it('exposes its settings', () => {
    expect(STREAK.tokensPerMonth).toBe(2);
    expect(STREAK.defaultMinMin).toBe(10);
  });
});
