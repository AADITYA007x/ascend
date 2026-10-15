// Shared screen pieces: the top bar.
import { h, icon } from './dom.js';

/** Top bar with a title, an optional back link and an optional right-side action. */
export function topbar(title, { back, action, subtitle } = {}) {
  return h(
    'div',
    { class: 'topbar-inner' },
    back
      ? h('a', { href: back, class: 'icon-btn', 'aria-label': 'Back' }, icon('back'))
      : null,
    h('div', { class: 'topbar-titles' }, h('h1', {}, title), subtitle ? h('p', { class: 'topbar-sub' }, subtitle) : null),
    action ?? null,
  );
}
