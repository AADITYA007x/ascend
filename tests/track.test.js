import { describe, it, expect } from 'vitest';
import { recentPace, trackStatus, headline } from '../src/model/track.js';
import { buildPlan } from '../src/model/planner.js';
import { addDays } from '../src/model/time.js';

// 2026-10-19 is a Monday.
const START = '2026-10-19';
const day = (n) => addDays(START, n);
const semester = (fields = {}) => ({
  id: 'sem',
  startDate: START,
  endDate: day(41),
  dailyLimitMin: 120,
  studyFrom: '07:00',
  studyTo: '23:00',
  bufferDays: 2,
  offDays: [],
  ...fields,
});

/** Subjects from { A: [[60, 60]], B: [[30]] } — one array of topic minutes per unit. */
function data(spec) {
  const subjects = [];
  const units = [];
  const topics = [];
  for (const [id, unitList] of Object.entries(spec)) {
    subjects.push({ id, name: id, credits: 3 });
    unitList.forEach((mins, ui) => {
      const unitId = `${id}-u${ui + 1}`;
      units.push({ id: unitId, subjectId: id, order: ui });
      mins.forEach((estMin, ti) => topics.push({ id: `${unitId}-t${ti + 1}`, unitId, subjectId: id, estMin, difficulty: 2, order: ti }));
    });
  }
  return { subjects, units, topics };
}
const quiz = (id, subjectId, date, unit = `${subjectId}-u1`) => ({ id, subjectId, type: 'quiz', date, weight: 10, unitIds: [unit] });

function status({ spec = { A: [[60, 60]] }, deadlines = [], sessions = [], sem = semester(), today = START, pace = null } = {}) {
  const d = data(spec);
  const input = { semester: sem, ...d, deadlines, slots: [], sessions, today };
  const plan = buildPlan(input);
  return trackStatus({ plan, deadlines, topics: d.topics, sessions, semester: sem, today, pace });
}
const forDeadline = (list, id) => list.find((s) => s.deadlineId === id);

describe('recentPace', () => {
  const daily = (from, to, minutes) => Array.from({ length: to - from + 1 }, (_, i) => ({ date: day(from + i), minutes }));
  it('needs at least a week of history', () => {
    expect(recentPace({ semester: semester(), sessions: daily(0, 2, 60), today: day(3) })).toBeNull();
  });
  it('is minutes studied over free study time', () => {
    expect(recentPace({ semester: semester(), sessions: daily(0, 13, 60), today: day(14) })).toBeCloseTo(0.5);
  });
  it('skips off days and caps a long day at what was free', () => {
    const sem = semester({ offDays: [day(5)] });
    const sessions = [...daily(0, 13, 60), { date: day(7), minutes: 500 }];
    // 13 counted days × 120 free; day 7 counts as 120 (60 + 500 capped), the off day not at all.
    expect(recentPace({ semester: sem, sessions, today: day(14) })).toBeCloseTo((12 * 60 + 120) / (13 * 120));
  });
});

describe('trackStatus', () => {
  it('is on track with plenty of room', () => {
    const list = status({ deadlines: [quiz('q', 'A', day(10))] });
    // Room: 11 days × 120, less the reviews of the two topics once the plan has finished them (4 × 15 min).
    expect(forDeadline(list, 'q')).toMatchObject({ status: 'ontrack', needMin: 120, roomMin: 11 * 120 - 60, extraPerDay: null });
  });
  it('is tight when the work needs most of the room, with a small daily nudge', () => {
    const list = status({ spec: { A: [[60, 60, 30]] }, deadlines: [quiz('q', 'A', day(2))], sem: semester({ dailyLimitMin: 60 }) });
    // Room: 3 × 60 less one 15-min review of the first topic → 165. Need 150: over 80%.
    // Comfortable needs 187.5 → 22.5 more over 3 days → 10 min a day.
    expect(forDeadline(list, 'q')).toMatchObject({ status: 'tight', needMin: 150, roomMin: 165, extraPerDay: 10 });
  });
  it('is behind when the plan cannot fit it', () => {
    const list = status({ spec: { A: [[60, 60, 30]] }, deadlines: [quiz('q', 'A', day(1))], sem: semester({ dailyLimitMin: 60 }) });
    expect(forDeadline(list, 'q')).toMatchObject({ status: 'behind', extraPerDay: 35 });
    expect(headline(list).deadlineId).toBe('q');
  });
  it('is tight when it only fits at full daily study and your recent pace is lower', () => {
    const args = { deadlines: [quiz('q', 'A', day(10))], sem: semester({ dailyLimitMin: 20 }) };
    expect(forDeadline(status(args), 'q').status).toBe('ontrack');
    expect(forDeadline(status({ ...args, pace: 0.5 }), 'q')).toMatchObject({ status: 'tight', slowPace: true, extraPerDay: 10 });
  });
  it('takes planned review time out of the room', () => {
    const sessions = [{ topicId: 'A-u1-t1', subjectId: 'A', date: day(-1), minutes: 60, finished: true }];
    const list = status({ deadlines: [quiz('q', 'A', day(2))], sessions });
    // Less today's review of the finished topic, and tomorrow's review of the one the plan finishes today.
    expect(forDeadline(list, 'q')).toMatchObject({ needMin: 60, roomMin: 3 * 120 - 15 - 15 });
  });
  it('counts earlier deadlines’ work toward later ones, across subjects', () => {
    const list = status({ spec: { A: [[60]], B: [[60]] }, deadlines: [quiz('qa', 'A', day(3)), quiz('qb', 'B', day(5))] });
    expect(forDeadline(list, 'qa').needMin).toBe(60);
    expect(forDeadline(list, 'qb').needMin).toBe(120);
  });
  it('the semester as a whole only judges work no deadline covers', () => {
    expect(forDeadline(status({ deadlines: [quiz('q', 'A', day(10))] }), null).status).toBe('done');
    expect(forDeadline(status({ deadlines: [] }), null)).toMatchObject({ status: 'ontrack', needMin: 120 });
  });
  it('is done when a deadline’s topics are all finished', () => {
    const sessions = ['A-u1-t1', 'A-u1-t2'].map((topicId) => ({ topicId, subjectId: 'A', date: day(-1), minutes: 60, finished: true }));
    expect(forDeadline(status({ deadlines: [quiz('q', 'A', day(5))], sessions }), 'q').status).toBe('done');
  });
  it('skips deadlines with no topics and ones already past', () => {
    const noTopics = { id: 'n', subjectId: 'A', type: 'assignment', date: day(5), weight: 10, unitIds: [] };
    const past = quiz('p', 'A', day(-2));
    const list = status({ deadlines: [noTopics, past] });
    expect(list.map((s) => s.deadlineId)).toEqual([null]);
  });
});

describe('headline', () => {
  it('picks the soonest of the worst, or nothing when all is well', () => {
    const list = [
      { deadlineId: 'a', dueBy: day(3), status: 'tight' },
      { deadlineId: 'b', dueBy: day(5), status: 'behind' },
      { deadlineId: 'c', dueBy: day(8), status: 'behind' },
    ];
    expect(headline(list).deadlineId).toBe('b');
    expect(headline([{ deadlineId: 'a', dueBy: day(3), status: 'ontrack' }])).toBeNull();
  });
});
