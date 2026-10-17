// Importing a class timetable that the AI helper read from a photo or PDF. Pure functions.
//
// The helper returns rows as written on the timetable ({ day, start, end, subject, kind, room },
// all text). These turn them into tidy classes, suggest which of your subjects each name means,
// and work out what to save.

import { makeSlot, makeSubject, pickColor } from './factory.js';
import { overlappingIds } from './timetable.js';
import { toMinutes, fromMinutes } from './time.js';

export const IMPORT = {
  maxImageSide: 2000, // px, longest side after downscaling a photo
  jpegQuality: 0.85,
  maxBytes: 4 * 1024 * 1024, // largest file sent to the helper
  maxRows: 80,
  nameMax: 60,
  labelMax: 40, // same as a class's label field
  creditsDefault: 3,
};

/**
 * "9", "9:00", "09.00", "9 am", "2:15 pm", "14:15", "noon" → "HH:MM", or null.
 * A bare 1–7 without am/pm is read as the afternoon (13:00–19:00), as colleges usually mean it.
 * Returns { time, shifted } so a pair can be fixed when the guess was wrong.
 */
function readTime(input, { afternoon = true } = {}) {
  const s = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (s === 'noon' || s === '12 noon') return { time: '12:00', shifted: false };
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return null;
  let shifted = false;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    const pm = m[3].startsWith('p');
    h = (h % 12) + (pm ? 12 : 0);
  } else if (afternoon && h >= 1 && h <= 7) {
    h += 12;
    shifted = true;
  }
  if (h > 23) return null;
  return { time: fromMinutes(h * 60 + min), shifted };
}

export function parseTime(input) {
  return readTime(input)?.time ?? null;
}

/** Start and end together: fixes a wrong afternoon guess ("7"–"8" is 07:00–08:00). Null if it can't work. */
export function parseTimes(start, end) {
  let a = readTime(start);
  let b = readTime(end);
  if (!a || !b) return null;
  if (toMinutes(b.time) <= toMinutes(a.time) && a.shifted) a = readTime(start, { afternoon: false });
  // "7 pm" to "8": an afternoon start with the end written as a morning hour.
  if (toMinutes(b.time) <= toMinutes(a.time) && toMinutes(a.time) >= 12 * 60 && toMinutes(b.time) < 12 * 60) {
    const later = readTime(`${end} pm`);
    if (later && toMinutes(later.time) > toMinutes(a.time)) b = later;
  }
  if (toMinutes(b.time) <= toMinutes(a.time)) return null;
  return { start: a.time, end: b.time };
}

const DAY_PREFIXES = [
  ['mo', 0],
  ['tu', 1],
  ['we', 2],
  ['th', 3],
  ['fr', 4],
  ['sa', 5],
  ['su', 6],
];
const DAY_LETTERS = { m: 0, w: 2, f: 4 }; // T and S could be two days each

/** "Mon", "monday", "Thurs", "W" → 0–6 (Monday = 0), or null. */
export function parseDay(input) {
  const s = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!s) return null;
  if (s.length === 1) return DAY_LETTERS[s] ?? null;
  const hit = DAY_PREFIXES.find(([p]) => s.startsWith(p));
  return hit ? hit[1] : null;
}

const tidy = (s, max) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();

/**
 * Rows from the helper → [{ day, start, end, name, label }], keeping only ones that make sense.
 * Drops rows without a day, a readable time or a name, and exact duplicates.
 */
