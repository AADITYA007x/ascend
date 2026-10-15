// Deadlines: quizzes, assignments, lab records, mid-sems and end-sems.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, textInput, dateInput, select, stepper, chips, showMessages, fab, emptyState } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { state, reload, subjectById } from '../state.js';
import { saveDeadline, deleteDeadline, restore } from '../db/repo.js';
import { makeDeadline } from '../model/factory.js';
import { validateDeadline, DEADLINE_TYPES, DEADLINE_LABELS } from '../model/validate.js';
import { byOrder } from '../model/summary.js';
import { formatDate, formatMonth, relativeDays, todayYMD, daysBetween } from '../model/time.js';
import { rerender } from '../router.js';

export function renderDeadlines() {
  const today = todayYMD();
  const sorted = [...state.deadlines].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const upcoming = sorted.filter((d) => daysBetween(today, d.date) >= 0);
  const past = sorted.filter((d) => daysBetween(today, d.date) < 0).reverse();

  if (!state.subjects.length) {
    return {
      title: 'Deadlines',
      top: topbar('Deadlines'),
      body: emptyState(
        'Add a subject first',
        'Deadlines belong to a subject. Add your subjects, then come back here.',
        h('a', { href: '#/subjects', class: 'btn btn-primary' }, 'Go to subjects'),
      ),
    };
  }

  const groups = [];
  let month = null;
  for (const d of upcoming) {
    const m = d.date.slice(0, 7);
    if (m !== month) {
      month = m;
      groups.push({ label: formatMonth(d.date), items: [] });
    }
    groups.at(-1).items.push(d);
  }

  const body = [];
  if (!state.deadlines.length) {
    body.push(
      emptyState('No deadlines yet', 'Add your first quiz or assignment when you know it. Mid-sems and end-sems help Ascend plan ahead.'),
    );
  } else if (!upcoming.length) {
    body.push(h('p', { class: 'calm-note' }, 'Nothing coming up. Enjoy the quiet stretch.'));
  }

  for (const g of groups) {
    body.push(h('section', { class: 'group' }, h('h2', { class: 'group-title' }, g.label), list(g.items, today)));
  }
  if (past.length) {
    body.push(
      h(
        'details',
        { class: 'group past' },
        h('summary', { class: 'group-title' }, `Past (${past.length})`),
        list(past, today),
      ),
    );
  }
  body.push(fab('Add deadline', () => openDeadlineSheet(null)));

  const next = upcoming[0];
  return {
    title: 'Deadlines',
    top: topbar('Deadlines', {
      subtitle: next ? `Next: ${next.title}, ${relativeDays(today, next.date).toLowerCase()}` : null,
    }),
    body,
  };
}

function list(items, today) {
  return h(
    'ul',
    { class: 'cards' },
    items.map((d) => {
      const subject = subjectById(d.subjectId);
      const days = daysBetween(today, d.date);
      return h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            class: `card card-link deadline-card type-${d.type}`,
            style: { '--subject': subject?.color ?? 'var(--muted)' },
            onclick: () => openDeadlineSheet(d),
          },
          h(
            'span',
            { class: 'date-badge', 'aria-hidden': 'true' },
            h('span', { class: 'date-day' }, d.date.slice(8, 10).replace(/^0/, '')),
            h('span', { class: 'date-mon' }, formatDate(d.date).split(' ').at(-1)),
          ),
          h(
            'span',
            { class: 'card-main' },
            h('span', { class: 'card-heading' }, d.title),
            h(
              'span',
              { class: 'muted small' },
              h('span', { class: 'subject-dot small-dot', 'aria-hidden': 'true' }),
              `${subject?.name ?? 'Unknown subject'} · ${DEADLINE_LABELS[d.type]} · ${d.weight}%`,
            ),
            h('span', { class: 'visually-hidden' }, formatDate(d.date)),
          ),
          h('span', { class: `pill${days >= 0 && days <= 3 ? ' pill-soon' : ''}` }, relativeDays(today, d.date)),
        ),
      );
    }),
  );
}

const DEFAULT_WEIGHTS = { quiz: 5, assignment: 10, lab: 10, midsem: 20, endsem: 50 };

