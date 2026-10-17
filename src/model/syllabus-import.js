// Importing subjects, units and topics that the AI helper read from a syllabus. Pure functions.
//
// Step 1: the helper lists the subjects in the document; these are tidied and the ones that look
// like yours are suggested. Step 2: for each subject you pick, it lists units and topics; these
// are tidied, given study-time estimates, and merged into what you already have (never replacing it).

import { makeSubject, makeTopic, makeUnit, pickColor } from './factory.js';
import { nextOrder } from './summary.js';
import { matchSubject } from './timetable-import.js';
import { LIMITS } from './validate.js';

export const SYLLABUS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxPhotos: 12,
  defaultMin: 45, // a topic's time when the syllabus gives no hours
  studyPerLectureHour: 1.5, // study time for each lecture hour
  minTopicMin: 15,
  maxTopicMin: 180,
  round: 5,
  maxUnits: 12,
  maxTopicsPerUnit: 25,
  maxSubjects: 60,
  difficultyWeight: { 1: 0.75, 2: 1, 3: 1.4 },
};

const tidy = (s, max) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** "Sem 5", "Semester V", "5th semester", "V", "5" → 5; null when there's no semester number. */
export function semesterNumber(text) {
  const s = String(text ?? '').toLowerCase();
  const m =
    s.match(/\b(?:sem(?:ester)?|term)\s*[-:.]?\s*([0-9]{1,2}|[ivx]{1,4})\b/) ??
    s.match(/\b([0-9]{1,2})(?:st|nd|rd|th)?\s*(?:sem(?:ester)?|term)\b/) ??
    s.trim().match(/^([0-9]{1,2}|[ivx]{1,4})$/);
  if (!m) return null;
  const v = /^\d+$/.test(m[1]) ? Number(m[1]) : ROMAN[m[1]];
  return v >= 1 && v <= 12 ? v : null;
}

/**
 * The subjects the helper found → [{ key, name, code, credits, semester, pages, match, suggested }].
 * Removes duplicates (same code, or same name), and suggests subjects that match yours or your semester.
 */
export function cleanSubjectList(raw, mySubjects = [], hint = '') {
  const hintSem = semesterNumber(hint);
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= SYLLABUS.maxSubjects) break;
    const name = tidy(r?.name, LIMITS.nameMax);
    if (!name) continue;
    const code = tidy(r?.code, 20);
    const key = code ? `c:${norm(code)}` : `n:${norm(name)}`;
    if (seen.has(key) || seen.has(`n:${norm(name)}`)) continue;
    seen.add(key);
    seen.add(`n:${norm(name)}`);
    const credits = Number(r?.credits);
    const semester = tidy(r?.semester, 30);
    const match = matchSubject(name, mySubjects) ?? (code ? matchSubject(code, mySubjects) : null);
    const sem = semesterNumber(semester);
    out.push({
      key,
      name,
      code,
      credits: Number.isFinite(credits) && credits >= 0 && credits <= 10 ? credits : null,
      semester,
      pages: tidy(r?.pages, 30),
      match,
      suggested: Boolean(match) || (hintSem !== null && sem === hintSem),
    });
  }
  return out;
}

/**
 * Units from the helper → [{ name, hours, topics: [{ name, difficulty }] }], tidied and capped.
 * A unit without a name becomes "Unit N"; empty units and repeated topics are dropped.
 */
export function cleanUnits(raw) {
  const units = [];
  for (const u of Array.isArray(raw) ? raw : []) {
    if (units.length >= SYLLABUS.maxUnits) break;
    if (!u || typeof u !== 'object') continue;
    const seen = new Set();
    const topics = [];
    for (const t of Array.isArray(u.topics) ? u.topics : []) {
      if (topics.length >= SYLLABUS.maxTopicsPerUnit) break;
      const name = tidy(typeof t === 'string' ? t : t?.name, LIMITS.nameMax);
      if (!name || seen.has(norm(name))) continue;
      seen.add(norm(name));
      const d = Math.round(Number(t?.difficulty));
      topics.push({ name, difficulty: d >= 1 && d <= 3 ? d : 2 });
    }
    if (!topics.length) continue;
    const hours = parseFloat(u.hours);
    units.push({
      name: tidy(u.name, LIMITS.nameMax) || `Unit ${units.length + 1}`,
      hours: Number.isFinite(hours) && hours >= 0.5 && hours <= 100 ? hours : null,
      topics,
    });
  }
  return units;
}

