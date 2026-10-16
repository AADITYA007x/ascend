// "On track?" for each coming deadline and the semester as a whole. Pure functions.
//
// The plan already knows what fits; this turns it into a calm status and, when it's tight,
// how many more minutes a day would make it comfortable.

import { addDays, isValidDate } from './time.js';
import { withSemesterDefaults } from './factory.js';
import { dayCapacity } from './planner.js';
import { topicProgress, remainingMin, minutesStudiedOn } from './progress.js';
import { planningTopics } from './estimate.js';
import { covers, currentDeadline, dueBy, isActiveOn } from './priority.js';

export const TRACK = {
  comfortable: 0.8, // work needing more than this share of the room is "tight"
  paceDays: 14,
  paceMinDays: 7, // fewer counted days than this: not enough to judge your pace
  round: 5,
};

const RANK = { behind: 3, tight: 2, ontrack: 1, done: 0 };

/**
 * Minutes studied ÷ free study time over the last `days` days (not today), 0–1.
 * Off days, days before the semester and days with no free time don't count.
 * null until there are enough days to say anything.
 */
export function recentPace({ semester, slots = [], sessions = [], today, days = TRACK.paceDays }) {
  if (!semester || !isValidDate(today)) return null;
  const settings = withSemesterDefaults(semester);
  let counted = 0;
  let free = 0;
  let studied = 0;
  for (let k = 1; k <= days; k++) {
    const date = addDays(today, -k);
    if (date < settings.startDate) break;
    const cap = dayCapacity({ settings, slots, date, today });
    if (cap <= 0) continue;
    counted += 1;
    free += cap;
    studied += Math.min(cap, minutesStudiedOn(sessions, date)); // one long day doesn't hide the rest
  }
  if (counted < TRACK.paceMinDays || free <= 0) return null;
  return Math.min(1, studied / free);
}

const roundUp = (n) => Math.ceil(n / TRACK.round) * TRACK.round;

/**
 * For each coming deadline with topics to learn, and for work no deadline covers (deadlineId null):
 * { deadlineId, dueBy, needMin, roomMin, status: 'done' | 'ontrack' | 'tight' | 'behind', extraPerDay, slowPace }
 * need = new work due by that date (any subject), room = the plan's study time until then minus reviews.
 * Sorted by due date.
 */
export function trackStatus({ plan, deadlines = [], topics = [], sessions = [], semester, today, pace = null }) {
  if (!plan?.days?.length || !semester) return [];
  const settings = withSemesterDefaults(semester);
  const end = settings.endDate;
  const progress = topicProgress(sessions);
  const valid = deadlines.filter((d) => isValidDate(d.date));

  // What each unfinished topic is preparing for, as the planner sees it today.
  const work = [];
  for (const t of planningTopics(topics, sessions)) {
    const left = remainingMin(t, progress.get(t.id));
    const covering = valid.filter((d) => covers(d, t));
    work.push({ topic: t, left, covering, due: currentDeadline(covering, today, settings.bufferDays, end).dueBy });
  }

  const roomUntil = (due) => {
    let room = 0;
    let days = 0;
    for (const d of plan.days) {
      if (d.date > due) break;
      const reviews = d.items.reduce((s, it) => (it.kind === 'review' ? s + it.minutes : s), 0);
      room += Math.max(0, d.capacity - reviews);
      if (d.capacity > 0) days += 1;
    }
    return { room, days };
  };

  const judge = ({ deadlineId, due, own, behind }) => {
    const needMin = work.reduce((s, w) => (w.due <= due ? s + w.left : s), 0);
    const { room, days } = roomUntil(due);
    const base = { deadlineId, dueBy: due, needMin, roomMin: room, extraPerDay: null, slowPace: false };
    if (own <= 0) return { ...base, status: 'done' };
    const usable = pace !== null && pace < 1 ? room * pace : room;
    const slowPace = needMin <= room && needMin > usable;
    let status = 'ontrack';
    if (behind) status = 'behind';
    else if (needMin > TRACK.comfortable * room || slowPace) status = 'tight';
    const extra = days > 0 ? roundUp(Math.max(0, needMin / TRACK.comfortable - usable) / days) : null;
    return { ...base, status, slowPace, extraPerDay: status === 'ontrack' ? null : extra || null };
  };

  const out = [];
  for (const d of valid) {
    if (!isActiveOn(d, today)) continue;
    const mine = work.filter((w) => covers(d, w.topic));
    if (!mine.length) continue; // a quiz or assignment not tied to topics: nothing to judge
    out.push(
      judge({
        deadlineId: d.id,
        due: dueBy(d, settings.bufferDays),
        own: mine.reduce((s, w) => s + w.left, 0),
        behind: plan.atRisk.includes(d.id),
      }),
    );
  }
  // The semester as a whole: only work no deadline covers (the rest is judged above).
  const uncovered = work.reduce((s, w) => (w.covering.length ? s : s + w.left), 0);
  out.push(judge({ deadlineId: null, due: end, own: uncovered, behind: plan.unscheduled.length > 0 }));
  return out.sort((a, b) => a.dueBy.localeCompare(b.dueBy) || (a.deadlineId === null) - (b.deadlineId === null));
}

/** The one status worth a line on Today: the worst, soonest first. null when all is well. */
export function headline(statuses) {
  let best = null;
  for (const s of statuses) {
    if (RANK[s.status] < RANK.tight) continue;
    if (!best || RANK[s.status] > RANK[best.status]) best = s;
  }
  return best;
}
