// Ascend AI helper: a Cloudflare Worker that asks Gemini for help. Optional: the app works without it.
//   POST /cards      pasted notes → draft flashcards
//   POST /timetable  a photo or PDF of a class timetable → the classes on it
//   POST /upload               a big file (raw bytes, up to 50 MB) → stored with Google for 48 h at most
//   POST /syllabus/subjects    uploaded syllabus files → the subjects in them
//   POST /syllabus/units       uploaded syllabus files + one subject → its units and topics
//   POST /files/delete         removes uploaded files once the import is done
// Paste this whole file into the Cloudflare dashboard (see README.md).
//
// Settings (Worker → Settings → Variables and secrets):
//   GEMINI_API_KEY   secret, from Google AI Studio. Never put it in the app.
//   ALLOWED_ORIGINS  comma list of where your app runs, e.g. https://ascend.pages.dev,http://localhost:5173
//   GEMINI_MODEL           optional, defaults to gemini-3.8-flash (check AI Studio for current free models)
//   GEMINI_FALLBACK_MODEL  optional, defaults to gemini-3.5-flash-lite; used when the main model's free
//                          limit is reached, it is overloaded ("high demand") or its name was retired

const NOTES_MAX = 12000;
const TOPIC_MAX = 120;
const CARDS_MAX = 20;
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const FILE_MAX = 5.5 * 1024 * 1024; // base64 characters (about 4 MB of file)
const BATCH_MAX = 20;
const SUBJECTS_MAX = 30;
const ROWS_MAX = 80;
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite'; // tried when the main model is used up, overloaded or gone
const OVERLOADED = [500, 503, 504]; // Gemini's "high demand" answers: usually gone within seconds
const RETRY_MS = 2000; // wait before asking an overloaded model once more
const UPLOAD_MAX = 50 * 1024 * 1024; // bytes
const UPLOAD_WAIT_MS = 60 * 1000; // how long to wait for Google to finish processing a PDF
const SYLLABUS_FILES_MAX = 12;
const SUBJECT_LIST_MAX = 60;
const UNITS_MAX = 12;
const TOPICS_MAX = 25;
const API = 'https://generativelanguage.googleapis.com';

const BUSY = 'The helper couldn’t do that right now. Try again in a bit.';
const OVERLOADED_MSG = 'Gemini is very busy right now. Try again in a few minutes.';

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
 * Asks Gemini for a JSON list, trying the backup model when the main one is used up, overloaded or gone.
 * Returns { status, list } or { status, error }.
 * schema: a strict response schema, or null to rely on the prompt (needed with images on newer models).
 * fast: ask for a low thinking level (much quicker); if the model refuses it (400), retry once without.
 */
async function askGemini(parts, schema, env, opts = {}) {
  const models = [...new Set([env.GEMINI_MODEL || DEFAULT_MODEL, env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL].filter(Boolean))];
  let r;
  for (const model of models) {
    r = await askModel(model, parts, schema, env, opts);
    // Each model has its own free allowance and its own load, so when one can't answer the next may.
    // 404: the model's name was retired.
    if (r.status !== 429 && r.status !== 503 && r.upstream !== 404) return r;
  }
  return r;
}

