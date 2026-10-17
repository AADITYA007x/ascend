// Ascend AI helper: a Cloudflare Worker that asks Gemini for help. Optional: the app works without it.
//   POST /cards      pasted notes → draft flashcards
//   POST /timetable  a photo or PDF of a class timetable → the classes on it
// Paste this whole file into the Cloudflare dashboard (see README.md).
//
// Settings (Worker → Settings → Variables and secrets):
//   GEMINI_API_KEY   secret, from Google AI Studio. Never put it in the app.
//   ALLOWED_ORIGINS  comma list of where your app runs, e.g. https://ascend.pages.dev,http://localhost:5173
//   GEMINI_MODEL     optional, defaults to gemini-3.8-flash (check AI Studio for current free models)

const NOTES_MAX = 12000;
const TOPIC_MAX = 120;
const CARDS_MAX = 20;
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const FILE_MAX = 5.5 * 1024 * 1024; // base64 characters (about 4 MB of file)
const BATCH_MAX = 20;
const SUBJECTS_MAX = 30;
const ROWS_MAX = 80;
const DEFAULT_MODEL = 'gemini-3.8-flash';

const BUSY = 'The helper couldn’t do that right now. Try again in a bit.';

const CARDS_SCHEMA = {
  type: 'ARRAY',
  maxItems: CARDS_MAX,
  items: {
    type: 'OBJECT',
    properties: { front: { type: 'STRING' }, back: { type: 'STRING' } },
    required: ['front', 'back'],
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(origin ? corsHeaders(origin) : {}) },
  });
}

function cardsPrompt(topic, notes) {
  return [
    'You write study flashcards for a college student.',
    `Topic: ${topic || 'not given'}.`,
    `From the notes below only, write up to ${CARDS_MAX} flashcards.`,
    'Each front is one clear exam-style question or prompt; each back is a short, correct answer (one to three sentences).',
    'Cover the key definitions, formulas, steps and differences. Do not invent facts that are not in the notes.',
    'Write in the same language as the notes.',
    '',
    'NOTES:',
    notes,
  ].join('\n');
}

function timetablePrompt(batch, subjects) {
  return [
    'This is a college class timetable for one week. List every class on it, one row per class per day.',
    'For each class give: day (as written, e.g. Mon), start and end time (e.g. 09:00, or 2:15 pm), subject (as written), kind (Lecture, Lab, Tutorial or as written; empty if not shown) and room (empty if not shown).',
    'Read the time headers or period numbers to find each class’s times. A cell spanning several periods is one class from the first period’s start to the last period’s end.',
    'Leave out breaks, lunch, free periods, holidays and anything that is not a class.',
    batch
      ? `The student is in section/batch "${batch}". Keep classes for everyone and classes for this batch; leave out classes marked only for other batches.`
      : 'Keep classes for all batches and sections.',
    subjects.length ? `The student’s subjects, for spelling only (still write names as they appear): ${subjects.join('; ')}.` : '',
    'Do not invent classes that are not on the timetable.',
    'Answer with only a JSON array of objects with the string fields "day", "start", "end", "subject", "kind" and "room".',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Asks Gemini for a JSON list. Returns { status, list } or { status, error }.
 * schema: a strict response schema, or null to rely on the prompt (needed with images on newer models).
 * fast: ask for a low thinking level (much quicker); if the model refuses it (400), retry once without.
 */
async function askGemini(parts, schema, env, { fast = false } = {}) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const call = (withThinking) => {
    const generationConfig = { responseMimeType: 'application/json', temperature: 0.2 };
    if (schema) generationConfig.responseSchema = schema;
    if (withThinking) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    });
  };
  // For you in the Worker's logs (never sent to the browser): what Gemini said, without the key.
  const logFailure = async (r, label) => {
    const detail = await r.text().catch(() => '');
    console.error(`Gemini ${model} (${label}) answered ${r.status}: ${detail.slice(0, 500)}`);
  };
  let res = await call(fast);
  if (!res.ok) await logFailure(res, fast ? 'low thinking' : 'default');
  if (res.status === 400 && fast) {
    res = await call(false);
    if (!res.ok) await logFailure(res, 'default thinking');
  }
  if (res.status === 429) return { status: 429, error: 'The helper has reached its free limit for now. Try again later.' };
  if (!res.ok) return { status: 502, error: BUSY };
  try {
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error('not a list');
    return { status: 200, list };
  } catch {
    return { status: 502, error: 'The helper’s answer didn’t make sense. Try again.' };
  }
}

const str = (v, max) => String(v ?? '').trim().slice(0, max);

async function cards(body, env) {
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
  const topic = typeof body?.topic === 'string' ? body.topic.trim().slice(0, TOPIC_MAX) : '';
  if (!notes) return { status: 400, body: { error: 'Paste some notes first.' } };
  if (notes.length > NOTES_MAX) return { status: 413, body: { error: `Notes can be up to ${NOTES_MAX} characters.` } };
  const r = await askGemini([{ text: cardsPrompt(topic, notes) }], CARDS_SCHEMA, env);
  if (r.error) return { status: r.status, body: { error: r.error } };
  const list = r.list
    .map((c) => ({ front: str(c?.front, 1000), back: str(c?.back, 2000) }))
    .filter((c) => c.front && c.back)
    .slice(0, CARDS_MAX);
  return { status: 200, body: { cards: list } };
}

async function timetable(body, env) {
  const file = body?.file;
  const mimeType = typeof file?.mimeType === 'string' ? file.mimeType : '';
  const data = typeof file?.data === 'string' ? file.data : '';
  if (!FILE_TYPES.includes(mimeType)) return { status: 415, body: { error: 'Send a photo (JPEG, PNG, WebP) or a PDF.' } };
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200))) return { status: 400, body: { error: 'The file didn’t come through. Try again.' } };
  if (data.length > FILE_MAX) return { status: 413, body: { error: 'That file is too big. Try a smaller photo or a shorter PDF.' } };
  const batch = str(body?.batch, BATCH_MAX);
  const subjects = (Array.isArray(body?.subjects) ? body.subjects : [])
    .map((s) => str(s, 60))
    .filter(Boolean)
    .slice(0, SUBJECTS_MAX);
  const r = await askGemini([{ inlineData: { mimeType, data } }, { text: timetablePrompt(batch, subjects) }], null, env, { fast: true });
  if (r.error) return { status: r.status, body: { error: r.error } };
  const rows = r.list
    .map((x) => ({
      day: str(x?.day, 20),
      start: str(x?.start, 20),
      end: str(x?.end, 20),
      subject: str(x?.subject, 80),
      kind: str(x?.kind, 30),
      room: str(x?.room, 30),
    }))
    .filter((x) => x.day && x.start && x.subject)
    .slice(0, ROWS_MAX);
  return { status: 200, body: { rows } };
}

const ROUTES = { '/cards': cards, '/timetable': timetable };

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = request.headers.get('Origin');
    if (!origin || !allowed.includes(origin)) return json({ error: 'Not allowed.' }, 403);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const route = ROUTES[new URL(request.url).pathname];
    if (request.method !== 'POST' || !route) return json({ error: 'Not found.' }, 404, origin);
    if (!env.GEMINI_API_KEY) return json({ error: 'The helper isn’t set up yet.' }, 500, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Send the request as JSON.' }, 400, origin);
    }
    try {
      const out = await route(body, env);
      return json(out.body, out.status, origin);
    } catch (err) {
      console.error(`Helper error: ${err?.message ?? err}`);
      return json({ error: BUSY }, 502, origin);
    }
  },
};