function openDeadlineSheet(existing) {
  const d =
    existing ??
    makeDeadline({
      semesterId: state.semester.id,
      subjectId: state.subjects[0]?.id ?? '',
      date: todayYMD(),
      weight: DEFAULT_WEIGHTS.quiz,
    });

  const weightStepper = stepper('weight', d.weight, { min: 0, max: 100, step: 5, format: (n) => `${n}%`, label: 'weight' });
  const typeChips = chips(
    'type',
    DEADLINE_TYPES.map((t) => ({ value: t, label: DEADLINE_LABELS[t] })),
    d.type,
    { label: 'Type' },
  );
  const subjectSelect = select(
    'subjectId',
    state.subjects.map((s) => ({ value: s.id, label: s.name })),
    d.subjectId,
  );
  const unitsBox = h('div', { class: 'field', 'data-field': 'unitIds' });

  function renderUnits(subjectId, checked) {
    const units = byOrder(state.units.filter((u) => u.subjectId === subjectId));
    unitsBox.replaceChildren(
      h('span', { class: 'field-label' }, 'Covers units (optional)'),
      units.length
        ? chips('unitIds', units.map((u) => ({ value: u.id, label: u.name })), checked, { multiple: true, label: 'Units covered' })
        : h('p', { class: 'field-hint' }, 'This subject has no units yet.'),
      h('p', { class: 'field-hint' }, 'Helps Ascend know which topics to prepare first.'),
    );
  }
  renderUnits(d.subjectId, d.unitIds ?? []);
  subjectSelect.addEventListener('change', () => renderUnits(subjectSelect.value, []));

  // A new deadline gets a typical weight for its type until the user changes the weight.
  let weightTouched = Boolean(existing);
  let settingDefault = false;
  weightStepper.addEventListener('change', () => {
    if (!settingDefault) weightTouched = true;
  });
  typeChips.addEventListener('change', (e) => {
    if (weightTouched) return;
    settingDefault = true;
    weightStepper.setValue(DEFAULT_WEIGHTS[e.target.value] ?? 10);
    settingDefault = false;
  });

  const body = h(
    'div',
    {},
    h('div', { class: 'field', 'data-field': 'type' }, h('span', { class: 'field-label' }, 'Type'), typeChips, h('p', { class: 'field-msg' })),
    field('title', 'Title', textInput('title', d.title, { placeholder: 'e.g. Quiz 2, Assignment 3', maxlength: 80 })),
    field('subjectId', 'Subject', subjectSelect),
    field('date', 'Date', dateInput('date', d.date)),
    field('weight', 'Weight in your final grade', weightStepper, { hint: 'Roughly how much it counts. Bigger weights get more preparation.' }),
    unitsBox,
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
              const snapshot = await deleteDeadline(d.id);
              await reload();
              rerender();
              toast(`${d.title} deleted`, {
                actionLabel: 'Undo',
                onAction: async () => {
                  await restore(snapshot);
                  await reload();
                  rerender();
                },
              });
            },
          },
          icon('trash', 18),
          'Delete',
        ),
      ]
    : [];

  let warnedOnce = false;
  const sheet = openSheet({
    title: existing ? 'Edit deadline' : 'New deadline',
    body,
    extraActions: extra,
    onSubmit: async (form) => {
      const fd = new FormData(form);
      const next = {
        ...d,
        type: String(fd.get('type') ?? ''),
        title: String(fd.get('title') ?? '').trim(),
        subjectId: String(fd.get('subjectId') ?? ''),
        date: String(fd.get('date') ?? ''),
        weight: Number(fd.get('weight')),
        unitIds: fd.getAll('unitIds').map(String),
      };
      const v = validateDeadline(next, state.semester);
      showMessages(form, v);
      if (!v.ok) return false;
      // Show a date warning once; saving again confirms it.
      if (Object.keys(v.warnings).length && !warnedOnce) {
        warnedOnce = true;
        return false;
      }
      await saveDeadline(next);
      await reload();
      rerender();
      toast(existing ? 'Deadline saved' : `${next.title} added`);
    },
  });
}