async function askModel(model, parts, schema, env, { fast = false } = {}) {
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
  let thinking = fast;
  let res = await call(thinking);
  if (!res.ok) await logFailure(res, thinking ? 'low thinking' : 'default');
  if (res.status === 400 && thinking) {
    thinking = false;
    res = await call(thinking);
    if (!res.ok) await logFailure(res, 'default thinking');
  }
  if (OVERLOADED.includes(res.status)) {
    await new Promise((resolve) => setTimeout(resolve, Number(env.GEMINI_RETRY_MS ?? RETRY_MS)));
    res = await call(thinking);
    if (!res.ok) await logFailure(res, 'retry');
  }
  if (res.status === 429) return { status: 429, error: 'The helper has reached its free limit for now. Try again later.' };
  if (OVERLOADED.includes(res.status)) return { status: 503, error: OVERLOADED_MSG };
  if (!res.ok) return { status: 502, error: BUSY, upstream: res.status };
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

// ---------- Big files: Google's Files API ----------

const FILE_NAME = /^files\/[a-z0-9-]{1,64}$/;
const isFileRef = (f) =>
  f && typeof f === 'object' && FILE_TYPES.includes(f.mimeType) && typeof f.uri === 'string' && f.uri.startsWith(`${API}/`) && f.uri.length < 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Streams the request body to Google without holding it in memory. Returns { status, body }. */
async function upload(request, env) {
  const mimeType = (request.headers.get('Content-Type') ?? '').split(';')[0].trim();
  if (!FILE_TYPES.includes(mimeType)) return { status: 415, body: { error: 'Send a PDF or a photo (JPEG, PNG, WebP).' } };
  const size = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(size) || size <= 0) return { status: 411, body: { error: 'The file didn’t come through. Try again.' } };
  if (size > UPLOAD_MAX) return { status: 413, body: { error: 'That file is over 50 MB. Try the pages for your semester only.' } };

  const key = { 'x-goog-api-key': env.GEMINI_API_KEY };
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      ...key,
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: JSON.stringify({ file: { display_name: 'ascend-upload' } }),
  });
  const uploadUrl = start.headers.get('X-Goog-Upload-URL');
  if (!start.ok || !uploadUrl) {
    console.error(`Upload start answered ${start.status}: ${(await start.text().catch(() => '')).slice(0, 300)}`);
    const limit = start.status === 429;
    return { status: limit ? 429 : 502, body: { error: limit ? 'The helper has reached its free limit for now. Try again later.' : BUSY } };
  }

  // A fixed-length stream sends exactly `size` bytes (and fails if the body is longer or shorter).
  let body = request.body;
  if (typeof FixedLengthStream !== 'undefined' && request.body) {
    const { readable, writable } = new FixedLengthStream(size);
    request.body.pipeTo(writable).catch(() => {});
    body = readable;
  }
  const done = await fetch(uploadUrl, {
    method: 'POST',
    headers: { ...key, 'Content-Length': String(size), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body,
  });
  if (!done.ok) {
    console.error(`Upload answered ${done.status}: ${(await done.text().catch(() => '')).slice(0, 300)}`);
    return { status: 502, body: { error: 'The upload didn’t finish. Try again.' } };
  }
  let file = (await done.json())?.file;
  // PDFs are processed first; wait until Google says the file is ready.
  const until = Date.now() + UPLOAD_WAIT_MS;
  while (file?.state === 'PROCESSING' && Date.now() < until) {
    await sleep(2000);
    const r = await fetch(`${API}/v1beta/${file.name}`, { headers: key });
    if (r.ok) file = await r.json();
  }
  if (!file?.uri || file.state === 'FAILED') return { status: 502, body: { error: 'Google couldn’t open that file. Try a different copy or photos of the pages.' } };
  if (file.state === 'PROCESSING') return { status: 504, body: { error: 'The file is still being prepared. Try again in a minute.' } };
  return { status: 200, body: { file: { uri: file.uri, name: file.name, mimeType: file.mimeType || mimeType } } };
}

async function deleteFiles(body, env) {
  const names = (Array.isArray(body?.names) ? body.names : [])
    .filter((n) => typeof n === 'string' && FILE_NAME.test(n))
    .slice(0, SYLLABUS_FILES_MAX);
  await Promise.all(
    names.map((n) => fetch(`${API}/v1beta/${n}`, { method: 'DELETE', headers: { 'x-goog-api-key': env.GEMINI_API_KEY } }).catch(() => null)),
  );
  return { status: 200, body: { deleted: names.length } };
}

// ---------- Syllabus ----------

function fileParts(files) {
  const list = (Array.isArray(files) ? files : []).filter(isFileRef).slice(0, SYLLABUS_FILES_MAX);
  return list.map((f) => ({ fileData: { mimeType: f.mimeType, fileUri: f.uri } }));
}

function subjectsPrompt(hint, mine) {
  return [
    'These files are a college syllabus (it may cover several semesters or programmes). List every subject or course it describes in detail.',
    'For each give: name (the full title as written), code (if shown, else empty), credits (a number if shown, else null), semester (as written, e.g. "V" or "Semester 5"; empty if not shown) and pages (the page numbers of its detailed syllabus, e.g. "41-43"; empty if unknown).',
    'Leave out lab-only lists, elective tables without detail, and anything that is not a subject.',
    hint ? `The student says they are in: "${hint}". Still list all subjects; this only helps you read the document.` : '',
    mine.length ? `Subjects the student already has, for spelling only: ${mine.join('; ')}.` : '',
    'Answer with only a JSON array of objects with the fields "name", "code", "credits", "semester" and "pages".',
  ]
    .filter(Boolean)
    .join('\n');
}

