import { describe, it, expect } from 'vitest';
import { buildPlan, dayCapacity, blockSize, BLOCK } from '../src/model/planner.js';
import { withSemesterDefaults } from '../src/model/factory.js';
import { addDays } from '../src/model/time.js';

// 2026-10-19 is a Monday.
const START = '2026-10-19';
const day = (n) => addDays(START, n);

const semester = (fields = {}) => ({
  id: 'sem',
  name: 'Sem',
  startDate: START,
  endDate: day(41),
  dailyLimitMin: 120,
  studyFrom: '07:00',
  studyTo: '23:00',
  bufferDays: 2,
  offDays: [],
  ...fields,
});

/** One subject with one unit per entry in `units`; each unit is a list of topic minutes. */
function subject(id, units, { credits = 3, difficulty = 2 } = {}) {
  const s = { id, name: id, credits };
  const us = [];
  const ts = [];
  units.forEach((mins, ui) => {
    const unitId = `${id}-u${ui + 1}`;
    us.push({ id: unitId, subjectId: id, name: `Unit ${ui + 1}`, order: ui });
    mins.forEach((estMin, ti) => {
      ts.push({ id: `${unitId}-t${ti + 1}`, unitId, subjectId: id, name: `Topic ${ti + 1}`, estMin, difficulty, order: ti });
    });
  });
  return { subjects: [s], units: us, topics: ts };
}

function merge(...parts) {
  return parts.reduce(
    (acc, p) => ({
      subjects: [...acc.subjects, ...p.subjects],
      units: [...acc.units, ...p.units],
      topics: [...acc.topics, ...p.topics],
    }),
    { subjects: [], units: [], topics: [] },
  );
}

const deadline = (fields) => ({ id: 'd', subjectId: 'A', type: 'quiz', date: day(10), weight: 10, unitIds: [], ...fields });

function plan({ data = subject('A', [[60, 60]]), today = START, ...rest } = {}) {
  return buildPlan({ semester: semester(), deadlines: [], slots: [], sessions: [], today, ...data, ...rest });
}

// New work only; reviews (Milestone 4) have their own helper.
const learnOf = (d) => d.items.filter((it) => it.kind === 'learn');
const allItems = (p) => p.days.flatMap((d) => learnOf(d).map((it) => ({ ...it, date: d.date })));
const allReviews = (p) => p.days.flatMap((d) => d.items.filter((it) => it.kind === 'review').map((it) => ({ ...it, date: d.date })));
const planned = (p, topicId) => allItems(p).filter((it) => it.topicId === topicId);
const totalPlanned = (p) => allItems(p).reduce((s, it) => s + it.minutes, 0);

describe('dayCapacity', () => {
  const settings = withSemesterDefaults(semester({ dailyLimitMin: 600 }));
  const slots = [{ day: 0, start: '09:00', end: '13:00' }]; // Monday classes
  it('subtracts class hours and caps at the daily limit', () => {
    expect(dayCapacity({ settings, slots, date: day(0), today: day(0) })).toBe(600); // 16 h − 4 h = 12 h, capped at 10 h
    expect(dayCapacity({ settings: { ...settings, dailyLimitMin: 120 }, slots, date: day(0), today: day(0) })).toBe(120);
    const busy = [{ day: 0, start: '07:00', end: '22:30' }];
    expect(dayCapacity({ settings, slots: busy, date: day(0), today: day(0) })).toBe(30);
  });
  it('is 0 on an off day', () => {
    expect(dayCapacity({ settings: { ...settings, offDays: [day(1)] }, slots, date: day(1), today: day(0) })).toBe(0);
  });
  it('shortens today by the time already gone and minutes already studied', () => {
    // 20:00 now → 3 h left until 23:00.
    expect(dayCapacity({ settings, slots, date: day(0), today: day(0), nowMin: 20 * 60 })).toBe(180);
    expect(dayCapacity({ settings, slots, date: day(0), today: day(0), nowMin: 20 * 60, studiedToday: 500 })).toBe(100);
    // Other days are not affected by the clock.
    expect(dayCapacity({ settings, slots, date: day(1), today: day(0), nowMin: 20 * 60 })).toBe(600);
  });
});

