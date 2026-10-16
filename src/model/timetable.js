// Weekly class timetable helpers. Pure functions.
import { toMinutes } from './time.js';

/** Sorts slots by day, then start time, then end time. Returns a new array. */
export function sortSlots(slots) {
  return [...slots].sort(
    (a, b) => a.day - b.day || toMinutes(a.start) - toMinutes(b.start) || toMinutes(a.end) - toMinutes(b.end),
  );
}

/** Slots for one weekday (Mon = 0), sorted. */
export function slotsForDay(slots, day) {
  return sortSlots(slots.filter((s) => s.day === day));
}

/** True if two slots share time on the same day. Touching (10:00 end / 10:00 start) is fine. */
export function slotsOverlap(a, b) {
  if (a.day !== b.day) return false;
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** Every overlapping pair, as [idA, idB]. */
export function findOverlaps(slots) {
  const pairs = [];
  const sorted = sortSlots(slots);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].day === sorted[i].day; j++) {
      if (toMinutes(sorted[j].start) >= toMinutes(sorted[i].end)) break;
      if (slotsOverlap(sorted[i], sorted[j])) pairs.push([sorted[i].id, sorted[j].id]);
    }
  }
  return pairs;
}

/** Set of slot ids that overlap with at least one other slot. */
export function overlappingIds(slots) {
  const ids = new Set();
  for (const [a, b] of findOverlaps(slots)) {
    ids.add(a);
    ids.add(b);
  }
  return ids;
}

/** Total length of [start, end] minute ranges, with overlaps counted once. */
function mergedLength(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur = null;
  for (const [s, e] of sorted) {
    if (!cur || s > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [s, e];
    } else if (e > cur[1]) {
      cur[1] = e;
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

/** Minutes of class on one weekday, with overlaps counted once. */
export function classMinutesOnDay(slots, day) {
  return mergedLength(slots.filter((s) => s.day === day).map((s) => [toMinutes(s.start), toMinutes(s.end)]));
}

/**
 * Free minutes on one weekday between two times given in minutes (e.g. 420 → 1380).
 * Class time outside the window is ignored.
 */
export function freeMinutesOnDay(slots, day, fromMin, toMin) {
  const windowLen = Math.max(0, toMin - fromMin);
  const ranges = slots
    .filter((s) => s.day === day)
    .map((s) => [Math.max(toMinutes(s.start), fromMin), Math.min(toMinutes(s.end), toMin)])
    .filter(([s, e]) => e > s);
  return windowLen - mergedLength(ranges);
}

/**
 * Free minutes for each weekday (Mon..Sun) inside an awake window,
 * e.g. dayStart "07:00", dayEnd "23:00". Class time outside the window is ignored.
 */
export function freeMinutesPerDay(slots, dayStart = '07:00', dayEnd = '23:00') {
  const ws = toMinutes(dayStart);
  const we = toMinutes(dayEnd);
  return Array.from({ length: 7 }, (_, day) => freeMinutesOnDay(slots, day, ws, we));
}
