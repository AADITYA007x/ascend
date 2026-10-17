// Import the class timetable from a photo or PDF: choose a file, the AI helper reads it, you check
// the names and classes, then save. Nothing is saved until you tap Save.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, textInput, timeInput, select, stepper, chips, showMessages } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { prepareFile } from '../ui/image.js';
import { state, reload, subjectById } from '../state.js';
import { saveImport, undoImport, setMeta } from '../db/repo.js';
import { validateSlot } from '../model/validate.js';
import { overlappingIds } from '../model/timetable.js';
import { WEEKDAYS, WEEKDAYS_SHORT } from '../model/time.js';
import { IMPORT, cleanRows, groupNames, defaultDecision, buildSlots, planSave, foundLine } from '../model/timetable-import.js';
import { helperEnabled, postHelper } from '../net/helper.js';
import { navigate, rerender } from '../router.js';

// The import in progress (kept while you move around the app, cleared once saved).
// { step: 'choose' | 'reading' | 'review', error, file, controller, rows, decisions, mode, day }
let flow = null;

const keyOf = (name) => name.toLowerCase();

export function renderTimetableImport() {
  const top = topbar('Import timetable', { back: '#/timetable', subtitle: 'From a photo or PDF' });
  const step = flow?.step ?? 'choose';
  const body = step === 'reading' ? readingView() : step === 'review' ? reviewView() : chooseView();
  return { title: 'Import timetable', top, body };
}

// ---------- 1. Choose ----------

function chooseView() {
  const enabled = helperEnabled();
  const online = navigator.onLine;
  const ready = enabled && online;
  const batch = textInput('batch', state.importBatch ?? '', { placeholder: 'e.g. B2, Section A', maxlength: 20 });
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1' });
  const picker = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'visually-hidden', tabindex: '-1' });
  for (const input of [camera, picker]) {
    input.addEventListener('change', () => input.files?.[0] && start(input.files[0], batch.value));
  }

  const note = !enabled
    ? 'Reading a timetable needs the Ascend AI helper, which isn’t set up in this copy of the app. You can still add classes by hand.'
    : !online
      ? 'Reading a timetable needs the internet. You can still add classes by hand.'
      : null;

  return h(
    'div',
    { class: 'import' },
    flow?.error ? h('p', { class: 'form-message', role: 'alert' }, flow.error) : null,
    h('p', { class: 'muted' }, 'Take a photo of your class timetable, or pick an image or PDF. Ascend reads the classes, and you check them before anything is saved.'),
    h(
      'div',
      { class: 'import-choices' },
      h('button', { type: 'button', class: 'import-choice', disabled: !ready, onclick: () => camera.click() }, icon('camera', 26), h('span', {}, 'Take a photo')),
      h('button', { type: 'button', class: 'import-choice', disabled: !ready, onclick: () => picker.click() }, icon('file', 26), h('span', {}, 'Choose image or PDF')),
    ),
    camera,
    picker,
    field('batch', 'Your section or batch (optional)', batch, {
      hint: 'If the timetable lists several batches, only classes for everyone and for yours are kept.',
    }),
    note
      ? h('p', { class: 'calm-note small' }, note, ' ', h('a', { href: '#/timetable' }, 'Back to timetable'))
      : h('p', { class: 'muted small' }, 'The image goes to Google’s Gemini through your Ascend helper, only to read the classes. Nothing is saved until you check it.'),
  );
}

