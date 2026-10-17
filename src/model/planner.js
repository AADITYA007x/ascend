// The planner: turns the semester and what you've studied into a day-by-day plan. Pure functions.
//
// Nothing here is saved. The plan is rebuilt from today on every render, so missing a day,
// finishing early or adding topics rebalances it automatically.

import { addDays, daysBetween, weekdayMon0, toMinutes, isValidDate } from './time.js';
import { freeMinutesOnDay } from './timetable.js';
import { withSemesterDefaults } from './factory.js';
import { topicProgress, minutesStudiedOn, remainingMin } from './progress.js';
import { covers, currentDeadline, dueBy, isExam, isActiveOn, phaseOn, topicScore } from './priority.js';
import { byOrder } from './summary.js';
import { planningTopics } from './estimate.js';
import { attendanceKey, cancelledKeys } from './attendance.js';
import { REVISION, REVIEWS, nextGap, isWeak, weakness, revisionMinutes, revisionStates, topicRatings } from './revision.js';

export const BLOCK = {
  max: 90, // longest block for one topic on one day
  min: 20, // shortest block when a topic is split (no crumbs)
  round: 5, // split blocks are rounded down to this
};

// Deadline guard: work due by a date counts as urgent once it needs this share of the time left.
const GUARD_TIGHTNESS = 0.9;

/** Study minutes available on one date. Classes in `cancelled` (attendance keys) count as free time. */
export function dayCapacity({ settings, slots, date, today, nowMin = null, studiedToday = 0, cancelled = null }) {
  if (settings.offDays.includes(date)) return 0;
  const from = toMinutes(settings.studyFrom) ?? 7 * 60;
  const to = toMinutes(settings.studyTo) ?? 23 * 60;
  let limit = settings.dailyLimitMin;
  let start = from;
  if (date === today) {
    limit -= studiedToday;
    if (nowMin !== null && nowMin !== undefined) start = Math.max(from, nowMin);
  }
  const held = cancelled?.size ? slots.filter((s) => !cancelled.has(attendanceKey(s.id, date))) : slots;
  const free = freeMinutesOnDay(held, weekdayMon0(date), start, to);
  return Math.max(0, Math.min(limit, free));
}

/**
 * How much of a topic to place in `left` minutes. 0 means "not today".
 * minBlock is lowered on days with less time than BLOCK.min, so a small daily limit still gets a plan.
 */
export function blockSize(remaining, left, minBlock = BLOCK.min) {
  let block = Math.min(remaining, BLOCK.max, left);
  if (block <= 0) return 0;
  if (block === remaining) return block; // finishes the topic
  block = Math.floor(block / BLOCK.round) * BLOCK.round;
  const rest = remaining - block;
  // Leave a proper block for later rather than a few stray minutes.
  if (rest < minBlock) block -= minBlock - rest;
  return block >= minBlock ? block : 0;
}

/**
 * Builds the plan from max(today, semester start) to the semester's last day.
 * nowMin (minutes since midnight) trims today's free time to what is left of the day.
 *
 * Each day starts with reviews of finished topics (weak ones first), within a share of the day,
 * then new work. Planned reviews count as "okay", so the coming days show the 1 → 3 → 7 → 21 chain.
 *
 * Returns {
 *   days: [{ date, phase, capacity, buffer, bufferFor, items: [{ kind: 'review' | 'learn', topicId,
 *            subjectId, unitId, minutes, part, parts, deadlineId, dueBy, overdue,
 *            review (1–4, null once mastered), weak, forExam }] }],
 *   unscheduled: [{ topicId, minutes }],  // work that doesn't fit before the semester ends
 *   atRisk: [deadlineId],                 // deadlines whose topics don't all fit before them
 *   phase,                                // today's phase
 * }
 */
