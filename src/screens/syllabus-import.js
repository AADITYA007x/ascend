// Import subjects, units and topics from the syllabus: upload a PDF or page photos, tick your subjects,
// let the AI helper read their units, check everything, then save. Nothing is saved until you tap Save,
// and saving only adds: your own units and topics are never changed.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, textInput, stepper, chips, showMessages, select } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { prepareBlob } from '../ui/image.js';
import { state, reload, subjectById } from '../state.js';
import { saveSyllabusImport, undoImport, setMeta } from '../db/repo.js';
import { DIFFICULTY_LABELS } from '../model/factory.js';
import { validateTopic } from '../model/validate.js';
import { formatMinutes } from '../model/time.js';
import { SYLLABUS, cleanSubjectList, cleanUnits, withEstimates, reviewTotals, planSyllabusSave } from '../model/syllabus-import.js';
import { helperEnabled, postHelper, uploadToHelper, deleteHelperFiles } from '../net/helper.js';
import { navigate, rerender } from '../router.js';

const READ_AT_ONCE = 1; // one subject at a time keeps within Gemini's free per-minute limit
const LIMIT_WAIT_MS = 30 * 1000; // after "free limit reached", wait this long and try again…
const LIMIT_TRIES = 4; // …up to this many times
const WAIT_MS = 3 * 60 * 1000;
const TIME_PRESETS = [15, 30, 45, 60, 90, 120];

// The import in progress (kept while you move around the app, cleared once saved or cancelled).
let flow = null;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const onThisScreen = () => location.hash.startsWith('#/subjects/import');
const redraw = () => onThisScreen() && rerender();

export function renderSyllabusImport(focusSubjectId) {
  // Opened from one subject's screen: that subject is the one to tick.
  if (!flow || flow.step === 'choose') flow = { step: 'choose', pages: [], ...flow, focus: focusSubjectId ?? null };
  const focus = focusSubjectId ? subjectById(focusSubjectId) : null;
  const top = topbar('Import from syllabus', { back: focus ? `#/subject/${encodeURIComponent(focus.id)}` : '#/subjects', subtitle: focus ? focus.name : 'Subjects, units and topics' });
  const step = flow?.step ?? 'choose';
  const views = { choose: chooseView, uploading: progressView, finding: progressView, pick: pickView, reading: readingView, review: reviewView };
  return { title: 'Import from syllabus', top, body: (views[step] ?? chooseView)() };
}

// ---------- 1. Choose ----------

