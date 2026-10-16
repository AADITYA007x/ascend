import { describe, it, expect } from 'vitest';
import {
  startTimer,
  timerView,
  pauseTimer,
  resumeTimer,
  startBreak,
  startFocus,
  finishTimer,
  formatClock,
  TIMER,
} from '../src/model/timer.js';

const MIN = 60 * 1000;
const T0 = new Date(2026, 9, 19, 18, 0).getTime(); // local 18:00 on 19 Oct 2026
const at = (min) => T0 + min * MIN;
const start = (fields = {}) => startTimer({ topicId: 't', subjectId: 's', plannedMin: 45, ...fields }, T0);

describe('startTimer', () => {
  it('defaults to 25 / 5 and starts in focus', () => {
    const t = start();
    expect(t.focusMin).toBe(25);
    expect(t.breakMin).toBe(5);
    expect(timerView(t, T0)).toMatchObject({ phase: 'focus', status: 'running', remainingMs: 25 * MIN, focusMs: 0, rounds: 0 });
  });
  it('keeps custom lengths within sensible limits', () => {
    expect(start({ focusMin: 50, breakMin: 10 })).toMatchObject({ focusMin: 50, breakMin: 10 });
    expect(start({ focusMin: 0, breakMin: 999 })).toMatchObject({ focusMin: TIMER.minLen, breakMin: TIMER.maxBreak });
  });
});

describe('timerView', () => {
  it('counts down from wall-clock time', () => {
    expect(timerView(start(), at(10)).remainingMs).toBe(15 * MIN);
  });
  it('ends after the full round', () => {
    expect(timerView(start(), at(25))).toMatchObject({ status: 'ended', remainingMs: 0, focusMs: 25 * MIN, rounds: 1 });
  });
  it('stays right after the screen was locked for 40 minutes: focus is capped at the round', () => {
    const v = timerView(start(), at(40));
    expect(v.status).toBe('ended');
    expect(v.focusMs).toBe(25 * MIN);
  });
  it('never goes negative if the clock moves backwards', () => {
    const v = timerView(start(), at(-5));
    expect(v.elapsedMs).toBe(0);
    expect(v.remainingMs).toBe(25 * MIN);
  });
});

describe('pause and resume', () => {
  it('does not count paused time', () => {
    let t = start();
    t = pauseTimer(t, at(5));
    expect(timerView(t, at(12))).toMatchObject({ status: 'paused', remainingMs: 20 * MIN });
    t = resumeTimer(t, at(15));
    expect(timerView(t, at(20)).remainingMs).toBe(15 * MIN);
    expect(timerView(t, at(35)).status).toBe('ended');
  });
  it('ignores a second pause, a resume while running, and a pause after the end', () => {
    const t = pauseTimer(start(), at(5));
    expect(pauseTimer(t, at(6))).toBe(t);
    const running = start();
    expect(resumeTimer(running, at(3))).toBe(running);
    expect(pauseTimer(running, at(30))).toBe(running);
  });
});

describe('rounds', () => {
  it('a break then a second round adds up both rounds', () => {
    let t = start();
    t = startBreak(t, at(27)); // came back 2 min late: still 25
    expect(timerView(t, at(28))).toMatchObject({ phase: 'break', remainingMs: 4 * MIN, focusMs: 25 * MIN, rounds: 1 });
    expect(timerView(t, at(40)).status).toBe('ended');
    t = startFocus(t, at(40));
    expect(timerView(t, at(50))).toMatchObject({ phase: 'focus', focusMs: 35 * MIN, rounds: 1 });
    expect(finishTimer(t, at(65))).toMatchObject({ minutes: 50, rounds: 2 });
  });
  it('break time is never counted as study', () => {
    const t = startBreak(start(), at(25));
    expect(finishTimer(t, at(29)).minutes).toBe(25);
  });
});

describe('finishTimer', () => {
  it('ending early counts only the real focus time', () => {
    expect(finishTimer(start(), at(12.4))).toMatchObject({ minutes: 12, rounds: 1, startedAt: T0, date: '2026-10-19' });
  });
  it('counts a paused session without the pause', () => {
    const t = pauseTimer(start(), at(10));
    expect(finishTimer(t, at(60)).minutes).toBe(10);
  });
  it('dates the session by when it started, even past midnight', () => {
    const late = startTimer({ topicId: 't', subjectId: 's' }, new Date(2026, 9, 19, 23, 50).getTime());
    expect(finishTimer(late, new Date(2026, 9, 20, 0, 15).getTime()).date).toBe('2026-10-19');
  });
});

describe('formatClock', () => {
  it('shows minutes and seconds, rounding seconds up', () => {
    expect(formatClock(25 * MIN)).toBe('25:00');
    expect(formatClock(25 * MIN - 1)).toBe('25:00');
    expect(formatClock(1499000)).toBe('24:59');
    expect(formatClock(1)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-500)).toBe('00:00');
  });
});