export function buildPlan({
  semester,
  subjects = [],
  units = [],
  topics = [],
  deadlines = [],
  slots = [],
  sessions = [],
  attendance = [],
  today,
  nowMin = null,
}) {
  const empty = { days: [], unscheduled: [], atRisk: [], phase: 'keepup' };
  if (!semester || !isValidDate(semester.startDate) || !isValidDate(semester.endDate) || !isValidDate(today)) {
    return empty;
  }
  const settings = withSemesterDefaults(semester);
  // Estimates scaled by your real pace; difficulty moved by how sessions felt.
  topics = planningTopics(topics, sessions);
  const end = settings.endDate;
  const start = today > settings.startDate ? today : settings.startDate;
  const validDeadlines = deadlines.filter((d) => isValidDate(d.date));
  if (start > end) return { ...empty, phase: phaseOn(today, validDeadlines, end) };

  // ---- Capacity for every day ----
  const dates = Array.from({ length: daysBetween(start, end) + 1 }, (_, i) => addDays(start, i));
  const studiedToday = minutesStudiedOn(sessions, today);
  const cancelled = cancelledKeys(attendance);
  const capacity = dates.map((date) => dayCapacity({ settings, slots, date, today, nowMin, studiedToday, cancelled }));
  const prefix = [0];
  capacity.forEach((c, i) => prefix.push(prefix[i] + c));
  /** Capacity from day index i up to and including `date`. */
  const capacityUntil = (i, date) => {
    const j = Math.min(daysBetween(start, date), dates.length - 1);
    return j < i ? 0 : prefix[j + 1] - prefix[i];
  };

  // ---- Buffer days before each upcoming exam ----
  const bufferFor = new Map();
  for (const d of [...validDeadlines].filter(isExam).sort((a, b) => a.date.localeCompare(b.date))) {
    for (let k = 1; k <= settings.bufferDays; k++) {
      const day = addDays(d.date, -k);
      if (!bufferFor.has(day)) bufferFor.set(day, d.id);
    }
  }

  // ---- Work queues: one per unit, topics in syllabus order ----
  const progress = topicProgress(sessions);
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const work = new Map(); // topicId → { topic, remaining, covering, seq }
  const queues = [];
  let seq = 0;
  for (const subject of subjects) {
    for (const unit of byOrder(units.filter((u) => u.subjectId === subject.id))) {
      const list = byOrder(topics.filter((t) => t.unitId === unit.id));
      for (const topic of list) {
        work.set(topic.id, {
          topic,
          remaining: remainingMin(topic, progress.get(topic.id)),
          covering: validDeadlines.filter((d) => covers(d, topic)),
          seq: seq++,
        });
      }
      if (list.length) queues.push({ topics: list, pos: 0 });
    }
  }

  // ---- Reviews: finished topics come back after about 1, 3, 7 and 21 days ----
  const ratings = topicRatings(sessions);
  const reviews = new Map(); // topicId → { topic, step, due, lastDate, mastered, weak, weakness, minutes, seq }
  const addReview = (topic, st) =>
    reviews.set(topic.id, { ...st, topic, minutes: revisionMinutes(topic, st.weak), seq: work.get(topic.id).seq });
  for (const [id, st] of revisionStates(topics, sessions)) if (work.has(id)) addReview(work.get(id).topic, st);
  const deadlineById = new Map(validDeadlines.map((d) => [d.id, d]));

  /** Reviews to do on `date`: due ones, plus (on an exam's buffer days) its topics not yet looked at again. */
  const reviewCandidates = (date, exam) => {
    const windowStart = exam ? addDays(exam.date, -settings.bufferDays) : null;
    const list = [];
    for (const r of reviews.values()) {
      if (r.lastDate >= date) continue; // finished or reviewed today already
      const due = !r.mastered && r.due <= date;
      const forExam = exam && covers(exam, r.topic) && r.lastDate < windowStart ? exam : null;
      if (due || forExam) list.push({ r, forExam, due, sortDue: due ? r.due : date });
    }
    return list.sort(
      (a, b) => Number(b.r.weak) - Number(a.r.weak) || a.sortDue.localeCompare(b.sortDue) || b.r.weakness - a.r.weakness || a.r.seq - b.r.seq,
    );
  };

  /** A planned review counts as "okay": on to the next step. */
  const advance = (r, date) => {
    r.lastDate = date;
    if (r.mastered) return;
    r.step += 1;
    if (r.step >= REVIEWS) {
      r.mastered = true;
      r.due = null;
    } else {
      r.due = addDays(date, nextGap(r.step, 'okay'));
    }
  };

  // ---- "At risk" checks: once a deadline's due-by date has passed, is its work all placed? ----
  const atRisk = new Set();
  let pendingRisk = validDeadlines
    .filter((d) => isActiveOn(d, start))
    .map((d) => ({ deadline: d, checkOn: addDays(dueBy(d, settings.bufferDays), 1) }));
  const checkRisk = (d) => {
    for (const w of work.values()) {
      if (w.remaining > 0 && covers(d, w.topic)) {
        atRisk.add(d.id);
        return;
      }
    }
  };

  // ---- Fill the days ----
  const days = [];
  const blocks = new Map(); // topicId → its planned items, in order
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    pendingRisk = pendingRisk.filter((p) => (p.checkOn <= date ? (checkRisk(p.deadline), false) : true));

    const phase = phaseOn(date, validDeadlines, end);
    const bufferId = bufferFor.get(date) ?? null;

    // What each unfinished topic is preparing for today.
    const info = new Map();
    for (const [id, w] of work) {
      if (w.remaining > 0) info.set(id, currentDeadline(w.covering, date, settings.bufferDays, end));
    }

    // Deadline guard: find the latest due-by date whose work barely fits (or doesn't) in the time left.
    const needByDue = new Map();
    for (const [id, cd] of info) needByDue.set(cd.dueBy, (needByDue.get(cd.dueBy) ?? 0) + work.get(id).remaining);
    let urgentUntil = null;
    let need = 0;
    for (const due of [...needByDue.keys()].sort()) {
      need += needByDue.get(due);
      if (need >= GUARD_TIGHTNESS * capacityUntil(i, due)) urgentUntil = due;
    }

    let left = capacity[i];

    // Reviews first, within the day's share; one is always allowed so they never pile up.
    // When new work for a deadline is tight, or on a buffer day (where only work that's behind
    // may go), new work goes first and reviews get the time left over.
    const exam = bufferId ? deadlineById.get(bufferId) : null;
    let budget = Math.floor(capacity[i] * REVISION.share[phase]);
    const reviewItems = [];
    const placeReviews = (withinBudget) => {
      for (const c of reviewCandidates(date, exam)) {
        const minutes = c.r.minutes;
        if (minutes > left) continue;
        if (withinBudget && reviewItems.length > 0 && minutes > budget) continue;
        reviewItems.push({
          kind: 'review',
          topicId: c.r.topic.id,
          subjectId: c.r.topic.subjectId,
          unitId: c.r.topic.unitId,
          minutes,
          part: 1,
          parts: 1,
          deadlineId: c.forExam?.id ?? null,
          dueBy: date,
          overdue: c.due && c.r.due < date,
          review: c.r.mastered ? null : c.r.step + 1,
          weak: c.r.weak,
          forExam: c.forExam?.id ?? null,
        });
        left -= minutes;
        budget -= minutes;
        advance(c.r, date);
      }
    };
    if (!bufferId && urgentUntil === null) placeReviews(true);

    const minBlock = Math.min(BLOCK.min, capacity[i]);
    const usedToday = new Set();
    const items = [];
    while (left > 0) {
      const candidates = [];
      for (const q of queues) {
        while (q.pos < q.topics.length && work.get(q.topics[q.pos].id).remaining <= 0) q.pos++;
        const topic = q.topics[q.pos];
        if (!topic || usedToday.has(topic.id)) continue;
        const cd = info.get(topic.id);
        const overdue = cd.dueBy < date;
        // Buffer days are kept for review; only work that's behind may use them.
        if (bufferId && !overdue) continue;
        candidates.push({
          w: work.get(topic.id),
          cd,
          overdue,
          urgent: urgentUntil !== null && cd.dueBy <= urgentUntil,
          score: topicScore({ topic, subject: subjectById.get(topic.subjectId), deadline: cd.deadline, dueBy: cd.dueBy, day: date, phase }),
        });
      }
      if (!candidates.length) break;
      candidates.sort(
        (a, b) =>
          Number(b.urgent) - Number(a.urgent) ||
          (a.urgent ? a.cd.dueBy.localeCompare(b.cd.dueBy) : 0) ||
          b.score - a.score ||
          a.w.seq - b.w.seq,
      );
      const best = candidates[0];
      const { topic } = best.w;
      usedToday.add(topic.id);
      const minutes = blockSize(best.w.remaining, left, minBlock);
      if (minutes <= 0) continue;
      const item = {
        kind: 'learn',
        topicId: topic.id,
        subjectId: topic.subjectId,
        unitId: topic.unitId,
        minutes,
        part: 1,
        parts: 1,
        deadlineId: best.cd.deadline?.id ?? null,
        dueBy: best.cd.dueBy,
        overdue: best.overdue,
      };
      items.push(item);
      if (!blocks.has(topic.id)) blocks.set(topic.id, []);
      blocks.get(topic.id).push(item);
      best.w.remaining -= minutes;
      left -= minutes;
      // Finished in the plan: its first review comes the next day.
      if (best.w.remaining <= 0) {
        const r = ratings.get(topic.id) ?? [];
        addReview(topic, {
          step: 0,
          lastDate: date,
          due: addDays(date, nextGap(0, r.at(-1))),
          mastered: false,
          weak: isWeak(r),
          weakness: weakness(r, topic.difficulty),
          ratings: r,
        });
      }
    }
    // Time new work didn't need goes to more reviews.
    if (left > 0) placeReviews(false);

    days.push({
      date,
      phase,
      capacity: capacity[i],
      buffer: Boolean(bufferId),
      bufferFor: bufferId,
      items: [...reviewItems, ...items],
    });
  }
  for (const p of pendingRisk) checkRisk(p.deadline);

  // "(1/2)" labels for topics split over several days.
  for (const list of blocks.values()) {
    list.forEach((item, k) => {
      item.part = k + 1;
      item.parts = list.length;
    });
  }

  const unscheduled = [];
  for (const [topicId, w] of work) if (w.remaining > 0) unscheduled.push({ topicId, minutes: w.remaining });

  return { days, unscheduled, atRisk: [...atRisk], phase: days[0]?.date === today ? days[0].phase : phaseOn(today, validDeadlines, end) };
}
