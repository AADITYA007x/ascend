import { describe, it, expect } from 'vitest';
import {
  semesterNumber,
  cleanSubjectList,
  cleanUnits,
  estimateTopicMinutes,
  withEstimates,
  reviewTotals,
  planSyllabusSave,
  SYLLABUS,
} from '../src/model/syllabus-import.js';

const mine = [
  { id: 'dbms', name: 'Database Management Systems', code: 'CS301', color: '#2f6f6a' },
  { id: 'os', name: 'Operating Systems', code: '', color: '#c7794a' },
];

describe('semesterNumber', () => {
  it('reads the usual ways a semester is written', () => {
    expect(['Sem 5', 'Semester V', 'SEM-5', '5th Semester', 'V', '5', 'B.Tech CSE Sem 5'].map(semesterNumber)).toEqual([5, 5, 5, 5, 5, 5, 5]);
    expect(semesterNumber('Semester III')).toBe(3);
  });
  it('gives null without a semester number', () => {
    expect(semesterNumber('B.Tech CSE')).toBeNull();
    expect(semesterNumber('')).toBeNull();
    expect(semesterNumber('Sem 15')).toBeNull();
  });
});

describe('cleanSubjectList', () => {
  const raw = [
    { name: ' Database Management  Systems ', code: 'CS301', credits: 4, semester: 'V', pages: '41-43' },
    { name: 'DBMS (repeat)', code: 'cs 301', credits: 4, semester: 'V' }, // same code
    { name: 'Computer Networks', code: 'CS302', credits: '3', semester: 'Semester 5' },
    { name: 'Engineering Mathematics I', code: 'MA101', credits: 4, semester: 'I' },
    { name: 'Operating Systems', code: '', credits: 99, semester: '' },
    { name: '', code: 'X' },
  ];
  it('tidies, removes repeats and suggests yours or your semester', () => {
    const list = cleanSubjectList(raw, mine, 'B.Tech CSE Sem 5');
    expect(list.map((s) => [s.name, s.code, s.credits, s.suggested])).toEqual([
      ['Database Management Systems', 'CS301', 4, true],
      ['Computer Networks', 'CS302', 3, true],
      ['Engineering Mathematics I', 'MA101', 4, false],
      ['Operating Systems', '', null, true],
    ]);
    expect(list[0]).toMatchObject({ pages: '41-43', match: { subjectId: 'dbms' } });
  });
  it('suggests only matches when there is no semester hint', () => {
    expect(cleanSubjectList(raw, mine, '').filter((s) => s.suggested).map((s) => s.name)).toEqual(['Database Management Systems', 'Operating Systems']);
  });
  it('copes with anything that is not a list', () => {
    expect(cleanSubjectList(null)).toEqual([]);
  });
});

describe('cleanUnits', () => {
  it('tidies units and topics, names unnamed units and keeps sensible hours', () => {
    const units = cleanUnits([
      { name: ' Unit 1: Introduction ', hours: '8 hrs', topics: [{ name: 'ER model', difficulty: 1 }, 'Keys', { name: 'keys', difficulty: 3 }, { name: '', difficulty: 2 }] },
      { name: '', hours: 0, topics: [{ name: 'Normalization', difficulty: 7 }] },
      { name: 'Empty unit', topics: [] },
      null,
    ]);
    expect(units).toEqual([
      { name: 'Unit 1: Introduction', hours: 8, topics: [{ name: 'ER model', difficulty: 1 }, { name: 'Keys', difficulty: 2 }] },
      { name: 'Unit 2', hours: null, topics: [{ name: 'Normalization', difficulty: 2 }] },
    ]);
  });
  it('caps units and topics', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `U${i}`, topics: Array.from({ length: 40 }, (_, j) => `T${j}`) }));
    const units = cleanUnits(many);
    expect(units).toHaveLength(SYLLABUS.maxUnits);
    expect(units[0].topics).toHaveLength(SYLLABUS.maxTopicsPerUnit);
  });
});

