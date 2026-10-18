// Semester screen: first-run welcome, overview with setup checklist, and the semester form.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, textInput, dateInput, timeInput, stepper, chips, showMessages } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { state, reload } from '../state.js';
import { saveSemester } from '../db/repo.js';
import { makeSemester, withSemesterDefaults } from '../model/factory.js';
import { validateSemester, validateAttendanceMin, ATTENDANCE_LIMITS } from '../model/validate.js';
import { STREAK } from '../model/streak.js';
import { semesterTotals, setupProgress } from '../model/summary.js';
import { formatMinutes, formatDate, daysBetween, todayYMD, addDays } from '../model/time.js';
import { navigate, rerender } from '../router.js';
import { installCard } from '../ui/install.js';
import { backupCard, restoreBackup } from '../ui/backup.js';

const STEP_ROUTES = {
  semester: 'semester',
  subjects: 'subjects',
  topics: 'subjects',
  deadlines: 'deadlines',
  timetable: 'timetable',
};

export function renderSemester() {
  if (!state.semester) return renderWelcome();

  const s = state.semester;
  const settings = withSemesterDefaults(s);
  const totals = semesterTotals(state);
  const progress = setupProgress(state);
  const today = todayYMD();
  const totalDays = daysBetween(s.startDate, s.endDate);
  const weeks = Math.round(totalDays / 7);
  const left = daysBetween(today, s.endDate);

  const editBtn = h(
    'button',
    { type: 'button', class: 'btn btn-quiet', onclick: () => openSemesterSheet(s) },
    icon('edit', 18),
    'Edit',
  );

  const checklist = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title' }, progress.next ? 'Setting up' : 'All set up'),
    h(
      'p',
      { class: 'muted' },
      progress.next
        ? `${progress.doneCount} of ${progress.steps.length} done. Take it one step at a time.`
        : ['Your semester is ready. ', h('a', { href: '#/today' }, 'See today’s plan'), '.'],
    ),
    h(
      'ol',
      { class: 'checklist' },
      progress.steps.map((step) =>
        h(
          'li',
          { class: step.done ? 'done' : step === progress.next ? 'next' : '' },
          h('span', { class: 'check' }, step.done ? icon('check', 16) : null),
          h('a', { href: `#/${STEP_ROUTES[step.key]}` }, step.label),
        ),
      ),
    ),
  );

  const stats = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title' }, 'At a glance'),
    h(
      'dl',
      { class: 'stats' },
      stat('Subjects', totals.subjects),
      stat('Credits', totals.credits),
      stat('Topics', totals.topics),
      stat('Study time', formatMinutes(totals.estMin)),
      stat('Deadlines', totals.deadlines),
      stat('Classes / week', totals.slots),
    ),
  );

  const dates = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title' }, 'Dates'),
    h('p', {}, `${formatDate(s.startDate)} → ${formatDate(s.endDate)}`),
    h(
      'p',
      { class: 'muted' },
      `About ${weeks} week${weeks === 1 ? '' : 's'} long. `,
      left > 0 ? `${left} days to go.` : left === 0 ? 'Last day today.' : 'This semester has ended.',
    ),
    h('p', { class: 'muted' }, `Daily study limit: ${formatMinutes(s.dailyLimitMin)}`),
    h('p', { class: 'muted' }, `Study between ${settings.studyFrom} and ${settings.studyTo} · ${bufferLabel(settings.bufferDays)} before exams`),
    h('p', { class: 'muted' }, `A streak day needs ${formatMinutes(settings.streakMinMin)} of study`),
    h('p', { class: 'muted' }, `Minimum attendance: ${settings.attendanceMin}%`),
  );

  return {
    title: 'Semester',
    top: topbar(s.name, { back: '#/progress', action: editBtn, subtitle: 'Your semester' }),
    body: [checklist, dates, stats, backupCard(), installCard()].filter(Boolean),
  };
}

function bufferLabel(n) {
  return n === 0 ? 'no buffer days' : `${n} buffer day${n === 1 ? '' : 's'}`;
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, String(value)));
}

function renderWelcome() {
  const art = h('div', { class: 'welcome-art', 'aria-hidden': 'true' });
  art.innerHTML = `<svg viewBox="0 0 200 120" width="100%" height="100%">
    <circle cx="150" cy="38" r="12" fill="var(--sun)"/>
    <path d="M0 120 L60 52 L100 96 L130 66 L200 120 Z" fill="var(--hill-far)"/>
    <path d="M20 120 L95 28 L170 120 Z" fill="var(--accent)"/>
    <path d="M95 28 L83 43 L107 43 Z" fill="var(--snow)"/>
    <path d="M40 120 C70 100, 80 80, 95 60" stroke="var(--snow)" stroke-width="2" stroke-dasharray="3 5" fill="none" stroke-linecap="round"/>
  </svg>`;
  return {
    title: 'Welcome',
    top: null,
    hideNav: true,
    body: h(
      'section',
      { class: 'welcome' },
      art,
      h('h1', {}, 'Welcome to Ascend'),
      h(
        'p',
        { class: 'muted' },
        'A calm study planner for your semester. Add your subjects, deadlines and classes, and Ascend will help you climb, one day at a time.',
      ),
      h('p', { class: 'muted small' }, 'Everything stays on this device.'),
      h(
        'button',
        { type: 'button', class: 'btn btn-primary btn-wide', onclick: () => openSemesterSheet(null) },
        'Let’s set up your semester',
      ),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: restoreBackup }, 'Restore from a backup'),
    ),
  };
}

