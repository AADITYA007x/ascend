// Focus: the running timer for one topic. Times come from timestamps (model/timer.js), so the
// screen is right again the moment the app comes back after the phone locks or you switch apps.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { emptyState } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { chime, buzz, notify, keepAwake } from '../ui/alerts.js';
import { state, reload, subjectById } from '../state.js';
import { saveActiveTimer, clearActiveTimer } from '../db/repo.js';
import { timerView, pauseTimer, resumeTimer, startBreak, startFocus, finishTimer, formatClock } from '../model/timer.js';
import { formatMinutes } from '../model/time.js';
import { navigate } from '../router.js';
import { openLogSheet } from './session-sheets.js';

const RING_R = 88;
const RING_C = 2 * Math.PI * RING_R;

// The screen on show right now (rendering again replaces it).
let live = null;
document.addEventListener('visibilitychange', () => live?.tick());

/** Which phase-end has already chimed, so it happens once per phase. */
let signalled = null;
const phaseKey = (t) => `${t.phase}-${t.phaseStart}`;

export function renderFocus() {
  live?.stop();
  const t = state.timer;
  const top = topbar('Focus', { back: '#/today' });
  if (!t) {
    return {
      title: 'Focus',
      top,
      hideNav: true,
      body: emptyState(
        'No focus session running',
        'Start one from a topic in Today’s plan.',
        h('a', { href: '#/today', class: 'btn btn-primary' }, 'Go to Today'),
      ),
    };
  }

  const topic = state.topics.find((x) => x.id === t.topicId);
  if (!topic) {
    return {
      title: 'Focus',
      top,
      hideNav: true,
      body: emptyState(
        'This topic was removed',
        'The focus session can’t be saved to it.',
        h('button', { type: 'button', class: 'btn btn-primary', onclick: discard }, 'End session'),
      ),
    };
  }

  const subject = subjectById(t.subjectId);
  if (timerView(t, Date.now()).status === 'ended') signalled = phaseKey(t); // ended while away: no late chime

  const ring = h('div', { class: 'focus-ring' });
  // Static markup with our own numbers only.
  ring.innerHTML = `<svg viewBox="0 0 200 200" aria-hidden="true">
    <circle class="ring-track" cx="100" cy="100" r="${RING_R}"/>
    <circle class="ring-fill" cx="100" cy="100" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="0" transform="rotate(-90 100 100)"/>
  </svg>`;
  const fill = ring.querySelector('.ring-fill');
  const clock = h('span', { class: 'focus-clock', role: 'timer', 'aria-live': 'off' });
  const phaseLabel = h('span', { class: 'focus-phase' });
  ring.append(h('div', { class: 'focus-center' }, phaseLabel, clock));

  const status = h('p', { class: 'focus-status', 'aria-live': 'polite' });
  const sofar = h('p', { class: 'muted small focus-sofar' });
  const actions = h('div', { class: 'focus-actions' });

  const root = h(
    'div',
    { class: 'focus', style: { '--subject': subject?.color ?? 'var(--accent)' } },
    h(
      'div',
      { class: 'focus-topic' },
      h('span', { class: 'subject-dot', 'aria-hidden': 'true' }),
      h(
        'span',
        {},
        h('span', { class: 'card-heading' }, topic.name),
        h('span', { class: 'muted small' }, t.kind === 'revision' ? `Review · ${subject?.name ?? ''}` : (subject?.name ?? '')),
      ),
    ),
    ring,
    status,
    sofar,
    actions,
  );

  let actionsKey = null;
  let endTimer = null;

  function tick() {
    if (!root.isConnected && actionsKey !== null) return stop();
    const timer = state.timer;
    if (!timer) return stop();
    const v = timerView(timer, Date.now());

    clock.textContent = formatClock(v.remainingMs);
    fill.setAttribute('stroke-dashoffset', String(RING_C * (v.elapsedMs / v.lengthMs)));
    root.classList.toggle('on-break', v.phase === 'break');
    phaseLabel.textContent = v.phase === 'break' ? 'Break' : timer.kind === 'revision' && !timer.breakMin ? 'Review' : `Round ${timer.rounds + 1}`;
    status.textContent = statusText(v, timer);
    sofar.textContent = v.focusMs >= 60000 ? `${formatMinutes(Math.floor(v.focusMs / 60000))} of focus so far` : '';
    if (root.isConnected) document.title = `${formatClock(v.remainingMs)} · ${v.phase === 'focus' ? 'Focus' : 'Break'}`;

    const key = `${v.phase}-${v.status}`;
    if (key !== actionsKey) {
      actionsKey = key;
      actions.replaceChildren(...actionButtons(timer, v));
      keepAwake(timer.keepAwake && v.status === 'running');
    }

    if (v.status === 'ended' && signalled !== phaseKey(timer)) {
      signalled = phaseKey(timer);
      phaseEnded(timer, topic);
    }

    // A precise wake-up for the end of the phase, on top of the once-a-second tick.
    clearTimeout(endTimer);
    if (v.status === 'running') endTimer = setTimeout(tick, v.remainingMs + 50);
  }

  const interval = setInterval(tick, 1000);
  function stop() {
    clearInterval(interval);
    clearTimeout(endTimer);
    keepAwake(false);
    if (live?.tick === tick) live = null;
  }
  live = { tick, stop };
  tick();

  return { title: 'Focus', top, hideNav: true, body: root };
}

