// Study with friends: start or join a focus room, and see who is focusing right now.
// Everyone keeps their own timer; the room only shares names, status, subject and minutes today.
import { h } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, textInput, showMessages, emptyState } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { state } from '../state.js';
import { SUBJECT_COLORS } from '../model/factory.js';
import { validateRoomName } from '../model/validate.js';
import { ROOM, cleanName, makeRoomCode, memberView, normalizeCode, sortMembers } from '../model/room.js';
import { roomsEnabled, joinRoom, leaveRoom, cheer, clearRoom } from '../net/room-client.js';
import { rerender } from '../router.js';

// The countdown on show right now (rendering again replaces it).
let live = null;
const cheeredAt = new Map(); // memberId → when you last cheered them

const inviteLink = (code) => `${location.origin}${location.pathname}#/room/${code}`;
const spaced = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

function colorFor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SUBJECT_COLORS[hash % SUBJECT_COLORS.length];
}

export function renderRoom(codeParam) {
  live?.stop();
  const code = codeParam ? normalizeCode(codeParam) : null;
  const top = topbar('Study with friends', { back: '#/today' });
  const room = state.room;

  if (!roomsEnabled()) {
    return {
      title: 'Study with friends',
      top,
      body: emptyState(
        'Study rooms aren’t set up',
        'This copy of Ascend was built without a rooms server. Everything else works just as before.',
        h('a', { href: '#/today', class: 'btn btn-quiet' }, 'Back to Today'),
      ),
    };
  }

  if (room?.status === 'full') {
    return {
      title: 'Study with friends',
      top,
      body: emptyState(
        'That room is full',
        `A room holds up to ${ROOM.maxMembers} people. Ask for a new code, or start a room of your own.`,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => (clearRoom(), rerender()) }, 'OK'),
      ),
    };
  }

  if (room) return { title: `Room ${room.code}`, top, body: roomView(room, code) };
  return { title: 'Study with friends', top, body: joinView(code) };
}

// ---------- Not in a room yet ----------

function joinView(code) {
  const offline = !navigator.onLine;
  const name = textInput('name', state.roomMe?.name ?? '', { placeholder: 'e.g. Asha', maxlength: ROOM.nameMax, autocomplete: 'nickname' });
  const codeInput = code
    ? null
    : textInput('code', '', {
        id: 'room-code-input',
        placeholder: 'K7Q F3M',
        'aria-describedby': 'room-code-msg',
        maxlength: 9,
        autocapitalize: 'characters',
        spellcheck: 'false',
        class: 'input room-code-input',
      });
  // Codes are easier to read as you type them in capitals.
  codeInput?.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase()));

  const form = h(
    'form',
    { class: 'card room-join', novalidate: true },
    h(
      'p',
      { class: 'muted' },
      'Study side by side, each with your own timer. Friends in the room see your name, whether you’re focusing, your subject and your minutes today. Never your topics or notes.',
    ),
    field('name', 'Your name in rooms', name),
    code
      ? [
          h('p', { class: 'room-invite' }, h('span', { class: 'muted small' }, 'You’re invited to room'), h('span', { class: 'room-code' }, spaced(code))),
          h('button', { type: 'submit', class: 'btn btn-primary btn-wide', value: 'join', disabled: offline }, 'Join the room'),
        ]
      : [
          h('button', { type: 'submit', class: 'btn btn-primary btn-wide', value: 'start', disabled: offline }, 'Start a room'),
          h('p', { class: 'room-or muted small' }, 'or join a friend’s room'),
          // Built by hand so the Join button sits on the same line as the code.
          h(
            'div',
            { class: 'field', 'data-field': 'code' },
            h('label', { for: 'room-code-input', class: 'field-label' }, 'Room code'),
            h(
              'div',
              { class: 'room-join-row' },
              codeInput,
              h('button', { type: 'submit', class: 'btn btn-quiet', value: 'join', disabled: offline }, 'Join'),
            ),
            h('p', { class: 'field-msg', id: 'room-code-msg' }),
          ),
        ],
    offline ? h('p', { class: 'calm-note small' }, 'Rooms need the internet. Your own timer works offline as always.') : null,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const action = e.submitter?.value ?? (code ? 'join' : 'start');
    const fd = new FormData(form);
    const cleanedName = cleanName(fd.get('name'));
    const errors = { ...validateRoomName(cleanedName).errors };
    const target = code ?? (action === 'start' ? makeRoomCode() : normalizeCode(fd.get('code')));
    if (!target) errors.code = 'That doesn’t look like a room code. It’s 6 letters and numbers.';
    showMessages(form, { errors });
    if (Object.keys(errors).length) return;
    await joinRoom(target, cleanedName);
    if (location.hash !== '#/room') history.replaceState(null, '', '#/room');
    rerender();
  });

  return form;
}

