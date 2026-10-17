// Progress: how the semester is going, whether each deadline is on track, and the weekly story.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { emptyState } from '../ui/fields.js';
import { state, subjectById } from '../state.js';
import { withSemesterDefaults } from '../model/factory.js';
import { buildPlan } from '../model/planner.js';
import { subjectProgress, overallProgress, dailyMinutes, deadlineCoverage } from '../model/stats.js';
import { recentPace, trackStatus, headline } from '../model/track.js';
import { weekStart, weekSummary, weekStory } from '../model/story.js';
import { climbModel } from '../model/climb.js';
import { skyModel } from '../model/sky.js';
import { climbScene } from '../ui/scene.js';
import { streakModel, streakLine } from '../model/streak.js';
import { summitReached } from '../model/summit.js';
import { DEADLINE_LABELS } from '../model/validate.js';
import { addDays, daysBetween, formatDate, formatMinutes, relativeDays, todayYMD, WEEKDAYS_SHORT, weekdayMon0 } from '../model/time.js';

export const STATUS_LABELS = { ontrack: 'On track', tight: 'A little tight', behind: 'Needs more time', done: 'Ready' };

const nowMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

/** Statuses for every coming deadline, from a plan built for today. */
export function trackFor(plan, today) {
  const semester = withSemesterDefaults(state.semester);
  const pace = recentPace({ semester, slots: state.slots, sessions: state.sessions, today });
  return trackStatus({ plan, deadlines: state.deadlines, topics: state.topics, sessions: state.sessions, semester, today, pace });
}

/** "The Maths mid-sem", or "Your semester plan" for work with no deadline. */
export function statusLabel(s) {
  if (!s.deadlineId) return 'Your semester plan';
  const d = state.deadlines.find((x) => x.id === s.deadlineId);
  if (!d) return 'A deadline';
  return `The ${subjectById(d.subjectId)?.name ?? ''} ${DEADLINE_LABELS[d.type].toLowerCase()}`.replace(/\s+/g, ' ');
}

/** "The Maths mid-sem is a little tight. About 20 more minutes a day would cover it." */
export function statusSentence(s) {
  const how = s.status === 'behind' ? 'could use a bit more time' : 'is a little tight';
  return `${statusLabel(s)} ${how}. ${statusAdvice(s)}`;
}

/** One helpful sentence for a tight or behind status, never a scolding one. */
export function statusAdvice(s) {
  if (s.extraPerDay) return `About ${s.extraPerDay} more minutes a day would cover it.`;
  if (s.slowPace) return 'It fits at your full daily time; your last two weeks were a bit lighter.';
  return 'A little more daily study time would help.';
}

