import './styles/tokens.css';
import './styles/base.css';

import { openDB } from './db/idb.js';
import { state, reload } from './state.js';
import { startRouter } from './router.js';
import { setupProgress } from './model/summary.js';
import { h } from './ui/dom.js';
import { renderToday } from './screens/today.js';
import { renderSemester } from './screens/semester.js';
import { renderSubjects } from './screens/subjects.js';
import { renderSubject } from './screens/subject.js';
import { renderDeadlines } from './screens/deadlines.js';
import { renderTimetable } from './screens/timetable.js';

// Every screen except Semester needs a semester first.
const needsSemester = (render) => (...args) => (state.semester ? render(...args) : renderSemester());

const routes = {
  today: { render: needsSemester(renderToday) },
  semester: { render: renderSemester },
  subjects: { render: needsSemester(renderSubjects) },
  subject: { render: needsSemester(renderSubject), tab: 'subjects' },
  deadlines: { render: needsSemester(renderDeadlines) },
  timetable: { render: needsSemester(renderTimetable) },
};

function defaultRoute() {
  if (!state.semester) return 'semester';
  // Once there are topics there is a plan to show, even if setup isn't quite finished.
  if (state.topics.length) return 'today';
  return setupProgress(state).next ? 'semester' : 'subjects';
}

async function boot() {
  try {
    await openDB();
    await reload();
  } catch (err) {
    console.error(err);
    document.getElementById('screen').replaceChildren(
      h(
        'div',
        { class: 'empty' },
        h('h3', {}, 'Ascend couldn’t open its storage'),
        h('p', {}, 'Your browser may be in private mode or storage may be blocked. Try a normal window and reload.'),
      ),
    );
    return;
  }

  startRouter(routes, { defaultRoute });

  // Ask the browser to keep our data even when space runs low.
  if (navigator.storage?.persist) {
    navigator.storage.persisted().then((already) => already || navigator.storage.persist()).catch(() => {});
  }
}

boot();