function chooseView() {
  if (!flow) flow = { step: 'choose', pages: [] };
  const ready = helperEnabled() && navigator.onLine;
  const hint = textInput('hint', state.syllabusHint ?? '', { placeholder: 'e.g. B.Tech CSE Sem 5', maxlength: 60 });
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1' });
  const picker = h('input', { type: 'file', accept: 'application/pdf,image/*', multiple: true, class: 'visually-hidden', tabindex: '-1' });

  const addFiles = (files) => {
    const list = [...files];
    const pdf = list.find((f) => f.type === 'application/pdf');
    if (pdf) return start([pdf], hint.value); // a PDF goes on its own, straight away
    const room = SYLLABUS.maxPhotos - flow.pages.length;
    flow.pages.push(...list.filter((f) => f.type.startsWith('image/')).slice(0, room).map((f) => ({ file: f, url: URL.createObjectURL(f) })));
    flow.error = list.length > room ? `Up to ${SYLLABUS.maxPhotos} photos at a time.` : null;
    state.syllabusHint = hint.value;
    rerender();
  };
  camera.addEventListener('change', () => camera.files?.length && addFiles(camera.files));
  picker.addEventListener('change', () => picker.files?.length && addFiles(picker.files));

  const pages = flow.pages.length
    ? h(
        'section',
        { class: 'card import-pages' },
        h('span', { class: 'card-heading' }, `${flow.pages.length} page${flow.pages.length === 1 ? '' : 's'} ready`),
        h(
          'div',
          { class: 'page-thumbs' },
          flow.pages.map((p, i) =>
            h(
              'div',
              { class: 'page-thumb' },
              h('img', { src: p.url, alt: `Page ${i + 1}` }),
              h('button', { type: 'button', class: 'icon-btn page-remove', 'aria-label': `Remove page ${i + 1}`, onclick: () => (URL.revokeObjectURL(p.url), flow.pages.splice(i, 1), rerender()) }, icon('close', 16)),
            ),
          ),
        ),
        h('button', { type: 'button', class: 'btn btn-primary btn-wide', disabled: !ready, onclick: () => start(flow.pages.map((p) => p.file), hint.value) }, `Read ${flow.pages.length} page${flow.pages.length === 1 ? '' : 's'}`),
      )
    : null;

  const note = !helperEnabled()
    ? 'Reading a syllabus needs the Ascend AI helper, which isn’t set up in this copy of the app. You can still add units and topics by hand.'
    : !navigator.onLine
      ? 'Reading a syllabus needs the internet. You can still add units and topics by hand.'
      : null;

  return h(
    'div',
    { class: 'import' },
    flow.error ? h('p', { class: 'form-message', role: 'alert' }, flow.error) : null,
    h('p', { class: 'muted' }, 'Upload your syllabus (the whole master PDF is fine) or photos of its pages. You pick your subjects, Ascend reads their units and topics, and you check everything before it’s saved.'),
    h(
      'div',
      { class: 'import-choices' },
      h('button', { type: 'button', class: 'import-choice', disabled: !ready, onclick: () => camera.click() }, icon('camera', 26), h('span', {}, flow.pages.length ? 'Add a photo' : 'Take photos')),
      h('button', { type: 'button', class: 'import-choice', disabled: !ready, onclick: () => picker.click() }, icon('file', 26), h('span', {}, 'Choose PDF or images')),
    ),
    camera,
    picker,
    pages,
    field('hint', 'Your course and semester (optional)', hint, { hint: 'Helps Ascend find and tick your subjects in a big syllabus.' }),
    note
      ? h('p', { class: 'calm-note small' }, note)
      : h('p', { class: 'muted small' }, 'The file goes to Google’s Gemini through your Ascend helper, only to read it, and is deleted afterwards. Nothing is saved until you check it.'),
  );
}

async function start(files, hintText) {
  const hint = hintText.replace(/\s+/g, ' ').trim().slice(0, 60);
  state.syllabusHint = hint;
  setMeta('syllabusHint', hint);
  const controller = new AbortController();
  const focus = flow?.focus ?? null;
  let blobs;
  try {
    blobs = await Promise.all(files.map((f) => prepareBlob(f, { maxPdfBytes: SYLLABUS.maxFileBytes })));
  } catch (err) {
    flow = { ...flow, step: 'choose', error: err.message };
    return rerender();
  }
  for (const p of flow?.pages ?? []) URL.revokeObjectURL(p.url);
  flow = {
    step: 'uploading',
    controller,
    focus,
    hint,
    uploads: blobs.map((b, i) => ({ label: files[i].type === 'application/pdf' ? files[i].name : `Page ${i + 1}`, sizeMb: b.size / 1024 / 1024, progress: 0 })),
    files: [],
  };
  rerender();
  const mine = () => flow?.controller === controller;
  try {
    for (const [i, blob] of blobs.entries()) {
      const file = await uploadToHelper(blob, {
        signal: controller.signal,
        onProgress: (p) => {
          if (!mine()) return;
          flow.uploads[i].progress = p;
          const bar = document.querySelector(`[data-upload="${i}"]`);
          if (bar) bar.value = p;
        },
      });
      if (!mine()) return;
      flow.uploads[i].progress = 1;
      flow.files.push(file);
    }
    flow.step = 'finding';
    redraw();
    const data = await postHelper(
      '/syllabus/subjects',
      { files: flow.files, hint, mine: state.subjects.map((s) => (s.code ? `${s.name} (${s.code})` : s.name)) },
      { timeoutMs: WAIT_MS, signal: controller.signal },
    );
    if (!mine()) return;
    const subjects = cleanSubjectList(data.subjects, state.subjects, hint);
    if (!subjects.length) throw Object.assign(new Error('No subjects could be found in that file. Try clearer photos or the official PDF.'), { kind: 'empty' });
    const focusKey = focus ? subjects.find((s) => s.match?.subjectId === focus)?.key : null;
    const picked = new Set(focus ? (focusKey ? [focusKey] : []) : subjects.filter((s) => s.suggested).map((s) => s.key));
    Object.assign(flow, { step: 'pick', subjects, picked });
  } catch (err) {
    if (!mine()) return;
    if (err.kind === 'cancel') return;
    deleteHelperFiles(flow.files.map((f) => f.name));
    flow = { step: 'choose', pages: [], focus, error: err.message };
  }
  redraw();
}

