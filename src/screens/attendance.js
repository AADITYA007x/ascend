// Attendance: mark classes with one tap, see each subject's %, and how much room is left.
// Today and Timetable show small pieces of it (classesTodayCard, attendanceSummaryCard).
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, stepper, chips, showMessages, emptyState } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { state, reload, subjectById } from '../state.js';
import { saveAttendance, saveAttendanceMany, undoAttendance, deleteAttendance, saveSubject, saveSemester } from '../db/repo.js';
import { makeAttendance, withSemesterDefaults, withSubjectDefaults } from '../model/factory.js';
import { validateAttendanceMin, validateStartCounts, ATTENDANCE_LIMITS } from '../model/validate.js';
import { ATTENDANCE, STATUS_LABELS, attendanceKey, attendanceStatus, classesOn, unmarkedClasses } from '../model/attendance.js';
import { formatDate, relativeDays, todayYMD } from '../model/time.js';
import { rerender } from '../router.js';

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

const recordFor = (key) => state.attendance.find((r) => r.id === key) ?? null;
const subjectName = (slot) => subjectById(slot.subjectId)?.name ?? 'Class';
const statusOf = (subject) => attendanceStatus(state.attendance, subject, withSemesterDefaults(state.semester));

/** Subjects that have classes in the timetable or anything marked, the ones needing a look first. */
function trackedSubjects() {
  const ids = new Set([...state.slots.map((s) => s.subjectId), ...state.attendance.map((r) => r.subjectId)]);
  const rank = { below: 0, close: 1, safe: 2, none: 3 };
  return state.subjects
    .filter((s) => ids.has(s.id) || Number(s.startHeld) > 0)
    .map((subject) => ({ subject, status: statusOf(subject) }))
    .sort((a, b) => rank[a.status.level] - rank[b.status.level] || a.subject.name.localeCompare(b.subject.name));
}

// ---------- Marking ----------

async function mark(c, status) {
  const existing = recordFor(c.key);
  if (existing?.status === status) {
    await deleteAttendance(c.key); // tapping the chosen mark again clears it
  } else {
    await saveAttendance(
      makeAttendance({ semesterId: state.semester.id, subjectId: c.slot.subjectId, slotId: c.slot.id, date: c.date, status }),
    );
  }
  await reload();
}

/**
 * Present / Absent / Cancelled for one class. The buttons update themselves straight away;
 * onChange runs after the mark is saved (to redraw what depends on it).
 */
