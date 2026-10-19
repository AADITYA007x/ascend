import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker/worker.js';

const APP = 'https://ascend.example';
const env = { GEMINI_API_KEY: 'test-key', GEMINI_RETRY_MS: 0, ALLOWED_ORIGINS: `${APP}, http://localhost:5173` };

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
    expect(url).toContain('gemini-3.8-flash:generateContent');
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

    stubGemini(new Response('{"error":{"message":"secret details"}}', { status: 400 }));
    res = await worker.fetch(req({ notes: 'n' }), env);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret details');

    stubGemini(new Response('{}', { status: 429 }));
    expect((await worker.fetch(req({ notes: 'n' }), env)).status).toBe(429);

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network'))));
    expect((await worker.fetch(req({ notes: 'n' }), env)).status).toBe(502);
  });
});

describe('timetable reading', () => {
  const file = { mimeType: 'image/jpeg', data: 'aGVsbG8gd29ybGQ=' };
  const reply = (rows) => geminiReply(JSON.stringify(rows));
  const post = (body) => worker.fetch(req(body, { path: '/timetable' }), env);

  it('refuses other file types, a missing file and files that are too big', async () => {
    expect((await post({ file: { mimeType: 'image/gif', data: 'aGk=' } })).status).toBe(415);
    expect((await post({ file: { mimeType: 'image/jpeg', data: '' } })).status).toBe(400);
    expect((await post({})).status).toBe(415);
    expect((await post({ file: { mimeType: 'application/pdf', data: 'A'.repeat(6 * 1024 * 1024) } })).status).toBe(413);
  });

  it('sends the file as inlineData with the batch and subject names, and returns tidy rows', async () => {
    const spy = stubGemini(
      reply([
        { day: 'Mon', start: '9:00', end: '10:00', subject: ' Physics ', kind: 'Lecture', room: 'LH-2' },
        { day: '', start: '9', end: '10', subject: 'No day' },
        { day: 'Tue', start: '2 pm', end: '4 pm', subject: 'DSA Lab' },
      ]),
    );
    const res = await post({ file, batch: 'B2', subjects: ['Physics (PH101)', 'Data Structures'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rows: [
        { day: 'Mon', start: '9:00', end: '10:00', subject: 'Physics', kind: 'Lecture', room: 'LH-2' },
        { day: 'Tue', start: '2 pm', end: '4 pm', subject: 'DSA Lab', kind: '', room: '' },
      ],
    });
    const [url, init] = spy.mock.calls[0];
    expect(url).not.toContain('test-key');
    const sent = JSON.parse(init.body);
    expect(sent.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: file.data } });
    const text = sent.contents[0].parts[1].text;
    expect(text).toContain('"B2"');
    expect(text).toContain('Physics (PH101); Data Structures');
    expect(sent.generationConfig).not.toHaveProperty('responseSchema'); // described in the prompt instead
    expect(sent.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(text).toContain('JSON array');
  });

  it('keeps all batches when none is given, and passes on the free-limit message', async () => {
    const spy = stubGemini(reply([]));
    await post({ file: { mimeType: 'application/pdf', data: 'JVBERi0=' } });
    expect(JSON.parse(spy.mock.calls[0][1].body).contents[0].parts[1].text).toContain('Keep classes for all batches');
    stubGemini(new Response('{}', { status: 429 }));
    const res = await post({ file });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/free limit/);
  });
});

