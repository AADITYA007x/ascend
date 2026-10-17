// Sheets for studying a topic: start a focus timer, and log / rate a session.
// Today and the focus screen both use these.
import { h, icon } from '../ui/dom.js';
import { field, stepper, chips } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { canAskNotify, askNotify, unlockAudio, wakeLockSupported } from '../ui/alerts.js';
import { state, reload, subjectById } from '../state.js';
import { saveSession, saveTimerSession, deleteSession, saveActiveTimer, saveSemester, setMeta } from '../db/repo.js';
import { makeSession, withSemesterDefaults, RATING_LABELS } from '../model/factory.js';
import { startTimer, TIMER } from '../model/timer.js';
import { REVIEWS } from '../model/revision.js';
import { formatMinutes, todayYMD } from '../model/time.js';
import { navigate, rerender } from '../router.js';
import { isSummitSession } from '../model/summit.js';
import { celebrateSummit } from '../ui/celebrate.js';
import { quizRating, quizLine } from '../model/cards.js';
import { afterReview, dueCardsFor, startQuiz } from './quiz.js';

const LENGTHS = [
  { value: '25-5', label: '25 / 5', focus: 25, brk: 5 },
  { value: '50-10', label: '50 / 10', focus: 50, brk: 10 },
  { value: 'custom', label: 'Custom' },
];

const topicById = (id) => state.topics.find((t) => t.id === id) ?? null;

/** A small on/off row (a real checkbox, so it works with the keyboard and screen readers). */
function toggle(name, label, checked, hint) {
  return h(
    'label',
    { class: 'toggle-row' },
    h('input', { type: 'checkbox', name, checked, class: 'toggle-input' }),
    h('span', { class: 'toggle-text' }, h('span', {}, label), hint ? h('span', { class: 'muted small' }, hint) : null),
  );
}

/**
 * Tap on a plan block: start a focus timer (the main action), or log time studied without one.
 * item: a plan item { kind, topicId, subjectId, minutes, part, parts, review }
 */
export function openStartSheet(item) {
  const topic = topicById(item.topicId);
  const subject = subjectById(item.subjectId);
  const isReview = item.kind === 'review';
  const kind = isReview ? 'revision' : 'learn';
  let sheet; // either sheet below; the buttons close whichever is open
  const logInstead = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-quiet',
      onclick: async () => {
        sheet.close();
        await sheet.closed;
        const entry = { ...item, kind, minutes: item.minutes, finished: !isReview && item.part === item.parts };
        // A review goes through the topic's due flashcards first, if it has any.
        if (isReview) afterReview(entry);
        else openLogSheet(entry);
      },
    },
    'I studied this already',
  );
  // A review with cards due can be just the quiz: its own length is the time logged.
  const due = isReview ? dueCardsFor(item.topicId) : [];
  const quizOnly = due.length
    ? h(
        'button',
        {
          type: 'button',
          class: 'quiz-option',
          onclick: async () => {
            sheet.close();
            await sheet.closed;
            startQuiz(item.topicId, {
              cards: due,
              timed: true,
              entry: { topicId: item.topicId, subjectId: item.subjectId, kind: 'revision', minutes: 1, finished: false },
            });
          },
        },
        icon('book', 20),
        h('span', {}, h('span', { class: 'card-heading' }, 'Just the quiz'), h('span', { class: 'muted small' }, `${due.length} flashcard${due.length === 1 ? '' : 's'} due`)),
      )
    : null;

  // Only one timer at a time.
  if (state.timer) {
    const running = topicById(state.timer.topicId);
    sheet = openSheet({
      title: topic?.name ?? 'Study',
      body: h('div', {}, h('p', { class: 'confirm-text' }, `You have a focus session running on ${running?.name ?? 'another topic'}.`), quizOnly),
      submitLabel: 'Back to focus',
      extraActions: [logInstead],
      onSubmit: () => () => navigate('focus'),
    });
    return sheet;
  }

  const semester = withSemesterDefaults(state.semester);
  // A review is short: by default one round of its own length, with no break.
  const lengths = isReview
    ? [{ value: 'review', label: `Just this (${formatMinutes(item.minutes)})`, focus: item.minutes, brk: 0 }, ...LENGTHS]
    : LENGTHS;
  const preset = isReview
    ? 'review'
    : (LENGTHS.find((l) => l.focus === semester.focusMin && l.brk === semester.breakMin)?.value ?? 'custom');
  const startFocusMin = isReview ? item.minutes : semester.focusMin;
  const startBreakMin = isReview ? 0 : semester.breakMin;
  const focusStep = stepper('focusMin', startFocusMin, { min: 5, max: TIMER.maxFocus, step: 5, format: formatMinutes, label: 'focus time' });
  const breakStep = stepper('breakMin', startBreakMin, { min: 0, max: 30, step: 1, format: formatMinutes, label: 'break time' });
  const custom = h('div', { class: 'custom-lengths', hidden: preset !== 'custom' }, field('focusMin', 'Focus', focusStep), field('breakMin', 'Break', breakStep));
  const lengthChips = chips(
    'length',
    lengths.map(({ value, label }) => ({ value, label })),
    preset,
    { label: 'Focus and break length' },
  );
  lengthChips.addEventListener('change', (e) => {
    const l = lengths.find((x) => x.value === e.target.value);
    if (!l) return;
    custom.hidden = l.value !== 'custom';
    if (l.focus !== undefined) {
      focusStep.setValue(l.focus);
      breakStep.setValue(l.brk);
    }
  });

  const body = h(
    'div',
    {},
    h(
      'p',
      { class: 'muted start-meta' },
      isReview
        ? `${subject?.name ?? ''} · ${item.review ? `review ${item.review} of ${REVIEWS}` : 'a look back before the exam'}`
        : `${subject?.name ?? ''} · ${formatMinutes(item.minutes)} planned${item.parts > 1 ? ` (part ${item.part} of ${item.parts})` : ''}`,
    ),
    quizOnly,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Focus / break (minutes)'), lengthChips),
    custom,
    wakeLockSupported() ? toggle('keepAwake', 'Keep screen on', semester.keepAwake, 'While the timer runs.') : null,
    canAskNotify() ? toggle('notify', 'Tell me when time is up', true, 'A notification, even if you switch apps.') : null,
  );

  sheet = openSheet({
    title: isReview ? `Review: ${topic?.name ?? 'topic'}` : (topic?.name ?? 'Focus'),
    body,
    submitLabel: 'Start focus',
    extraActions: [logInstead],
    onSubmit: async (form) => {
      unlockAudio(); // a tap is needed before the chime may play later
      const fd = new FormData(form);
      if (fd.get('notify')) await askNotify();
      const focusMin = Number(fd.get('focusMin'));
      const breakMin = Number(fd.get('breakMin'));
      const keepAwake = wakeLockSupported() ? Boolean(fd.get('keepAwake')) : semester.keepAwake;
      const timer = {
        ...startTimer({ topicId: item.topicId, subjectId: item.subjectId, plannedMin: item.minutes, focusMin, breakMin }, Date.now()),
        keepAwake,
        kind,
        finishes: !isReview && item.part === item.parts, // this block was planned to finish the topic
      };
      await saveActiveTimer(timer);
      // Remember your usual lengths (a review's own length isn't one of them).
      const remember = fd.get('length') === 'review' ? { focusMin: semester.focusMin, breakMin: semester.breakMin } : { focusMin, breakMin };
      if (remember.focusMin !== semester.focusMin || remember.breakMin !== semester.breakMin || keepAwake !== semester.keepAwake) {
        await saveSemester({ ...state.semester, ...remember, keepAwake });
      }
      await reload();
      return () => navigate('focus');
    },
  });
  return sheet;
}