// ---------- In a room ----------

function roomView(room, otherCode) {
  const root = h('div', { class: 'room' });

  if (otherCode && otherCode !== room.code) {
    root.append(
      h(
        'div',
        { class: 'card room-switch' },
        h('p', {}, `You’re in room ${spaced(room.code)}. Join ${spaced(otherCode)} instead?`),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-quiet',
            onclick: async () => {
              await joinRoom(otherCode, state.roomMe.name);
              history.replaceState(null, '', '#/room');
              rerender();
            },
          },
          `Switch to ${spaced(otherCode)}`,
        ),
      ),
    );
  }

  const conn = {
    connecting: 'Joining…',
    reconnecting: 'Reconnecting…',
    offline: 'You’re offline. Your timer keeps going, and the room comes back when you do.',
  }[room.status];

  root.append(
    h(
      'section',
      { class: 'card room-code-card' },
      h('span', { class: 'muted small' }, 'Room code'),
      h('span', { class: 'room-code', 'aria-label': `Room code ${[...room.code].join(' ')}` }, spaced(room.code)),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => share(room.code) }, 'Share invite'),
      conn ? h('p', { class: 'room-conn small', role: 'status' }, conn) : null,
    ),
  );

  const members = sortMembers(room.members, room.selfId);
  const rows = members.map((m) => memberRow(m, m.id === room.selfId));
  root.append(h('ul', { class: 'member-list', 'aria-label': 'People in this room' }, rows.map((r) => r.el)));
  if (room.status === 'live' && members.length === 1) {
    root.append(h('p', { class: 'calm-note small' }, 'Just you so far. Share the code and friends can join from their phones.'));
  }
  root.append(h('button', { type: 'button', class: 'btn btn-quiet room-leave', onclick: leave }, 'Leave room'));

  // Count down every second, in this device's clock corrected by the server's.
  function tick() {
    if (!root.isConnected) return stop();
    const now = Date.now();
    for (const r of rows) {
      const v = memberView(r.member, now, room.clockOffset);
      if (r.status.textContent !== v.label) r.status.textContent = v.label;
    }
  }
  const interval = setInterval(tick, 1000);
  function stop() {
    clearInterval(interval);
    if (live?.stop === stop) live = null;
  }
  live = { stop };
  setTimeout(tick); // once the screen is on the page

  return root;
}

function memberRow(m, isSelf) {
  const v = memberView(m, Date.now(), state.room?.clockOffset ?? 0);
  const status = h('span', { class: 'member-status' }, v.label);
  const since = Date.now() - (cheeredAt.get(m.id) ?? 0);
  const cheerBtn = isSelf
    ? null
    : h(
        'button',
        {
          type: 'button',
          class: 'cheer-btn',
          'data-focus-key': `cheer-${m.id}`,
          'aria-label': `Cheer ${m.name} on`,
          title: `Cheer ${m.name} on`,
          disabled: since < ROOM.cheerGapMs,
          onclick: (e) => {
            cheer(m.id);
            cheeredAt.set(m.id, Date.now());
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.classList.add('cheered');
            setTimeout(() => {
              btn.disabled = false;
              btn.classList.remove('cheered');
            }, ROOM.cheerGapMs);
            toast(`You cheered ${m.name} on`);
          },
        },
        '👏',
      );
  const el = h(
    'li',
    { class: `member-row status-${m.status}`, style: { '--member': colorFor(m.id) } },
    h('span', { class: 'member-avatar', 'aria-hidden': 'true' }, [...m.name][0]?.toUpperCase() ?? '?'),
    h(
      'span',
      { class: 'member-main' },
      h('span', { class: 'member-name' }, m.name, isSelf ? h('span', { class: 'muted small' }, ' · you') : null),
      status,
      v.detail ? h('span', { class: 'muted small' }, v.detail) : null,
    ),
    cheerBtn,
  );
  return { el, status, member: m };
}

async function share(code) {
  const url = inviteLink(code);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Study with me on Ascend', text: `Join my focus room on Ascend: ${spaced(code)}`, url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied. Send it to a friend.');
  } catch {
    toast(`Room code: ${spaced(code)}`);
  }
}

async function leave() {
  await leaveRoom();
  rerender();
  toast('You left the room. Your timer and plan are just as they were.');
}
