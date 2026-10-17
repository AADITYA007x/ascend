import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import worker, { Room } from '../rooms/src/index.js';
import { PROTOCOL } from '../rooms/src/protocol.js';

// Small stand-ins for the Durable Object's state and hibernatable WebSockets.
class FakeSocket {
  constructor() {
    this.sent = [];
    this.closed = null;
    this.att = null;
  }
  send(text) {
    if (this.closed) throw new Error('closed');
    this.sent.push(JSON.parse(text));
  }
  close(code, reason) {
    this.closed = { code, reason };
  }
  serializeAttachment(v) {
    this.att = structuredClone(v);
  }
  deserializeAttachment() {
    return structuredClone(this.att);
  }
  last(type) {
    return [...this.sent].reverse().find((m) => m.type === type);
  }
}

function makeRoom() {
  const sockets = [];
  const ctx = {
    acceptWebSocket: (ws) => sockets.push(ws),
    getWebSockets: () => sockets.filter((ws) => !ws.closed),
    setWebSocketAutoResponse: () => {},
  };
  const room = new Room(ctx, {});
  const connect = () => {
    const ws = new FakeSocket();
    room.accept(ws);
    return ws;
  };
  const say = (ws, msg) => room.webSocketMessage(ws, JSON.stringify(msg));
  return { room, connect, say };
}

const id = (n) => `device-${String(n).padStart(4, '0')}-xyz`;
const NOW = 1_800_000_000_000;

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

describe('Room', () => {
  it('welcomes a newcomer with who is there, and tells the others', async () => {
    const { connect, say } = makeRoom();
    const a = connect();
    await say(a, { type: 'hello', id: id(1), name: 'Asha' });
    expect(a.last('welcome')).toEqual({ type: 'welcome', you: id(1), now: NOW, members: [] });
    const b = connect();
    await say(b, { type: 'hello', id: id(2), name: 'Bea', presence: { status: 'focus', endsAt: NOW + 60000, subject: 'Physics', todayMin: 10, rounds: 0 } });
    expect(b.last('welcome').members.map((m) => m.name)).toEqual(['Asha']);
    expect(a.last('joined').member).toMatchObject({ id: id(2), name: 'Bea', status: 'focus', subject: 'Physics' });
  });

  it('passes presence on to the others, not back to the sender', async () => {
    const { connect, say } = makeRoom();
    const a = connect();
    const b = connect();
    await say(a, { type: 'hello', id: id(1), name: 'Asha' });
    await say(b, { type: 'hello', id: id(2), name: 'Bea' });
    const before = b.sent.length;
    await say(a, { type: 'presence', status: 'break', endsAt: NOW + 300000, subject: null, todayMin: 25, rounds: 1 });
    expect(b.sent.length).toBe(before + 1);
    expect(b.last('update').member).toMatchObject({ id: id(1), status: 'break', todayMin: 25 });
    expect(a.last('update')).toBeUndefined();
  });

  it('sends a cheer only to its friend, and not twice in a row', async () => {
    const { connect, say } = makeRoom();
    const [a, b, c] = [connect(), connect(), connect()];
    await say(a, { type: 'hello', id: id(1), name: 'Asha' });
    await say(b, { type: 'hello', id: id(2), name: 'Bea' });
    await say(c, { type: 'hello', id: id(3), name: 'Chen' });
    await say(a, { type: 'cheer', to: id(2) });
    await say(a, { type: 'cheer', to: id(2) });
    expect(b.sent.filter((m) => m.type === 'cheer')).toEqual([{ type: 'cheer', from: id(1), name: 'Asha' }]);
    expect(c.last('cheer')).toBeUndefined();
  });

  it('refuses a ninth person calmly', async () => {
    const { connect, say } = makeRoom();
    for (let i = 0; i < PROTOCOL.maxMembers; i++) await say(connect(), { type: 'hello', id: id(i), name: `P${i}` });
    const extra = connect();
    await say(extra, { type: 'hello', id: id(99), name: 'Late' });
    expect(extra.last('error')).toMatchObject({ code: 'full' });
    expect(extra.closed.code).toBe(4001);
  });

  it('replaces an old connection from the same device without a "left" in between', async () => {
    const { connect, say } = makeRoom();
    const a = connect();
    const b1 = connect();
    await say(a, { type: 'hello', id: id(1), name: 'Asha' });
    await say(b1, { type: 'hello', id: id(2), name: 'Bea' });
    const b2 = connect();
    await say(b2, { type: 'hello', id: id(2), name: 'Bea' });
    expect(b1.closed.code).toBe(4000);
    expect(a.last('left')).toBeUndefined();
    expect(b2.last('welcome').members.map((m) => m.id)).toEqual([id(1)]);
  });

  it('announces leaving and closing', async () => {
    const { room, connect, say } = makeRoom();
    const [a, b, c] = [connect(), connect(), connect()];
    await say(a, { type: 'hello', id: id(1), name: 'Asha' });
    await say(b, { type: 'hello', id: id(2), name: 'Bea' });
    await say(c, { type: 'hello', id: id(3), name: 'Chen' });
    await say(b, { type: 'leave' });
    expect(a.last('left')).toEqual({ type: 'left', id: id(2) });
    await room.webSocketClose(c, 1006);
    expect(a.last('left')).toEqual({ type: 'left', id: id(3) });
  });

  it('answers bad messages, ignores anything before hello, and closes a flood', async () => {
    const { room, connect, say } = makeRoom();
    const a = connect();
    await room.webSocketMessage(a, '{broken');
    expect(a.last('error')).toMatchObject({ code: 'bad' });
    await say(a, { type: 'presence', status: 'idle', endsAt: null, subject: null, todayMin: 0, rounds: 0 });
    expect(a.last('error').message).toBe('say-hello-first');
    for (let i = 0; i < PROTOCOL.burst + 1; i++) await say(a, { type: 'leave-not' });
    expect(a.last('error')).toMatchObject({ code: 'slow' });
    expect(a.closed.code).toBe(1008);
  });
});

describe('rooms Worker', () => {
  const env = (seen) => ({
    ALLOWED_ORIGINS: 'https://ascend.example, http://localhost:5173',
    ROOMS: { idFromName: (code) => `id:${code}`, get: (rid) => ({ fetch: async () => (seen.push(rid), new Response('to the room')) }) },
  });
  const req = (path, { origin = 'https://ascend.example', upgrade = 'websocket' } = {}) =>
    new Request(`https://rooms.example${path}`, { headers: { ...(origin ? { Origin: origin } : {}), ...(upgrade ? { Upgrade: upgrade } : {}) } });

  it('sends a valid code to its room, tidying the code first', async () => {
    const seen = [];
    const res = await worker.fetch(req('/rooms/k7qf3m'), env(seen));
    expect(await res.text()).toBe('to the room');
    expect(seen).toEqual(['id:K7QF3M']);
  });
  it('refuses other sites, bad codes, other paths and plain requests', async () => {
    const seen = [];
    expect((await worker.fetch(req('/rooms/K7QF3M', { origin: 'https://evil.example' }), env(seen))).status).toBe(403);
    expect((await worker.fetch(req('/rooms/K7QF3M', { origin: null }), env(seen))).status).toBe(403);
    expect((await worker.fetch(req('/rooms/K0QF3M'), env(seen))).status).toBe(404);
    expect((await worker.fetch(req('/other'), env(seen))).status).toBe(404);
    expect((await worker.fetch(req('/rooms/K7QF3M', { upgrade: null }), env(seen))).status).toBe(426);
    expect(seen).toEqual([]);
  });
});