function cancel() {
  if (!flow) return;
  flow.controller?.abort();
  deleteHelperFiles((flow.files ?? []).map((f) => f.name));
  const focus = flow.focus;
  flow = focus ? { step: 'choose', pages: [], focus } : null;
  rerender();
}

// ---------- 2. Uploading and finding subjects ----------

function progressView() {
  const finding = flow.step === 'finding';
  return h(
    'div',
    { class: 'import import-reading', 'aria-busy': 'true' },
    h(
      'ul',
      { class: 'upload-list' },
      flow.uploads.map((u, i) =>
        h(
          'li',
          { class: 'upload-row' },
          h('span', { class: 'small' }, u.label, h('span', { class: 'muted' }, ` · ${u.sizeMb < 1 ? `${Math.max(1, Math.round(u.sizeMb * 1024))} KB` : `${u.sizeMb.toFixed(1)} MB`}`)),
          h('progress', { class: 'upload-bar', max: 1, value: u.progress, 'data-upload': i, 'aria-label': `Uploading ${u.label}` }),
        ),
      ),
    ),
    h('p', { class: 'card-heading', role: 'status' }, finding ? 'Finding the subjects in your syllabus…' : 'Uploading…'),
    h('p', { class: 'muted small' }, finding ? 'A big syllabus can take a minute or two.' : 'Big PDFs take a little while on mobile data.'),
    h('button', { type: 'button', class: 'btn btn-quiet', onclick: cancel }, 'Cancel'),
  );
}

// ---------- 3. Pick your subjects ----------

