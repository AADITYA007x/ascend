// Today: the day's study plan, built fresh from the semester on every render.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { emptyState } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { state, reload, subjectById } from '../state.js';
import { saveSemester, setMeta } from '../db/repo.js';
import { withSemesterDefaults, RATING_LABELS } from '../model/factory.js';
import { buildPlan } from '../model/planner.js';
import { timerView, formatClock } from '../model/timer.js';
import { REVIEWS } from '../model/revision.js';
import { minutesStudiedOn } from '../model/progress.js';
import { DEADLINE_LABELS } from '../model/validate.js';
import { formatDate, formatMinutes, relativeDays, todayYMD, daysBetween, addDays } from '../model/time.js';
import { rerender } from '../router.js';
import { openStartSheet } from './session-sheets.js';
import { trackFor, statusSentence, storyFor } from './progress.js';
import { headline } from '../model/track.js';
import { weekStart } from '../model/story.js';
import { skyModel } from '../model/sky.js';
import { skyBand } from '../ui/scene.js';
import { planningTopics } from '../model/estimate.js';
import { streakModel, streakLine, streakNudge, restTokenNote } from '../model/streak.js';
import { resolveSummit, summitReached, isSummitItem } from '../model/summit.js';
import { classesTodayCard } from './attendance.js';
import { installCard } from '../ui/install.js';
import { roomsEnabled } from '../net/room-client.js';
import { focusingCount } from '../model/room.js';

// Today offers installing once, after a few study sessions, until you say "Not now".
const INSTALL_AFTER_SESSIONS = 3;

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
  const sky = skyModel({ ...state, semester, today });
  if (sky.text) body.push(skyBand(sky));
  const streak = streakModel({ sessions: state.sessions, semester, today });
  if (streak.days.length) body.push(streakRow(streak));
  const running = timerCard();
  if (running) body.push(running);
  const room = roomCard();
  if (room) body.push(room);
  const story = weekStoryCard(today, semester);
  if (story) body.push(story);
  if (!state.installDismissed && state.sessions.length >= INSTALL_AFTER_SESSIONS) {
    const install = installCard({ onDismiss: dismissInstall });
    if (install) body.push(install);
  }

  if (daysBetween(today, semester.startDate) > 0) {
    body.push(h('p', { class: 'calm-note' }, `Your semester starts ${relativeDays(today, semester.startDate).toLowerCase()}. Here’s how it begins.`));
  } else if (daysBetween(semester.endDate, today) > 0) {
    body.push(emptyState('This semester has ended', 'Well climbed. You can look back at it any time, or set up the next one.'));
    return { title: 'Today', top: topbar('Today', { subtitle: formatDate(today) }), body };
  }

  const studied = minutesStudiedOn(state.sessions, today);
  const isOff = semester.offDays.includes(today);

  const classes = classesTodayCard(today);
  if (classes) body.push(classes);

  const summit = todaySummit(day, today);
  if (day) {
    body.push(...todayBlocks(day, { plan, semester, today, studied, isOff, summit }));
  }
  const doneList = doneToday(today, summit);
  if (doneList) body.push(doneList);

  const note = trackNote(plan, today);
  if (note) body.push(note);
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
    body.push(h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => takeDayOff(today, streak) }, 'Take today off'));
  }
  if (roomsEnabled() && !state.room) {
    body.push(h('a', { href: '#/room', class: 'btn btn-quiet' }, 'Study with friends'));
  }

  return {
    title: 'Today',
    top: topbar('Today', { subtitle: `${formatDate(today)} · ${PHASE_LABELS[plan.phase]}` }),
    body,
  };
}

/** The summary card and today's blocks, or a calm note when there's nothing to do. */
function todayBlocks(day, { plan, semester, today, studied, isOff, summit }) {
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

  const reached = summit && summitReached(summit, state.sessions, today);
  if (reached) out.push(summitNote(summit));

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
  const reviews = day.items.filter((it) => it.kind === 'review').length;
  out.push(
    h(
      'section',
      { class: 'card plan-summary' },
      h('p', { class: 'plan-total' }, `${formatMinutes(total)} planned`),
      h(
        'p',
        { class: 'muted small' },
        `${day.items.length} block${day.items.length === 1 ? '' : 's'}`,
        reviews ? ` · ${reviews} review${reviews === 1 ? '' : 's'}` : '',
        studied ? ` · ${formatMinutes(studied)} done already` : '',
        ' · tap a block to start',
      ),
    ),
  );
  out.push(h('ul', { class: 'cards' }, day.items.map((item) => h('li', {}, blockCard(item, today, isSummitItem(summit, item))))));
  return out;
}

