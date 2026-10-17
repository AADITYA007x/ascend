// Focus rooms, app side: your presence from the timer, how friends' rows read, and reconnecting. Pure functions.
//
// Times from friends arrive in the room server's clock. clockOffset = serverNow − deviceNow,
// so a phone with a wrong clock still counts down correctly.

import { timerView } from './timer.js';
import { formatMinutes } from './time.js';
import { PROTOCOL, makeRoomCode, normalizeCode, cleanName } from '../../rooms/src/protocol.js';

export { makeRoomCode, normalizeCode, cleanName };

export const ROOM = {
  maxMembers: PROTOCOL.maxMembers,
  nameMin: PROTOCOL.nameMin,
  nameMax: PROTOCOL.nameMax,
  presenceEveryMs: 60 * 1000, // refresh minutes today while in a room
  rejoinWithinMs: 12 * 60 * 60 * 1000, // after a reload, go back to a room joined this recently
  cheerGapMs: 30 * 1000, // one cheer per friend per 30 s
  backoffMs: [1000, 2000, 5000, 10000, 30000],
};

const STATUS_ORDER = { focus: 0, break: 1, paused: 2, idle: 3 };

/**
 * Your presence for the room, from the focus timer (or null when none is running).
 * endsAt is in the server's clock; a paused or finished phase has none.
 */
export function presenceFromTimer(timer, now, { subjectName = null, todayMin = 0, clockOffset = 0 } = {}) {
  const today = Math.max(0, Math.min(PROTOCOL.todayMax, Math.round(todayMin)));
  if (!timer) return { status: 'idle', endsAt: null, subject: null, todayMin: today, rounds: 0 };
  const v = timerView(timer, now);
  const rounds = Math.min(PROTOCOL.roundsMax, v.rounds);
  const subject = subjectName ? cleanName(subjectName).slice(0, PROTOCOL.subjectMax) : null;
  if (v.status !== 'running') return { status: 'paused', endsAt: null, subject, todayMin: today, rounds };
  return {
    status: v.phase === 'focus' ? 'focus' : 'break',
    endsAt: Math.round(now + v.remainingMs + clockOffset),
    subject,
    todayMin: today,
    rounds,
  };
}

/** How a member's row reads right now: { status, label, detail }. */
export function memberView(member, now, clockOffset = 0) {
  const left = member.endsAt === null || member.endsAt === undefined ? null : member.endsAt - (now + clockOffset);
  const mins = left === null ? null : Math.ceil(left / 60000);
  let label;
  if (member.status === 'focus') label = left > 0 ? `Focusing · ${mins} min left` : 'Finishing a round';
  else if (member.status === 'break') label = left > 0 ? `On a break · ${mins} min left` : 'Back from a break';
  else if (member.status === 'paused') label = 'Paused';
  else label = 'Taking it easy';
  const parts = [member.subject, member.todayMin ? `${formatMinutes(member.todayMin)} today` : null].filter(Boolean);
  return { status: member.status, label, detail: parts.join(' · ') };
}

/** You first, then focusing, on a break, paused, taking it easy; then by name. */
export function sortMembers(members, selfId) {
  return [...members].sort(
    (a, b) =>
      (b.id === selfId) - (a.id === selfId) ||
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      a.name.localeCompare(b.name),
  );
}

/** Friends (not you) focusing right now. */
export function focusingCount(members, selfId) {
  return members.filter((m) => m.id !== selfId && m.status === 'focus').length;
}

/** Wait before reconnect attempt n (0-based): 1, 2, 5, 10, then 30 s. */
export function backoffMs(attempt) {
  return ROOM.backoffMs[Math.min(Math.max(0, attempt), ROOM.backoffMs.length - 1)];
}

/** After a reload: go back to the last room if it was joined recently. */
export function shouldRejoin(saved, now) {
  if (!saved || !normalizeCode(saved.code) || !Number.isFinite(saved.joinedAt)) return false;
  return now - saved.joinedAt >= 0 && now - saved.joinedAt < ROOM.rejoinWithinMs;
}

/** "1 friend focusing with you", "3 friends focusing with you". */
export function focusingLine(count) {
  return `${count} friend${count === 1 ? '' : 's'} focusing with you`;
}
