// Flashcards for one topic: add, edit and delete them, practise them, or draft some from your notes.
// The draft helper is optional: it only shows when the app was built with VITE_CARDS_URL (the AI helper).
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, showMessages, fab, emptyState } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { state, reload, cardsFor } from '../state.js';
import { saveCard, saveCards, deleteCard, restore } from '../db/repo.js';
import { makeCard } from '../model/factory.js';
import { validateCard, CARD_LIMITS } from '../model/validate.js';
import { cardStates, cleanDrafts, CARDS } from '../model/cards.js';
import { relativeDays, todayYMD } from '../model/time.js';
import { rerender } from '../router.js';
import { startQuiz } from './quiz.js';
import { helperEnabled, postHelper } from '../net/helper.js';

// The helper button follows the connection.
const onConnection = () => location.hash.startsWith('#/cards/') && rerender();
window.addEventListener('online', onConnection);
window.addEventListener('offline', onConnection);

export function renderCards(topicId) {
  const topic = state.topics.find((t) => t.id === topicId);
  if (!topic) {
    return {
      title: 'Not found',
      top: topbar('Flashcards', { back: '#/subjects' }),
      body: emptyState('This topic is gone', 'It may have been deleted.', h('a', { href: '#/subjects', class: 'btn btn-quiet' }, 'Back to subjects')),
    };
  }

  const cards = cardsFor(topic.id);
  const states = cardStates(cards, state.sessions);
  const today = todayYMD();
  const back = `#/subject/${encodeURIComponent(topic.subjectId)}`;

  const helper = helperEnabled()
    ? h(
        'button',
        { type: 'button', class: 'btn btn-quiet', disabled: !navigator.onLine, onclick: () => openNotesSheet(topic) },
        icon('leaf', 18),
        navigator.onLine ? 'Make cards from my notes' : 'Make cards from my notes (needs internet)',
      )
    : null;

  const practice = cards.length
    ? h(
        'button',
        { type: 'button', class: 'btn btn-quiet', onclick: () => startQuiz(topic.id, { cards, practice: true, back: `#/cards/${encodeURIComponent(topic.id)}` }) },
        icon('play', 18),
        'Try them now',
      )
    : null;

  const body = cards.length
    ? [
        h('p', { class: 'muted small cards-intro' }, 'Cards that are due come up as a short quiz when this topic is reviewed.'),
        h('div', { class: 'cards-tools' }, practice, helper),
        h(
          'ul',
          { class: 'cards' },
          cards.map((c) =>
            h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: 'card card-link flashcard-row', onclick: () => openCardSheet(topic, c) },
                h('span', { class: 'card-main' }, h('span', { class: 'card-heading' }, c.front), cardState(states.get(c.id), today)),
                icon('chevron', 18),
              ),
            ),
          ),
        ),
      ]
    : emptyState(
        'No flashcards yet',
        'Write a question on the front and the answer on the back. When this topic is reviewed, the cards that are due come up as a short quiz.',
        helper,
      );

  return {
    title: `Flashcards · ${topic.name}`,
    top: topbar('Flashcards', { back, subtitle: topic.name }),
    body: [].concat(body, fab('Add card', () => openCardSheet(topic, null))),
  };
}

/** One calm line about where a card stands. */
function cardState(st, today) {
  if (!st || st.due === null) return h('span', { class: 'muted small' }, 'New');
  if (st.lastResult === 'missed') return h('span', { class: 'muted small' }, 'Missed last time, so it comes back soon');
  if (st.due <= today) return h('span', { class: 'muted small' }, 'Due with the next review');
  return h('span', { class: 'muted small' }, `Back ${relativeDays(today, st.due).toLowerCase()}`);
}

function textArea(name, value, { maxlength, rows = 3, placeholder } = {}) {
  return h('textarea', { name, class: 'input textarea', rows, maxlength, placeholder, value });
}

/** Add a card (the sheet stays open for the next one) or edit one. */
function openCardSheet(topic, existing) {
  const c = existing ?? makeCard({ topicId: topic.id, subjectId: topic.subjectId });
  const front = textArea('front', c.front, { maxlength: CARD_LIMITS.frontMax, placeholder: 'e.g. What does the rank of a matrix tell you?' });
  const back = textArea('back', c.back, { maxlength: CARD_LIMITS.backMax, rows: 4, placeholder: 'e.g. How many rows (or columns) are linearly independent.' });
  let added = 0;

  const extra = existing
    ? [
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-quiet danger-text',
            onclick: async () => {
              sheet.close();
              await sheet.closed;
              const snapshot = await deleteCard(c.id);
              await reload();
              rerender();
              toast('Card deleted', { actionLabel: 'Undo', onAction: () => undo(snapshot) });
            },
          },
          icon('trash', 18),
          'Delete',
        ),
      ]
    : [];

  const sheet = openSheet({
    title: existing ? 'Edit card' : 'New card',
    body: h(
      'div',
      {},
      field('front', 'Front', front),
      field('back', 'Back', back, { hint: existing ? null : 'After you add it, the sheet stays open for the next card.' }),
    ),
    extraActions: extra,
    submitLabel: existing ? 'Save' : 'Add card',
    onSubmit: async (form) => {
      const fd = new FormData(form);
      const next = { ...c, front: String(fd.get('front') ?? '').trim(), back: String(fd.get('back') ?? '').trim() };
      const v = validateCard(next);
      showMessages(form, v);
      if (!v.ok) return false;
      if (existing) {
        await saveCard(next);
        await reload();
        rerender();
        return undefined;
      }
      // A fresh card each time, so the next one gets its own id.
      await saveCard(makeCard({ topicId: topic.id, subjectId: topic.subjectId, front: next.front, back: next.back }));
      await reload();
      rerender();
      added += 1;
      front.value = '';
      back.value = '';
      front.focus();
      toast(added === 1 ? 'Card added. Add another, or close when you’re done.' : `${added} cards added`);
      return false;
    },
  });
}

