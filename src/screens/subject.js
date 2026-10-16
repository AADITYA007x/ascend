// One subject: its units and topics.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, textInput, select, stepper, chips, showMessages, fab, emptyState } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { state, reload, subjectById } from '../state.js';
import { saveUnit, saveUnits, saveTopic, saveTopics, deleteUnit, deleteTopic, restore } from '../db/repo.js';
import { makeUnit, makeTopic, DIFFICULTY_LABELS } from '../model/factory.js';
import { validateUnit, validateTopic } from '../model/validate.js';
import { subjectTotals, byOrder, nextOrder, moveItem } from '../model/summary.js';
import { formatMinutes } from '../model/time.js';
import { planningTopics } from '../model/estimate.js';
import { rerender } from '../router.js';
import { openSubjectSheet, creditsLabel } from './subjects.js';

// Units the user collapsed, remembered while the app is open.
const collapsed = new Set();

export function renderSubject(subjectId) {
  const subject = subjectById(subjectId);
  if (!subject) {
    return {
      title: 'Not found',
      top: topbar('Subject', { back: '#/subjects' }),
      body: emptyState('This subject is gone', 'It may have been deleted.', h('a', { href: '#/subjects', class: 'btn btn-quiet' }, 'Back to subjects')),
    };
  }

  const units = byOrder(state.units.filter((u) => u.subjectId === subject.id));
  const totals = subjectTotals(subject.id, state.units, state.topics);

  const editBtn = h(
    'button',
    { type: 'button', class: 'icon-btn', 'aria-label': 'Edit subject', onclick: () => openSubjectSheet(subject) },
    icon('edit'),
  );

  const summary = h(
    'p',
    { class: 'subject-summary muted', style: { '--subject': subject.color } },
    h('span', { class: 'subject-dot', 'aria-hidden': 'true' }),
    [subject.code, creditsLabel(subject.credits), totals.topics ? `${formatMinutes(totals.estMin)} of study` : null]
      .filter(Boolean)
      .join(' · '),
  );

  const body = units.length
    ? h('div', { class: 'units' }, units.map((u) => unitBlock(subject, u)))
    : emptyState(
        'No units yet',
        'Add the units from your syllabus (Unit 1, Unit 2…). Then list the topics inside each one with a rough time estimate.',
      );

  return {
    title: subject.name,
    top: topbar(subject.name, { back: '#/subjects', action: editBtn }),
    body: [summary, body, fab('Add unit', () => openUnitSheet(subject, null))],
  };
}

/** Map of topicId → the estimate Ascend now plans with, for topics where your pace changed it. */
function learnedEstimates() {
  const map = new Map();
  for (const t of planningTopics(state.topics, state.sessions)) if (t.estMin !== t.baseEstMin) map.set(t.id, t.estMin);
  return map;
}

function topicTime(t, learned) {
  const est = learned.get(t.id);
  if (est === undefined) return h('span', { class: 'topic-time muted small' }, formatMinutes(t.estMin));
  return h(
    'span',
    {
      class: 'topic-time muted small',
      title: `You set ${formatMinutes(t.estMin)}. Ascend plans about ${formatMinutes(est)} from your pace.`,
      'aria-label': `About ${formatMinutes(est)}, learned from your pace (you set ${formatMinutes(t.estMin)})`,
    },
    `~${formatMinutes(est)}`,
  );
}

function unitBlock(subject, unit) {
  const learned = learnedEstimates();
  const topics = byOrder(state.topics.filter((t) => t.unitId === unit.id));
  const est = topics.reduce((sum, t) => sum + t.estMin, 0);
  const details = h(
    'details',
    {
      class: 'card unit',
      open: !collapsed.has(unit.id),
      ontoggle: (e) => (e.currentTarget.open ? collapsed.delete(unit.id) : collapsed.add(unit.id)),
    },
    h(
      'summary',
      {},
      h(
        'span',
        { class: 'card-main' },
        h('span', { class: 'card-heading' }, unit.name),
        h(
          'span',
          { class: 'muted small' },
          topics.length ? `${topics.length} topic${topics.length === 1 ? '' : 's'} · ${formatMinutes(est)}` : 'No topics yet',
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `Edit ${unit.name}`,
          onclick: (e) => {
            e.preventDefault();
            openUnitSheet(subject, unit);
          },
        },
        icon('edit', 20),
      ),
    ),
    topics.length
      ? h(
          'ul',
          { class: 'topics' },
          topics.map((t) =>
            h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: 'topic-row', onclick: () => openTopicSheet(subject, unit, t) },
                h('span', { class: 'topic-name' }, t.name),
                h('span', { class: `pill diff-${t.difficulty}` }, DIFFICULTY_LABELS[t.difficulty]),
                topicTime(t, learned),
              ),
            ),
          ),
        )
      : null,
    h(
      'button',
      { type: 'button', class: 'btn btn-quiet add-topic', onclick: () => openTopicSheet(subject, unit, null) },
      icon('plus', 18),
      'Add topic',
    ),
  );
  return details;
}

function moveButtons(onMove, canUp, canDown) {
  return h(
    'div',
    { class: 'move-row' },
    h('span', { class: 'field-label' }, 'Order'),
    h('button', { type: 'button', class: 'btn btn-quiet', disabled: !canUp, onclick: () => onMove(-1) }, icon('up', 18), 'Move up'),
    h('button', { type: 'button', class: 'btn btn-quiet', disabled: !canDown, onclick: () => onMove(1) }, icon('down', 18), 'Move down'),
  );
}

