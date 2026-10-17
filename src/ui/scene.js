// The climb scene (Progress) and the slim sky band (Today). Drawing only: the numbers come from
// model/climb.js and model/sky.js. User text (subject names) only ever goes in as textContent.
import { h } from './dom.js';
import { trailPoint, trailPath, climbReadout, campReadout } from '../model/climb.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 250;
let uid = 0;

/** createElementNS with attributes and children (text children become text nodes). */
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

/** Fixed star positions, so the sky looks the same each time. */
const STAR_SPOTS = [
  [38, 22], [92, 40], [140, 14], [205, 30], [262, 18], [306, 44], [70, 62], [238, 58],
];

function starsFor(sky) {
  if (sky.mood === 'night') return STAR_SPOTS.length;
  if (sky.mood === 'dusk' || sky.mood === 'examday') return sky.stars;
  return 0;
}

/** Sun (or moon at night) on an arc: rises low on the left, sets low on the right. */
function sunAt(sun, width, low, high) {
  return { x: 20 + sun * (width - 40), y: low - Math.sin(Math.PI * sun) * (low - high) };
}

const round = (n) => Math.round(n * 10) / 10;

/**
 * The climb: sky, sun, mountain, trail, camps, summit and you.
 * Returns a section with the scene, the countdown and a readout line (tap a camp to read it).
 */
export function climbScene(climb, sky, today, { summitDone = false } = {}) {
  const id = `sky-${++uid}`;
  const mainReadout = () => climbReadout(climb, today) + (summitDone ? ' · Today’s summit reached' : '');
  const readout = h('p', { class: 'scene-readout small', 'aria-live': 'polite' }, mainReadout());

  const grad = s(
    'linearGradient',
    { id, x1: 0, y1: 0, x2: 0, y2: 1 },
    s('stop', { offset: '0', style: `stop-color: var(--sky-top-${sky.mood})` }),
    s('stop', { offset: '1', style: `stop-color: var(--sky-bottom-${sky.mood})` }),
  );

  const stars = STAR_SPOTS.slice(0, starsFor(sky)).map(([x, y]) => s('circle', { cx: x, cy: y, r: 1.4, class: 'scene-star' }));
  const sunPos = sunAt(sky.sun, W, 110, 26);
  const sunEl =
    sky.mood === 'night'
      ? s('g', { class: 'scene-moon' }, s('circle', { cx: 290, cy: 40, r: 11 }), s('circle', { cx: 296, cy: 35, r: 10, class: 'scene-moon-cut' }))
      : s('circle', { cx: round(sunPos.x), cy: round(sunPos.y), r: 13, class: 'scene-sun' });

  const hills = s('path', { d: 'M0,250 L0,150 L58,112 L118,150 L190,98 L262,142 L340,104 L340,250 Z', class: 'scene-hills' });
  const mountain = s('path', { d: 'M-10,250 L170,22 L350,250 Z', class: 'scene-mountain' });
  const snow = s('path', { d: 'M170,22 L150,47 L162,44 L170,52 L178,44 L190,47 Z', class: 'scene-snow' });

  const done = trailPath(0, climb.height);
  const ahead = trailPath(climb.height, 1);
  const trail = [
    ahead ? s('path', { d: ahead, class: 'scene-trail-ahead' }) : null,
    done ? s('path', { d: done, class: 'scene-trail-done' }) : null,
  ];

  // Camps: a flag on the trail and a label pill beside it. Each label tries its preferred side,
  // then the other, then below the flag, and takes the first spot that is on screen and clear
  // of the climber and the labels already placed.
  const me = trailPoint(climb.height);
  const taken = [{ x: me.x - 16, y: me.y - 9, w: 32, h: 33 }]; // the climber and its "you" pill
  const overlaps = (a) => taken.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
  const camps = climb.camps.map((camp, i) => {
    const p = trailPoint(camp.at);
    const text = camp.label;
    const width = Math.min(130, 14 + text.length * 6.1);
    const rightFirst = p.x >= W / 2;
    const spots = [
      { x: rightFirst ? p.x + 12 : p.x - 12 - width, y: p.y - 19 },
      { x: rightFirst ? p.x - 12 - width : p.x + 12, y: p.y - 19 },
      { x: p.x - width / 2, y: p.y + 4 },
      { x: rightFirst ? p.x + 12 : p.x - 12 - width, y: p.y + 4 },
    ]
      .map((o) => ({ ...o, w: width, h: 16 }))
      .filter((o) => o.x >= 4 && o.x + o.w <= W - 4);
    const spot = spots.find((o) => !overlaps(o)) ?? spots[0] ?? { x: Math.max(4, p.x - width / 2), y: p.y + 4, w: width, h: 16 };
    taken.push(spot);
    const lx = spot.x;
    const ly = spot.y;
    const g = s(
      'g',
      { class: `scene-camp camp-${camp.state}`, tabindex: 0, role: 'button', 'data-i': i, 'aria-label': campReadout(camp, climb.height, today) },
      s('circle', { cx: round(p.x), cy: round(p.y), r: 16, class: 'scene-hit' }),
      s('line', { x1: round(p.x), y1: round(p.y), x2: round(p.x), y2: round(p.y - 16), class: 'scene-pole' }),
      s('path', { d: `M${round(p.x)},${round(p.y - 16)} l10,4 l-10,4 Z`, class: 'scene-flag' }),
      s('rect', { x: round(lx), y: round(ly), width: round(width), height: 16, rx: 8, class: 'scene-label-bg' }),
      s('text', { x: round(lx + width / 2), y: round(ly + 11), 'text-anchor': 'middle', class: 'scene-label' }, text),
    );
    return g;
  });

  const top = trailPoint(1);
  const summitText = climb.summit.label;
  const summitW = Math.min(140, 14 + summitText.length * 6.1);
  const summit = s(
    'g',
    { class: 'scene-summit' },
    s('line', { x1: top.x, y1: top.y, x2: top.x, y2: top.y - 20, class: 'scene-pole' }),
    s('path', { d: `M${top.x},${top.y - 20} l12,5 l-12,5 Z`, class: 'scene-flag summit-flag' }),
    s('rect', { x: round(top.x - 16 - summitW), y: top.y - 22, width: round(summitW), height: 16, rx: 8, class: 'scene-label-bg' }),
    s('text', { x: round(top.x - 16 - summitW / 2), y: top.y - 11, 'text-anchor': 'middle', class: 'scene-label' }, summitText),
  );

  const climber = s(
    'g',
    { class: 'scene-climber' },
    s('rect', { x: round(me.x - 15), y: round(me.y + 8), width: 30, height: 15, rx: 7.5, class: 'scene-you-bg' }),
    s('text', { x: round(me.x), y: round(me.y + 19), 'text-anchor': 'middle', class: 'scene-label scene-you' }, 'you'),
    s('circle', { cx: round(me.x), cy: round(me.y), r: 6, class: 'scene-me' }),
    // Today's summit is climbed: the climber carries a small pennant.
    summitDone
      ? s(
          'g',
          { class: 'scene-pennant' },
          s('line', { x1: round(me.x + 4), y1: round(me.y - 3), x2: round(me.x + 4), y2: round(me.y - 19), class: 'scene-pole' }),
          s('path', { d: `M${round(me.x + 4)},${round(me.y - 19)} l9,3.5 l-9,3.5 Z`, class: 'scene-flag summit-flag' }),
        )
      : null,
  );

  const svg = s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': describe(climb, sky, today) },
    s('defs', {}, grad),
    s('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${id})` }),
    stars,
    sunEl,
    hills,
    mountain,
    snow,
    trail,
    camps,
    summit,
    climber,
  );

  const scene = h('div', { class: 'scene' }, svg);

  // Tap or focus a camp to read it; tap it again (or elsewhere) to go back.
  let active = null;
  const show = (g) => {
    svg.querySelectorAll('.scene-camp.active').forEach((x) => x.classList.remove('active'));
    if (!g || g === active) {
      active = null;
      readout.textContent = mainReadout();
      return;
    }
    active = g;
    g.classList.add('active');
    readout.textContent = campReadout(climb.camps[Number(g.dataset.i)], climb.height, today);
  };
  svg.addEventListener('click', (e) => show(e.target.closest('.scene-camp')));
  svg.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.scene-camp')) {
      e.preventDefault();
      show(e.target.closest('.scene-camp'));
    }
  });

  return h(
    'section',
    { class: 'card scene-card' },
    scene,
    h('div', { class: 'scene-text' }, sky.text ? h('p', { class: 'scene-countdown' }, sky.text) : null, readout),
  );
}