describe('timetable speed setting', () => {
  it('asks for low thinking, and retries once without it if the model refuses (400)', async () => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        calls.push(JSON.parse(init.body));
        return calls.length === 1
          ? new Response('{"error":{"code":400}}', { status: 400 })
          : geminiReply(JSON.stringify([{ day: 'Mon', start: '9', end: '10', subject: 'OS' }]));
      }),
    );
    const res = await worker.fetch(req({ file: { mimeType: 'image/png', data: 'aGVsbG8=' } }, { path: '/timetable' }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toHaveLength(1);
    expect(calls[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(calls[1].generationConfig).not.toHaveProperty('thinkingConfig');
  });
  it('keeps flashcards as they were (strict schema, one try), and gives the calm error when both tries fail', async () => {
    const spy = stubGemini(new Response('{}', { status: 400 }));
    expect((await worker.fetch(req({ notes: 'n' }), env)).status).toBe(502);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0][1].body).generationConfig).toHaveProperty('responseSchema');
    const both = vi.fn(async () => new Response('{}', { status: 400 }));
    vi.stubGlobal('fetch', both);
    expect((await worker.fetch(req({ file: { mimeType: 'image/png', data: 'aGVsbG8=' } }, { path: '/timetable' }), env)).status).toBe(502);
    expect(both).toHaveBeenCalledTimes(2);
  });
});

describe('backup model', () => {
  it('tries the backup model when the main one’s free limit is used up', async () => {
    const urls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        urls.push(String(url));
        return String(url).includes('gemini-3.8-flash')
          ? new Response('{"error":{"code":429}}', { status: 429 })
          : geminiReply(JSON.stringify([{ front: 'Q', back: 'A' }]));
      }),
    );
    const res = await worker.fetch(req({ notes: 'n' }), env);
    expect(res.status).toBe(200);
    expect(urls.map((u) => u.match(/models\/([^:]+)/)[1])).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });
  it('uses the backup model from settings, and says "free limit" when both are used up', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', spy);
    const res = await worker.fetch(req({ notes: 'n' }), { ...env, GEMINI_FALLBACK_MODEL: 'gemini-x-lite' });
    expect(res.status).toBe(429);
    expect(spy.mock.calls.map(([u]) => String(u).match(/models\/([^:]+)/)[1])).toEqual(['gemini-3.8-flash', 'gemini-x-lite']);
  });

  const modelsAsked = (spy) => spy.mock.calls.map(([u]) => String(u).match(/models\/([^:]+)/)[1]);

  it('asks an overloaded model once more before moving on', async () => {
    let n = 0;
    const spy = vi.fn(async () => (++n === 1 ? new Response('{}', { status: 503 }) : geminiReply(JSON.stringify([{ front: 'Q', back: 'A' }]))));
    vi.stubGlobal('fetch', spy);
    expect((await worker.fetch(req({ notes: 'n' }), env)).status).toBe(200);
    expect(modelsAsked(spy)).toEqual(['gemini-3.8-flash', 'gemini-3.8-flash']);
  });

  it('moves to the backup model when the main one stays overloaded', async () => {
    const spy = vi.fn(async (url) =>
      String(url).includes('gemini-3.8-flash') ? new Response('{}', { status: 503 }) : geminiReply(JSON.stringify([{ front: 'Q', back: 'A' }])),
    );
    vi.stubGlobal('fetch', spy);
    expect((await worker.fetch(req({ notes: 'n' }), env)).status).toBe(200);
    expect(modelsAsked(spy)).toEqual(['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });

  it('says Gemini is busy, without details, when every model is overloaded', async () => {
    const spy = vi.fn(async () => new Response('{"error":{"message":"secret details"}}', { status: 503 }));
    vi.stubGlobal('fetch', spy);
    const res = await worker.fetch(req({ notes: 'n' }), env);
    expect(res.status).toBe(503);
    const body = JSON.stringify(await res.json());
    expect(body).toMatch(/very busy/);
    expect(body).not.toContain('secret details');
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('moves to the backup model when the main one’s name was retired', async () => {
    const spy = vi.fn(async (url) =>
      String(url).includes('gemini-3.8-flash') ? new Response('{}', { status: 404 }) : geminiReply(JSON.stringify([{ front: 'Q', back: 'A' }])),
    );
    vi.stubGlobal('fetch', spy);
    expect((await worker.fetch(req({ notes: 'n' }), env)).status).toBe(200);
    expect(modelsAsked(spy)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });
});
