// Backing up everything on this device to a file, and reading such a file back. Pure functions.
//
// A backup is plain JSON: { app: 'ascend', format: 1, exportedAt, stores: { storeName: [records] } }.
// Restoring replaces everything, so a file is checked fully before anything is touched.

export const BACKUP = {
  app: 'ascend',
  format: 1,
  maxChars: 50 * 1024 * 1024, // far beyond a real semester, small enough to parse on a phone
};

export const BACKUP_STORES = [
  'semesters',
  'subjects',
  'units',
  'topics',
  'deadlines',
  'classSlots',
  'sessions',
  'cards',
  'attendance',
  'meta',
];

// Meta records that only make sense on the device that wrote them.
const TRANSIENT_META = new Set(['activeTimer', 'lastRoom', 'lastBackupAt']);
const ACTIVE_KEY = 'activeSemesterId';

/** Everything read from the database → the backup object (ready for JSON.stringify). */
export function makeBackup(stores, now = new Date()) {
  const out = {};
  for (const name of BACKUP_STORES) {
    const records = Array.isArray(stores?.[name]) ? stores[name] : [];
    out[name] = name === 'meta' ? records.filter((r) => !TRANSIENT_META.has(r?.key)) : records;
  }
  return { app: BACKUP.app, format: BACKUP.format, exportedAt: now.toISOString(), stores: out };
}

/** "ascend-backup-2026-10-18.json" */
export const backupFileName = (ymd) => `ascend-backup-${ymd}.json`;

const fail = (error) => ({ ok: false, error });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The text of a picked file → { ok: true, stores, counts, exportedAt } or { ok: false, error }.
 * Every store comes back (empty when missing), so restoring can clear and refill all of them.
 */
export function parseBackup(text) {
  if (typeof text !== 'string' || !text.trim()) return fail('That file is empty.');
  if (text.length > BACKUP.maxChars) return fail('That file is too big to be an Ascend backup.');

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('That file isn’t an Ascend backup.');
  }
  if (!isObject(data) || data.app !== BACKUP.app || !isObject(data.stores)) return fail('That file isn’t an Ascend backup.');
  if (data.format !== BACKUP.format) return fail('This backup is from a newer version of Ascend. Update the app, then try again.');

  for (const name of Object.keys(data.stores)) {
    if (!BACKUP_STORES.includes(name)) return fail('That backup has parts Ascend doesn’t recognise.');
  }

  const stores = {};
  for (const name of BACKUP_STORES) {
    const records = data.stores[name] ?? [];
    if (!Array.isArray(records)) return fail('That backup looks damaged.');
    const keyField = name === 'meta' ? 'key' : 'id';
    const seen = new Set();
    for (const r of records) {
      if (!isObject(r) || typeof r[keyField] !== 'string' || !r[keyField]) return fail('That backup looks damaged.');
      if (seen.has(r[keyField])) return fail('That backup looks damaged.');
      seen.add(r[keyField]);
    }
    stores[name] = name === 'meta' ? records.filter((r) => !TRANSIENT_META.has(r.key)) : records;
  }

  if (!stores.semesters.length) return fail('That backup has no semester in it.');
  // Open the semester the backup had open, or the newest one if that's missing.
  const active = stores.meta.find((r) => r.key === ACTIVE_KEY);
  if (!active || !stores.semesters.some((s) => s.id === active.value)) {
    const newest = [...stores.semesters].sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? ''))).at(-1);
    stores.meta = [...stores.meta.filter((r) => r.key !== ACTIVE_KEY), { key: ACTIVE_KEY, value: newest.id }];
  }

  const exportedAt = typeof data.exportedAt === 'string' && !Number.isNaN(Date.parse(data.exportedAt)) ? data.exportedAt : null;
  return { ok: true, stores, counts: backupCounts(stores), exportedAt };
}

/** The numbers worth showing before a restore. */
export function backupCounts(stores) {
  const n = (name) => stores?.[name]?.length ?? 0;
  return { subjects: n('subjects'), topics: n('topics'), deadlines: n('deadlines'), sessions: n('sessions'), cards: n('cards') };
}

/** "13 subjects, 120 topics and 4 deadlines" (empty parts left out). */
export function countsLine(counts) {
  const parts = [
    [counts.subjects, 'subject'],
    [counts.topics, 'topic'],
    [counts.deadlines, 'deadline'],
    [counts.sessions, 'study session'],
    [counts.cards, 'flashcard'],
  ]
    .filter(([n]) => n)
    .map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`);
  if (!parts.length) return 'no subjects yet';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
