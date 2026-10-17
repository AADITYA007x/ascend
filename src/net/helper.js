// Talking to the optional AI helper Worker (flashcards from notes, timetable from a photo).
// It is off unless the app was built with VITE_CARDS_URL (the helper's address).

const BASE = String(import.meta.env.VITE_CARDS_URL ?? '').trim().replace(/\/+$/, '');

export const helperEnabled = () => Boolean(BASE);

/** An error with a calm message that is safe to show as is. kind: 'cancel' when you cancelled. */
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
    if (!res.ok) throw new HelperError(data.error || 'The helper couldn’t do that right now. Try again in a bit.');
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