function describe(climb, sky, today) {
  const camps = climb.camps.length ? ` Camps: ${climb.camps.map((c) => c.label).join(', ')}.` : '';
  return `A mountain trail. ${climbReadout(climb, today)}.${camps} Summit: ${climb.summit.label}.${sky.text ? ` ${sky.text}.` : ''}`;
}

/** The slim sky band for Today: the countdown on today's sky. Links to Progress. */
export function skyBand(sky) {
  const sun = sunAt(sky.sun, 100, 46, 12); // x in %, y in px
  const stars = STAR_SPOTS.slice(0, starsFor(sky)).map(([x, y]) =>
    h('span', { class: 'band-star', style: { left: `${round((x / W) * 100)}%`, top: `${round(y * 0.7)}px` } }),
  );
  const body =
    sky.mood === 'night'
      ? h('span', { class: 'band-moon', 'aria-hidden': 'true' })
      : h('span', { class: 'band-sun', 'aria-hidden': 'true', style: { left: `${round(sun.x)}%`, top: `${round(sun.y)}px` } });
  return h(
    'a',
    { href: '#/progress', class: `sky-band mood-${sky.mood}`, 'aria-label': `${sky.text}. See your climb.` },
    h('span', { class: 'band-sky', 'aria-hidden': 'true' }, stars, body),
    h('span', { class: 'sky-pill' }, sky.text),
  );
}
