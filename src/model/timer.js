// The focus timer. Pure functions over a small state object; `now` is always passed in (ms).
//
// The state holds timestamps, never a tick count, so time left is right the moment the app comes
// back after the screen locks or you switch apps. Phases never chain on their own: when a round
// ends the timer waits for you, and a round never counts for more than its length.

import { todayYMD } from './time.js';

const MIN = 60 * 1000;

export const TIMER = {
  focusMin: 25,
  breakMin: 5,
  minLen: 1,
  maxFocus: 180,
  maxBreak: 60,
};

/** A fresh timer in its first focus round. */
export function startTimer({ topicId, subjectId, plannedMin = 0, focusMin = TIMER.focusMin, breakMin = TIMER.breakMin }, now) {
  return {
    topicId,
    subjectId,
    plannedMin,
    focusMin: clampLen(focusMin, TIMER.minLen, TIMER.maxFocus),
    breakMin: clampLen(breakMin, 0, TIMER.maxBreak), // 0 = no break (e.g. a short review)
    phase: 'focus',
    phaseStart: now,
    pausedAt: null,
    pausedMs: 0,
    focusDoneMs: 0,
    rounds: 0,
    startedAt: now,
  };
}

function clampLen(n, min, max) {
  const v = Math.round(Number(n) || 0);
  return Math.min(max, Math.max(min, v));
}

const phaseLengthMs = (t) => (t.phase === 'focus' ? t.focusMin : t.breakMin) * MIN;

/** Time spent in the current phase, not counting pauses, never below 0 or above the phase length. */
function phaseElapsed(t, now) {
  const until = t.pausedAt ?? now;
  const raw = until - t.phaseStart - t.pausedMs;
  return Math.min(phaseLengthMs(t), Math.max(0, raw));
}

/** What the screen shows. status: 'running' | 'paused' | 'ended' (the phase's time is up). */
export function timerView(t, now) {
  const length = phaseLengthMs(t);
  const elapsedMs = phaseElapsed(t, now);
  const ended = elapsedMs >= length;
  const focusNow = t.phase === 'focus' ? elapsedMs : 0;
  return {
    phase: t.phase,
    status: ended ? 'ended' : t.pausedAt !== null ? 'paused' : 'running',
    lengthMs: length,
    elapsedMs,
    remainingMs: length - elapsedMs,
    focusMs: t.focusDoneMs + focusNow,
    rounds: t.rounds + (t.phase === 'focus' && ended ? 1 : 0),
  };
}

export function pauseTimer(t, now) {
  if (t.pausedAt !== null || timerView(t, now).status === 'ended') return t;
  return { ...t, pausedAt: now };
}

export function resumeTimer(t, now) {
  if (t.pausedAt === null) return t;
  return { ...t, pausedMs: t.pausedMs + Math.max(0, now - t.pausedAt), pausedAt: null };
}

/** Banks the current phase (focus time and a finished round) before moving on. */
function settle(t, now) {
  if (t.phase !== 'focus') return t;
  const v = timerView(t, now);
  return { ...t, focusDoneMs: v.focusMs, rounds: v.rounds };
}

function nextPhase(t, phase, now) {
  return { ...settle(t, now), phase, phaseStart: now, pausedAt: null, pausedMs: 0 };
}

export const startBreak = (t, now) => nextPhase(t, 'break', now);
export const startFocus = (t, now) => nextPhase(t, 'focus', now);

/** The session to save: total focus minutes (rounded), rounds and the day the timer started. */
export function finishTimer(t, now) {
  const v = timerView(t, now);
  const partRound = t.phase === 'focus' && v.status !== 'ended' && v.elapsedMs > 0 ? 1 : 0;
  return {
    minutes: Math.round(v.focusMs / MIN),
    rounds: v.rounds + partRound,
    startedAt: t.startedAt,
    date: todayYMD(new Date(t.startedAt)),
  };
}

/** 1499000 → "24:59". Seconds round up, so it never shows 00:00 before the time is really up. */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
