// One focus room: a Durable Object holding its members' WebSockets.
//
// It uses the WebSocket hibernation API, so a quiet room costs nothing: each member lives in its
// socket's attachment, never on disk. When the last person leaves, nothing of the room remains.

import { PROTOCOL, parseClientMessage, rateLimit, publicMember } from './protocol.js';

const send = (ws, msg) => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* already closed */
  }
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // The app's heartbeat is answered without waking the room.
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
  }

  /** The Worker has already checked the origin and the code; this upgrades to a WebSocket. */
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    // A crowd of half-open sockets is refused before it starts.
    if (this.ctx.getWebSockets().length >= PROTOCOL.maxMembers * 2) return new Response('Room is busy', { status: 429 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.accept(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  accept(ws) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ member: null, bucket: null, cheers: {} });
  }

  members(except = null) {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const member = ws.deserializeAttachment()?.member;
      if (member) out.push({ ws, member });
    }
    return out;
  }

  broadcast(msg, except) {
    for (const { ws } of this.members(except)) send(ws, msg);
  }

  async webSocketMessage(ws, data) {
    const now = Date.now();
    const att = ws.deserializeAttachment() ?? { member: null, bucket: null, cheers: {} };
    const limited = rateLimit(att.bucket, now);
    att.bucket = limited.bucket;
    if (!limited.ok) {
      ws.serializeAttachment(att);
      send(ws, { type: 'error', code: 'slow', message: 'Too many messages. Reconnect in a moment.' });
      this.drop(ws, 1008, 'Too many messages');
      return;
    }
    const parsed = parseClientMessage(typeof data === 'string' ? data : '', now);
    if (!parsed.ok) {
      ws.serializeAttachment(att);
      send(ws, { type: 'error', code: 'bad', message: parsed.error });
      return;
    }
    const msg = parsed.msg;

    if (msg.type === 'hello') {
      if (att.member) return ws.serializeAttachment(att);
      // The same device coming back (e.g. a dropped connection): replace its old socket quietly.
      for (const other of this.members(ws)) {
        if (other.member.id !== msg.id) continue;
        const oa = other.ws.deserializeAttachment();
        other.ws.serializeAttachment({ ...oa, member: null });
        try {
          other.ws.close(4000, 'Replaced by a new connection');
        } catch {
          /* already closed */
        }
      }
      if (this.members(ws).length >= PROTOCOL.maxMembers) {
        ws.serializeAttachment(att);
        send(ws, { type: 'error', code: 'full', message: `This room is full (${PROTOCOL.maxMembers} people).` });
        this.drop(ws, 4001, 'Room is full');
        return;
      }
      att.member = { id: msg.id, name: msg.name, ...msg.presence };
      ws.serializeAttachment(att);
      send(ws, { type: 'welcome', you: msg.id, now, members: this.members(ws).map(({ member }) => publicMember(member)) });
      this.broadcast({ type: 'joined', member: publicMember(att.member) }, ws);
      return;
    }

    if (!att.member) {
      ws.serializeAttachment(att);
      send(ws, { type: 'error', code: 'bad', message: 'say-hello-first' });
      return;
    }

    if (msg.type === 'presence') {
      const { type, ...presence } = msg;
      att.member = { ...att.member, ...presence };
      ws.serializeAttachment(att);
      this.broadcast({ type: 'update', member: publicMember(att.member) }, ws);
      return;
    }

    if (msg.type === 'cheer') {
      const last = att.cheers[msg.to] ?? 0;
      if (msg.to === att.member.id || now - last < PROTOCOL.cheerGapMs) return ws.serializeAttachment(att);
      att.cheers = { ...att.cheers, [msg.to]: now };
      ws.serializeAttachment(att);
      const target = this.members(ws).find(({ member }) => member.id === msg.to);
      if (target) send(target.ws, { type: 'cheer', from: att.member.id, name: att.member.name });
      return;
    }

    if (msg.type === 'leave') {
      this.drop(ws, 1000, 'Left the room');
    }
  }

  /** Tells the others someone left (once), then closes the socket. */
  drop(ws, code, reason) {
    const att = ws.deserializeAttachment();
    if (att?.member) {
      const { id } = att.member;
      ws.serializeAttachment({ ...att, member: null });
      this.broadcast({ type: 'left', id }, ws);
    }
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketClose(ws, code) {
    this.drop(ws, code === 1005 || code === 1006 ? 1000 : code, 'Closed');
  }

  async webSocketError(ws) {
    this.drop(ws, 1011, 'Connection error');
  }
}
