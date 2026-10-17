import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker/worker.js';

const APP = 'https://ascend.example';
const env = { GEMINI_API_KEY: 'test-key', ALLOWED_ORIGINS: APP };
const API = 'https://generativelanguage.googleapis.com';
const FILE = { uri: `${API}/v1beta/files/abc123`, name: 'files/abc123', mimeType: 'application/pdf' };

const post = (path, body, headers = {}) =>
  worker.fetch(
    new Request(`https://helper.example${path}`, {
      method: 'POST',
      headers: { Origin: APP, 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
    }),
    env,
  );

const geminiReply = (list) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] } }] }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('/upload', () => {
  const bytes = new Uint8Array(1000).fill(65);

  it('refuses other types, a missing size and files over 50 MB', async () => {
    expect((await post('/upload', bytes, { 'Content-Type': 'image/gif' })).status).toBe(415);
    const big = new Request('https://helper.example/upload', { method: 'POST', headers: { Origin: APP, 'Content-Type': 'application/pdf', 'Content-Length': String(60 * 1024 * 1024) }, body: 'x' });
    expect((await worker.fetch(big, env)).status).toBe(413);
  });

  it('starts a resumable upload, sends the bytes, waits until the PDF is ready, and keeps the key out of URLs', async () => {
    const calls = [];
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url) === `${API}/upload/v1beta/files`) {
          return new Response('{}', { headers: { 'X-Goog-Upload-URL': 'https://upload.example/session-1' } });
        }
        if (String(url) === 'https://upload.example/session-1') {
          return new Response(JSON.stringify({ file: { ...FILE, state: 'PROCESSING' } }));
        }
        polls += 1;
        return new Response(JSON.stringify({ ...FILE, state: polls < 2 ? 'PROCESSING' : 'ACTIVE' }));
      }),
    );
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const pending = post('/upload', bytes, { 'Content-Type': 'application/pdf', 'Content-Length': '1000' });
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ file: FILE });

    const [start, send, ...rest] = calls;
    expect(start.init.headers['X-Goog-Upload-Command']).toBe('start');
    expect(start.init.headers['X-Goog-Upload-Header-Content-Length']).toBe('1000');
    expect(start.init.headers['X-Goog-Upload-Header-Content-Type']).toBe('application/pdf');
    expect(send.init.headers['X-Goog-Upload-Command']).toBe('upload, finalize');
    expect(send.init.headers['X-Goog-Upload-Offset']).toBe('0');
    expect(rest.map((c) => c.url)).toEqual([`${API}/v1beta/files/abc123`, `${API}/v1beta/files/abc123`]);
    expect(calls.every((c) => !c.url.includes('test-key'))).toBe(true);
    expect(calls.every((c) => c.init.headers['x-goog-api-key'] === 'test-key')).toBe(true);
  });

  it('gives a calm error when Google won’t start the upload or can’t open the file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    expect((await post('/upload', bytes, { 'Content-Type': 'application/pdf', 'Content-Length': '1000' })).status).toBe(502);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).endsWith('/upload/v1beta/files')
          ? new Response('{}', { headers: { 'X-Goog-Upload-URL': 'https://upload.example/s' } })
          : new Response(JSON.stringify({ file: { ...FILE, state: 'FAILED' } })),
      ),
    );
    const res = await post('/upload', bytes, { 'Content-Type': 'application/pdf', 'Content-Length': '1000' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/couldn’t open/);
  });
});

describe('/syllabus/subjects', () => {
  it('reads the uploaded files with the hint, and tidies the list', async () => {
    const spy = vi.fn(async () =>
      geminiReply([
        { name: ' Database Management Systems ', code: 'CS301', credits: '4', semester: 'V', pages: '41-43' },
        { name: 'Networks', code: '', credits: null, semester: '', pages: '' },
        { name: '', code: 'X' },
      ]),
    );
    vi.stubGlobal('fetch', spy);
    const res = await post('/syllabus/subjects', { files: [FILE, { uri: 'https://evil.example/x', mimeType: 'application/pdf' }], hint: 'B.Tech CSE Sem 5', mine: ['Operating Systems'] });
    expect(res.status).toBe(200);
    expect((await res.json()).subjects).toEqual([
      { name: 'Database Management Systems', code: 'CS301', credits: 4, semester: 'V', pages: '41-43' },
      { name: 'Networks', code: '', credits: null, semester: '', pages: '' },
    ]);
    const sent = JSON.parse(spy.mock.calls[0][1].body);
    const parts = sent.contents[0].parts;
    expect(parts[0]).toEqual({ fileData: { mimeType: 'application/pdf', fileUri: FILE.uri } });
    expect(parts).toHaveLength(2); // the file from another site was ignored
    expect(parts[1].text).toContain('"B.Tech CSE Sem 5"');
    expect(parts[1].text).toContain('Operating Systems');
    expect(sent.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('needs an uploaded file', async () => {
    expect((await post('/syllabus/subjects', { files: [] })).status).toBe(400);
  });
});

describe('/syllabus/units', () => {
  it('asks about one subject (with its pages) and returns tidy units', async () => {
    const spy = vi.fn(async () =>
      geminiReply([
        { name: 'Unit 1: Intro', hours: 6, topics: [{ name: 'ER model', difficulty: 1 }, 'Keys', { name: '' }] },
        { name: 'Unit 2', hours: null, topics: [] },
      ]),
    );
    vi.stubGlobal('fetch', spy);
    const res = await post('/syllabus/units', { files: [FILE], subject: { name: 'Database Management Systems', code: 'CS301', pages: '41-43' } });
    expect(res.status).toBe(200);
    expect((await res.json()).units).toEqual([{ name: 'Unit 1: Intro', hours: 6, topics: [{ name: 'ER model', difficulty: 1 }, { name: 'Keys', difficulty: 2 }] }]);
    const text = JSON.parse(spy.mock.calls[0][1].body).contents[0].parts[1].text;
    expect(text).toContain('"Database Management Systems" (code CS301), around pages 41-43');
  });

  it('needs a subject', async () => {
    expect((await post('/syllabus/units', { files: [FILE], subject: {} })).status).toBe(400);
  });
});

describe('/files/delete', () => {
  it('deletes only well-formed file names', async () => {
    const spy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', spy);
    const res = await post('/files/delete', { names: ['files/abc123', '../secret', 'files/ok-2'] });
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(spy.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [`${API}/v1beta/files/abc123`, 'DELETE'],
      [`${API}/v1beta/files/ok-2`, 'DELETE'],
    ]);
  });
});
