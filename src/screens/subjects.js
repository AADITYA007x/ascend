// Subjects list and the add/edit subject sheet.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, textInput, stepper, chips, showMessages, fab, emptyState } from '../ui/fields.js';
import { openSheet, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { state, reload } from '../state.js';
import { saveSubject, deleteSubject, restore } from '../db/repo.js';
import { makeSubject, pickColor, SUBJECT_COLORS } from '../model/factory.js';
import { validateSubject } from '../model/validate.js';
import { subjectTotals, semesterTotals } from '../model/summary.js';
import { formatMinutes } from '../model/time.js';
import { navigate, rerender } from '../router.js';
import { renderSyllabusImport } from './syllabus-import.js';

export const creditsLabel = (n) => `${n} credit${n === 1 ? '' : 's'}`;

export function renderSubjects(sub, focusId) {
  if (sub === 'import') return renderSyllabusImport(focusId);
  const totals = semesterTotals(state);
  const subtitle = state.subjects.length
    ? `${totals.subjects} subject${totals.subjects === 1 ? '' : 's'} · ${creditsLabel(totals.credits)}`
    : state.semester.name;

  const list = state.subjects.length
    ? h(
        'ul',
        { class: 'cards' },
        state.subjects.map((s) => {
          const t = subjectTotals(s.id, state.units, state.topics);
          const detail = t.topics
            ? `${t.units} unit${t.units === 1 ? '' : 's'} · ${t.topics} topic${t.topics === 1 ? '' : 's'} · ${formatMinutes(t.estMin)}`
            : t.units
              ? `${t.units} unit${t.units === 1 ? '' : 's'} · no topics yet`
              : 'No units yet. Tap to add them.';
          return h(
            'li',
            {},
            h(
              'a',
              { href: `#/subject/${encodeURIComponent(s.id)}`, class: 'card card-link subject-card', style: { '--subject': s.color } },
              h('span', { class: 'subject-dot', 'aria-hidden': 'true' }),
              h(
                'span',
                { class: 'card-main' },
                h('span', { class: 'card-heading' }, s.name, s.code ? h('span', { class: 'code' }, s.code) : null),
                h('span', { class: 'muted small' }, detail),
              ),
              h('span', { class: 'pill' }, creditsLabel(s.credits)),
              icon('chevron', 18),
            ),
          );
        }),
      )
    : emptyState(
        'No subjects yet',
        'Add the subjects you’re taking this semester, or let Ascend read them, with their units and topics, from your syllabus.',
        importLink('btn btn-primary'),
      );

  return {
    title: 'Subjects',
    top: topbar('Subjects', { subtitle }),
    body: [state.subjects.length ? importLink('btn btn-quiet import-link') : null, list, fab('Add subject', () => openSubjectSheet(null))].filter(Boolean),
  };
}

/** "Import from syllabus": subjects, units and topics in one go. */
function importLink(cls) {
  return h('a', { href: '#/subjects/import', class: cls }, icon('file', 18), 'Import from syllabus');
}

export function openSubjectSheet(existing) {
  const s =
    existing ??
    makeSubject({
      semesterId: state.semester.id,
      color: pickColor(state.subjects.map((x) => x.color)),
    });

  const colorChips = chips(
    'color',
    SUBJECT_COLORS.map((c) => ({ value: c, label: h('span', { class: 'swatch', style: { '--swatch': c } }) })),
    s.color,
    { label: 'Colour' },
  );
  colorChips.classList.add('swatches');
  // Give each swatch a readable name for screen readers.
  colorChips.querySelectorAll('input').forEach((inp, i) => inp.setAttribute('aria-label', `Colour ${i + 1}`));

  const body = h(
    'div',
    {},
    field('name', 'Subject name', textInput('name', s.name, { placeholder: 'e.g. Engineering Mathematics', maxlength: 80 })),
    field('code', 'Course code (optional)', textInput('code', s.code ?? '', { placeholder: 'e.g. MA201', maxlength: 20 })),
    field(
      'credits',
      'Credits',
      stepper('credits', s.credits, { min: 0, max: 10, step: 0.5, format: creditsLabel, label: 'credits' }),
      { hint: 'More credits means more weight when Ascend plans your days.' },
    ),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Colour'), colorChips),
  );

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
              removeSubject(existing);
            },
          },
          icon('trash', 18),
          'Delete',
        ),
      ]
    : [];

  const sheet = openSheet({
    title: existing ? 'Edit subject' : 'New subject',
    body,
    extraActions: extra,
    onSubmit: async (form) => {
      const fd = new FormData(form);
      const next = {
        ...s,
        name: String(fd.get('name') ?? '').trim(),
        code: String(fd.get('code') ?? '').trim(),
        credits: Number(fd.get('credits')),
        color: String(fd.get('color') ?? s.color),
      };
      const v = validateSubject(next);
      showMessages(form, v);
      if (!v.ok) return false;
      await saveSubject(next);
      await reload();
      if (existing) {
        toast('Subject saved');
        rerender();
        return;
      }
      toast(`${next.name} added`);
      return () => navigate(`subject/${encodeURIComponent(next.id)}`);
    },
  });
}

async function removeSubject(subject) {
  const t = subjectTotals(subject.id, state.units, state.topics);
  const deadlines = state.deadlines.filter((d) => d.subjectId === subject.id).length;
  const slots = state.slots.filter((x) => x.subjectId === subject.id).length;
  const parts = [
    t.units && `${t.units} unit${t.units === 1 ? '' : 's'}`,
    t.topics && `${t.topics} topic${t.topics === 1 ? '' : 's'}`,
    deadlines && `${deadlines} deadline${deadlines === 1 ? '' : 's'}`,
    slots && `${slots} class${slots === 1 ? '' : 'es'}`,
  ].filter(Boolean);
  const ok = await confirmSheet({
    title: `Delete ${subject.name}?`,
    message: parts.length
      ? `This also removes its ${parts.join(', ')}.`
      : 'This subject has nothing else attached to it.',
  });
  if (!ok) return;
  const snapshot = await deleteSubject(subject.id);
  await reload();
  navigate('subjects');
  toast(`${subject.name} deleted`, {
    actionLabel: 'Undo',
    duration: 7000,
    onAction: async () => {
      await restore(snapshot);
      await reload();
      rerender();
    },
  });
}
