import { describe, it, expect } from 'vitest';
import { makeBackup, parseBackup, backupFileName, countsLine, BACKUP, BACKUP_STORES } from '../src/model/backup.js';

const stores = {
  semesters: [{ id: 'sem1', name: 'Sem 5', startDate: '2026-07-20' }],
  subjects: [{ id: 's1', semesterId: 'sem1', name: 'DSA' }],
  units: [{ id: 'u1', subjectId: 's1', name: 'Trees' }],
  topics: [
    { id: 't1', unitId: 'u1', subjectId: 's1', name: 'AVL' },
    { id: 't2', unitId: 'u1', subjectId: 's1', name: 'B-trees' },
  ],
  deadlines: [],
  classSlots: [],
  sessions: [],
  cards: [],
  attendance: [],
  meta: [
    { key: 'activeSemesterId', value: 'sem1' },
    { key: 'activeTimer', value: { startedAt: 1 } },
    { key: 'lastRoom', value: { code: 'ABC' } },
    { key: 'lastBackupAt', value: '2026-10-01T10:00:00.000Z' },
    { key: 'syllabusHint', value: 'B.Tech CSE Sem 5' },
  ],
};

const text = (obj) => JSON.stringify(obj);
const backup = (over = {}) => ({ ...makeBackup(stores, new Date('2026-10-18T09:00:00Z')), ...over });

describe('makeBackup', () => {
  it('wraps every store with the app name, format and time', () => {
    const b = makeBackup(stores, new Date('2026-10-18T09:00:00Z'));
    expect(b.app).toBe('ascend');
    expect(b.format).toBe(BACKUP.format);
    expect(b.exportedAt).toBe('2026-10-18T09:00:00.000Z');
    expect(Object.keys(b.stores)).toEqual(BACKUP_STORES);
    expect(b.stores.topics).toHaveLength(2);
  });

  it('leaves out what only makes sense on this device', () => {
    const keys = makeBackup(stores).stores.meta.map((r) => r.key);
    expect(keys).toEqual(['activeSemesterId', 'syllabusHint']);
  });

  it('fills missing stores with empty lists', () => {
    expect(makeBackup({ semesters: stores.semesters }).stores.cards).toEqual([]);
  });
});

describe('parseBackup', () => {
  it('reads back what makeBackup wrote', () => {
    const r = parseBackup(text(backup()));
    expect(r.ok).toBe(true);
    expect(r.stores.subjects).toEqual(stores.subjects);
    expect(r.counts).toEqual({ subjects: 1, topics: 2, deadlines: 0, sessions: 0, cards: 0 });
    expect(r.exportedAt).toBe('2026-10-18T09:00:00.000Z');
  });

  it('drops device-only meta even if a file carries it', () => {
    const b = backup();
    b.stores.meta = stores.meta;
    expect(parseBackup(text(b)).stores.meta.map((r) => r.key)).toEqual(['activeSemesterId', 'syllabusHint']);
  });

  it('turns missing stores into empty ones', () => {
    const r = parseBackup(text({ app: 'ascend', format: 1, stores: { semesters: stores.semesters } }));
    expect(r.ok).toBe(true);
    expect(r.stores.topics).toEqual([]);
    expect(r.exportedAt).toBeNull();
  });

  it('opens the newest semester when the file doesn’t say which', () => {
    const b = backup();
    b.stores.semesters = [...stores.semesters, { id: 'sem2', name: 'Sem 6', startDate: '2027-01-10' }];
    b.stores.meta = [{ key: 'activeSemesterId', value: 'gone' }];
    expect(parseBackup(text(b)).stores.meta).toEqual([{ key: 'activeSemesterId', value: 'sem2' }]);
  });

  it.each([
    ['empty text', ''],
    ['not JSON', '{oops'],
    ['another app', text({ app: 'other', format: 1, stores: {} })],
    ['no stores', text({ app: 'ascend', format: 1 })],
    ['a JSON list', '[]'],
  ])('refuses %s', (_, input) => {
    const r = parseBackup(input);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty|isn’t an Ascend backup/);
  });

  it('asks for an update when the format is newer', () => {
    expect(parseBackup(text(backup({ format: 2 }))).error).toMatch(/newer version/);
  });

  it('refuses unknown stores', () => {
    const b = backup();
    b.stores.passwords = [];
    expect(parseBackup(text(b)).ok).toBe(false);
  });

  it.each([
    ['a store that isn’t a list', (b) => (b.stores.topics = {})],
    ['a record without an id', (b) => b.stores.topics.push({ name: 'x' })],
    ['a meta record without a key', (b) => b.stores.meta.push({ value: 1 })],
    ['a repeated id', (b) => b.stores.topics.push({ ...stores.topics[0] })],
    ['a record that isn’t an object', (b) => b.stores.units.push('u2')],
  ])('refuses %s', (_, damage) => {
    const b = JSON.parse(text(backup()));
    damage(b);
    expect(parseBackup(text(b)).error).toMatch(/damaged/);
  });

  it('refuses a backup without a semester', () => {
    const b = backup();
    b.stores.semesters = [];
    expect(parseBackup(text(b)).error).toMatch(/no semester/);
  });

  it('refuses files that are far too big', () => {
    expect(parseBackup('x'.repeat(BACKUP.maxChars + 1)).error).toMatch(/too big/);
  });
});

describe('backupFileName and countsLine', () => {
  it('names the file by date', () => {
    expect(backupFileName('2026-10-18')).toBe('ascend-backup-2026-10-18.json');
  });

  it('says what a backup holds in plain words', () => {
    expect(countsLine({ subjects: 13, topics: 120, deadlines: 1, sessions: 0, cards: 0 })).toBe('13 subjects, 120 topics and 1 deadline');
    expect(countsLine({ subjects: 1, topics: 0, deadlines: 0, sessions: 0, cards: 0 })).toBe('1 subject');
    expect(countsLine({ subjects: 0, topics: 0, deadlines: 0, sessions: 0, cards: 0 })).toBe('no subjects yet');
  });
});
