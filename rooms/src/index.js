// Ascend focus rooms: a Cloudflare Worker that sends each room's WebSockets to its own Durable Object.
// GET /rooms/<CODE> with "Upgrade: websocket" joins a room. Nothing else is served.
//
// Settings (wrangler.toml → [vars]):
//   ALLOWED_ORIGINS  comma list of where your app runs, e.g. https://ascend.pages.dev,http://localhost:5173

import { normalizeCode } from './protocol.js';

export { Room } from './room.js';

const text = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = request.headers.get('Origin');
    if (!origin || !allowed.includes(origin)) return text('Not allowed.', 403);

    const match = new URL(request.url).pathname.match(/^\/rooms\/([^/]+)$/);
    const code = match && normalizeCode(decodeURIComponent(match[1]));
    if (request.method !== 'GET' || !code) return text('Not found.', 404);
    if (request.headers.get('Upgrade') !== 'websocket') return text('Expected a WebSocket.', 426);

    // The same code always reaches the same room.
    const room = env.ROOMS.get(env.ROOMS.idFromName(code));
    return room.fetch(request);
  },
};