/**
 * Study minutes for each topic of a unit, in order.
 * With lecture hours: hours × 60 × 1.5, shared by difficulty (easy 0.75, medium 1, hard 1.4).
 * Without: 45 min each. Rounded to 5 min, kept between 15 min and 3 h.
 */
export function estimateTopicMinutes(unit) {
  const topics = unit.topics ?? [];
  if (!unit.hours) return topics.map(() => SYLLABUS.defaultMin);
  const total = unit.hours * 60 * SYLLABUS.studyPerLectureHour;
  const w = (t) => SYLLABUS.difficultyWeight[t.difficulty] ?? 1;
  const sum = topics.reduce((s, t) => s + w(t), 0) || 1;
  return topics.map((t) => {
    const m = Math.round((total * w(t)) / sum / SYLLABUS.round) * SYLLABUS.round;
    return Math.min(SYLLABUS.maxTopicMin, Math.max(SYLLABUS.minTopicMin, m));
  });
}

/** Units ready for review: each topic gets its estimated minutes. */
export function withEstimates(units) {
  return units.map((u) => {
    const mins = estimateTopicMinutes(u);
    return { ...u, topics: u.topics.map((t, i) => ({ ...t, estMin: mins[i] })) };
  });
}

/** "5 subjects · 23 units · 140 topics · about 186 h of study" (only the subjects you keep). */
export function reviewTotals(picks) {
  const kept = picks.filter((p) => p.decision.action !== 'skip');
  const units = kept.flatMap((p) => p.units);
  const topics = units.flatMap((u) => u.topics);
  const minutes = topics.reduce((s, t) => s + (t.estMin || 0), 0);
  return { subjects: kept.length, units: units.length, topics: topics.length, hours: Math.round(minutes / 60) };
}

/**
 * What saving adds: { subjects, units, topics } (new records only).
 * picks: [{ decision: { action: 'match', subjectId } | { action: 'create', name, code, credits } | { action: 'skip' },
 *           units: [{ name, topics: [{ name, estMin, difficulty }] }] }]
 * A unit with the same name as one you have is reused, and topics you already have are left out.
 */
export function planSyllabusSave({ picks, existing, semesterId }) {
  const subjects = [];
  const units = [];
  const topics = [];
  const used = existing.subjects.map((s) => s.color);
  const allSubjects = () => [...existing.subjects, ...subjects];
  const unitsOf = (subjectId) => [...existing.units, ...units].filter((u) => u.subjectId === subjectId);
  const topicsOf = (unitId) => [...existing.topics, ...topics].filter((t) => t.unitId === unitId);

  for (const pick of picks) {
    const d = pick.decision;
    if (!d || d.action === 'skip') continue;
    let subjectId = d.subjectId;
    if (d.action === 'create') {
      const name = tidy(d.name, LIMITS.nameMax);
      if (!name) continue;
      const same = allSubjects().find((s) => norm(s.name) === norm(name));
      if (same) subjectId = same.id;
      else {
        const color = pickColor(used);
        used.push(color);
        const credits = Number(d.credits);
        const s = makeSubject({
          semesterId,
          name,
          code: tidy(d.code, 20),
          credits: Number.isFinite(credits) && credits >= 0 && credits <= 10 ? credits : 3,
          color,
        });
        subjects.push(s);
        subjectId = s.id;
      }
    }
    if (!allSubjects().some((s) => s.id === subjectId)) continue;

    for (const u of pick.units ?? []) {
      const uname = tidy(u.name, LIMITS.nameMax);
      if (!uname) continue;
      let unit = unitsOf(subjectId).find((x) => norm(x.name) === norm(uname));
      if (!unit) {
        unit = makeUnit({ subjectId, name: uname, order: nextOrder(unitsOf(subjectId)) });
        units.push(unit);
      }
      for (const t of u.topics ?? []) {
        const tname = tidy(t.name, LIMITS.nameMax);
        if (!tname || topicsOf(unit.id).some((x) => norm(x.name) === norm(tname))) continue;
        const estMin = Math.min(LIMITS.estMinMax, Math.max(LIMITS.estMinMin, Math.round(Number(t.estMin) || SYLLABUS.defaultMin)));
        const difficulty = [1, 2, 3].includes(t.difficulty) ? t.difficulty : 2;
        topics.push(makeTopic({ unitId: unit.id, subjectId, name: tname, estMin, difficulty, order: nextOrder(topicsOf(unit.id)) }));
      }
    }
  }
  return { subjects, units, topics };
}