function pickView() {
  const n = flow.picked.size;
  return h(
    'div',
    { class: 'import' },
    h('p', { class: 'muted' }, `Found ${flow.subjects.length} subject${flow.subjects.length === 1 ? '' : 's'}. ${n ? 'Ticked the ones that look like yours. ' : ''}Tick the subjects you’re taking.`),
    h(
      'ul',
      { class: 'cards pick-list' },
      flow.subjects.map((s) =>
        h(
          'li',
          {},
          h(
            'label',
            { class: 'card pick-row' },
            h('input', {
              type: 'checkbox',
              checked: flow.picked.has(s.key),
              onchange: (e) => {
                if (e.target.checked) flow.picked.add(s.key);
                else flow.picked.delete(s.key);
                rerender();
              },
            }),
            h(
              'span',
              { class: 'card-main' },
              h('span', { class: 'card-heading' }, s.name),
              h(
                'span',
                { class: 'muted small' },
                [s.code, s.credits !== null ? `${s.credits} credits` : null, s.semester ? `Sem ${s.semester.replace(/^sem(ester)?\s*/i, '')}` : null, s.match ? `matches your ${subjectById(s.match.subjectId)?.name}` : null]
                  .filter(Boolean)
                  .join(' · '),
              ),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'import-save card' },
      h('button', { type: 'button', class: 'btn btn-primary btn-wide', disabled: n === 0, onclick: readUnits }, n ? `Read units for ${n} subject${n === 1 ? '' : 's'}` : 'Tick at least one subject'),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: cancel }, 'Start over'),
    ),
  );
}

// ---------- 4. Reading units ----------

function readUnits() {
  flow.step = 'reading';
  flow.results = new Map(flow.subjects.filter((s) => flow.picked.has(s.key)).map((s) => [s.key, { subject: s, status: 'waiting' }]));
  rerender();
  pump();
}

/** Keeps READ_AT_ONCE subjects being read until all are done. */
function pump() {
  if (flow?.step !== 'reading') return;
  const results = [...flow.results.values()];
  const busy = results.filter((r) => r.status === 'reading' || r.status === 'limit').length;
  for (const r of results.filter((x) => x.status === 'waiting').slice(0, Math.max(0, READ_AT_ONCE - busy))) readOne(r);
  if (results.every((r) => r.status === 'done' || r.status === 'failed') && results.every((r) => r.status === 'done')) toReview();
}

async function readOne(r) {
  const controller = flow.controller;
  r.status = 'reading';
  redraw();
  try {
    const data = await postHelper(
      '/syllabus/units',
      { files: flow.files, subject: { name: r.subject.name, code: r.subject.code, pages: r.subject.pages } },
      { timeoutMs: WAIT_MS, signal: controller.signal },
    );
    const units = withEstimates(cleanUnits(data.units));
    if (!units.length) throw new Error('No units found for this subject.');
    Object.assign(r, { status: 'done', units });
  } catch (err) {
    if (err.kind === 'cancel') return;
    if (err.kind === 'limit' && (r.limitTries ?? 0) < LIMIT_TRIES) {
      // Gemini's free tier allows only a few requests a minute: wait, then try this subject again.
      r.limitTries = (r.limitTries ?? 0) + 1;
      r.status = 'limit';
      redraw();
      setTimeout(() => {
        if (flow?.controller !== controller || r.status !== 'limit') return;
        readOne(r);
      }, LIMIT_WAIT_MS);
      return;
    }
    Object.assign(r, { status: 'failed', error: err.message });
  }
  if (flow?.controller !== controller) return;
  redraw();
  pump();
}

function readingView() {
  const results = [...flow.results.values()];
  const done = results.filter((r) => r.status === 'done').length;
  const settled = results.every((r) => r.status === 'done' || r.status === 'failed');
  return h(
    'div',
    { class: 'import' },
    h('p', { class: 'card-heading', role: 'status' }, settled ? `Read ${done} of ${results.length} subjects` : `Reading units… (${done} of ${results.length} done)`),
    h('p', { class: 'muted small' }, 'Each subject takes a few seconds. On Gemini’s free plan Ascend reads one at a time, and sometimes waits a little.'),
    h(
      'ul',
      { class: 'cards' },
      results.map((r) =>
        h(
          'li',
          { class: 'card read-row' },
          h('span', { class: 'card-main' }, h('span', { class: 'card-heading' }, r.subject.name), h('span', { class: `small ${r.status === 'failed' ? 'weak-text' : 'muted'}` }, readLabel(r))),
          r.status === 'failed'
            ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => ((r.status = 'waiting'), rerender(), pump()) }, 'Retry')
            : r.status === 'done'
              ? icon('check', 20)
              : null,
        ),
      ),
    ),
    settled && done
      ? h('button', { type: 'button', class: 'btn btn-primary btn-wide', onclick: toReview }, `Continue with ${done} subject${done === 1 ? '' : 's'}`)
      : null,
    h('button', { type: 'button', class: 'btn btn-quiet', onclick: cancel }, 'Cancel'),
  );
}

function readLabel(r) {
  if (r.status === 'waiting') return 'Waiting…';
  if (r.status === 'reading') return 'Reading…';
  if (r.status === 'limit') return 'Waiting for Gemini’s free limit… trying again in 30 s';
  if (r.status === 'failed') return `Couldn’t read this one. ${r.error ?? ''}`.trim();
  const topics = r.units.reduce((s, u) => s + u.topics.length, 0);
  return `${plural(r.units.length, 'unit')} · ${plural(topics, 'topic')}`;
}