/**
 * Log a session and rate it. Used after a focus timer (with the real minutes filled in)
 * and for time studied without the timer.
 * entry: { topicId, subjectId, minutes, finished, kind?, source?, startedAt?, rounds?, date?, quiz? }
 * A review ('revision') only asks how it felt and how long it took. After a flashcard quiz,
 * the score picks the starting rating (you can change it) and the answers are saved with the session.
 * Returns the sheet; opts.afterClose runs once a saved sheet has closed (a safe place to navigate).
 */
export function openLogSheet(entry, { afterClose } = {}) {
  const topic = topicById(entry.topicId);
  const fromTimer = entry.source === 'timer';
  const isReview = entry.kind === 'revision';
  const minutes = stepper('minutes', Math.max(1, entry.minutes), {
    min: 1,
    max: 600,
    step: 5,
    format: formatMinutes,
    label: 'study time',
  });
  const suggested = quizRating(entry.quiz);
  const rating = chips(
    'rating',
    Object.entries(RATING_LABELS).map(([value, label]) => ({ value, label })),
    suggested ?? 'okay',
    { label: 'How did it feel?' },
  );
  const status = isReview
    ? null
    : chips(
        'status',
        [
          { value: 'finished', label: 'Finished the topic' },
          { value: 'partial', label: 'More to go' },
        ],
        entry.finished ? 'finished' : 'partial',
        { label: 'How far did you get?' },
      );

  return openSheet({
    title: isReview ? `Review: ${topic?.name ?? 'topic'}` : (topic?.name ?? 'How did it go?'),
    body: h(
      'div',
      {},
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'How did it feel?'),
        rating,
        suggested ? h('p', { class: 'field-hint' }, `From your quiz: ${quizLine(entry.quiz)}. Change it if it felt different.`) : null,
      ),
      status ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How far did you get?'), status) : null,
      field('minutes', fromTimer ? 'Focus time' : 'Time studied', minutes, {
        hint: fromTimer ? 'From the timer. Change it if you kept going after the bell.' : null,
      }),
    ),
    submitLabel: 'Save',
    onSubmit: async (form) => {
      const fd = new FormData(form);
      const session = makeSession({
        semesterId: state.semester.id,
        subjectId: entry.subjectId,
        topicId: entry.topicId,
        date: entry.date ?? todayYMD(),
        minutes: Number(fd.get('minutes')),
        kind: isReview ? 'revision' : 'learn',
        finished: !isReview && fd.get('status') === 'finished',
        rating: String(fd.get('rating') ?? '') || null,
        source: fromTimer ? 'timer' : 'manual',
        startedAt: entry.startedAt ?? null,
        rounds: entry.rounds ?? 0,
        quiz: entry.quiz ?? null,
      });
      if (fromTimer) await saveTimerSession(session);
      else await saveSession(session);
      await reload();
      // Today's summit, climbed for the first time today: celebrate once.
      const summit = state.summit;
      const climbed = isSummitSession(summit, session, todayYMD());
      if (climbed) {
        await setMeta('summit', { ...summit, celebrated: true });
        state.summit = { ...summit, celebrated: true };
        celebrateSummit(topic?.name ?? 'Today’s summit');
      }
      const message = climbed
        ? 'Summit saved.'
        : isReview
          ? 'Reviewed. The next look is planned.'
          : session.finished
            ? 'Nice work. Your plan is updated.'
            : 'Saved. The rest is planned ahead.';
      toast(message, {
        actionLabel: 'Undo',
        onAction: async () => {
          await deleteSession(session.id);
          await reload();
          rerender();
        },
      });
      // When the sheet leads somewhere else, that screen renders once it's closed.
      if (!afterClose) rerender();
      return afterClose;
    },
  });
}
