// Ascend card helper: a Cloudflare Worker that turns pasted notes into draft flashcards with Gemini.
// Paste this whole file into the Cloudflare dashboard (see README.md). Optional: the app works without it.
//
// Settings (Worker → Settings → Variables and secrets):
//   GEMINI_API_KEY   secret, from Google AI Studio. Never put it in the app.
//   ALLOWED_ORIGINS  comma list of where your app runs, e.g. https://ascend.pages.dev,http://localhost:5173
//   GEMINI_MODEL     optional, defaults to gemini-2.5-flash

const NOTES_MAX = 12000;
const TOPIC_MAX = 120;
const CARDS_MAX = 20;
const DEFAULT_MODEL = 'gemini-2.5-flash';

const SCHEMA = {
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

function prompt(topic, notes) {
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

async function makeCards(topic, notes, env) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt(topic, notes) }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.3 },
    }),
  });
  if (res.status === 429) return { status: 429, body: { error: 'The helper has reached its free limit for now. Try again later.' } };
  if (!res.ok) return { status: 502, body: { error: 'The helper couldn’t make cards right now. Try again in a bit.' } };
  try {
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error('not a list');
    const cards = list
      .map((c) => ({ front: String(c?.front ?? '').trim(), back: String(c?.back ?? '').trim() }))
      .filter((c) => c.front && c.back)
      .slice(0, CARDS_MAX);
    return { status: 200, body: { cards } };
  } catch {
    return { status: 502, body: { error: 'The helper’s answer didn’t make sense. Try again, or with shorter notes.' } };
  }
}

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = request.headers.get('Origin');
    if (!origin || !allowed.includes(origin)) return json({ error: 'Not allowed.' }, 403);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const { pathname } = new URL(request.url);
    if (request.method !== 'POST' || pathname !== '/cards') return json({ error: 'Not found.' }, 404, origin);
    if (!env.GEMINI_API_KEY) return json({ error: 'The helper isn’t set up yet.' }, 500, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Send notes as JSON.' }, 400, origin);
    }
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
    const topic = typeof body?.topic === 'string' ? body.topic.trim().slice(0, TOPIC_MAX) : '';
    if (!notes) return json({ error: 'Paste some notes first.' }, 400, origin);
    if (notes.length > NOTES_MAX) return json({ error: `Notes can be up to ${NOTES_MAX} characters.` }, 413, origin);

    try {
      const { status, body: out } = await makeCards(topic, notes, env);
      return json(out, status, origin);
    } catch {
      return json({ error: 'The helper couldn’t make cards right now. Try again in a bit.' }, 502, origin);
    }
  },
};