function toReview() {
  flow.picks = [...flow.results.values()]
    .filter((r) => r.status === 'done')
    .map((r) => ({
      found: r.subject,
      decision: r.subject.match
        ? { action: 'match', subjectId: r.subject.match.subjectId }
        : { action: 'create', name: r.subject.name, code: r.subject.code, credits: r.subject.credits ?? 3 },
      units: r.units,
    }));
  flow.step = 'review';
  redraw();
}

// ---------- 5. Review ----------

function reviewView() {
  const t = reviewTotals(flow.picks);
  return h(
    'div',
    { class: 'import' },
    h(
      'section',
      { class: 'card import-summary' },
      h(
        'div',
        { class: 'card-main' },
        h('span', { class: 'card-heading' }, `${plural(t.subjects, 'subject')} · ${plural(t.units, 'unit')} · ${plural(t.topics, 'topic')}`),
        h('span', { class: 'muted small' }, `About ${t.hours} h of study. Times come from the syllabus hours; tap a topic to change it.`),
      ),
    ),
    flow.picks.map((p, i) => subjectCard(p, i)),
    h(
      'div',
      { class: 'card import-save' },
      h('p', { class: 'muted small' }, 'Saving only adds: units and topics you already have stay as they are.'),
      h('button', { type: 'button', class: 'btn btn-primary btn-wide', disabled: t.topics === 0, onclick: save }, 'Save'),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: cancel }, 'Start over'),
    ),
  );
}

function subjectCard(p, i) {
  const d = p.decision;
  const value = d.action === 'match' ? `s:${d.subjectId}` : d.action;
  const options = [
    { value: 'create', label: 'Add as a new subject' },
    { value: 'skip', label: 'Skip this subject' },
    ...state.subjects.map((s) => ({ value: `s:${s.id}`, label: `Add to ${s.name}${p.found.match?.subjectId === s.id ? ' (suggested)' : ''}` })),
  ];
  const choice = select(`pick-${i}`, options, value, { 'aria-label': `Where ${p.found.name} goes` });
  choice.addEventListener('change', () => {
    const v = choice.value;
    if (v === 'skip') p.decision = { action: 'skip' };
    else if (v === 'create') p.decision = { action: 'create', name: p.found.name, code: p.found.code, credits: p.found.credits ?? 3 };
    else p.decision = { action: 'match', subjectId: v.slice(2) };
    rerender();
  });

  let create = null;
  if (d.action === 'create') {
    const nameIn = textInput(`subj-name-${i}`, d.name, { maxlength: 80, 'aria-label': 'Subject name' });
    nameIn.addEventListener('input', () => (d.name = nameIn.value.trim()));
    const codeIn = textInput(`subj-code-${i}`, d.code ?? '', { maxlength: 20, 'aria-label': 'Subject code', placeholder: 'Code' });
    codeIn.addEventListener('input', () => (d.code = codeIn.value.trim()));
    const credits = stepper(`subj-credits-${i}`, d.credits ?? 3, { min: 0, max: 10, format: (n) => `${n} credit${n === 1 ? '' : 's'}`, label: 'credits' });
    credits.addEventListener('change', (e) => (d.credits = Number(e.target.value)));
    create = h('div', { class: 'name-create' }, h('div', { class: 'row-2 subj-create' }, field(`subj-name-${i}`, 'Name', nameIn), field(`subj-code-${i}`, 'Code', codeIn)), credits);
  }

  const skipped = d.action === 'skip';
  return h(
    'section',
    { class: `card name-card${skipped ? ' skipped' : ''}` },
    h('div', { class: 'name-head' }, h('span', { class: 'card-heading' }, p.found.name), h('span', { class: 'muted small' }, plural(p.units.length, 'unit'))),
    choice,
    create,
    skipped ? null : p.units.map((u, ui) => unitBlock(p, u, ui)),
  );
}

