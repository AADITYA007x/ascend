// Quiz: a topic's due flashcards, one at a time, as part of its review (or as practice, saving nothing).
// Answers are kept in memory until the review is saved: they ride on the session (model/cards.js).
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { emptyState } from '../ui/fields.js';
import { state } from '../state.js';
import { cardStates, dueCards, quizLine } from '../model/cards.js';
import { todayYMD } from '../model/time.js';
import { navigate } from '../router.js';
import { openLogSheet } from './session-sheets.js';

// The quiz in progress: { topicId, cards, entry, practice, timed, back, afterClose, startedAt, index, revealed, got, missed, done }
let ctx = null;

/** A topic's cards due today, in quiz order. */
export function dueCardsFor(topicId, today = todayYMD()) {
  return dueCards(state.cards, cardStates(state.cards, state.sessions), topicId, today);
}

/**
 * Opens the quiz for a topic.
 * - entry: the review being logged (as for openLogSheet); its quiz answers are added at the end
 * - practice: just for practice, nothing is saved
 * - timed: the quiz is the whole review, so its own length becomes the logged minutes
 */
export function startQuiz(topicId, { cards, entry = null, practice = false, timed = false, back = '#/today', afterClose } = {}) {
  ctx = { topicId, cards, entry, practice, timed, back, afterClose, startedAt: Date.now(), index: 0, revealed: false, got: [], missed: [], done: false };
  navigate(`quiz/${encodeURIComponent(topicId)}`);
}

/**
 * After studying a review: the quiz when the topic has cards due, otherwise straight to rating it.
 * opts as for openLogSheet; opts.back is where the quiz's back arrow goes.
 */
export function afterReview(entry, { afterClose, back } = {}) {
  const cards = dueCardsFor(entry.topicId);
  if (!cards.length) return openLogSheet(entry, { afterClose });
  startQuiz(entry.topicId, { cards, entry, back, afterClose });
}

export function renderQuiz(topicId) {
  const topic = state.topics.find((t) => t.id === topicId);
  if (!ctx || ctx.topicId !== topicId || !topic) {
    return {
      title: 'Quiz',
      top: topbar('Quiz', { back: '#/today' }),
      hideNav: true,
      body: emptyState(
        'This quiz has ended',
        'Nothing was lost: you can start it again from the review in Today’s plan.',
        h('a', { href: '#/today', class: 'btn btn-primary' }, 'Go to Today'),
      ),
    };
  }

  const q = ctx;
  const subject = state.subjects.find((s) => s.id === topic.subjectId);
  const root = h('div', { class: 'quiz', style: { '--subject': subject?.color ?? 'var(--accent)' } });

  function paint(focusMain = true) {
    root.replaceChildren(...(q.done ? doneView() : cardView()));
    if (focusMain) root.querySelector('.focus-main')?.focus({ preventScroll: true });
  }

  function cardView() {
    const card = q.cards[q.index];
    const progress = h('p', { class: 'muted small quiz-progress' }, `Card ${q.index + 1} of ${q.cards.length}`);
    const face = h(
      'div',
      { class: `card flashcard${q.revealed ? ' revealed' : ''}`, 'aria-live': 'polite' },
      h('p', { class: 'flashcard-front' }, card.front),
      q.revealed ? h('div', { class: 'flashcard-back' }, h('span', { class: 'field-label' }, 'Answer'), h('p', {}, card.back)) : null,
    );
    const actions = h('div', { class: 'focus-actions quiz-actions' });
    if (!q.revealed) {
      actions.append(
        h('button', { type: 'button', class: 'btn btn-primary focus-main', onclick: reveal }, 'Show answer'),
      );
    } else {
      actions.append(
        h(
          'div',
          { class: 'quiz-answer' },
          h('button', { type: 'button', class: 'btn quiz-missed', onclick: () => answer('missed') }, 'Missed'),
          h('button', { type: 'button', class: 'btn btn-primary focus-main', onclick: () => answer('got') }, icon('check', 20), 'Got it'),
        ),
      );
    }
    actions.append(h('button', { type: 'button', class: 'btn btn-quiet', onclick: finish }, q.got.length + q.missed.length ? 'Stop here' : 'Skip the cards'));
    return [progress, face, actions];
  }

  function doneView() {
    const answered = q.got.length + q.missed.length;
    const line = answered ? quizLine(q) : 'No cards this time';
    const note = q.practice
      ? 'Just practice, so nothing changes in your plan.'
      : answered
        ? q.missed.length
          ? 'The ones you missed come back soon.'
          : 'Every one of them stuck.'
        : 'You can still save how the review went.';
    const main = q.practice
      ? h('button', { type: 'button', class: 'btn btn-primary focus-main', onclick: () => navigate(q.back.replace(/^#\//, '')) }, 'Done')
      : h('button', { type: 'button', class: 'btn btn-primary focus-main', onclick: save }, 'Save the review');
    return [
      h('div', { class: 'card flashcard quiz-done' }, icon('check', 32), h('p', { class: 'flashcard-front' }, line), h('p', { class: 'muted' }, note)),
      h('div', { class: 'focus-actions quiz-actions' }, main),
    ];
  }

  function reveal() {
    q.revealed = true;
    paint();
  }

  function answer(result) {
    (result === 'got' ? q.got : q.missed).push(q.cards[q.index].id);
    q.index += 1;
    q.revealed = false;
    if (q.index >= q.cards.length) return finish();
    paint();
  }

  function finish() {
    q.done = true;
    paint();
    if (!q.practice) save();
  }

  function save() {
    const answered = q.got.length + q.missed.length;
    const entry = { ...q.entry, quiz: answered ? { got: [...q.got], missed: [...q.missed] } : null };
    if (q.timed) entry.minutes = Math.max(1, Math.round((Date.now() - q.startedAt) / 60000));
    openLogSheet(entry, {
      afterClose: () => {
        ctx = null;
        if (q.afterClose) q.afterClose();
        else navigate('today');
      },
    });
  }

  paint(false);

  return {
    title: q.practice ? 'Practice' : 'Quiz',
    top: topbar(q.practice ? 'Practice' : 'Quiz', { back: q.back, subtitle: topic.name }),
    hideNav: true,
    body: root,
  };
}
