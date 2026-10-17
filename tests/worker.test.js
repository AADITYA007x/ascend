import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker/worker.js';

const APP = 'https://ascend.example';
const env = { GEMINI_API_KEY: 'test-key', ALLOWED_ORIGINS: `${APP}, http://localhost:5173` };

function req(body, { origin = APP, method = 'POST', path = '/cards' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  return new Request(`https://helper.example${path}`, {
    method,
    headers,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

const geminiReply = (text, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });

function stubGemini(response) {
  const spy = vi.fn(async () => response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('card helper worker', () => {
  it('refuses other sites and requests without an origin', async () => {
    expect((await worker.fetch(req({ notes: 'x' }, { origin: 'https://evil.example' }), env)).status).toBe(403);
    expect((await worker.fetch(req({ notes: 'x' }, { origin: null }), env)).status).toBe(403);
  });

  it('answers the CORS preflight for the app', async () => {
    const res = await worker.fetch(req(null, { method: 'OPTIONS' }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('checks the path, the key and the notes', async () => {
    expect((await worker.fetch(req({ notes: 'x' }, { path: '/other' }), env)).status).toBe(404);
    expect((await worker.fetch(req({ notes: 'x' }), { ...env, GEMINI_API_KEY: '' })).status).toBe(500);
    expect((await worker.fetch(req('not json'), env)).status).toBe(400);
    expect((await worker.fetch(req({ notes: '   ' }), env)).status).toBe(400);
    expect((await worker.fetch(req({ notes: 'x'.repeat(12001) }), env)).status).toBe(413);
  });

  it('returns tidy cards from a good reply, with the key in a header, not the URL', async () => {
    const spy = stubGemini(geminiReply(JSON.stringify([{ front: ' Q1 ', back: ' A1 ' }, { front: '', back: 'x' }])));
    const res = await worker.fetch(req({ topic: 'Matrices', notes: 'Some notes' }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(await res.json()).toEqual({ cards: [{ front: 'Q1', back: 'A1' }] });
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain('gemini-2.5-flash:generateContent');
    expect(url).not.toContain('test-key');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    expect(JSON.parse(init.body).contents[0].parts[0].text).toContain('Some notes');
  });

  it('uses the model from settings when given', async () => {
    const spy = stubGemini(geminiReply('[]'));
    await worker.fetch(req({ notes: 'n' }), { ...env, GEMINI_MODEL: 'gemini-x' });
    expect(spy.mock.calls[0][0]).toContain('/models/gemini-x:generateContent');
  });

  it('gives a calm error for a broken reply, a Gemini error or the free limit', async () => {
    stubGemini(geminiReply('not json at all'));
    let res = await worker.fetch(req({ notes: 'n' }), env);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/try again/i);

    stubGemini(new Response('{"error":{"message":"secret details"}}', { status: 500 }));
    res = await worker.fetch(req({ notes: 'n' }), env);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret details');

    stubGemini(new Response('{}', { status: 429 }));
    expect((await worker.fetch(req({ notes: 'n' }), env)).status).toBe(429);

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network'))));
    expect((await worker.fetch(req({ notes: 'n' }), env)).status).toBe(502);
  });
});