function openUnitSheet(subject, existing) {
  const sorted = byOrder(state.units.filter((x) => x.subjectId === subject.id));
  const u = existing ?? makeUnit({ subjectId: subject.id, order: nextOrder(sorted) });
  const idx = sorted.findIndex((x) => x.id === u.id);

  const body = h(
    'div',
    {},
    field('name', 'Unit name', textInput('name', u.name, { placeholder: `e.g. Unit ${u.order + 1}: Linear algebra`, maxlength: 80 })),
    existing && sorted.length > 1
      ? moveButtons(
          async (dir) => {
            await saveUnits(moveItem(sorted, u.id, dir));
            await reload();
            sheet.close();
            rerender();
          },
          idx > 0,
          idx < sorted.length - 1,
        )
      : null,
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
              const snapshot = await deleteUnit(u.id, subject.id);
              await reload();
              rerender();
              const n = snapshot.topics?.length ?? 0;
              toast(n ? `${u.name} and ${n} topic${n === 1 ? '' : 's'} deleted` : `${u.name} deleted`, {
                actionLabel: 'Undo',
                duration: 7000,
                onAction: () => undo(snapshot),
              });
            },
          },
          icon('trash', 18),
          'Delete',
        ),
      ]
    : [];

  const sheet = openSheet({
    title: existing ? 'Edit unit' : 'New unit',
    body,
    extraActions: extra,
    onSubmit: async (form) => {
      const next = { ...u, name: String(new FormData(form).get('name') ?? '').trim() };
      const v = validateUnit(next);
      showMessages(form, v);
      if (!v.ok) return false;
      await saveUnit(next);
      await reload();
      rerender();
      if (!existing) toast(`${next.name} added. Now add its topics.`);
    },
  });
}

const TIME_PRESETS = [15, 30, 45, 60, 90, 120];

function openTopicSheet(subject, unit, existing) {
  const unitTopics = byOrder(state.topics.filter((t) => t.unitId === unit.id));
  const t = existing ?? makeTopic({ unitId: unit.id, subjectId: subject.id, order: nextOrder(unitTopics) });
  const idx = unitTopics.findIndex((x) => x.id === t.id);
  const units = byOrder(state.units.filter((u) => u.subjectId === subject.id));

  const learnedEst = existing ? learnedEstimates().get(t.id) : undefined;
  const timeStepper = stepper('estMin', t.estMin, { min: 5, max: 600, step: 5, format: formatMinutes, label: 'time' });
  const presets = h(
    'div',
    { class: 'presets' },
    TIME_PRESETS.map((m) =>
      h('button', { type: 'button', class: 'chip chip-small', onclick: () => timeStepper.setValue(m) }, formatMinutes(m)),
    ),
  );

  const body = h(
    'div',
    {},
    field('name', 'Topic', textInput('name', t.name, { placeholder: 'e.g. Eigenvalues and eigenvectors', maxlength: 80 })),
    field('estMin', 'Estimated study time', timeStepper, {
      hint: learnedEst
        ? `From your pace in this subject, Ascend plans about ${formatMinutes(learnedEst)}.`
        : 'A rough guess is fine. Ascend will learn as you go.',
    }),
    presets,
    h(
      'div',
      { class: 'field', 'data-field': 'difficulty' },
      h('span', { class: 'field-label' }, 'How hard does it feel?'),
      chips(
        'difficulty',
        [1, 2, 3].map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] })),
        t.difficulty,
        { label: 'Difficulty' },
      ),
      h('p', { class: 'field-msg' }),
    ),
    units.length > 1
      ? field('unitId', 'Unit', select('unitId', units.map((u) => ({ value: u.id, label: u.name })), t.unitId))
      : null,
    existing && unitTopics.length > 1
      ? moveButtons(
          async (dir) => {
            await saveTopics(moveItem(unitTopics, t.id, dir));
            await reload();
            sheet.close();
            rerender();
          },
          idx > 0,
          idx < unitTopics.length - 1,
        )
      : null,
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
              const snapshot = await deleteTopic(t.id);
              await reload();
              rerender();
              toast(`${t.name} deleted`, { actionLabel: 'Undo', onAction: () => undo(snapshot) });
            },
          },
          icon('trash', 18),
          'Delete',
        ),
      ]
    : [];

  const sheet = openSheet({
    title: existing ? 'Edit topic' : `New topic in ${unit.name}`,
    body,
    extraActions: extra,
    submitLabel: existing ? 'Save' : 'Add topic',
    onSubmit: async (form) => {
      const fd = new FormData(form);
      const unitId = String(fd.get('unitId') ?? t.unitId);
      const next = {
        ...t,
        name: String(fd.get('name') ?? '').trim(),
        estMin: Number(fd.get('estMin')),
        difficulty: Number(fd.get('difficulty')),
        unitId,
      };
      // Moving to another unit puts the topic at the end of that unit.
      if (unitId !== t.unitId) next.order = nextOrder(state.topics.filter((x) => x.unitId === unitId));
      const v = validateTopic(next);
      showMessages(form, v);
      if (!v.ok) return false;
      await saveTopic(next);
      await reload();
      rerender();
      if (!existing) toast(`${next.name} added`);
    },
  });
}

async function undo(snapshot) {
  await restore(snapshot);
  await reload();
  rerender();
}