/** Step 1 of the helper: paste notes. */
function openNotesSheet(topic, notes = '') {
  const area = textArea('notes', notes, { maxlength: CARDS.notesMax, rows: 10, placeholder: 'Paste your notes for this topic here.' });
  const counter = h('p', { class: 'field-hint notes-count' });
  const count = () => (counter.textContent = `${area.value.length.toLocaleString()} / ${CARDS.notesMax.toLocaleString()} characters`);
  area.addEventListener('input', count);
  count();

  openSheet({
    title: 'Cards from my notes',
    body: h(
      'div',
      {},
      h('p', { class: 'muted small form-hint-top' }, 'Your notes are sent to the card helper to make draft cards. You check and edit every card before it is saved.'),
      field('notes', 'Notes', area),
      counter,
    ),
    submitLabel: 'Make draft cards',
    onSubmit: async (form) => {
      const text = String(new FormData(form).get('notes') ?? '').trim();
      if (!text) {
        showMessages(form, { errors: { notes: 'Paste some notes first.' } });
        return false;
      }
      showMessages(form, {});
      if (!navigator.onLine) {
        toast('You’re offline. Your notes are still here; try again once you’re connected.');
        return false;
      }
      const submit = form.querySelector('button[type=submit]');
      submit.textContent = 'Making cards…';
      try {
        const drafts = cleanDrafts(await requestDrafts(topic.name, text), cardsFor(topic.id));
        if (!drafts.length) {
          toast('No new cards came out of those notes. Try adding a bit more detail.');
          return false;
        }
        return () => openDraftsSheet(topic, drafts, text);
      } catch (err) {
        toast(err.message);
        return false;
      } finally {
        submit.textContent = 'Make draft cards';
      }
    },
  });
}

async function requestDrafts(topic, notes) {
  return (await postHelper('/cards', { topic, notes })).cards ?? [];
}

/** Step 2 of the helper: check and edit the drafts, then save the ones you keep. */
function openDraftsSheet(topic, drafts, notes) {
  const list = h('div', { class: 'drafts' });
  drafts.forEach((d, i) => {
    const row = h(
      'div',
      { class: 'draft-row field', 'data-field': `draft-${i}` },
      h(
        'div',
        { class: 'draft-head' },
        h('span', { class: 'field-label' }, `Card ${i + 1}`),
        h(
          'button',
          { type: 'button', class: 'icon-btn', 'aria-label': `Remove card ${i + 1}`, onclick: () => row.remove() },
          icon('trash', 18),
        ),
      ),
      h('label', { class: 'visually-hidden', for: `draft-front-${i}` }, `Card ${i + 1} front`),
      h('textarea', { id: `draft-front-${i}`, class: 'input textarea draft-front', rows: 2, maxlength: CARD_LIMITS.frontMax, value: d.front }),
      h('label', { class: 'visually-hidden', for: `draft-back-${i}` }, `Card ${i + 1} back`),
      h('textarea', { id: `draft-back-${i}`, class: 'input textarea draft-back', rows: 3, maxlength: CARD_LIMITS.backMax, value: d.back }),
      h('p', { class: 'field-msg' }),
    );
    list.append(row);
  });

  const backToNotes = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-quiet',
      onclick: async () => {
        sheet.close();
        await sheet.closed;
        openNotesSheet(topic, notes);
      },
    },
    'Back to notes',
  );

  const sheet = openSheet({
    title: 'Check your draft cards',
    body: h('div', {}, h('p', { class: 'muted small form-hint-top' }, 'Edit anything that isn’t quite right, and remove the cards you don’t want.'), list),
    extraActions: [backToNotes],
    submitLabel: 'Save cards',
    onSubmit: async (form) => {
      const rows = [...form.querySelectorAll('.draft-row')];
      if (!rows.length) {
        toast('No cards left to save.');
        return false;
      }
      const errors = {};
      const cards = rows.map((row) => {
        const card = makeCard({
          topicId: topic.id,
          subjectId: topic.subjectId,
          front: row.querySelector('.draft-front').value.trim(),
          back: row.querySelector('.draft-back').value.trim(),
          source: 'ai',
        });
        const v = validateCard(card);
        if (!v.ok) errors[row.dataset.field] = v.errors.front ?? v.errors.back;
        return card;
      });
      showMessages(form, { errors });
      if (Object.keys(errors).length) return false;
      // Keep their order: one millisecond apart.
      const base = Date.now();
      cards.forEach((c, i) => (c.createdAt = base + i));
      await saveCards(cards);
      await reload();
      rerender();
      toast(`${cards.length} card${cards.length === 1 ? '' : 's'} saved`, {
        actionLabel: 'Undo',
        onAction: () => removeCards(cards.map((c) => c.id)),
      });
    },
  });
}

async function undo(snapshot) {
  await restore(snapshot);
  await reload();
  rerender();
}

/** Takes back cards that were just saved. */
async function removeCards(ids) {
  for (const id of ids) await deleteCard(id);
  await reload();
  rerender();
}