function unitsPrompt(subject) {
  return [
    `In this syllabus, find the subject "${subject.name}"${subject.code ? ` (code ${subject.code})` : ''}${subject.pages ? `, around pages ${subject.pages}` : ''}.`,
    'List its units or modules in order. For each unit give: name (as written, e.g. "Unit 2: Normalization"), hours (its lecture hours as a number if stated, else null) and topics.',
    'For topics, split long comma- or semicolon-separated lines into separate short topics of 2 to 8 words, in the syllabus order.',
    'Give each topic a difficulty: 1 for introductions and definitions, 2 for standard material, 3 for heavy derivations, proofs, algorithms or problem-solving.',
    'Leave out course objectives, outcomes, textbooks, references and lab experiments (unless the subject is a lab).',
    'Answer with only a JSON array of objects with the fields "name", "hours" and "topics" (an array of objects with "name" and "difficulty").',
  ].join('\n');
}

async function syllabusSubjects(body, env) {
  const parts = fileParts(body?.files);
  if (!parts.length) return { status: 400, body: { error: 'Upload the syllabus first.' } };
  const hint = str(body?.hint, 60);
  const mine = (Array.isArray(body?.mine) ? body.mine : []).map((s) => str(s, 60)).filter(Boolean).slice(0, SUBJECTS_MAX);
  const r = await askGemini([...parts, { text: subjectsPrompt(hint, mine) }], null, env, { fast: true });
  if (r.error) return { status: r.status, body: { error: r.error } };
  const subjects = r.list
    .map((s) => {
      const credits = s?.credits === null || s?.credits === '' ? NaN : Number(s?.credits);
      return {
        name: str(s?.name, 100),
        code: str(s?.code, 20),
        credits: Number.isFinite(credits) ? credits : null,
        semester: str(s?.semester, 30),
        pages: str(s?.pages, 30),
      };
    })
    .filter((s) => s.name)
    .slice(0, SUBJECT_LIST_MAX);
  return { status: 200, body: { subjects } };
}

async function syllabusUnits(body, env) {
  const parts = fileParts(body?.files);
  const subject = { name: str(body?.subject?.name, 100), code: str(body?.subject?.code, 20), pages: str(body?.subject?.pages, 30) };
  if (!parts.length) return { status: 400, body: { error: 'Upload the syllabus first.' } };
  if (!subject.name) return { status: 400, body: { error: 'Pick a subject first.' } };
  const r = await askGemini([...parts, { text: unitsPrompt(subject) }], null, env, { fast: true });
  if (r.error) return { status: r.status, body: { error: r.error } };
  const units = r.list
    .map((u) => ({
      name: str(u?.name, 100),
      hours: u?.hours ?? null,
      topics: (Array.isArray(u?.topics) ? u.topics : [])
        .map((t) => (typeof t === 'string' ? { name: str(t, 100), difficulty: 2 } : { name: str(t?.name, 100), difficulty: Number(t?.difficulty) || 2 }))
        .filter((t) => t.name)
        .slice(0, TOPICS_MAX),
    }))
    .filter((u) => u.topics.length)
    .slice(0, UNITS_MAX);
  return { status: 200, body: { units } };
}

// JSON routes get the parsed body; raw routes get the request itself.
const ROUTES = {
  '/cards': cards,
  '/timetable': timetable,
  '/syllabus/subjects': syllabusSubjects,
  '/syllabus/units': syllabusUnits,
  '/files/delete': deleteFiles,
};
const RAW_ROUTES = { '/upload': upload };

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = request.headers.get('Origin');
    if (!origin || !allowed.includes(origin)) return json({ error: 'Not allowed.' }, 403);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const path = new URL(request.url).pathname;
    const route = ROUTES[path];
    const raw = RAW_ROUTES[path];
    if (request.method !== 'POST' || (!route && !raw)) return json({ error: 'Not found.' }, 404, origin);
    if (!env.GEMINI_API_KEY) return json({ error: 'The helper isn’t set up yet.' }, 500, origin);

    if (raw) {
      try {
        const out = await raw(request, env);
        return json(out.body, out.status, origin);
      } catch (err) {
        console.error(`Helper error: ${err?.message ?? err}`);
        return json({ error: BUSY }, 502, origin);
      }
    }

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
