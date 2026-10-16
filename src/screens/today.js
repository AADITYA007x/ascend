// Today: the day's study plan, built fresh from the semester on every render.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, stepper, chips, emptyState } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { state, reload, subjectById } from '../state.js';
import { saveSession, deleteSession, saveSemester } from '../db/repo.js';
import { makeSession, withSemesterDefaults } from '../model/factory.js';
import { buildPlan } from '../model/planner.js';
import { minutesStudiedOn } from '../model/progress.js';
import { DEADLINE_LABELS } from '../model/validate.js';
import { formatDate, formatMinutes, relativeDays, todayYMD, daysBetween } from '../model/time.js';
import { rerender } from '../router.js';

const PHASE_LABELS = { keepup: 'Keeping up', exam: 'Exam mode' };

export function renderToday() {
  const today = todayYMD();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const semester = withSemesterDefaults(state.semester);

  if (!state.topics.length) {
    return {
      title: 'Today',
      top: topbar('Today', { subtitle: formatDate(today) }),
      body: emptyState(
        'Add topics to get your plan',
        'Ascend plans your days from the topics in each subject. Add a few to begin.',
        h('a', { href: '#/subjects', class: 'btn btn-primary' }, 'Go to subjects'),
      ),
    };
  }

  const plan = buildPlan({ ...state, semester, today, nowMin });
  const day = plan.days[0]?.date === today ? plan.days[0] : null;
  const body = [];

  if (daysBetween(today, semester.startDate) > 0) {
    body.push(h('p', { class: 'calm-note' }, `Your semester starts ${relativeDays(today, semester.startDate).toLowerCase()}. Here’s how it begins.`));
  } else if (daysBetween(semester.endDate, today) > 0) {
    body.push(emptyState('This semester has ended', 'Well climbed. You can look back at it any time, or set up the next one.'));
    return { title: 'Today', top: topbar('Today', { subtitle: formatDate(today) }), body };
  }

  const studied = minutesStudiedOn(state.sessions, today);
  const isOff = semester.offDays.includes(today);

  if (day) {
    body.push(...todayBlocks(day, { plan, semester, today, studied, isOff }));
  }
  const doneList = doneToday(today);
  if (doneList) body.push(doneList);

  const risk = riskNote(plan, today);
  if (risk) body.push(risk);
  if (!state.slots.length) {
    body.push(
      h(
        'p',
        { class: 'calm-note small' },
        'Tip: add your ',
        h('a', { href: '#/timetable' }, 'class timetable'),
        ' so Ascend plans around your classes.',
      ),
    );
  }

  const ahead = plan.days.filter((d) => d.date > today).slice(0, day ? 7 : 8);
  if (ahead.length) body.push(weekAhead(ahead, today, Boolean(day)));

  if (day && !isOff && day.items.length) {
    body.push(h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => takeDayOff(today) }, 'Take today off'));
  }

  return {
    title: 'Today',
    top: topbar('Today', { subtitle: `${formatDate(today)} · ${PHASE_LABELS[plan.phase]}` }),
    body,
  };
}

/** The summary card and today's blocks, or a calm note when there's nothing to do. */
function todayBlocks(day, { plan, semester, today, studied, isOff }) {
  if (isOff) {
    return [
      h(
        'section',
        { class: 'card rest-card' },
        h('h2', { class: 'card-title' }, 'Rest day'),
        h('p', { class: 'muted' }, 'Today’s study has moved to the coming days. Rest is part of the climb.'),
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => undoDayOff(today) }, 'Plan today after all'),
      ),
    ];
  }

  const out = [];
  if (day.buffer) {
    const d = state.deadlines.find((x) => x.id === day.bufferFor);
    const subject = d && subjectById(d.subjectId);
    out.push(
      h(
        'section',
        { class: 'card rest-card' },
        h('h2', { class: 'card-title' }, 'Buffer day'),
        h(
          'p',
          { class: 'muted' },
          d ? `Before the ${subject?.name ?? ''} ${DEADLINE_LABELS[d.type].toLowerCase()} (${relativeDays(today, d.date).toLowerCase()}). ` : '',
          'A good day to look back over what you’ve covered.',
        ),
      ),
    );
  }

  if (!day.items.length) {
    const allDone = plan.unscheduled.length === 0 && plan.days.every((d) => d.items.length === 0);
    if (allDone) {
      out.push(emptyState('Every topic is covered', 'Wonderful work. Add new topics whenever they come up.'));
    } else if (!day.buffer) {
      const text =
        studied > 0 && studied >= semester.dailyLimitMin
          ? 'You’ve reached today’s study time. Rest well.'
          : day.capacity === 0
            ? 'No free study time left today. Rest well.'
            : 'Nothing planned for today. Enjoy the breather.';
      out.push(h('section', { class: 'card rest-card' }, h('p', {}, text)));
    }
    return out;
  }

  const total = day.items.reduce((s, it) => s + it.minutes, 0);
  out.push(
    h(
      'section',
      { class: 'card plan-summary' },
      h('p', { class: 'plan-total' }, `${formatMinutes(total)} planned`),
      h(
        'p',
        { class: 'muted small' },
        `${day.items.length} block${day.items.length === 1 ? '' : 's'}`,
        studied ? ` · ${formatMinutes(studied)} done already` : '',
        ' · tap a block when you’ve studied it',
      ),
    ),
  );
  out.push(h('ul', { class: 'cards' }, day.items.map((item) => h('li', {}, blockCard(item, today)))));
  return out;
}

