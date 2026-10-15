// Gentle toasts at the bottom of the screen, with an optional action (e.g. Undo).
import { h } from './dom.js';

export function toast(message, { actionLabel, onAction, duration = 4000 } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return;
  region.replaceChildren();
  let timer;
  const el = h(
    'div',
    { class: 'toast', role: 'status' },
    h('span', {}, message),
    actionLabel
      ? h(
          'button',
          {
            type: 'button',
            class: 'toast-action',
            onclick: () => {
              clearTimeout(timer);
              el.remove();
              onAction?.();
            },
          },
          actionLabel,
        )
      : null,
  );
  region.append(el);
  timer = setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, duration);
}