describe('estimateTopicMinutes', () => {
  it('uses 45 min each when no hours are given', () => {
    expect(estimateTopicMinutes({ hours: null, topics: [{ difficulty: 1 }, { difficulty: 3 }] })).toEqual([45, 45]);
  });
  it('shares 1.5× the lecture hours by difficulty, rounded to 5 min', () => {
    // 6 h × 1.5 = 540 min; weights 0.75 + 1 + 1.4 = 3.15
    expect(estimateTopicMinutes({ hours: 6, topics: [{ difficulty: 1 }, { difficulty: 2 }, { difficulty: 3 }] })).toEqual([130, 170, 180]);
    expect(estimateTopicMinutes({ hours: 2, topics: [{ difficulty: 2 }, { difficulty: 2 }] })).toEqual([90, 90]);
  });
  it('keeps each topic between 15 min and 3 h', () => {
    expect(estimateTopicMinutes({ hours: 1, topics: Array(10).fill({ difficulty: 1 }) })[0]).toBe(15);
    expect(estimateTopicMinutes({ hours: 40, topics: [{ difficulty: 2 }] })).toEqual([180]);
  });
  it('adds the estimates to review units, and totals what you keep', () => {
    const units = withEstimates([{ name: 'U', hours: 2, topics: [{ name: 'A', difficulty: 2 }, { name: 'B', difficulty: 2 }] }]);
    expect(units[0].topics.map((t) => t.estMin)).toEqual([90, 90]);
    const picks = [
      { decision: { action: 'create', name: 'X' }, units },
      { decision: { action: 'skip' }, units },
    ];
    expect(reviewTotals(picks)).toEqual({ subjects: 1, units: 1, topics: 2, hours: 3 });
  });
});

describe('planSyllabusSave', () => {
  const existing = {
    subjects: mine,
    units: [{ id: 'u1', subjectId: 'dbms', name: 'Unit 1: Introduction', order: 0 }],
    topics: [
      { id: 't1', unitId: 'u1', subjectId: 'dbms', name: 'ER Model', estMin: 45, difficulty: 2, order: 0 },
      { id: 't2', unitId: 'u1', subjectId: 'dbms', name: 'Keys', estMin: 30, difficulty: 2, order: 1 },
    ],
  };
  const unit = (name, ...topics) => ({ name, topics: topics.map((t) => ({ name: t, estMin: 60, difficulty: 3 })) });

  it('reuses a unit you have, skips topics you have, and continues the order', () => {
    const { subjects, units, topics } = planSyllabusSave({
      semesterId: 'S',
      existing,
      picks: [{ decision: { action: 'match', subjectId: 'dbms' }, units: [unit('unit 1 introduction', 'ER model', 'Relational algebra'), unit('Unit 2: Normalization', '1NF', '2NF')] }],
    });
    expect(subjects).toEqual([]);
    expect(units.map((u) => [u.name, u.order, u.subjectId])).toEqual([['Unit 2: Normalization', 1, 'dbms']]);
    expect(topics.map((t) => [t.name, t.unitId === 'u1' ? 'u1' : 'new', t.order, t.estMin, t.difficulty])).toEqual([
      ['Relational algebra', 'u1', 2, 60, 3],
      ['1NF', 'new', 0, 60, 3],
      ['2NF', 'new', 1, 60, 3],
    ]);
  });

  it('creates new subjects once, with a free colour, and leaves out skipped ones', () => {
    const { subjects, units, topics } = planSyllabusSave({
      semesterId: 'S',
      existing,
      picks: [
        { decision: { action: 'create', name: 'Computer Networks', code: 'CS302', credits: 4 }, units: [unit('Unit 1', 'OSI model')] },
        { decision: { action: 'create', name: 'computer  networks', credits: 4 }, units: [unit('Unit 2', 'TCP')] },
        { decision: { action: 'skip' }, units: [unit('Unit 1', 'Ignored')] },
        { decision: { action: 'create', name: 'operating systems' }, units: [unit('Unit 1', 'Processes')] }, // you have it already
      ],
    });
    expect(subjects.map((s) => [s.name, s.code, s.credits, s.semesterId])).toEqual([['Computer Networks', 'CS302', 4, 'S']]);
    expect(mine.map((s) => s.color)).not.toContain(subjects[0].color);
    expect(units.map((u) => [u.name, u.subjectId === subjects[0].id ? 'cn' : u.subjectId])).toEqual([
      ['Unit 1', 'cn'],
      ['Unit 2', 'cn'],
      ['Unit 1', 'os'],
    ]);
    expect(topics.map((t) => t.name)).toEqual(['OSI model', 'TCP', 'Processes']);
  });

  it('keeps times and difficulty within the app’s limits', () => {
    const { topics } = planSyllabusSave({
      semesterId: 'S',
      existing,
      picks: [{ decision: { action: 'match', subjectId: 'os' }, units: [{ name: 'U', topics: [{ name: 'A', estMin: 2000, difficulty: 9 }, { name: 'B' }] }] }],
    });
    expect(topics.map((t) => [t.estMin, t.difficulty])).toEqual([[600, 2], [45, 2]]);
  });
});
