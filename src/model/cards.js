// Flashcards: when each card is due, which come up in a quiz, and what the score suggests. Pure functions.
//
// Answers aren't stored on their own: a review session carries quiz: { got: [cardId], missed: [cardId] },
// and a card's schedule is read from those, oldest first. Undoing a session undoes its quiz too.

import { addDays } from './time.js';
import { chronological } from './estimate.js';
import { CARD_LIMITS } from './validate.js';

export const CARDS = {
  gaps: [1, 3, 7, 21], // days until a card comes back after each "got it" in a row
  quizMax: 10, // a quiz stays short
  maxFront: CARD_LIMITS.frontMax,
  maxBack: CARD_LIMITS.backMax,
  draftMax: 20, // most draft cards the helper may return
  notesMax: 12000,
  easyAt: 0.85, // share remembered for the quiz to suggest "easy"
  okayAt: 0.6, // ... and "okay"; below this suggests "hard"
};

/**
 * Where each card stands. Map of cardId → { box, due, lastDate, lastResult, misses }
 * box = "got it" answers in a row (0 after a miss); due = null while the card is new (due right away).
 * Only the first answer to a card on a day counts.
 */
export function cardStates(cards, sessions) {
  const states = new Map(cards.map((c) => [c.id, { box: 0, due: null, lastDate: null, lastResult: null, misses: 0 }]));
  for (const s of chronological(sessions)) {
    if (!s.quiz) continue;
    const answers = [...(s.quiz.got ?? []).map((id) => [id, 'got']), ...(s.quiz.missed ?? []).map((id) => [id, 'missed'])];
    for (const [id, result] of answers) {
      const st = states.get(id);
      if (!st || st.lastDate === s.date) continue;
      st.lastDate = s.date;
      st.lastResult = result;
      if (result === 'got') {
        st.box += 1;
        st.due = addDays(s.date, CARDS.gaps[Math.min(st.box, CARDS.gaps.length) - 1]);
      } else {
        st.box = 0;
        st.misses += 1;
        st.due = addDays(s.date, 1);
      }
    }
  }
  return states;
}

/** A topic's cards due by `today`: missed last time first, then new, then most overdue, then oldest. */
export function dueCards(cards, states, topicId, today, max = CARDS.quizMax) {
  const rank = (st) => (st.lastResult === 'missed' ? 0 : st.due === null ? 1 : 2);
  return cards
    .filter((c) => c.topicId === topicId)
    .map((c) => ({ c, st: states.get(c.id) ?? { due: null, lastResult: null } }))
    .filter(({ st }) => st.due === null || st.due <= today)
    .sort(
      (a, b) =>
        rank(a.st) - rank(b.st) ||
        (a.st.due ?? '').localeCompare(b.st.due ?? '') ||
        (a.c.createdAt ?? 0) - (b.c.createdAt ?? 0),
    )
    .slice(0, max)
    .map(({ c }) => c);
}

/** The rating a quiz suggests, or null when nothing was answered. */
export function quizRating(quiz) {
  const got = quiz?.got?.length ?? 0;
  const total = got + (quiz?.missed?.length ?? 0);
  if (!total) return null;
  const share = got / total;
  if (share >= CARDS.easyAt) return 'easy';
  if (share >= CARDS.okayAt) return 'okay';
  return 'hard';
}

/** "7 of 9 remembered" */
export function quizLine(quiz) {
  const got = quiz?.got?.length ?? 0;
  const total = got + (quiz?.missed?.length ?? 0);
  if (!total) return 'No cards answered';
  return `${got} of ${total} remembered`;
}

const squash = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * Tidies draft cards from the helper: trims, drops blanks, shortens long text, removes duplicates
 * (among the drafts and against the topic's cards, ignoring case and spacing), and keeps at most draftMax.
 */
export function cleanDrafts(raw, existingCards = []) {
  const seen = new Set(existingCards.map((c) => squash(String(c.front ?? ''))));
  const out = [];
  for (const d of Array.isArray(raw) ? raw : []) {
    if (out.length >= CARDS.draftMax) break;
    const front = cut(String(d?.front ?? '').trim(), CARDS.maxFront);
    const back = cut(String(d?.back ?? '').trim(), CARDS.maxBack);
    if (!front || !back) continue;
    const key = squash(front);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ front, back });
  }
  return out;
}