function unitBlock(p, u, ui) {
  const minutes = u.topics.reduce((s, t) => s + t.estMin, 0);
  return h(
    'details',
    { class: 'review-unit', open: ui === 0 },
    h(
      'summary',
      {},
      h('span', { class: 'card-main' }, h('span', { class: 'unit-name' }, u.name), h('span', { class: 'muted small' }, `${u.topics.length} topics · ${formatMinutes(minutes)}${u.hours ? ` · ${u.hours} lecture h` : ''}`)),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `Remove ${u.name}`,
          onclick: (e) => {
            e.preventDefault();
            p.units = p.units.filter((x) => x !== u);
            rerender();
            toast(`${u.name} removed from this import`);
          },
        },
        icon('trash', 18),
      ),
    ),
    h(
      'ul',
      { class: 'topics' },
      u.topics.map((t) =>
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', class: 'topic-row', onclick: () => openTopicSheet(u, t) },
            h('span', { class: 'topic-name' }, t.name),
            h('span', { class: `pill diff-${t.difficulty}` }, DIFFICULTY_LABELS[t.difficulty]),
            h('span', { class: 'topic-time muted small' }, formatMinutes(t.estMin)),
          ),
        ),
      ),
    ),
  );
}

function openTopicSheet(unit, topic) {
  const time = stepper('estMin', topic.estMin, { min: 5, max: 600, step: 5, format: formatMinutes, label: 'time' });
  const sheet = openSheet({
    title: 'Edit topic',
    body: h(
      'div',
      {},
      field('name', 'Topic', textInput('name', topic.name, { maxlength: 80 })),
      field('estMin', 'Estimated study time', time),
      h('div', { class: 'presets' }, TIME_PRESETS.map((m) => h('button', { type: 'button', class: 'chip chip-small', onclick: () => time.setValue(m) }, formatMinutes(m)))),
      h(
        'div',
        { class: 'field', 'data-field': 'difficulty' },
        h('span', { class: 'field-label' }, 'How hard does it look?'),
        chips('difficulty', [1, 2, 3].map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] })), topic.difficulty, { label: 'Difficulty' }),
        h('p', { class: 'field-msg' }),
      ),
    ),
    extraActions: [
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-quiet danger-text',
          onclick: () => {
            unit.topics = unit.topics.filter((t) => t !== topic);
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
      const next = { name: String(fd.get('name') ?? '').replace(/\s+/g, ' ').trim(), estMin: Number(fd.get('estMin')), difficulty: Number(fd.get('difficulty')) };
      const v = validateTopic({ ...next, unitId: 'x' });
      showMessages(form, v);
      if (!v.ok) return false;
      Object.assign(topic, next);
      rerender();
      return undefined;
    },
  });
}

async function save() {
  const plan = planSyllabusSave({
    picks: flow.picks,
    existing: { subjects: state.subjects, units: state.units, topics: state.topics },
    semesterId: state.semester.id,
  });
  if (!plan.topics.length && !plan.units.length && !plan.subjects.length) {
    toast('Nothing new to add: you already have all of these.');
    return;
  }
  const undo = await saveSyllabusImport(plan);
  await reload();
  deleteHelperFiles(flow.files.map((f) => f.name));
  const focus = flow.focus;
  flow = null;
  navigate(focus ? `subject/${encodeURIComponent(focus)}` : 'subjects');
  const parts = [
    plan.subjects.length ? `${plan.subjects.length} subject${plan.subjects.length === 1 ? '' : 's'}` : null,
    `${plan.units.length} unit${plan.units.length === 1 ? '' : 's'}`,
    `${plan.topics.length} topic${plan.topics.length === 1 ? '' : 's'}`,
  ].filter(Boolean);
  toast(`Added ${parts.join(', ')}`, {
    actionLabel: 'Undo',
    duration: 8000,
    onAction: async () => {
      await undoImport(undo);
      await reload();
      rerender();
    },
  });
}