function blockCard(item, today, isSummit = false) {
  const topic = state.topics.find((t) => t.id === item.topicId);
  const subject = subjectById(item.subjectId);
  const partLabel = item.parts > 1 ? ` (${item.part}/${item.parts})` : '';
  const isReview = item.kind === 'review';
  return h(
    'button',
    {
      type: 'button',
      class: `card card-link plan-block${isReview ? ' review-block' : ''}${isSummit ? ' summit-block' : ''}`,
      style: { '--subject': subject?.color ?? 'var(--accent)' },
      onclick: () => openStartSheet(item),
    },
    h('span', { class: 'subject-dot', 'aria-hidden': 'true' }),
    h(
      'span',
      { class: 'card-main' },
      h(
        'span',
        { class: 'card-heading' },
        isSummit ? h('span', { class: 'summit-tag' }, icon('flag', 13), 'Summit') : null,
        isReview ? h('span', { class: 'review-tag' }, 'Review') : null,
        topic?.name ?? 'Topic',
        partLabel,
      ),
      h('span', { class: 'muted small' }, `${subject?.name ?? ''} · ${isReview ? reviewReason(item) : reason(item, today)}`),
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

/** "Worth another look" for weak topics, "Before the mid-sem" on buffer days, else "Review 2 of 4". */
function reviewReason(item) {
  if (item.weak) return 'Worth another look';
  const d = item.forExam && state.deadlines.find((x) => x.id === item.forExam);
  if (d) return `Before the ${DEADLINE_LABELS[d.type].toLowerCase()}`;
  return item.review ? `Review ${item.review} of ${REVIEWS}` : 'A look back';
}

function doneToday(today, summit) {
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
            h(
              'span',
              { class: 'card-heading' },
              summitReached(summit, [s], today) ? h('span', { class: 'summit-tag' }, icon('flag', 13), 'Summit') : null,
              topic?.name ?? 'Topic',
            ),
            h(
              'span',
              { class: 'muted small' },
              [
                s.kind === 'revision' ? 'review' : null,
                formatMinutes(s.minutes),
                s.kind === 'revision' ? null : s.finished ? 'finished' : 'more to go',
                RATING_LABELS[s.rating]?.toLowerCase(),
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          ),
        );
      }),
    ),
  );
}

/** One calm line when a coming deadline is tight or needs more time (details on Progress). */
function trackNote(plan, today) {
  const worst = headline(trackFor(plan, today));
  if (!worst) return null;
  return h('p', { class: 'calm-note small' }, statusSentence(worst), ' ', h('a', { href: '#/progress' }, 'See progress'));
}

/** Last week's story, on the first open of a new week, until you dismiss it. */
function weekStoryCard(today, semester) {
  const lastWeek = addDays(weekStart(today), -7);
  if (state.storySeen === lastWeek) return null;
  if (addDays(lastWeek, 6) < semester.startDate) return null; // the semester hadn't started yet
  const dismiss = async () => {
    await setMeta('storySeen', lastWeek);
    state.storySeen = lastWeek;
    rerender();
  };
  return h(
    'section',
    { class: 'card story-card story-today' },
    h('h2', { class: 'card-title' }, 'Your week'),
    h('div', { class: 'story' }, storyFor(lastWeek, today, true).map((line) => h('p', {}, line))),
    h(
      'div',
      { class: 'story-actions' },
      h('a', { href: '#/progress', class: 'btn btn-quiet' }, 'Read more'),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: dismiss }, 'Got it'),
    ),
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