const upcomingFor = (today) =>
  state.deadlines
    .filter((d) => daysBetween(today, d.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 1)
    .map((d) => ({ label: `${subjectById(d.subjectId)?.name ?? ''} ${DEADLINE_LABELS[d.type].toLowerCase()}`.trim(), days: daysBetween(today, d.date) }));

const storyNames = {
  topic: (id) => state.topics.find((t) => t.id === id)?.name ?? 'A topic',
  subjectOfTopic: (id) => state.topics.find((t) => t.id === id)?.subjectId,
  subject: (id) => subjectById(id)?.name ?? 'one subject',
};

/** The story of the week starting `from`. With `ahead`, it ends with what's coming up after `today`. */
export function storyFor(from, today, ahead = false) {
  const sessions = state.sessions;
  const summary = weekSummary({ sessions, from });
  const previous = weekSummary({ sessions, from: addDays(from, -7) });
  return weekStory(summary, previous, { names: storyNames, upcoming: ahead ? upcomingFor(today) : [] });
}

export function renderProgress() {
  const today = todayYMD();
  const semester = withSemesterDefaults(state.semester);
  const semBtn = h('a', { href: '#/semester', class: 'btn btn-quiet' }, icon('edit', 18), 'Semester');
  const top = topbar('Progress', { action: semBtn, subtitle: state.semester.name });

  if (!state.topics.length) {
    return {
      title: 'Progress',
      top,
      body: emptyState(
        'Your progress shows here',
        'Add topics to your subjects, and this page fills in as you study.',
        h('a', { href: '#/subjects', class: 'btn btn-primary' }, 'Go to subjects'),
      ),
    };
  }

  const plan = buildPlan({ ...state, semester, today, nowMin: nowMinutes() });
  const statuses = trackFor(plan, today);
  const perSubject = subjectProgress(state);
  const all = overallProgress(perSubject);

  return {
    title: 'Progress',
    top,
    body: [
      climbScene(climbModel({ ...state, semester, today }), skyModel({ ...state, semester, today }), today, {
        summitDone: summitReached(state.summit, state.sessions, today),
      }),
      headlineCard(statuses, all),
      streakCard(streakModel({ sessions: state.sessions, semester, today })),
      comingUp(statuses, today),
      chartCard(today, semester),
      subjectsCard(perSubject),
      storyCard(today, semester),
    ].filter(Boolean),
  };
}

const DAY_STATES = {
  studied: 'studied',
  rested: 'a rest token kept the streak',
  missed: 'a quiet day',
  before: 'before your first study day',
};

/** The streak: current and best, the last 14 days as dots, and the rest tokens left. */
function streakCard(m) {
  if (!m.days.length) return null;
  const days = m.days.slice(-14);
  const dot = (d) => {
    const label = d.state === 'today' ? (m.todayDone ? 'today, studied' : 'today, still to come') : DAY_STATES[d.state];
    const cls = d.state === 'today' ? `today${m.todayDone ? ' studied' : ''}` : d.state;
    return h(
      'li',
      { class: `day-dot ${cls}`, title: `${formatDate(d.date)}: ${label}` },
      d.state === 'rested' ? icon('leaf', 12) : null,
      h('span', { class: 'visually-hidden' }, `${formatDate(d.date)}: ${label}`),
    );
  };
  const leaves = Array.from({ length: m.tokensPerMonth }, (_, i) => h('span', { class: `token${i < m.tokensLeft ? '' : ' used'}` }, icon('leaf', 16)));
  const left = m.tokensLeft === 1 ? '1 rest token left' : `${m.tokensLeft} rest tokens left`;
  return h(
    'section',
    { class: 'card streak-card' },
    h('h2', { class: 'card-title' }, 'Streak'),
    h(
      'p',
      { class: 'streak-big' },
      m.current ? `${m.current} day${m.current === 1 ? '' : 's'}` : streakLine(m),
      m.best > m.current ? h('span', { class: 'muted small' }, ` · best ${m.best}`) : null,
    ),
    h('ol', { class: 'day-strip', 'aria-label': 'The last 14 days' }, days.map(dot)),
    h(
      'p',
      { class: 'token-line small' },
      h('span', { class: 'tokens', 'aria-hidden': 'true' }, leaves),
      `${left} · refills ${formatDate(m.refillDate)}`,
    ),
    h('p', { class: 'muted small' }, `A day counts with ${formatMinutes(m.minMin)} of study. Rest tokens keep your streak on days you rest.`),
  );
}

function progressBar(fraction, label) {
  const pct = Math.round(fraction * 100);
  return h(
    'div',
    { class: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': label },
    h('span', { class: 'meter-fill', style: { width: `${pct}%` } }),
  );
}

function headlineCard(statuses, all) {
  const worst = headline(statuses);
  const title = worst ? STATUS_LABELS[worst.status] : 'On track';
  const line = worst ? statusSentence(worst) : 'Everything fits before its deadline. Keep the pace that suits you.';
  const pct = Math.round(all.donePct * 100);
  return h(
    'section',
    { class: `card headline-card status-${worst?.status ?? 'ontrack'}` },
    h('h2', { class: 'card-title' }, title),
    h('p', { class: 'muted' }, line),
    progressBar(all.donePct, 'Topics learned'),
    h(
      'p',
      { class: 'small muted' },
      `${pct}% learned · ${all.topicsDone} of ${all.topicsTotal} topics · ${formatMinutes(all.studiedMin)} studied`,
      all.reviewsDone ? ` · ${all.reviewsDone} review${all.reviewsDone === 1 ? '' : 's'}` : '',
    ),
  );
}

function comingUp(statuses, today) {
  const rows = statuses.filter((s) => s.deadlineId).slice(0, 5);
  const semesterRow = statuses.find((s) => !s.deadlineId && s.status !== 'ontrack' && s.status !== 'done');
  if (!rows.length && !semesterRow) return null;
  return h(
    'section',
    { class: 'group' },
    h('h2', { class: 'group-title' }, 'Coming up'),
    h(
      'ul',
      { class: 'cards' },
      rows.map((s) => h('li', {}, deadlineRow(s, today))),
      semesterRow ? h('li', {}, deadlineRow(semesterRow, today)) : null,
    ),
  );
}

function deadlineRow(s, today) {
  const d = s.deadlineId ? state.deadlines.find((x) => x.id === s.deadlineId) : null;
  const subject = d && subjectById(d.subjectId);
  const cover = d ? deadlineCoverage(d, state.topics, state.sessions) : null;
  const heading = d ? `${subject?.name ?? ''} · ${DEADLINE_LABELS[d.type]}` : 'Everything else';
  const when = d ? relativeDays(today, d.date) : 'By the end of the semester';
  const needsHelp = s.status === 'tight' || s.status === 'behind';
  return h(
    'div',
    { class: 'card track-row', style: { '--subject': subject?.color ?? 'var(--accent)' } },
    h(
      'div',
      { class: 'track-head' },
      h('span', { class: 'subject-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'card-main' }, h('span', { class: 'card-heading' }, heading), h('span', { class: 'muted small' }, when)),
      h('span', { class: `pill status-pill status-${s.status}` }, STATUS_LABELS[s.status]),
    ),
    cover ? h('p', { class: 'small muted track-detail' }, `${cover.done} of ${cover.total} topic${cover.total === 1 ? '' : 's'} learned`) : null,
    needsHelp
      ? h('p', { class: 'small track-detail' }, statusAdvice(s), ' ', h('a', { href: '#/semester' }, 'Daily study time'))
      : null,
  );
}

// ---------- Last 14 days chart ----------

const CHART = { w: 340, h: 150, top: 14, bottom: 22, left: 4, right: 4, bar: 16, gap: 2, radius: 4 };

/** A column segment with rounded top corners only (square at the baseline). */
function topRounded(x, y, w, hgt, r) {
  const rr = Math.min(r, hgt, w / 2);
  return `M${x},${y + hgt} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + hgt} Z`;
}

function chartCard(today, semester) {
  const from = addDays(today, -13);
  const days = dailyMinutes(state.sessions, from, today);
  const total = days.reduce((s, d) => s + d.minutes, 0);
  const reviewTotal = days.reduce((s, d) => s + d.reviewMin, 0);
  const limit = semester.dailyLimitMin;
  const max = Math.max(limit, ...days.map((d) => d.minutes), 1);
  const plotH = CHART.h - CHART.top - CHART.bottom;
  const slot = (CHART.w - CHART.left - CHART.right) / days.length;
  const y = (m) => CHART.top + plotH - (m / max) * plotH;
  const baseY = y(0);

  const summary =
    total > 0
      ? `Last 14 days: ${formatMinutes(total)}${reviewTotal ? `, ${formatMinutes(reviewTotal)} of it reviews` : ''}.`
      : 'No study logged in the last 14 days yet.';
  const readout = h('p', { class: 'small muted chart-readout', 'aria-live': 'polite' }, summary);

  const cols = days
    .map((d, i) => {
      const x = CHART.left + i * slot + (slot - CHART.bar) / 2;
      const learn = d.minutes - d.reviewMin;
      let parts = '';
      // Learning sits on the baseline; reviews stack on top, with a 2px surface gap between.
      const learnTop = y(learn);
      const reviewTop = y(d.minutes);
      if (learn > 0) {
        const hgt = baseY - learnTop;
        parts += d.reviewMin > 0
          ? `<rect x="${x}" y="${learnTop}" width="${CHART.bar}" height="${hgt}" fill="var(--chart-learn)"/>`
          : `<path d="${topRounded(x, learnTop, CHART.bar, hgt, CHART.radius)}" fill="var(--chart-learn)"/>`;
      }
      if (d.reviewMin > 0) {
        const bottom = learn > 0 ? learnTop - CHART.gap : baseY;
        const hgt = Math.max(1, bottom - reviewTop);
        parts += `<path d="${topRounded(x, bottom - hgt, CHART.bar, hgt, CHART.radius)}" fill="var(--chart-review)"/>`;
      }
      const isToday = d.date === today;
      const label = WEEKDAYS_SHORT[weekdayMon0(d.date)][0];
      return `<g class="chart-col${isToday ? ' is-today' : ''}" data-i="${i}" tabindex="0" role="img" aria-label="${describe(d)}">
        <rect class="chart-hit" x="${CHART.left + i * slot}" y="0" width="${slot}" height="${CHART.h}" fill="transparent"/>
        ${parts}
        <text x="${CHART.left + i * slot + slot / 2}" y="${CHART.h - 6}" text-anchor="middle" class="chart-axis${isToday ? ' chart-today' : ''}">${label}</text>
      </g>`;
    })
    .join('');

  const chart = h('div', { class: 'chart' });
  // Our own numbers and labels only, never user text.
  chart.innerHTML = `<svg viewBox="0 0 ${CHART.w} ${CHART.h}" width="100%" aria-label="Study minutes per day, last 14 days" role="group">
    <line x1="${CHART.left}" x2="${CHART.w - CHART.right}" y1="${baseY}" y2="${baseY}" class="chart-base"/>
    <line x1="${CHART.left}" x2="${CHART.w - CHART.right}" y1="${y(limit)}" y2="${y(limit)}" class="chart-limit"/>
    ${baseY - y(limit) >= 14 ? `<text x="${CHART.w - CHART.right}" y="${y(limit) - 4}" text-anchor="end" class="chart-axis">daily limit ${formatMinutes(limit)}</text>` : ''}
    ${cols}
  </svg>`;

  // Hover, tap or focus a day to read it; leaving shows the summary again.
  const show = (e) => {
    const g = e.target.closest?.('.chart-col');
    if (!g) return;
    chart.querySelectorAll('.chart-col.active').forEach((x) => x.classList.remove('active'));
    g.classList.add('active');
    readout.textContent = describe(days[Number(g.dataset.i)]);
  };
  const reset = () => {
    chart.querySelectorAll('.chart-col.active').forEach((x) => x.classList.remove('active'));
    readout.textContent = summary;
  };
  chart.addEventListener('pointerover', show);
  chart.addEventListener('click', show);
  chart.addEventListener('focusin', show);
  chart.addEventListener('pointerleave', reset);
  chart.addEventListener('focusout', reset);

  const legend = h(
    'div',
    { class: 'chart-legend small muted' },
    h('span', {}, h('span', { class: 'swatch', style: { background: 'var(--chart-learn)' } }), 'New topics'),
    h('span', {}, h('span', { class: 'swatch', style: { background: 'var(--chart-review)' } }), 'Reviews'),
  );

  const table = h(
    'details',
    { class: 'chart-table' },
    h('summary', { class: 'small' }, 'Show as a table'),
    h(
      'table',
      { class: 'small' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', {}, 'Studied'), h('th', {}, 'Reviews'))),
      h(
        'tbody',
        {},
        days.map((d) => h('tr', {}, h('td', {}, formatDate(d.date)), h('td', {}, formatMinutes(d.minutes)), h('td', {}, formatMinutes(d.reviewMin)))),
      ),
    ),
  );

  return h('section', { class: 'card chart-card' }, h('h2', { class: 'card-title' }, 'Last 14 days'), readout, chart, legend, table);
}

function describe(d) {
  const base = `${formatDate(d.date)}: ${d.minutes ? formatMinutes(d.minutes) : 'no study'}`;
  return d.reviewMin ? `${base} (${formatMinutes(d.reviewMin)} reviews)` : base;
}

// ---------- Subjects ----------

function subjectsCard(perSubject) {
  return h(
    'section',
    { class: 'group' },
    h('h2', { class: 'group-title' }, 'Subjects'),
    h(
      'ul',
      { class: 'cards' },
      perSubject.map((p) => {
        const subject = subjectById(p.subjectId);
        const extras = [
          p.weakCount ? h('span', { class: 'weak-text' }, `${p.weakCount} worth another look`) : null,
          p.masteredCount ? h('span', {}, `${p.masteredCount} mastered`) : null,
        ].filter(Boolean);
        return h(
          'li',
          { class: 'card subject-progress', style: { '--subject': subject?.color ?? 'var(--accent)' } },
          h(
            'div',
            { class: 'track-head' },
            h('span', { class: 'subject-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'card-heading card-main' }, subject?.name ?? 'Subject'),
            h('span', { class: 'small muted' }, `${Math.round(p.donePct * 100)}%`),
          ),
          progressBar(p.donePct, `${subject?.name ?? 'Subject'} learned`),
          h(
            'p',
            { class: 'small muted' },
            `${p.topicsDone} of ${p.topicsTotal} topics · ${formatMinutes(p.studiedMin)} studied`,
            extras.length ? ' · ' : '',
            extras.flatMap((x, i) => (i ? [' · ', x] : [x])),
          ),
        );
      }),
    ),
  );
}

// ---------- Weekly story ----------

function storyCard(today, semester) {
  const thisWeek = weekStart(today);
  const first = weekStart(semester.startDate);
  const weeks = [];
  for (let w = thisWeek; w >= first && weeks.length < 12; w = addDays(w, -7)) weeks.push(w);
  if (!weeks.length) return null;

  const story = (from, ahead = false) => h('div', { class: 'story' }, storyFor(from, today, ahead).map((line) => h('p', {}, line)));
  const range = (from) => `${formatDate(from)} – ${formatDate(addDays(from, 6))}`;
  const [current, last, ...earlier] = weeks;
  return h(
    'section',
    { class: 'card story-card' },
    h('h2', { class: 'card-title' }, 'Your week'),
    h('p', { class: 'story-when small muted' }, 'This week so far'),
    story(current, true),
    last ? [h('p', { class: 'story-when small muted' }, `Last week · ${range(last)}`), story(last)] : null,
    earlier.length
      ? h(
          'details',
          { class: 'story-earlier' },
          h('summary', { class: 'small' }, 'Earlier weeks'),
          earlier.map((w) => [h('p', { class: 'story-when small muted' }, range(w)), story(w)]),
        )
      : null,
  );
}
