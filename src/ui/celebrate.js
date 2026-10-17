// A small celebration when today's summit topic is done: a flag rises on a little peak.
// Tap anywhere (or wait a few seconds) to close it. Still, not animated, under reduced motion.
import { h } from './dom.js';

// Our own static markup (never user data).
const PEAK_SVG = `<svg viewBox="0 0 160 110" width="160" height="110" aria-hidden="true">
  <path class="cel-hill" d="M0,110 L0,78 L34,58 L60,76 L80,64 L160,92 L160,110 Z"/>
  <path class="cel-mountain" d="M14,110 L80,24 L146,110 Z"/>
  <path class="cel-snow" d="M80,24 L69,38 L76,36 L80,41 L84,36 L91,38 Z"/>
  <g class="cel-flag"><line x1="80" y1="24" x2="80" y2="2" class="cel-pole"/><path d="M80,2 l16,6 l-16,6 Z" class="cel-cloth"/></g>
  <circle class="cel-spark s1" cx="50" cy="20" r="2.5"/>
  <circle class="cel-spark s2" cx="112" cy="16" r="2"/>
  <circle class="cel-spark s3" cx="62" cy="6" r="1.8"/>
  <circle class="cel-spark s4" cx="104" cy="36" r="2.2"/>
</svg>`;

export function celebrateSummit(topicName) {
  document.querySelector('.celebrate')?.remove();
  const art = h('span', { class: 'cel-art' });
  art.innerHTML = PEAK_SVG;
  const el = h(
    'div',
    { class: 'celebrate', role: 'status', 'aria-live': 'polite' },
    h(
      'div',
      { class: 'celebrate-card' },
      art,
      h('p', { class: 'celebrate-title' }, 'Summit reached'),
      h('p', { class: 'celebrate-topic' }, topicName),
      h('p', { class: 'muted small' }, 'The hardest climb of the day is done.'),
    ),
  );
  let timer;
  const close = () => {
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  el.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  timer = setTimeout(close, 3600);
}
