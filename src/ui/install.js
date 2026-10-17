// "Install Ascend": Chrome's install prompt when it offers one, a short hint on iPhone and iPad,
// and nothing once Ascend already runs as an installed app.
import { h, icon } from './dom.js';
import { isSheetOpen } from './sheet.js';
import { rerender } from '../router.js';

let deferred = null; // the browser's install prompt, saved for when you tap Install

// The prompt can arrive after a screen has drawn: draw again so the card appears.
const redraw = () => {
  if (!isSheetOpen() && document.getElementById('screen')?.childElementCount) rerender();
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // no mini-infobar: Ascend offers it calmly in its own card
  deferred = e;
  redraw();
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  redraw();
});

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isIOS() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

/** 'installed' | 'prompt' (Chrome can install) | 'ios' (show the Share hint) | 'none' */
export function installState() {
  if (isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  return 'none';
}

async function promptInstall() {
  const prompt = deferred;
  if (!prompt) return;
  deferred = null;
  await prompt.prompt();
  await prompt.userChoice.catch(() => null);
  redraw();
}

/**
 * The install card, or null when there's nothing to offer.
 * onDismiss: shows a "Not now" button that calls it.
 */
export function installCard({ onDismiss } = {}) {
  const st = installState();
  if (st !== 'prompt' && st !== 'ios') return null;
  const notNow = onDismiss ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: onDismiss }, 'Not now') : null;
  const text =
    st === 'prompt'
      ? 'Open it from your home screen like an app. It works offline, and your data stays on this device.'
      : 'In Safari, tap Share, then “Add to Home Screen”. It works offline, and your data stays on this device.';
  return h(
    'section',
    { class: 'card install-card' },
    h('div', { class: 'install-head' }, icon('peak', 26), h('h2', { class: 'card-title' }, st === 'prompt' ? 'Install Ascend' : 'Add Ascend to your home screen')),
    h('p', { class: 'muted' }, text),
    h(
      'div',
      { class: 'install-actions' },
      notNow,
      st === 'prompt' ? h('button', { type: 'button', class: 'btn btn-primary', onclick: promptInstall }, 'Install') : null,
    ),
  );
}