async function start(file, batchText) {
  const batch = batchText.replace(/\s+/g, ' ').trim().slice(0, 20);
  state.importBatch = batch;
  setMeta('importBatch', batch);
  let prepared;
  try {
    prepared = await prepareFile(file);
  } catch (err) {
    flow = { step: 'choose', error: err.message };
    return rerender();
  }
  const controller = new AbortController();
  flow = { step: 'reading', file: prepared, controller };
  rerender();
  try {
    const subjects = state.subjects.map((s) => (s.code ? `${s.name} (${s.code})` : s.name));
    const data = await postHelper(
      '/timetable',
      { file: { mimeType: prepared.mimeType, data: prepared.data }, batch, subjects },
      { timeoutMs: 120000, signal: controller.signal },
    );
    if (flow?.controller !== controller) return; // cancelled, or a newer file was picked
    const rows = cleanRows(data.rows).map((r, i) => ({ ...r, rid: i }));
    if (!rows.length) {
      flow = { step: 'choose', error: 'No classes could be read from that file. Try a clear, straight-on photo of the whole timetable.' };
    } else {
      const decisions = new Map(groupNames(rows, state.subjects).map((g) => [g.key, defaultDecision(g)]));
      flow = { step: 'review', file: prepared, rows, decisions, mode: 'add', day: rows[0].day };
    }
  } catch (err) {
    if (flow?.controller !== controller) return;
    flow = err.kind === 'cancel' ? null : { step: 'choose', error: err.message };
  }
  if (location.hash.startsWith('#/timetable/import')) rerender();
}

// ---------- 2. Reading ----------

function readingView() {
  return h(
    'div',
    { class: 'import import-reading', 'aria-busy': 'true' },
    flow.file.previewUrl ? h('img', { class: 'import-thumb', src: flow.file.previewUrl, alt: 'Your timetable' }) : h('p', { class: 'muted' }, 'Your PDF'),
    h('p', { class: 'card-heading', role: 'status' }, 'Reading your timetable…'),
    h('p', { class: 'muted small' }, 'This can take up to a minute for a busy timetable.'),
    h('button', { type: 'button', class: 'btn btn-quiet', onclick: cancelReading }, 'Cancel'),
  );
}

// ---------- 3. Review ----------

function decisionFor(name) {
  return flow.decisions.get(keyOf(name));
}

/** What a class will belong to, in a few words. */
function targetLabel(name) {
  const d = decisionFor(name);
  if (!d || d.action === 'skip') return 'Skipped';
  if (d.action === 'create') return `New subject: ${d.name || name}`;
  return subjectById(d.subjectId)?.name ?? 'Subject';
}

function preview() {
  const { newSubjects, slots } = buildSlots(flow.rows, flow.decisions, { semesterId: state.semester.id, subjects: state.subjects });
  return { newSubjects, slots, plan: planSave(state.slots, slots, flow.mode) };
}

function reviewView() {
  const groups = groupNames(flow.rows, state.subjects);
  for (const g of groups) if (!flow.decisions.has(g.key)) flow.decisions.set(g.key, defaultDecision(g));
  const { plan } = preview();

  const summary = h(
    'section',
    { class: 'card import-summary' },
    flow.file?.previewUrl ? h('img', { class: 'import-thumb small-thumb', src: flow.file.previewUrl, alt: '' }) : null,
    h(
      'div',
      { class: 'card-main' },
      h('span', { class: 'card-heading' }, foundLine(flow.rows)),
      h('span', { class: 'muted small' }, 'Check the names and classes, then save. Tap a class to fix it.'),
      h('button', { type: 'button', class: 'btn btn-quiet import-again', onclick: startOver }, 'Start over'),
    ),
  );

  const names = h(
    'section',
    { class: 'group' },
    h('h2', { class: 'group-title' }, 'Names on the timetable'),
    groups.map((g) => nameCard(g)),
  );

  return h('div', { class: 'import' }, summary, names, classesSection(), saveCard(plan));
}

