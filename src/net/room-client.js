// The live connection to a focus room. No DOM here: screens read state.room and listen with onRoomChange.
// Optional: everything is off unless the app was built with VITE_ROOMS_URL.
import { state, subjectById } from '../state.js';
import { setMeta } from '../db/repo.js';
import { newId } from '../model/factory.js';
import { minutesStudiedOn } from '../model/progress.js';
import { timerView } from '../model/timer.js';
import { todayYMD } from '../model/time.js';
import { ROOM, backoffMs, presenceFromTimer, normalizeCode } from '../model/room.js';

const BASE = String(import.meta.env.VITE_ROOMS_URL ?? '').trim().replace(/\/+$/, '');
const HEARTBEAT_MS = 25 * 1000; // keeps phone networks from dropping a quiet connection

let ws = null;
let wanted = null; // { code, me } while you want to be in a room
let attempt = 0;
let retryTimer = null;
let heartbeat = null;
let refresh = null;
let lastSent = '';
const changeListeners = new Set();
const cheerListeners = new Set();

export const roomsEnabled = () => Boolean(BASE);

export function onRoomChange(fn) {
  changeListeners.add(fn);
}

export function onCheer(fn) {
  cheerListeners.add(fn);
}

function emit() {
  for (const fn of changeListeners) fn(state.room);
}

function setRoom(patch) {
  state.room = patch === null ? null : { ...state.room, ...patch };
  emit();
}

/** Your presence right now, from the timer. Today's minutes include the round in progress. */
function currentPresence() {
  const now = Date.now();
  const timer = state.timer;
  let todayMin = minutesStudiedOn(state.sessions, todayYMD());
  if (timer && todayYMD(new Date(timer.startedAt)) === todayYMD()) todayMin += Math.floor(timerView(timer, now).focusMs / 60000);
  return presenceFromTimer(timer, now, {
    subjectName: timer ? subjectById(timer.subjectId)?.name : null,
    todayMin,
    clockOffset: state.room?.clockOffset ?? 0,
  });
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Tells the room your timer's state, if it changed (or always, with force). */
export function publishPresence(force = false) {
  if (!wanted || state.room?.status !== 'live') return;
  const p = currentPresence();
  const json = JSON.stringify(p);
  if (!force && json === lastSent) return;
  lastSent = json;
  send({ type: 'presence', ...p });
  // Your own row follows straight away.
  const members = state.room.members.map((m) => (m.id === state.room.selfId ? { ...m, ...p } : m));
  setRoom({ members });
}

export function cheer(memberId) {
  send({ type: 'cheer', to: memberId });
}

/** Joins a room (leaving any other). me = { id, name }. */
export async function joinRoom(code, name) {
  const c = normalizeCode(code);
  if (!c || !BASE) return;
  const me = { id: state.roomMe?.id ?? newId(), name };
  state.roomMe = me;
  await setMeta('roomMe', me);
  await setMeta('lastRoom', { code: c, joinedAt: Date.now() });
  if (wanted) disconnect();
  wanted = { code: c, me };
  attempt = 0;
  setRoom({ code: c, status: 'connecting', members: [], selfId: me.id, clockOffset: 0, error: null });
  connect();
}

export async function leaveRoom() {
  send({ type: 'leave' });
  disconnect();
  wanted = null;
  setRoom(null);
  await setMeta('lastRoom', null);
}

/** Forgets a room that turned out to be full. */
export function clearRoom() {
  if (state.room?.status === 'full') setRoom(null);
}

function disconnect() {
  clearTimeout(retryTimer);
  clearInterval(heartbeat);
  clearInterval(refresh);
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null;
    try {
      ws.close(1000);
    } catch {
      /* already closed */
    }
  }
  ws = null;
  lastSent = '';
}

function connect() {
  if (!wanted) return;
  if (!navigator.onLine) return setRoom({ status: 'offline' });
  const socket = new WebSocket(`${BASE}/rooms/${wanted.code}`);
  ws = socket;
  socket.onopen = () => {
    send({ type: 'hello', id: wanted.me.id, name: wanted.me.name, presence: currentPresence() });
    clearInterval(heartbeat);
    // Answered by the server without waking the room.
    heartbeat = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('ping'), HEARTBEAT_MS);
  };
  socket.onmessage = (e) => {
    if (e.data === 'pong') return;
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    handle(msg);
  };
  socket.onclose = (e) => {
    if (ws !== socket) return;
    clearInterval(heartbeat);
    clearInterval(refresh);
    ws = null;
    if (!wanted) return;
    if (e.code === 4001) {
      // The room is full: stop trying.
      wanted = null;
      setMeta('lastRoom', null);
      return setRoom({ status: 'full' });
    }
    setRoom({ status: navigator.onLine ? 'reconnecting' : 'offline' });
    scheduleRetry();
  };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!wanted || !navigator.onLine) return;
  retryTimer = setTimeout(connect, backoffMs(attempt));
  attempt += 1;
}

function handle(msg) {
  const room = state.room;
  if (!room) return;
  const others = (fn) => setRoom({ members: fn(room.members) });
  switch (msg.type) {
    case 'welcome': {
      attempt = 0;
      const clockOffset = msg.now - Date.now();
      const me = { id: wanted.me.id, name: wanted.me.name, ...currentPresence() };
      setRoom({ status: 'live', clockOffset, members: [me, ...msg.members.filter((m) => m.id !== me.id)] });
      // Send endsAt again now that the server's clock is known.
      lastSent = '';
      publishPresence(true);
      clearInterval(refresh);
      refresh = setInterval(() => publishPresence(true), ROOM.presenceEveryMs);
      break;
    }
    case 'joined':
    case 'update':
      others((list) => (list.some((m) => m.id === msg.member.id) ? list.map((m) => (m.id === msg.member.id ? msg.member : m)) : [...list, msg.member]));
      break;
    case 'left':
      others((list) => list.filter((m) => m.id !== msg.id));
      break;
    case 'cheer':
      for (const fn of cheerListeners) fn(msg.name);
      break;
    case 'error':
      if (msg.code === 'full') setRoom({ status: 'full' });
      break;
    default:
  }
}

// Coming back online or to the app: reconnect right away instead of waiting out the backoff.
function wake() {
  if (!wanted || ws) return;
  attempt = 0;
  clearTimeout(retryTimer);
  connect();
}
window.addEventListener('online', wake);
window.addEventListener('offline', () => wanted && !ws && setRoom({ status: 'offline' }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    wake();
    publishPresence(true);
  }
});