export function cleanRows(raw) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= IMPORT.maxRows) break;
    if (!r || typeof r !== 'object') continue;
    const day = parseDay(r.day);
    let { start, end } = r;
    // "9-10" or "9:00 – 10:00" in one field
    if ((end === undefined || end === null || end === '') && typeof start === 'string' && /[-–—]| to /.test(start)) {
      [start, end] = start.split(/\s*(?:[-–—]|to)\s*/);
    }
    const times = parseTimes(start, end);
    const name = tidy(r.subject, IMPORT.nameMax);
    if (day === null || !times || !name) continue;
    const label = tidy([tidy(r.kind, 20), tidy(r.room, 20)].filter(Boolean).join(' · '), IMPORT.labelMax);
    const key = `${day}|${times.start}|${times.end}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day, ...times, name, label });
  }
  return out;
}

// ---------- Matching names to your subjects ----------

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const KIND_WORDS = /\b(lab|labs|laboratory|lecture|lec|tutorial|tut|practical|prac|theory|th|class|session)\b|\((?:l|t|p|lab)\)/gi;
const SMALL_WORDS = new Set(['and', 'of', 'the', 'in', 'for', 'to', 'a', 'an', 'with']);

/** "DSA Lab (P)" → "dsa": the name without words like Lab or Tutorial. */
const baseName = (name) => norm(String(name ?? '').replace(KIND_WORDS, ' '));

const initials = (name) =>
  String(name ?? '')
    .split(/[\s&,/-]+/)
    .filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()))
    .map((w) => w[0].toLowerCase())
    .join('');

/** One clear candidate, or null when there are none or several. */
const only = (list) => (list.length === 1 ? list[0] : null);

/**
 * Which of your subjects a timetable name probably means: { subjectId, confidence } or null.
 * Tries, in order: exact name or code, the code inside the name, initials ("DSA"), a prefix ("Phy").
 */
export function matchSubject(name, subjects) {
  const n = baseName(name) || norm(name);
  if (!n) return null;
  const exact = subjects.find((s) => norm(s.name) === n || (s.code && norm(s.code) === n));
  if (exact) return { subjectId: exact.id, confidence: 'exact' };
  const full = norm(name);
  const byCode = only(subjects.filter((s) => s.code && norm(s.code).length >= 3 && full.includes(norm(s.code))));
  if (byCode) return { subjectId: byCode.id, confidence: 'likely' };
  if (n.length >= 2) {
    const byInitials = only(subjects.filter((s) => initials(s.name).length >= 2 && initials(s.name) === n));
    if (byInitials) return { subjectId: byInitials.id, confidence: 'likely' };
  }
  if (n.length >= 3) {
    const byPrefix = only(subjects.filter((s) => norm(s.name).startsWith(n)));
    if (byPrefix) return { subjectId: byPrefix.id, confidence: 'likely' };
    // Abbreviations like "Maths" or "Engg": the same first letter, and the rest in order.
    const byLetters = only(subjects.filter((s) => norm(s.name)[0] === n[0] && inOrder(n, norm(s.name))));
    if (byLetters) return { subjectId: byLetters.id, confidence: 'likely' };
  }
  return null;
}

/** True when every letter of `short` appears in `long`, in order. */
function inOrder(short, long) {
  let i = 0;
  for (const ch of long) if (ch === short[i]) i += 1;
  return i === short.length;
}

/** The distinct names on the timetable: [{ key, name, count, match }], most classes first. */
export function groupNames(rows, subjects) {
  const map = new Map();
  for (const r of rows) {
    const key = r.name.toLowerCase();
    if (!map.has(key)) map.set(key, { key, name: r.name, count: 0, match: matchSubject(r.name, subjects) });
    map.get(key).count += 1;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The starting choice for a name: match it when there's a suggestion, otherwise create it. */
export function defaultDecision(group) {
  if (group.match) return { action: 'match', subjectId: group.match.subjectId };
  return { action: 'create', name: tidy(group.name.replace(KIND_WORDS, ' '), IMPORT.nameMax) || group.name, credits: IMPORT.creditsDefault };
}

/**
 * Turns rows and your choices into records to save: { newSubjects, slots }.
 * decisions: Map(key → { action: 'match', subjectId } | { action: 'create', name, credits } | { action: 'skip' })
 * Two names created with the same subject name become one subject; identical classes are kept once.
 */
export function buildSlots(rows, decisions, { semesterId, subjects = [] }) {
  const used = subjects.map((s) => s.color);
  const created = new Map(); // normalized new name → subject
  const newSubjects = [];
  const subjectFor = (d) => {
    if (d.action === 'match') return d.subjectId;
    const k = norm(d.name);
    const existing = subjects.find((s) => norm(s.name) === k);
    if (existing) return existing.id;
    if (!created.has(k)) {
      const color = pickColor(used);
      used.push(color);
      const s = makeSubject({ semesterId, name: tidy(d.name, IMPORT.nameMax), credits: d.credits ?? IMPORT.creditsDefault, color });
      created.set(k, s);
      newSubjects.push(s);
    }
    return created.get(k).id;
  };
  const slots = [];
  const seen = new Set();
  for (const r of rows) {
    const d = decisions.get(r.name.toLowerCase());
    if (!d || d.action === 'skip' || (d.action === 'create' && !norm(d.name))) continue;
    const subjectId = subjectFor(d);
    const key = `${r.day}|${r.start}|${r.end}|${subjectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push(makeSlot({ semesterId, subjectId, label: r.label, day: r.day, start: r.start, end: r.end }));
  }
  return { newSubjects, slots };
}

const sameClass = (a, b) => a.day === b.day && a.start === b.start && a.end === b.end && a.subjectId === b.subjectId;

/**
 * What saving does: { save, removeIds, skipped, overlaps }.
 * 'add' keeps your classes and skips imported ones you already have; 'replace' swaps the whole timetable.
 */
export function planSave(existingSlots, slots, mode) {
  if (mode === 'replace') {
    return { save: slots, removeIds: existingSlots.map((s) => s.id), skipped: 0, overlaps: overlappingIds(slots).size };
  }
  const save = slots.filter((s) => !existingSlots.some((e) => sameClass(e, s)));
  return { save, removeIds: [], skipped: slots.length - save.length, overlaps: overlappingIds([...existingSlots, ...save]).size };
}

/** "Found 32 classes on 6 days" */
export function foundLine(rows) {
  const days = new Set(rows.map((r) => r.day)).size;
  return `Found ${rows.length} class${rows.length === 1 ? '' : 'es'} on ${days} day${days === 1 ? '' : 's'}`;
}