function nameCard(g) {
  const d = decisionFor(g.name);
  const value = d.action === 'match' ? `s:${d.subjectId}` : d.action;
  const options = [
    { value: 'create', label: 'Create a new subject' },
    { value: 'skip', label: 'Skip (not my class)' },
    ...state.subjects.map((s) => ({ value: `s:${s.id}`, label: `${s.name}${g.match?.subjectId === s.id ? ' (suggested)' : ''}` })),
  ];
  const choice = select(`decision-${g.key}`, options, value, { 'aria-label': `What “${g.name}” is` });
  choice.addEventListener('change', () => {
    const v = choice.value;
    if (v === 'skip') flow.decisions.set(g.key, { action: 'skip' });
    else if (v === 'create') flow.decisions.set(g.key, { ...defaultDecision({ ...g, match: null }) });
    else flow.decisions.set(g.key, { action: 'match', subjectId: v.slice(2) });
    rerender();
  });

  let extra = null;
  if (d.action === 'create') {
    const nameInput = textInput(`newname-${g.key}`, d.name, { maxlength: IMPORT.nameMax, 'aria-label': 'New subject name' });
    nameInput.addEventListener('input', () => (d.name = nameInput.value.trim()));
    nameInput.addEventListener('change', () => rerender());
    const credits = stepper(`credits-${g.key}`, d.credits ?? IMPORT.creditsDefault, { min: 0, max: 10, format: (n) => `${n} credit${n === 1 ? '' : 's'}`, label: 'credits' });
    credits.addEventListener('change', (e) => (d.credits = Number(e.target.value)));
    extra = h('div', { class: 'name-create' }, field(`newname-${g.key}`, 'Subject name', nameInput), credits);
  }

  return h(
    'div',
    { class: `card name-card${d.action === 'skip' ? ' skipped' : ''}` },
    h('div', { class: 'name-head' }, h('span', { class: 'card-heading' }, g.name), h('span', { class: 'muted small' }, `${g.count} class${g.count === 1 ? '' : 'es'}`)),
    choice,
    extra,
  );
}

function classesSection() {
  const counts = WEEKDAYS_SHORT.map((_, i) => flow.rows.filter((r) => r.day === i).length);
  if (!counts[flow.day]) flow.day = counts.findIndex((n) => n > 0);
  const tabs = h(
    'div',
    { class: 'day-tabs', role: 'tablist', 'aria-label': 'Day of the week' },
    WEEKDAYS_SHORT.map((d, i) =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: `day-tab${i === flow.day ? ' active' : ''}`,
          'aria-selected': String(i === flow.day),
          'aria-label': `${WEEKDAYS[i]}, ${counts[i]} class${counts[i] === 1 ? '' : 'es'}`,
          onclick: () => {
            flow.day = i;
            rerender();
          },
        },
        h('span', {}, d),
        h('span', { class: 'day-count', 'aria-hidden': 'true' }, counts[i] ? String(counts[i]) : '·'),
      ),
    ),
  );

  // Overlaps among the classes you're keeping (and, when adding, with your current ones).
  const kept = flow.rows.filter((r) => decisionFor(r.name)?.action !== 'skip').map((r) => ({ id: `r${r.rid}`, day: r.day, start: r.start, end: r.end }));
  const clashes = overlappingIds(flow.mode === 'add' ? [...state.slots, ...kept] : kept);

  const rows = flow.rows.filter((r) => r.day === flow.day).sort((a, b) => a.start.localeCompare(b.start));
  return h(
    'section',
    { class: 'group' },
    h('h2', { class: 'group-title' }, 'Classes'),
    tabs,
    h(
      'ul',
      { class: 'cards slots' },
      rows.map((r) => {
        const skipped = decisionFor(r.name)?.action === 'skip';
        const clash = !skipped && clashes.has(`r${r.rid}`);
        return h(
          'li',
          {},
          h(
            'button',
            { type: 'button', class: `card card-link slot-card${skipped ? ' skipped' : ''}${clash ? ' clash' : ''}`, onclick: () => openRowSheet(r) },
            h('span', { class: 'slot-time' }, h('span', {}, r.start), h('span', { class: 'muted' }, r.end)),
            h(
              'span',
              { class: 'card-main' },
              h('span', { class: 'card-heading' }, r.name),
              h('span', { class: 'muted small' }, [targetLabel(r.name), r.label].filter(Boolean).join(' · ')),
              clash ? h('span', { class: 'clash-note small' }, 'Overlaps another class') : null,
            ),
          ),
        );
      }),
    ),
  );
}

