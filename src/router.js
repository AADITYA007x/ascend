// Tiny hash router: "#/subject/abc" → routes['subject'](ctx, 'abc').
import { renderNav } from './ui/nav.js';

let routes = {};
let fallback = () => 'subjects';
const els = {};
let current = { name: null, params: [] };

export function startRouter(routeTable, { defaultRoute }) {
  routes = routeTable;
  fallback = defaultRoute;
  els.screen = document.getElementById('screen');
  els.topbar = document.getElementById('topbar');
  els.tabbar = document.getElementById('tabbar');
  window.addEventListener('hashchange', () => render({ focus: true }));
  render({ focus: false });
}

function parse() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0], params: parts.slice(1) };
}

export function navigate(path) {
  if (location.hash === `#/${path}`) render({ focus: true });
  else location.hash = `#/${path}`;
}

/** Re-render the current screen, keeping scroll position. */
export function rerender() {
  const y = window.scrollY;
  render({ focus: false });
  window.scrollTo(0, y);
}

function render({ focus }) {
  let { name, params } = parse();
  if (!routes[name]) {
    const def = fallback();
    history.replaceState(null, '', `#/${def}`);
    name = def;
    params = [];
  }
  const route = routes[name];
  const sameScreen = current.name === name && current.params.join('/') === params.join('/');
  current = { name, params };

  const view = route.render(...params);
  els.topbar.replaceChildren(...[].concat(view.top ?? []));
  els.screen.replaceChildren(...[].concat(view.body ?? []));
  renderNav(els.tabbar, route.tab ?? name);
  els.tabbar.hidden = Boolean(view.hideNav);
  els.topbar.hidden = !view.top;
  document.title = view.title ? `${view.title} · Ascend` : 'Ascend';

  if (focus && !sameScreen) {
    window.scrollTo(0, 0);
    els.screen.focus({ preventScroll: true });
  }
}
