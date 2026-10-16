import { describe, it, expect } from 'vitest';
import { skyModel, moodFor, SKY } from '../src/model/sky.js';
import { addDays } from '../src/model/time.js';

const D = '2026-10-19';
const day = (n) => addDays(D, n);
const semester = { startDate: D, endDate: day(90) };
const subjects = [
  { id: 'A', name: 'Maths' },
  { id: 'B', name: 'Physics' },
];
const exam = (id, subjectId, type, date) => ({ id, subjectId, type, date, weight: 30, unitIds: [] });
const deadlines = [
  exam('midA', 'A', 'midsem', day(20)),
  exam('endA', 'A', 'endsem', day(60)),
  { id: 'q', subjectId: 'A', type: 'quiz', date: day(3), weight: 10, unitIds: [] },
];
const sky = (today, ds = deadlines) => skyModel({ deadlines: ds, subjects, semester, today });

describe('moodFor', () => {
  it('warms as the exam gets close', () => {
    expect([14, 13, 7, 6, 3, 2, 1, 0].map(moodFor)).toEqual(['day', 'afternoon', 'afternoon', 'golden', 'golden', 'dusk', 'dusk', 'examday']);
  });
});

describe('skyModel', () => {
  it('counts down to the next exam (quizzes are not exams)', () => {
    expect(sky(day(6))).toMatchObject({ mood: 'day', daysLeft: 14, next: { date: day(20), label: 'Maths mid-sem', count: 1 }, stars: 2 });
    expect(sky(day(6)).text).toBe('14 days to the Maths mid-sem');
    expect(sky(day(14))).toMatchObject({ mood: 'golden', text: '6 days to the Maths mid-sem' });
    expect(sky(day(19))).toMatchObject({ mood: 'dusk', text: 'The Maths mid-sem is tomorrow' });
    expect(sky(day(20))).toMatchObject({ mood: 'examday', sun: 1, text: 'Maths mid-sem today. You’ve got this.' });
  });
  it('the sun crosses from the semester start, then from the previous exam', () => {
    expect(sky(day(0)).sun).toBe(0);
    expect(sky(day(10)).sun).toBeCloseTo(0.5);
    expect(sky(day(30)).sun).toBeCloseTo(0.25); // 10 of the 40 days from the mid-sem to the end-sem
  });
  it('before the semester starts, the sun is still rising', () => {
    expect(sky(day(-5)).sun).toBe(0);
  });
  it('groups exams on the same day', () => {
    const ds = [exam('x', 'A', 'endsem', day(5)), exam('y', 'B', 'endsem', day(5))];
    expect(sky(D, ds)).toMatchObject({ next: { label: '2 exams', count: 2 }, text: '5 days to 2 exams' });
    expect(sky(day(4), ds).text).toBe('2 exams tomorrow');
    expect(sky(day(5), ds).text).toBe('2 exams today. You’ve got this.');
  });
  it('is a calm night after the last exam', () => {
    expect(sky(day(61))).toMatchObject({ mood: 'night', next: null, text: 'Exams done. Rest well.' });
  });
  it('has no countdown without exams, and the sun follows the semester', () => {
    expect(sky(day(45), [])).toMatchObject({ mood: 'day', next: null, text: null });
    expect(sky(day(45), []).sun).toBeCloseTo(0.5);
  });
  it('shows one star per exam to come, up to a limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => exam(`e${i}`, 'A', 'endsem', day(30 + i)));
    expect(sky(D, many).stars).toBe(SKY.maxStars);
  });
  it('never uses alarm words', () => {
    const alarm = /\b(hurry|urgent|late|behind|warning|only|danger|panic)\b/i;
    for (let n = -1; n <= 70; n++) {
      const text = sky(day(n)).text ?? '';
      expect(text).not.toMatch(alarm);
    }
  });
});
