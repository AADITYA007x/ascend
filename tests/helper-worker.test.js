import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker/worker.js';

const ORIGIN = 'http://localhost:5173';
const env = { GEMINI_API_KEY: 'test', ALLOWED_ORIGINS: ORIGIN, GEMINI_MODEL: 'main-model', GEMINI_FALLBACK_MODEL: 'backup-model', GEMINI_RETRY_MS: 0 };

/** Fakes Gemini: answers(model) gives the HTTP status for that model (200 returns one card). */
function fakeGemini(answers) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const model = decodeURIComponent(String(url).match(/models\/([^:]+):/)[1]);
      calls.push(model);
      const status = answers(model);
      if (status !== 200) return new Response('{"error":{}}', { status });
      const text = JSON.stringify([{ front: 'Q', back: 'A' }]);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    }),
  );
  return calls;
}

async function askCards() {
  const req = new Request('https://helper.test/cards', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'Some notes', topic: 'T' }),
  });
  const res = await worker.fetch(req, env);
  return { status: res.status, body: await res.json() };
}

describe('helper worker: choosing a Gemini model', () => {
  afterEach(() => vi.unstubAllGlobals());
  vi.spyOn(console, 'error').mockImplementation(() => {});

  it('uses the main model when it answers', async () => {
    const calls = fakeGemini(() => 200);
    const r = await askCards();
    expect(r.status).toBe(200);
    expect(calls).toEqual(['main-model']);
  });

  it('falls back to the backup model when the main one is used up', async () => {
    fakeGemini((m) => (m === 'main-model' ? 429 : 200));
    expect((await askCards()).status).toBe(200);
  });

  it('keeps the free-limit message when the backup model name is retired', async () => {
    fakeGemini((m) => (m === 'main-model' ? 429 : 404));
    const r = await askCards();
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/free limit/);
  });

  it('keeps the busy message when the backup model name is retired', async () => {
    fakeGemini((m) => (m === 'main-model' ? 503 : 404));
    const r = await askCards();
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/very busy/);
  });

  it('says the model names are out of date when neither exists', async () => {
    fakeGemini(() => 404);
    const r = await askCards();
    expect(r.body.error).toMatch(/GEMINI_MODEL/);
  });
});