function blockCard(item, today) {
  const topic = state.topics.find((t) => t.id === item.topicId);
  const subject = subjectById(item.subjectId);
  const partLabel = item.parts > 1 ? ` (${item.part}/${item.parts})` : '';
  return h(
    'button',
    {
      type: 'button',
      class: 'card card-link plan-block',
      style: { '--subject': subject?.color ?? 'var(--accent)' },
      onclick: () => openLogSheet(item, topic),
    },
    h('span', { class: 'subject-dot', 'aria-hidden': 'true' }),
    h(
      'span',
      { class: 'card-main' },
      h('span', { class: 'card-heading' }, topic?.name ?? 'Topic', partLabel),
      h('span', { class: 'muted small' }, `${subject?.name ?? ''} · ${reason(item, today)}`),
    ),
    h('span', { class: 'pill' }, formatMinutes(item.minutes)),
  );
}

/** "Mid-sem in 9 days", or the unit name when no deadline is near. */
function reason(item, today) {
  const d = item.deadlineId && state.deadlines.find((x) => x.id === item.deadlineId);
  if (d) return `${DEADLINE_LABELS[d.type]} ${relativeDays(today, d.date).toLowerCase()}`;
  return state.units.find((u) => u.id === item.unitId)?.name ?? 'Keeping up';
}

function doneToday(today) {
  const sessions = state.sessions.filter((s) => s.date === today);
  if (!sessions.length) return null;
  return h(
    'section',
    { class: 'group' },
    h('h2', { class: 'group-title' }, 'Done today'),
    h(
      'ul',
      { class: 'cards' },
      sessions.map((s) => {
        const topic = state.topics.find((t) => t.id === s.topicId);
        const subject = subjectById(s.subjectId);
        return h(
          'li',
          { class: 'card done-row', style: { '--subject': subject?.color ?? 'var(--accent)' } },
          h('span', { class: 'check' }, icon('check', 16)),
          h(
            'span',
            { class: 'card-main' },
            h('span', { class: 'card-heading' }, topic?.name ?? 'Topic'),
            h('span', { class: 'muted small' }, `${formatMinutes(s.minutes)} · ${s.finished ? 'finished' : 'more to go'}`),
          ),
        );
      }),
    ),
  );
}

/** One gentle line when an upcoming deadline's topics don't all fit before it. */
function riskNote(plan, today) {
  const d = plan.atRisk
    .map((id) => state.deadlines.find((x) => x.id === id))
    .filter((x) => x && daysBetween(today, x.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!d) return null;
  const subject = subjectById(d.subjectId);
  return h(
    'p',
    { class: 'calm-note small' },
    `Some ${subject?.name ?? ''} topics don’t quite fit before the ${DEADLINE_LABELS[d.type].toLowerCase()}. `,
    h('a', { href: '#/semester' }, 'A little more daily study time'),
    ' would help.',
  );
}

function weekAhead(days, today, startedToday) {
  return h(
    'details',
    { class: 'group week-ahead' },
    h('summary', { class: 'group-title' }, startedToday ? 'Next 7 days' : 'Coming up'),
    h(
      'ul',
      { class: 'cards' },
      days.map((d) => {
        const total = d.items.reduce((s, it) => s + it.minutes, 0);
        const colors = [...new Set(d.items.map((it) => subjectById(it.subjectId)?.color ?? 'var(--accent)'))];
        const label = total ? formatMinutes(total) : d.buffer ? 'Buffer day' : 'Rest';
        return h(
          'li',
          { class: 'card week-row' },
          h('span', { class: 'week-date' }, daysBetween(today, d.date) === 1 ? 'Tomorrow' : formatDate(d.date)),
          h(
            'span',
            { class: 'week-dots', 'aria-hidden': 'true' },
            colors.map((c) => h('span', { class: 'subject-dot small-dot', style: { '--subject': c } })),
          ),
          h('span', { class: 'muted small' }, label),
        );
      }),
    ),
  );
}

function openLogSheet(item, topic) {
  const minutes = stepper('minutes', item.minutes, {
    min: 5,
    max: 600,
    step: 5,
    format: formatMinutes,
    label: 'study time',
  });
  const status = chips(
    'status',
    [
      { value: 'finished', label: 'Finished the topic' },
      { value: 'partial', label: 'More to go' },
    ],
    item.part === item.parts ? 'finished' : 'partial',
    { label: 'How far did you get?' },
  );
  openSheet({
    title: topic?.name ?? 'How did it go?',
    body: h(
      'div',
      {},
      field('minutes', 'Time studied', minutes),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How far did you get?'), status),
    ),
    submitLabel: 'Save',
    onSubmit: async (form) => {
      const fd = new FormData(form);
      const session = makeSession({
        semesterId: state.semester.id,
        subjectId: item.subjectId,
        topicId: item.topicId,
        date: todayYMD(),
        minutes: Number(fd.get('minutes')),
        finished: fd.get('status') === 'finished',
      });
      await saveSession(session);
      await reload();
      toast(session.finished ? 'Nice work. Your plan is updated.' : 'Saved. The rest is planned ahead.', {
        actionLabel: 'Undo',
        onAction: async () => {
          await deleteSession(session.id);
          await reload();
          rerender();
        },
      });
      rerender();
    },
  });
}

function takeDayOff(today) {
  openSheet({
    title: 'Take today off?',
    body: h('p', { class: 'confirm-text' }, 'Today’s study moves to the coming days. Rest is part of the climb.'),
    submitLabel: 'Take the day off',
    onSubmit: async () => {
      await setOffDay(today, true);
      toast('Enjoy your rest day.', { actionLabel: 'Undo', onAction: () => undoDayOff(today) });
      rerender();
    },
  });
}

async function undoDayOff(today) {
  await setOffDay(today, false);
  rerender();
}

async function setOffDay(date, off) {
  const s = withSemesterDefaults(state.semester);
  const others = s.offDays.filter((d) => d !== date);
  await saveSemester({ ...state.semester, offDays: off ? [...others, date] : others });
  await reload();
}
