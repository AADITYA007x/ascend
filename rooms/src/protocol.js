// Focus rooms: the messages between the app and a room, and the rules both sides share. Pure functions.
// The app imports the code and name helpers from here too, so the two never drift apart.

export const PROTOCOL = {
  codeLength: 6,
  // No 0/O, 1/I/L: easy to read out loud and to type from a phone.
  alphabet: '23456789ABCDEFGHJKMNPQRSTUVWXYZ',
  maxMembers: 8,
  nameMin: 2,
  nameMax: 24,
  subjectMax: 40,
  idMin: 8,
  idMax: 64,
  messageMax: 1024, // bytes (characters) per message
  endsAtAheadMs: 4 * 60 * 60 * 1000, // a phase never ends more than 4 h from now
  endsAtBehindMs: 5 * 60 * 1000,
  todayMax: 24 * 60,
  roundsMax: 99,
  burst: 20, // messages allowed in a burst…
  refillPerSec: 2, // …refilled at this rate (20 per 10 s)
  cheerGapMs: 10 * 1000, // one cheer to the same friend per 10 s (the app waits 30 s)
};

export const STATUSES = ['focus', 'break', 'paused', 'idle'];

/** A random room code, e.g. "K7QF3M". random() returns 0 ≤ x < 1. */
export function makeRoomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < PROTOCOL.codeLength; i++) code += PROTOCOL.alphabet[Math.floor(random() * PROTOCOL.alphabet.length)];
  return code;
}

/** "k7q-f3m " → "K7QF3M", or null when it can't be a room code. */
export function normalizeCode(input) {
  const code = String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  if (code.length !== PROTOCOL.codeLength) return null;
  return [...code].every((ch) => PROTOCOL.alphabet.includes(ch)) ? code : null;
}

/** Trimmed, single-spaced, without control characters, at most nameMax characters. */
export function cleanName(name) {
  return String(name ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PROTOCOL.nameMax)
    .trim();
}

const isId = (v) => typeof v === 'string' && v.length >= PROTOCOL.idMin && v.length <= PROTOCOL.idMax && /^[A-Za-z0-9-]+$/.test(v);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** A presence from the app, cleaned; null when it doesn't fit the rules. */
function cleanPresence(p, now) {
  if (!p || typeof p !== 'object' || !STATUSES.includes(p.status)) return null;
  let endsAt = null;
  if (p.endsAt !== null && p.endsAt !== undefined) {
    if (typeof p.endsAt !== 'number' || !Number.isFinite(p.endsAt)) return null;
    if (p.endsAt > now + PROTOCOL.endsAtAheadMs || p.endsAt < now - PROTOCOL.endsAtBehindMs) return null;
    endsAt = Math.round(p.endsAt);
  }
  if ((p.status === 'focus' || p.status === 'break') !== (endsAt !== null)) return null;
  const subject = p.subject === null || p.subject === undefined ? null : cleanName(String(p.subject)).slice(0, PROTOCOL.subjectMax) || null;
  const todayMin = p.todayMin ?? 0;
  const rounds = p.rounds ?? 0;
  if (!isInt(todayMin, 0, PROTOCOL.todayMax) || !isInt(rounds, 0, PROTOCOL.roundsMax)) return null;
  return { status: p.status, endsAt, subject, todayMin, rounds };
}

export const IDLE = { status: 'idle', endsAt: null, subject: null, todayMin: 0, rounds: 0 };

/**
 * Checks a message from the app. Returns { ok: true, msg } or { ok: false, error }.
 * hello { id, name, presence? } · presence { status, endsAt, subject, todayMin, rounds } · cheer { to } · leave
 */
export function parseClientMessage(text, now) {
  if (typeof text !== 'string') return { ok: false, error: 'not-text' };
  if (text.length > PROTOCOL.messageMax) return { ok: false, error: 'too-big' };
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (!m || typeof m !== 'object') return { ok: false, error: 'not-json' };
  switch (m.type) {
    case 'hello': {
      const name = cleanName(m.name);
      if (!isId(m.id)) return { ok: false, error: 'bad-id' };
      if (name.length < PROTOCOL.nameMin) return { ok: false, error: 'bad-name' };
      const presence = m.presence === undefined ? IDLE : cleanPresence(m.presence, now);
      if (!presence) return { ok: false, error: 'bad-presence' };
      return { ok: true, msg: { type: 'hello', id: m.id, name, presence } };
    }
    case 'presence': {
      const presence = cleanPresence(m, now);
      return presence ? { ok: true, msg: { type: 'presence', ...presence } } : { ok: false, error: 'bad-presence' };
    }
    case 'cheer':
      return isId(m.to) ? { ok: true, msg: { type: 'cheer', to: m.to } } : { ok: false, error: 'bad-id' };
    case 'leave':
      return { ok: true, msg: { type: 'leave' } };
    default:
      return { ok: false, error: 'unknown-type' };
  }
}

/** Token bucket. Returns { ok, bucket }; bucket = { tokens, at } (pass null to start one). */
export function rateLimit(bucket, now) {
  const b = bucket ?? { tokens: PROTOCOL.burst, at: now };
  const tokens = Math.min(PROTOCOL.burst, b.tokens + ((now - b.at) / 1000) * PROTOCOL.refillPerSec);
  if (tokens < 1) return { ok: false, bucket: { tokens, at: now } };
  return { ok: true, bucket: { tokens: tokens - 1, at: now } };
}

/** What everyone else sees about a member. */
export const publicMember = (m) => ({
  id: m.id,
  name: m.name,
  status: m.status,
  endsAt: m.endsAt,
  subject: m.subject,
  todayMin: m.todayMin,
  rounds: m.rounds,
});