describe('blockSize', () => {
  it('takes the whole topic when it fits', () => {
    expect(blockSize(45, 120)).toBe(45);
    expect(blockSize(10, 120)).toBe(10);
  });
  it('caps a block at 90 minutes and never leaves a crumb behind', () => {
    expect(blockSize(200, 120)).toBe(90);
    expect(blockSize(100, 120)).toBe(80); // 80 now, 20 later — not 90 + 10
  });
  it('skips when only a crumb of time is left', () => {
    expect(blockSize(60, 15)).toBe(0);
    expect(blockSize(25, 22)).toBe(0);
  });
  it('allows smaller blocks on short days', () => {
    expect(blockSize(60, 15, 15)).toBe(15);
  });
});

describe('placement', () => {
  const data = merge(
    subject('A', [[45, 120, 30], [200, 15]], { credits: 4, difficulty: 3 }),
    subject('B', [[60, 60, 90], [75]], { credits: 2, difficulty: 1 }),
  );
  const slots = [
    { day: 0, start: '07:00', end: '21:00' },
    { day: 2, start: '07:00', end: '22:00' },
  ];
  const p = plan({ data, slots, deadlines: [deadline({ id: 'mid', type: 'midsem', date: day(20) })] });

  it('never plans more than a day can hold', () => {
    for (const d of p.days) {
      expect(d.items.reduce((s, it) => s + it.minutes, 0)).toBeLessThanOrEqual(d.capacity);
    }
    // Monday has 2 h free, Wednesday 1 h.
    expect(p.days[0].capacity).toBe(120);
    expect(p.days[2].capacity).toBe(60);
  });
  it('keeps blocks between 20 and 90 minutes, except a small last part', () => {
    for (const it of allItems(p)) {
      expect(it.minutes).toBeLessThanOrEqual(BLOCK.max);
      if (it.part !== it.parts) expect(it.minutes).toBeGreaterThanOrEqual(BLOCK.min);
    }
  });
  it('plans all the work and at most one block per topic per day', () => {
    expect(totalPlanned(p)).toBe(data.topics.reduce((s, t) => s + t.estMin, 0));
    expect(p.unscheduled).toEqual([]);
    for (const d of p.days) {
      const ids = d.items.map((it) => it.topicId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('splits a long topic across days with part labels', () => {
    const parts = planned(p, 'A-u2-t1');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((it) => it.part)).toEqual(parts.map((_, k) => k + 1));
    expect(parts.every((it) => it.parts === parts.length)).toBe(true);
    expect(parts.reduce((s, it) => s + it.minutes, 0)).toBe(200);
  });
  it('follows syllabus order inside a unit', () => {
    const items = allItems(p);
    const firstIndex = (id) => items.findIndex((it) => it.topicId === id);
    const lastIndex = (id) => items.findLastIndex((it) => it.topicId === id);
    // B-u1-t3 is harder to reach than t1 and t2 but must come after them.
    expect(lastIndex('A-u1-t1')).toBeLessThan(firstIndex('A-u1-t2'));
    expect(lastIndex('A-u1-t2')).toBeLessThan(firstIndex('A-u1-t3'));
    expect(lastIndex('B-u1-t2')).toBeLessThan(firstIndex('B-u1-t3'));
  });
  it('is deterministic', () => {
    const again = plan({ data, slots, deadlines: [deadline({ id: 'mid', type: 'midsem', date: day(20) })] });
    expect(again).toEqual(p);
  });
});

describe('priority and the deadline guard', () => {
  // B is the "important" subject: many credits, hard topics, heavy end-sem.
  const data = merge(subject('A', [[90, 90, 50]], { credits: 1, difficulty: 1 }), subject('B', [[90, 90, 90]], { credits: 10, difficulty: 3 }));
  const endsemB = deadline({ id: 'endB', subjectId: 'B', type: 'endsem', date: day(40), weight: 60 });

  it('without a tight deadline, the higher score goes first', () => {
    const p = plan({ data, deadlines: [endsemB] });
    expect(p.days[0].items[0].subjectId).toBe('B');
  });
  it('a tight quiz goes ahead of higher-scoring but distant work, and is met', () => {
    const quiz = deadline({ id: 'quizA', subjectId: 'A', date: day(1), weight: 1, unitIds: ['A-u1'] });
    const p = plan({ data, deadlines: [endsemB, quiz] });
    expect(p.days[0].items.every((it) => it.subjectId === 'A')).toBe(true);
    const quizWork = allItems(p).filter((it) => it.subjectId === 'A');
    expect(quizWork.every((it) => it.date <= day(1))).toBe(true);
    expect(p.atRisk).toEqual([]);
  });
});

describe('buffer days', () => {
  it('stay free of new work when there is room, and are marked on the plan', () => {
    const data = merge(subject('A', [[60]]), subject('B', [[90, 90, 90, 90, 90, 90]]));
    const mid = deadline({ id: 'mid', type: 'midsem', date: day(10) });
    const p = plan({ data, deadlines: [mid] });
    const buffers = p.days.filter((d) => d.buffer);
    expect(buffers.map((d) => d.date)).toEqual([day(8), day(9)]);
    expect(buffers.every((d) => d.bufferFor === 'mid' && learnOf(d).length === 0)).toBe(true);
    expect(p.atRisk).toEqual([]);
  });
  it('are used for exam work only when you are behind', () => {
    const data = subject('A', [[60, 60, 60, 60, 60]]);
    const mid = deadline({ id: 'mid', type: 'midsem', date: day(5) });
    const p = plan({ data, deadlines: [mid], semester: semester({ dailyLimitMin: 60 }) });
    // Due by day 2: three topics fit, two spill into the buffer days 3 and 4.
    expect(p.days[3].buffer && p.days[4].buffer).toBe(true);
    expect(learnOf(p.days[3]).map((it) => it.overdue)).toEqual([true]);
    expect(learnOf(p.days[4])).toHaveLength(1);
    expect(p.atRisk).toEqual(['mid']);
    expect(p.unscheduled).toEqual([]);
  });
});

describe('reshuffle', () => {
  const data = subject('A', [[60, 60, 60, 60]]);
  const sem = semester({ dailyLimitMin: 60 });

  it('a missed day moves its work to the days ahead', () => {
    const first = plan({ data, semester: sem });
    expect(first.days[0].items[0].topicId).toBe('A-u1-t1');
    // Next day, nothing was logged: the same topic comes first again and nothing is lost.
    const next = plan({ data, semester: sem, today: day(1) });
    expect(next.days[0].date).toBe(day(1));
    expect(next.days[0].items[0].topicId).toBe('A-u1-t1');
    expect(totalPlanned(next)).toBe(240);
  });
  it('finishing a topic removes it; partial study shrinks it', () => {
    const sessions = [
      { topicId: 'A-u1-t1', date: day(0), minutes: 60, finished: true },
      { topicId: 'A-u1-t2', date: day(0), minutes: 20, finished: false },
    ];
    const p = plan({ data, semester: sem, sessions, today: day(1) });
    expect(planned(p, 'A-u1-t1')).toEqual([]);
    expect(planned(p, 'A-u1-t2').reduce((s, it) => s + it.minutes, 0)).toBe(40);
    expect(totalPlanned(p)).toBe(160);
  });
  it('study logged today uses up today’s time', () => {
    const sessions = [{ topicId: 'A-u1-t1', date: day(0), minutes: 60, finished: true }];
    const p = plan({ data, semester: sem, sessions });
    expect(p.days[0].capacity).toBe(0);
    expect(p.days[0].items).toEqual([]);
  });
  it('a newly added topic joins the plan', () => {
    const more = merge(data, subject('C', [[45]]));
    expect(planned(plan({ data: more, semester: sem }), 'C-u1-t1')).toHaveLength(1);
  });
  it('a day off moves its work along', () => {
    const p = plan({ data, semester: { ...sem, offDays: [day(0)] } });
    expect(p.days[0].items).toEqual([]);
    expect(p.days[1].items[0].topicId).toBe('A-u1-t1');
  });
});

describe('overload and edges', () => {
  it('reports work that cannot fit', () => {
    const data = subject('A', [[90, 90, 90, 90, 90]]);
    const quiz = deadline({ id: 'quiz', date: day(2), unitIds: ['A-u1'] });
    const p = plan({ data, deadlines: [quiz], semester: semester({ endDate: day(3), dailyLimitMin: 60 }) });
    expect(p.atRisk).toEqual(['quiz']);
    expect(p.unscheduled.reduce((s, u) => s + u.minutes, 0)).toBe(450 - 4 * 60);
  });
  it('still plans with a tiny daily limit', () => {
    const p = plan({ semester: semester({ dailyLimitMin: 15 }) });
    expect(p.days[0].items).toEqual([expect.objectContaining({ minutes: 15 })]);
  });
  it('fills in planner settings for semesters saved before Milestone 2', () => {
    const old = { id: 'sem', name: 'Old', startDate: START, endDate: day(41), dailyLimitMin: 90 };
    const p = plan({ semester: old });
    expect(p.days[0].capacity).toBe(90);
    expect(totalPlanned(p)).toBe(120);
  });
  it('plans from the first day of a semester that has not started, and nothing after it ends', () => {
    expect(plan({ today: day(-5) }).days[0].date).toBe(START);
    expect(plan({ today: day(50) }).days).toEqual([]);
  });
  it('reports the phase for today', () => {
    expect(plan().phase).toBe('keepup');
    expect(plan({ today: day(30) }).phase).toBe('exam');
  });
});

describe('learning from sessions', () => {
  const s = (topicId, minutes, fields = {}) => ({ topicId, subjectId: topicId[0], date: day(-1), minutes, finished: false, rating: null, ...fields });

  it('a topic rated hard comes before an otherwise equal one', () => {
    const data = merge(subject('A', [[60]]), subject('B', [[60]]));
    const opts = { data, semester: semester({ dailyLimitMin: 60 }) };
    expect(plan({ ...opts, sessions: [s('B-u1-t1', 10)] }).days[0].items[0].topicId).toBe('A-u1-t1');
    expect(plan({ ...opts, sessions: [s('B-u1-t1', 10, { rating: 'hard' })] }).days[0].items[0].topicId).toBe('B-u1-t1');
  });
  it('a slow pace gives the rest of that subject more time', () => {
    const data = subject('A', [[60, 60, 60]]);
    expect(totalPlanned(plan({ data, sessions: [s('A-u1-t1', 60, { finished: true })] }))).toBe(120);
    // pace = (150 + 90) / (60 + 90) = 1.6 → each 60 min topic becomes 95 min
    expect(totalPlanned(plan({ data, sessions: [s('A-u1-t1', 150, { finished: true })] }))).toBe(190);
  });
});

describe('spaced revision', () => {
  const done = (topicId, date = day(-1), fields = {}) => ({ topicId, subjectId: topicId[0], date, minutes: 60, finished: true, rating: null, ...fields });
  const reviewsOn = (p, n) => p.days[n].items.filter((it) => it.kind === 'review');

  it('a topic finished yesterday is reviewed today, before new work', () => {
    const p = plan({ data: subject('A', [[60, 60, 60]]), sessions: [done('A-u1-t1')] });
    const [first, second] = p.days[0].items;
    expect(first).toMatchObject({ kind: 'review', topicId: 'A-u1-t1', review: 1, minutes: 15, weak: false });
    expect(second.kind).toBe('learn');
  });
  it('the coming reviews are 1, 3, 7 and 21 days apart, then the topic is mastered', () => {
    const p = plan({ data: subject('A', [[60]]), sessions: [done('A-u1-t1')] });
    expect(allReviews(p).map((r) => [r.date, r.review])).toEqual([
      [day(0), 1],
      [day(3), 2],
      [day(10), 3],
      [day(31), 4],
    ]);
  });
  it('a weak topic is reviewed first, and for a little longer', () => {
    const sessions = [done('A-u1-t1'), done('A-u1-t2', day(-1), { rating: 'hard' })];
    const reviews = reviewsOn(plan({ data: subject('A', [[60, 60]]), sessions }), 0);
    expect(reviews.map((r) => [r.topicId, r.weak, r.minutes])).toEqual([
      ['A-u1-t2', true, 25],
      ['A-u1-t1', false, 15],
    ]);
  });
  it('reviews take at most their share of the day, but one always fits', () => {
    const data = merge(subject('A', [[60, 60, 60, 60, 60, 60]]), subject('B', [[90, 90, 90, 90]]));
    const sessions = data.topics.filter((t) => t.subjectId === 'A').map((t) => done(t.id));
    const roomy = plan({ data, sessions }); // 120 min: 30% = 36 → two 15-min reviews
    expect(reviewsOn(roomy, 0)).toHaveLength(2);
    expect(learnOf(roomy.days[0]).length).toBeGreaterThan(0);
    const tight = plan({ data, sessions, semester: semester({ dailyLimitMin: 20 }) });
    expect(reviewsOn(tight, 0)).toHaveLength(1);
  });
  it('a topic the plan finishes today comes back tomorrow', () => {
    const p = plan({ data: subject('A', [[60]]), semester: semester({ dailyLimitMin: 60 }) });
    expect(allReviews(p)[0]).toMatchObject({ date: day(1), topicId: 'A-u1-t1', review: 1 });
  });
  it('buffer days review the exam’s topics, weakest first', () => {
    const data = merge(subject('A', [[60, 60]]), subject('B', [[60]]));
    const sessions = [done('A-u1-t1', day(-1), { rating: 'hard' }), done('A-u1-t2'), done('B-u1-t1')];
    const mid = deadline({ id: 'mid', subjectId: 'A', type: 'midsem', date: day(10) });
    const p = plan({ data, sessions, deadlines: [mid] });
    expect(p.days[8].buffer).toBe(true);
    expect(reviewsOn(p, 8).map((r) => [r.topicId, r.forExam])).toEqual([
      ['A-u1-t1', 'mid'],
      ['A-u1-t2', 'mid'],
    ]);
    expect(reviewsOn(p, 9).filter((r) => r.forExam)).toEqual([]); // once per exam
  });
  it('when a deadline is tight, reviews only get time new work doesn’t need', () => {
    const data = merge(subject('A', [[60]]), subject('B', [[60, 60]]));
    const quiz = deadline({ id: 'quiz', subjectId: 'B', date: day(1), unitIds: ['B-u1'] });
    const p = plan({ data, sessions: [done('A-u1-t1')], deadlines: [quiz], semester: semester({ dailyLimitMin: 60 }) });
    expect(reviewsOn(p, 0)).toEqual([]);
    expect(allItems(p).filter((it) => it.subjectId === 'B').every((it) => it.date <= day(1))).toBe(true);
    expect(p.atRisk).toEqual([]);
    expect(allReviews(p)[0]).toMatchObject({ date: day(2), topicId: 'A-u1-t1' });
  });
  it('a missed review stays due and is marked overdue', () => {
    const p = plan({ data: subject('A', [[60]]), sessions: [done('A-u1-t1')], today: day(2) });
    expect(reviewsOn(p, 0)).toEqual([expect.objectContaining({ topicId: 'A-u1-t1', review: 1, overdue: true })]);
  });
  it('a real review moves the next one along', () => {
    const sessions = [done('A-u1-t1'), { topicId: 'A-u1-t1', date: day(0), minutes: 15, finished: false, rating: 'easy' }];
    const p = plan({ data: subject('A', [[60]]), sessions, today: day(1) });
    // Reviewed on day 0 rated easy: next gap 3 × 1.5 → 5 days.
    expect(allReviews(p)[0]).toMatchObject({ date: day(5), review: 2 });
  });
});