function markButtons(c, { onChange } = {}) {
  const current = recordFor(c.key)?.status ?? null;
  const group = h('div', {
    class: 'mark-chips',
    role: 'group',
    'aria-label': `${subjectName(c.slot)} at ${c.slot.start}, ${formatDate(c.date)}`,
  });
  for (const status of ATTENDANCE.statuses) {
    group.append(
      h(
        'button',
        {
          type: 'button',
          class: `mark-chip mark-${status}`,
          'aria-pressed': String(current === status),
          'data-mark': `${c.key}#${status}`,
          onclick: async (e) => {
            const btn = e.currentTarget;
            const on = btn.getAttribute('aria-pressed') !== 'true';
            for (const b of group.children) b.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-pressed', String(on));
            await mark(c, status);
            const hadFocus = document.activeElement === btn;
            onChange?.();
            // A redraw replaces the buttons: keep keyboard focus on the same one.
            if (hadFocus) document.querySelector(`[data-mark="${CSS.escape(`${c.key}#${status}`)}"]`)?.focus();
          },
        },
        STATUS_LABELS[status],
      ),
    );
  }
  return group;
}

function classRow(c, { note, showDate = false, onChange = rerender } = {}) {
  const subject = subjectById(c.slot.subjectId);
  return h(
    'li',
    { class: 'class-row', style: { '--subject': subject?.color ?? 'var(--muted)' } },
    h(
      'div',
      { class: 'class-row-head' },
      h('span', { class: 'subject-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'class-name' }, subject?.name ?? 'Class', c.slot.label ? h('span', { class: 'muted small' }, ` · ${c.slot.label}`) : null),
      h('span', { class: 'muted small class-time' }, showDate ? `${dayLabel(c.date)} · ${c.slot.start}` : `${c.slot.start}–${c.slot.end}`),
    ),
    markButtons(c, { onChange }),
    note ? h('p', { class: `attendance-note small${note.level === 'below' ? ' weak-text' : ' muted'}` }, note.text) : null,
  );
}

function dayLabel(date) {
  const today = todayYMD();
  const rel = relativeDays(today, date);
  return rel === 'Today' || rel === 'Yesterday' ? rel : formatDate(date);
}

// ---------- Today ----------

/** Today's classes with one-tap marks, or null on a day without classes. */
export function classesTodayCard(today) {
  const classes = classesOn(state.slots, today);
  const earlier = unmarkedClasses({ slots: state.slots, records: state.attendance, semester: state.semester, today, nowMin: nowMinutes() }).filter(
    (c) => c.date !== today,
  );
  const earlierLink = earlier.length
    ? h('a', { href: '#/attendance', class: 'btn btn-quiet' }, `${earlier.length} earlier class${earlier.length === 1 ? '' : 'es'} to mark`)
    : null;
  if (!classes.length) return earlierLink ? h('p', { class: 'calm-note small' }, earlierLink) : null;

  // A heads-up under a subject's first class when it's close to or below its minimum.
  const noted = new Set();
  const rows = classes.map((c) => {
    let note = null;
    if (!noted.has(c.slot.subjectId)) {
      noted.add(c.slot.subjectId);
      const st = statusOf(subjectById(c.slot.subjectId));
      if (st.level === 'close' || st.level === 'below') note = st;
    }
    return classRow(c, { note });
  });

  const allCancelled = classes.every((c) => recordFor(c.key)?.status === 'cancelled');
  const noClasses = allCancelled
    ? null
    : h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => cancelAll(classes) }, 'No classes today');

  return h(
    'section',
    { class: 'card classes-card' },
    h('h2', { class: 'card-title' }, 'Classes today'),
    h('ul', { class: 'class-list' }, rows),
    noClasses || earlierLink ? h('div', { class: 'classes-foot' }, noClasses, earlierLink) : null,
  );
}

async function cancelAll(classes) {
  const undo = await saveAttendanceMany(
    classes.map((c) =>
      makeAttendance({ semesterId: state.semester.id, subjectId: c.slot.subjectId, slotId: c.slot.id, date: c.date, status: 'cancelled' }),
    ),
  );
  await reload();
  rerender();
  toast('Marked as no classes. That time is free for study now.', {
    actionLabel: 'Undo',
    onAction: async () => {
      await undoAttendance(undo);
      await reload();
      rerender();
    },
  });
}

// ---------- Timetable ----------

/** A small card at the top of Timetable that leads to Attendance. */
export function attendanceSummaryCard() {
  const tracked = trackedSubjects();
  if (!tracked.length) return null;
  const needLook = tracked.filter((t) => t.status.level === 'below' || t.status.level === 'close').length;
  const anyHeld = tracked.some((t) => t.status.level !== 'none');
  const min = withSemesterDefaults(state.semester).attendanceMin;
  const line = needLook
    ? `${needLook} subject${needLook === 1 ? '' : 's'} could use a look`
    : anyHeld
      ? `All at ${min}% or above`
      : 'Mark your classes to see your attendance';
  return h(
    'a',
    { href: '#/attendance', class: 'card card-link attendance-summary' },
    icon('check', 22),
    h('span', { class: 'card-main' }, h('span', { class: 'card-heading' }, 'Attendance'), h('span', { class: 'muted small' }, line)),
    icon('chevron', 18),
  );
}

// ---------- The Attendance screen ----------

export function renderAttendance() {
  const semester = withSemesterDefaults(state.semester);
  const today = todayYMD();
  const editMin = h(
    'button',
    { type: 'button', class: 'btn btn-quiet', onclick: openMinimumSheet },
    `Minimum ${semester.attendanceMin}%`,
  );
  const top = topbar('Attendance', { back: '#/timetable', action: editMin });

  if (!state.slots.some((s) => s.subjectId)) {
    return {
      title: 'Attendance',
      top,
      body: emptyState(
        'Add your classes first',
        'Attendance follows your timetable: add each subject’s classes, then mark them here or on Today with one tap.',
        h('a', { href: '#/timetable', class: 'btn btn-primary' }, 'Go to timetable'),
      ),
    };
  }

  const body = [];
  const todo = unmarkedClasses({ slots: state.slots, records: state.attendance, semester, today, nowMin: nowMinutes() });
  if (todo.length) {
    const byDate = new Map();
    for (const c of todo) {
      if (!byDate.has(c.date)) byDate.set(c.date, []);
      byDate.get(c.date).push(c);
    }
    body.push(
      h(
        'section',
        { class: 'group' },
        h('h2', { class: 'group-title' }, 'To mark'),
        [...byDate].map(([date, list]) =>
          h('div', { class: 'card classes-card' }, h('h3', { class: 'card-title' }, dayLabel(date)), h('ul', { class: 'class-list' }, list.map((c) => classRow(c)))),
        ),
      ),
    );
  }

  body.push(
    h(
      'section',
      { class: 'group' },
      h('h2', { class: 'group-title' }, 'Subjects'),
      h(
        'ul',
        { class: 'cards' },
        trackedSubjects().map(({ subject, status }) => h('li', {}, subjectCard(subject, status))),
      ),
    ),
    h('p', { class: 'calm-note small' }, 'Only the classes you mark count, and cancelled classes don’t count at all.'),
  );

  return { title: 'Attendance', top, body };
}

function subjectCard(subject, st) {
  const pct = st.pct ?? 0;
  return h(
    'button',
    {
      type: 'button',
      class: `card card-link attendance-card level-${st.level}`,
      style: { '--subject': subject.color },
      onclick: () => openSubjectSheet(subject),
    },
    h(
      'span',
      { class: 'card-main' },
      h(
        'span',
        { class: 'attendance-head' },
        h('span', { class: 'card-heading' }, subject.name),
        h('span', { class: 'attendance-pct' }, st.pct === null ? '–' : `${st.pct}%`),
      ),
      h(
        'span',
        {
          class: 'meter attendance-meter',
          role: 'img',
          'aria-label': st.pct === null ? 'No classes marked yet' : `${st.pct}% attended, minimum ${st.min}%`,
          style: { '--min': `${st.min}%` },
        },
        h('span', { class: 'meter-fill', style: { width: `${pct}%` } }),
      ),
      h('span', { class: 'muted small' }, st.held ? `Attended ${st.attended} of ${st.held}` : 'No classes marked yet'),
      h('span', { class: `small${st.level === 'below' ? ' weak-text' : ' muted'}` }, st.text),
    ),
  );
}

function numberInput(name, value) {
  return h('input', { type: 'number', name, value: String(value), min: 0, max: ATTENDANCE_LIMITS.startMax, step: 1, inputmode: 'numeric', class: 'input' });
}

/** A subject's own minimum, its counts from before Ascend, and its recent marks. */
function openSubjectSheet(subject) {
  const s = withSubjectDefaults(subject);
  const semMin = withSemesterDefaults(state.semester).attendanceMin;
  const own = s.attendanceMin !== null && s.attendanceMin !== undefined;
  const minStepper = stepper('attendanceMin', own ? s.attendanceMin : semMin, {
    min: ATTENDANCE_LIMITS.minMin,
    max: ATTENDANCE_LIMITS.minMax,
    step: 5,
    format: (n) => `${n}%`,
    label: 'minimum',
  });
  const ownWrap = h('div', { hidden: !own }, minStepper);
  const which = chips(
    'minMode',
    [
      { value: 'semester', label: `Semester (${semMin}%)` },
      { value: 'own', label: 'Its own' },
    ],
    own ? 'own' : 'semester',
    { label: 'Minimum for this subject' },
  );
  which.addEventListener('change', (e) => (ownWrap.hidden = e.target.value !== 'own'));

  const recent = state.attendance
    .filter((r) => r.subjectId === s.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)
    .map((r) => {
      const slot = state.slots.find((x) => x.id === r.slotId);
      return slot ? { slot, date: r.date, key: attendanceKey(slot.id, r.date) } : null;
    })
    .filter(Boolean);

  openSheet({
    title: s.name,
    body: h(
      'div',
      {},
      h('div', { class: 'field', 'data-field': 'attendanceMin' }, h('span', { class: 'field-label' }, 'Minimum attendance'), which, ownWrap, h('p', { class: 'field-msg' })),
      h('span', { class: 'field-label sheet-subhead' }, 'Before you started marking in Ascend'),
      h('div', { class: 'row-2' }, field('startAttended', 'Attended', numberInput('startAttended', s.startAttended)), field('startHeld', 'Classes held', numberInput('startHeld', s.startHeld))),
      h('p', { class: 'field-hint form-hint' }, 'Starting mid-semester? Add what you had so far, e.g. 15 of 20.'),
      recent.length
        ? h(
            'div',
            { class: 'field' },
            h('span', { class: 'field-label' }, 'Recent classes'),
            h('ul', { class: 'class-list' }, recent.map((c) => classRow(c, { showDate: true, onChange: rerender }))),
          )
        : null,
    ),
    onSubmit: async (form) => {
      const fd = new FormData(form);
      const next = {
        ...s,
        attendanceMin: fd.get('minMode') === 'own' ? Number(fd.get('attendanceMin')) : null,
        startAttended: Number(fd.get('startAttended')),
        startHeld: Number(fd.get('startHeld')),
      };
      const counts = validateStartCounts(next);
      const min = next.attendanceMin === null ? { errors: {} } : validateAttendanceMin(next.attendanceMin);
      const v = { errors: { ...counts.errors, ...min.errors } };
      showMessages(form, v);
      if (Object.keys(v.errors).length) return false;
      await saveSubject(next);
      await reload();
      rerender();
      toast(`${s.name} saved`);
    },
  });
}

/** The semester's minimum, straight from the Attendance screen (also in the semester settings). */
function openMinimumSheet() {
  const semester = withSemesterDefaults(state.semester);
  openSheet({
    title: 'Minimum attendance',
    body: h(
      'div',
      {},
      field(
        'attendanceMin',
        'Your college’s minimum',
        stepper('attendanceMin', semester.attendanceMin, {
          min: ATTENDANCE_LIMITS.minMin,
          max: ATTENDANCE_LIMITS.minMax,
          step: 5,
          format: (n) => `${n}%`,
          label: 'minimum',
        }),
        { hint: 'Often 75%. A subject can have its own minimum: tap it in the list.' },
      ),
    ),
    onSubmit: async (form) => {
      const attendanceMin = Number(new FormData(form).get('attendanceMin'));
      const v = validateAttendanceMin(attendanceMin);
      showMessages(form, v);
      if (!v.ok) return false;
      await saveSemester({ ...state.semester, attendanceMin });
      await reload();
      rerender();
    },
  });
}