function statusText(v, timer) {
  if (v.phase === 'focus') {
    if (v.status === 'ended') return timer.breakMin ? 'Time for a break. Well done.' : 'Time’s up. Nicely done.';
    if (v.status === 'paused') return 'Paused. Pick up when you’re ready.';
    return 'One topic, nothing else.';
  }
  if (v.status === 'ended') return 'Break’s over. Ready when you are.';
  return 'Stand up, stretch, have some water.';
}

function phaseEnded(timer, topic) {
  chime();
  buzz();
  if (document.visibilityState !== 'visible') {
    if (timer.phase === 'focus' && !timer.breakMin) notify('Time’s up', `${topic.name}: done. Come back to rate it.`);
    else if (timer.phase === 'focus') notify('Time for a break', `${topic.name}: ${formatMinutes(timer.focusMin)} of focus done.`);
    else notify('Break’s over', `Ready for another round of ${topic.name}?`);
  }
}

function actionButtons(timer, v) {
  const primary = (label, fn, iconName) =>
    h('button', { type: 'button', class: 'btn btn-primary focus-main', onclick: fn }, iconName ? icon(iconName, 22) : null, label);
  const finish = h('button', { type: 'button', class: 'btn btn-quiet', onclick: finishSession }, 'Finish session');

  if (v.phase === 'focus') {
    if (v.status === 'running') return [primary('Pause', () => update(pauseTimer), 'pause'), finish];
    if (v.status === 'paused') return [primary('Resume', () => update(resumeTimer), 'play'), finish];
    // No break planned (a short review): finishing is the next step.
    if (!timer.breakMin) return [primary('Finish', finishSession, 'check')];
    return [primary(`Start ${formatMinutes(timer.breakMin)} break`, () => update(startBreak)), finish];
  }
  if (v.status === 'ended') return [primary('Another round', () => update(startFocus), 'play'), finish];
  return [primary('Skip the break', () => update(startFocus), 'play'), finish];
}

async function update(step) {
  if (!state.timer) return;
  const next = step(state.timer, Date.now());
  state.timer = next;
  live?.tick();
  await saveActiveTimer(next);
}

async function finishSession() {
  const t = state.timer;
  if (!t) return;
  const now = Date.now();
  const summary = finishTimer(t, now);
  // Hold the clock while you rate; closing the sheet leaves it paused.
  if (t.phase === 'focus') await update(pauseTimer);

  if (summary.minutes < 1) {
    openSheet({
      title: 'End this session?',
      body: h('p', { class: 'confirm-text' }, 'Less than a minute of focus, so there’s nothing to save yet.'),
      submitLabel: 'End session',
      onSubmit: async () => {
        await clearActiveTimer();
        await reload();
        return () => navigate('today');
      },
    });
    return;
  }

  openLogSheet(
    {
      topicId: t.topicId,
      subjectId: t.subjectId,
      minutes: summary.minutes,
      kind: t.kind ?? 'learn',
      finished: Boolean(t.finishes) && summary.minutes >= t.plannedMin,
      source: 'timer',
      startedAt: summary.startedAt,
      rounds: summary.rounds,
      date: summary.date,
    },
    { afterClose: () => navigate('today') },
  );
}

async function discard() {
  await clearActiveTimer();
  await reload();
  navigate('today');
}