function defaultDates() {
  const start = todayYMD();
  return { startDate: start, endDate: addDays(start, 120) };
}

export function openSemesterSheet(existing) {
  const s = existing ? withSemesterDefaults(existing) : makeSemester({ name: '', ...defaultDates() });
  const limitStepper = stepper('dailyLimitMin', s.dailyLimitMin, {
    min: 15,
    max: 16 * 60,
    step: 15,
    format: formatMinutes,
    label: 'daily study time',
  });
  const body = h(
    'div',
    {},
    field('name', 'Semester name', textInput('name', s.name, { placeholder: 'e.g. Semester 3, Autumn 2026', maxlength: 80 })),
    h(
      'div',
      { class: 'row-2' },
      field('startDate', 'First day', dateInput('startDate', s.startDate)),
      field('endDate', 'Last day', dateInput('endDate', s.endDate)),
    ),
    field('dailyLimitMin', 'Daily study limit', limitStepper, {
      hint: 'The most study time Ascend will plan for one day. You can change it any time.',
    }),
    h(
      'div',
      { class: 'row-2' },
      field('studyFrom', 'Study from', timeInput('studyFrom', s.studyFrom)),
      field('studyTo', 'Study until', timeInput('studyTo', s.studyTo)),
    ),
    h('p', { class: 'field-hint form-hint' }, 'Ascend only plans in this window, around your classes.'),
    field(
      'bufferDays',
      'Buffer days before exams',
      stepper('bufferDays', s.bufferDays, {
        min: 0,
        max: 7,
        format: (n) => (n === 0 ? 'None' : `${n} day${n === 1 ? '' : 's'}`),
        label: 'buffer days',
      }),
      { hint: 'Days kept free before mid-sems and end-sems, for review. Used for new topics only if you fall behind.' },
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'A streak day needs'),
      chips(
        'streakMinMin',
        STREAK.minChoices.map((m) => ({ value: m, label: formatMinutes(m) })),
        STREAK.minChoices.includes(s.streakMinMin) ? s.streakMinMin : STREAK.defaultMinMin,
        { label: 'Study a streak day needs' },
      ),
      h('p', { class: 'field-hint' }, `Study at least this much in a day to keep your streak going. You get ${STREAK.tokensPerMonth} rest tokens a month for days off.`),
    ),
    field(
      'attendanceMin',
      'Minimum attendance',
      stepper('attendanceMin', s.attendanceMin, {
        min: ATTENDANCE_LIMITS.minMin,
        max: ATTENDANCE_LIMITS.minMax,
        step: 5,
        format: (n) => `${n}%`,
        label: 'minimum attendance',
      }),
      { hint: 'Your college’s rule, often 75%. Ascend gives you a gentle heads-up before a subject gets close.' },
    ),
  );

  openSheet({
    title: existing ? 'Edit semester' : 'Your semester',
    body,
    submitLabel: existing ? 'Save' : 'Save and continue',
    onSubmit: async (form) => {
      const fd = new FormData(form);
      const next = {
        ...s,
        name: String(fd.get('name') ?? '').trim(),
        startDate: String(fd.get('startDate') ?? ''),
        endDate: String(fd.get('endDate') ?? ''),
        dailyLimitMin: Number(fd.get('dailyLimitMin')),
        studyFrom: String(fd.get('studyFrom') ?? ''),
        studyTo: String(fd.get('studyTo') ?? ''),
        bufferDays: Number(fd.get('bufferDays')),
        streakMinMin: Number(fd.get('streakMinMin')) || STREAK.defaultMinMin,
        attendanceMin: Number(fd.get('attendanceMin')),
      };
      const v = validateSemester(next);
      Object.assign(v.errors, validateAttendanceMin(next.attendanceMin).errors);
      v.ok = Object.keys(v.errors).length === 0;
      showMessages(form, v);
      if (!v.ok) return false;
      await saveSemester(next);
      await reload();
      if (existing) {
        toast('Semester saved');
        rerender();
        return;
      }
      toast('Great start. Now add your subjects.');
      return () => navigate('subjects');
    },
  });
}
