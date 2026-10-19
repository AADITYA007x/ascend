// Talking to the optional AI helper Worker (flashcards from notes, timetable from a photo).
// It is off unless the app was built with VITE_CARDS_URL (the helper's address).

const BASE = String(import.meta.env.VITE_CARDS_URL ?? '').trim().replace(/\/+$/, '');

export const helperEnabled = () => Boolean(BASE);

/**
 * An error with a calm message that is safe to show as is.
 * kind: 'cancel' when you cancelled, 'limit' when Gemini's free limit was reached or it's overloaded
 * (worth waiting and retrying).
 */
export class HelperError extends Error {
  constructor(message, kind = 'error') {
    super(message);
    this.kind = kind;
  }
}

/**
 * POSTs JSON to the helper and returns its JSON reply.
 * opts.signal cancels it (a HelperError with kind 'cancel'); it gives up after timeoutMs.
 */
export async function postHelper(path, body, { timeoutMs = 30000, signal } = {}) {
  const ctrl = new AbortController();
  let cancelled = false;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onCancel = () => {
    cancelled = true;
    ctrl.abort();
  };
  signal?.addEventListener('abort', onCancel);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    // 429: the free limit; 503: Gemini is overloaded. Both pass in a minute or so.
    if (!res.ok) throw new HelperError(data.error || 'The helper couldn’t do that right now. Try again in a bit.', res.status === 429 || res.status === 503 ? 'limit' : 'error');
    return data;
  } catch (err) {
    if (err instanceof HelperError) throw err;
    if (err?.name === 'AbortError') {
      throw cancelled ? new HelperError('Cancelled.', 'cancel') : new HelperError('The helper took too long. Try again in a moment.');
    }
    throw new HelperError('Couldn’t reach the helper. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
}

/**
 * Uploads a big file (PDF or photo) to the helper, which keeps it with Google for this import.
 * Uses XMLHttpRequest so a progress bar can follow the upload (onProgress gets 0–1).
 * Resolves with { uri, name, mimeType }.
 */
export function uploadToHelper(blob, { onProgress, signal, timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/upload`);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.timeout = timeoutMs;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.file) resolve(data.file);
      else reject(new HelperError(data.error || 'The upload didn’t finish. Try again.'));
    };
    xhr.onerror = () => reject(new HelperError('Couldn’t reach the helper. Check your connection and try again.'));
    xhr.ontimeout = () => reject(new HelperError('The upload took too long. Try a smaller file or fewer pages.'));
    xhr.onabort = () => reject(new HelperError('Cancelled.', 'cancel'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(blob);
  });
}

/** Asks the helper to delete uploaded files now (they'd be deleted within 48 h anyway). Never throws. */
export function deleteHelperFiles(names) {
  if (!BASE || !names?.length) return;
  postHelper('/files/delete', { names }, { timeoutMs: 15000 }).catch(() => {});
}
