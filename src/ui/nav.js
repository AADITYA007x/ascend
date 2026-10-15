// Bottom tab bar.
import { h, icon } from './dom.js';

const TABS = [
  { route: 'subjects', label: 'Subjects', icon: 'book' },
  { route: 'deadlines', label: 'Deadlines', icon: 'flag' },
  { route: 'timetable', label: 'Timetable', icon: 'clock' },
  { route: 'semester', label: 'Semester', icon: 'peak' },
];

export function renderNav(container, activeTab) {
  container.replaceChildren(
    ...TABS.map((t) =>
      h(
        'a',
        {
          href: `#/${t.route}`,
          class: `tab${t.route === activeTab ? ' active' : ''}`,
          'aria-current': t.route === activeTab ? 'page' : null,
        },
        icon(t.icon, 24),
        h('span', {}, t.label),
      ),
    ),
  );
}