function saveCard(plan) {
  const existing = state.slots.length;
  const n = plan.save.length;
  const notes = [
    plan.skipped ? `${plan.skipped} already in your timetable` : null,
    plan.overlaps ? `${plan.overlaps} overlapping class${plan.overlaps === 1 ? '' : 'es'} to check later` : null,
  ].filter(Boolean);
  let mode = null;
  if (existing) {
    mode = chips(
      'mode',
      [
        { value: 'add', label: 'Add to my timetable' },
        { value: 'replace', label: 'Replace my timetable' },
      ],
      flow.mode,
      { label: 'Add or replace' },
    );
    mode.addEventListener('change', (e) => {
      flow.mode = e.target.value;
      rerender();
    });
  }
  return h(
    'section',
    { class: 'card import-save' },
    mode ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, `You have ${existing} class${existing === 1 ? '' : 'es'} now`), mode) : null,
    notes.length ? h('p', { class: 'muted small' }, notes.join(' · ')) : null,
    h('button', { type: 'button', class: 'btn btn-primary btn-wide', disabled: n === 0, onclick: save }, n ? `Save ${n} class${n === 1 ? '' : 'es'}` : 'Nothing new to save'),
  );
}

function openRowSheet(row) {
  const sheet = openSheet({
    title: 'Edit class',
    body: h(
      'div',
      {},
      field('name', 'Name on the timetable', textInput('name', row.name, { maxlength: IMPORT.nameMax })),
      h(
        'div',
        { class: 'field', 'data-field': 'day' },
        h('span', { class: 'field-label' }, 'Day'),
        chips('day', WEEKDAYS_SHORT.map((d, i) => ({ value: i, label: d })), row.day, { label: 'Day' }),
        h('p', { class: 'field-msg' }),
      ),
      h('div', { class: 'row-2' }, field('start', 'Starts', timeInput('start', row.start)), field('end', 'Ends', timeInput('end', row.end))),
      field('label', 'Type or room (optional)', textInput('label', row.label, { maxlength: IMPORT.labelMax })),
    ),
    extraActions: [
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-quiet danger-text',
          onclick: () => {
            flow.rows = flow.rows.filter((r) => r.rid !== row.rid);
            sheet.close();
            rerender();
          },
        },
        icon('trash', 18),
        'Remove',
      ),
    ],
    onSubmit: (form) => {
      const fd = new FormData(form);
      const next = {
        ...row,
        name: String(fd.get('name') ?? '').replace(/\s+/g, ' ').trim(),
        day: Number(fd.get('day')),
        start: String(fd.get('start') ?? ''),
        end: String(fd.get('end') ?? ''),
        label: String(fd.get('label') ?? '').trim(),
      };
      const v = validateSlot({ ...next, subjectId: 'x' });
      if (!next.name) v.errors.name = 'Please add a name.';
      v.ok = Object.keys(v.errors).length === 0;
      showMessages(form, v);
      if (!v.ok) return false;
      flow.rows = flow.rows.map((r) => (r.rid === row.rid ? next : r));
      flow.day = next.day;
      rerender();
      return undefined;
    },
  });
}

/** Back to the start straight away; a reply that still arrives is ignored. */
function cancelReading() {
  flow?.controller?.abort();
  if (flow?.file?.previewUrl) URL.revokeObjectURL(flow.file.previewUrl);
  flow = null;
  rerender();
}

function startOver() {
  if (flow?.file?.previewUrl) URL.revokeObjectURL(flow.file.previewUrl);
  flow = null;
  rerender();
}

async function save() {
  const { newSubjects, plan } = preview();
  const used = new Set(plan.save.map((s) => s.subjectId));
  const subjects = newSubjects.filter((s) => used.has(s.id));
  const undo = await saveImport({ subjects, slots: plan.save, removeSlotIds: plan.removeIds });
  await reload();
  if (flow.file?.previewUrl) URL.revokeObjectURL(flow.file.previewUrl);
  flow = null;
  navigate('timetable');
  const n = plan.save.length;
  toast(
    `${n} class${n === 1 ? '' : 'es'} ${plan.removeIds.length ? 'saved as your timetable' : 'added'}${subjects.length ? `, with ${subjects.length} new subject${subjects.length === 1 ? '' : 's'}` : ''}`,
    {
      actionLabel: 'Undo',
      duration: 8000,
      onAction: async () => {
        await undoImport(undo);
        await reload();
        rerender();
      },
    },
  );
}