/** "Focus in progress" card with a live countdown, while a timer runs. */
function timerCard() {
  const t = state.timer;
  if (!t) return null;
  const topic = state.topics.find((x) => x.id === t.topicId);
  const subject = subjectById(t.subjectId);
  const line = h('span', { class: 'muted small' });
  const card = h(
    'a',
    { href: '#/focus', class: 'card card-link running-card', style: { '--subject': subject?.color ?? 'var(--accent)' } },
    icon('clock', 22),
    h('span', { class: 'card-main' }, h('span', { class: 'card-heading' }, topic?.name ?? 'Focus session'), line),
    h('span', { class: 'pill' }, 'Return'),
  );
  const update = () => {
    if (!state.timer) return;
    const v = timerView(state.timer, Date.now());
    const phase = v.phase === 'focus' ? 'Focus' : 'Break';
    line.textContent =
      v.status === 'ended'
        ? `${phase} time is up`
        : v.status === 'paused'
          ? `${phase} paused · ${formatClock(v.remainingMs)} left`
          : `${phase} · ${formatClock(v.remainingMs)} left`;
  };
  update();
  const interval = setInterval(() => (card.isConnected ? update() : clearInterval(interval)), 1000);
  return card;
}

/** Today's summit: kept once chosen; picked (and saved) on the first render of the day. */
function todaySummit(day, today) {
  const items = day?.date === today ? day.items : [];
  const { summit, changed } = resolveSummit({ stored: state.summit, items, topics: planningTopics(state.topics, state.sessions), today });
  if (changed) {
    state.summit = summit;
    setMeta('summit', summit).catch(() => {}); // only a convenience: it is picked again if this fails
  }
  return summit;
}

/** "Summit reached", once today's hardest topic is done. Links to the climb. */
function summitNote(summit) {
  const topic = state.topics.find((t) => t.id === summit.topicId);
  return h(
    'a',
    { href: '#/progress', class: 'summit-note' },
    icon('flag', 18),
    h(
      'span',
      { class: 'card-main' },
      h('span', { class: 'summit-note-title' }, 'Summit reached'),
      h('span', { class: 'muted small' }, `${topic?.name ?? 'Topic'} · the hardest climb of the day is done`),
    ),
  );
}

/** The streak, gently: "6-day streak · 2 rest tokens left", with the tokens as leaves. Links to Progress. */
function streakRow(m) {
  const nudge = streakNudge(m);
  const leaves = Array.from({ length: m.tokensPerMonth }, (_, i) =>
    h('span', { class: `token${i < m.tokensLeft ? '' : ' used'}` }, icon('leaf', 16)),
  );
  return h(
    'a',
    { href: '#/progress', class: `streak-row${m.todayDone ? ' done' : ''}` },
    h('span', { class: 'streak-icon' }, icon('peak', 20)),
    h('span', { class: 'card-main' }, h('span', { class: 'streak-line' }, streakLine(m)), nudge ? h('span', { class: 'muted small' }, nudge) : null),
    h('span', { class: 'tokens', 'aria-hidden': 'true' }, leaves),
  );
}

function takeDayOff(today, streak) {
  const note = restTokenNote(streak);
  openSheet({
    title: 'Take today off?',
    body: h(
      'div',
      {},
      h('p', { class: 'confirm-text' }, 'Today’s study moves to the coming days. Rest is part of the climb.'),
      note ? h('p', { class: 'muted rest-token-note' }, icon('leaf', 16), note) : null,
    ),
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

async function dismissInstall() {
  await setMeta('installDismissed', true);
  state.installDismissed = true;
  rerender();
  toast('No problem. You can install Ascend any time from Progress.');
}

/** While you're in a focus room: who's there, one tap from the room. */
function roomCard() {
  const room = state.room;
  if (!room || room.status === 'full') return null;
  const others = room.members.filter((m) => m.id !== room.selfId).length;
  const focusing = focusingCount(room.members, room.selfId);
  const line =
    room.status !== 'live'
      ? 'Reconnecting…'
      : others === 0
        ? 'Just you so far'
        : focusing
          ? `${focusing} focusing now`
          : `${others} friend${others === 1 ? '' : 's'} here`;
  return h(
    'a',
    { href: '#/room', class: 'card card-link room-card' },
    h('span', { class: 'room-card-icon', 'aria-hidden': 'true' }, '👥'),
    h('span', { class: 'card-main' }, h('span', { class: 'card-heading' }, `Room ${room.code.slice(0, 3)} ${room.code.slice(3)}`), h('span', { class: 'muted small' }, line)),
    icon('chevron', 18),
  );
}
