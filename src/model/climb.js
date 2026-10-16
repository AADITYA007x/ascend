// The climb: the semester as a mountain. Pure functions.
//
// Height is what you've learned (share of estimated learning time done). Each mid-sem and end-sem
// is a camp at the height you need by its date: the share of learning time in the topics covered by
// exams up to then. The summit is the end of the semester's work.

import { daysBetween, formatDate, isValidDate } from './time.js';
import { subjectProgress, overallProgress } from './stats.js';
import { planningTopics } from './estimate.js';
import { covers, isExam } from './priority.js';

export const CLIMB = {
  mergeGap: 0.06, // camps closer than this in height…
  mergeDays: 7, // …and within this many days of each other become one
  summitAt: 0.97, // a camp this high is the summit
};

const TYPE_NAMES = { midsem: ['mid-sem', 'mid-sems'], endsem: ['end-sem', 'end-sems'] };

/**
 * { height, camps: [{ deadlineIds, label, date, dateEnd, at, state }], summit: { label, date, deadlineIds },
 *   next: camp | null, gap }
 * state: 'past' (the exam is over), 'reached' (height ≥ at) or 'ahead'.
 */
export function climbModel({ subjects = [], topics = [], sessions = [], deadlines = [], semester, today }) {
  const height = overallProgress(subjectProgress({ subjects, topics, sessions })).donePct;
  const planned = planningTopics(topics, sessions);
  const total = planned.reduce((s, t) => s + (Number(t.estMin) || 0), 0);
  const nameOf = (id) => subjects.find((s) => s.id === id)?.name ?? '';

  const exams = deadlines
    .filter((d) => isExam(d) && isValidDate(d.date) && planned.some((t) => covers(d, t)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  // Height of each exam: learning time in everything covered by exams up to its date.
  const raw = exams.map((d) => {
    const upTo = exams.filter((e) => e.date <= d.date);
    const est = planned.reduce((s, t) => (upTo.some((e) => covers(e, t)) ? s + (Number(t.estMin) || 0) : s), 0);
    return { deadline: d, at: total > 0 ? est / total : 0 };
  });

  // Merge camps that would sit on top of each other.
  const groups = [];
  for (const r of raw) {
    const g = groups.at(-1);
    if (g && r.at - g[0].at < CLIMB.mergeGap && daysBetween(g.at(-1).deadline.date, r.deadline.date) <= CLIMB.mergeDays) g.push(r);
    else groups.push([r]);
  }

  const camps = groups.map((g) => {
    const ds = g.map((r) => r.deadline);
    const date = ds[0].date;
    const dateEnd = ds.at(-1).date;
    const at = Math.max(...g.map((r) => r.at));
    const allPast = ds.every((d) => daysBetween(today, d.date) < 0);
    return {
      deadlineIds: ds.map((d) => d.id),
      label: campLabel(ds, nameOf),
      date,
      dateEnd,
      dates: ds.map((d) => d.date),
      at,
      state: allPast ? 'past' : height >= at ? 'reached' : 'ahead',
    };
  });

  let summit = { label: 'Summit', date: semester?.endDate ?? null, deadlineIds: [] };
  if (camps.length && camps.at(-1).at >= CLIMB.summitAt) {
    const top = camps.pop();
    summit = { label: top.label, date: top.dateEnd, deadlineIds: top.deadlineIds };
  }

  const next = camps.find((c) => c.state !== 'past') ?? null;
  return { height, camps, summit, next, gap: next ? Math.max(0, next.at - height) : 0 };
}

function campLabel(ds, nameOf) {
  if (ds.length === 1) return `${nameOf(ds[0].subjectId)} ${TYPE_NAMES[ds[0].type][0]}`.trim();
  const types = new Set(ds.map((d) => d.type));
  return types.size === 1 ? `${ds.length} ${TYPE_NAMES[ds[0].type][1]}` : `${ds.length} exams`;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const toGo = (days) => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days to go`);

/** "6 Oct" or "2–9 Dec" style date for a camp. */
export function campDates(camp) {
  if (camp.date === camp.dateEnd) return formatDate(camp.date);
  return `${formatDate(camp.date)} – ${formatDate(camp.dateEnd)}`;
}

/** Days to the camp's next exam that hasn't happened yet. */
const daysToCamp = (camp, today) => {
  const next = (camp.dates ?? [camp.date]).find((d) => daysBetween(today, d) >= 0) ?? camp.dateEnd;
  return daysBetween(today, next);
};

/** One calm line under the scene. */
export function climbReadout(climb, today) {
  const parts = [`You’re ${pct(climb.height)} of the way up`];
  const c = climb.next;
  if (c) {
    const when = toGo(daysToCamp(c, today));
    if (c.state === 'reached') parts.push(`You’ve passed the ${c.label} camp · ${when}`);
    else parts.push(`The ${c.label} camp is ${pct(climb.gap)} above you · ${when}`);
  }
  return parts.join(' · ');
}

/** Readout for one tapped camp. */
export function campReadout(camp, height, today) {
  const days = daysToCamp(camp, today);
  if (camp.state === 'past') return `${capital(camp.label)} camp · ${campDates(camp)} · done`;
  const where = height >= camp.at ? 'you’re past it' : `${pct(camp.at - height)} above you`;
  return `${capital(camp.label)} camp · ${pct(camp.at)} up by ${campDates(camp)} · ${where} · ${toGo(days)}`;
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- The trail ----------

/** Switchbacks from the base (bottom left) to the summit, in a 340 × 240 viewBox. */
export const TRAIL = [
  [40, 228],
  [235, 202],
  [95, 168],
  [250, 132],
  [120, 96],
  [215, 62],
  [170, 30],
];

const segLengths = TRAIL.slice(1).map((p, i) => Math.hypot(p[0] - TRAIL[i][0], p[1] - TRAIL[i][1]));
const trailLength = segLengths.reduce((a, b) => a + b, 0);

/** Point at `t` (0 base … 1 summit), measured by length along the trail. */
export function trailPoint(t) {
  if (t >= 1) return { x: TRAIL.at(-1)[0], y: TRAIL.at(-1)[1] };
  let d = Math.max(0, t) * trailLength;
  for (let i = 0; i < segLengths.length; i++) {
    if (d <= segLengths[i] || i === segLengths.length - 1) {
      const f = segLengths[i] ? Math.min(1, d / segLengths[i]) : 0;
      const [x0, y0] = TRAIL[i];
      const [x1, y1] = TRAIL[i + 1];
      return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f };
    }
    d -= segLengths[i];
  }
  return { x: TRAIL.at(-1)[0], y: TRAIL.at(-1)[1] };
}

/** SVG path data for the trail between `from` and `to` (both 0–1). */
export function trailPath(from, to) {
  const a = Math.min(1, Math.max(0, from));
  const b = Math.min(1, Math.max(0, to));
  if (b <= a) return '';
  const pts = [trailPoint(a)];
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    acc += segLengths[i];
    const t = acc / trailLength;
    if (t > a && t < b) pts.push({ x: TRAIL[i + 1][0], y: TRAIL[i + 1][1] });
  }
  pts.push(trailPoint(b));
  const r = (n) => Math.round(n * 10) / 10;
  return pts.map((p, i) => `${i ? 'L' : 'M'}${r(p.x)},${r(p.y)}`).join(' ');
}
