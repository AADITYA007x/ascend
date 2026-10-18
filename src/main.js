import './styles/tokens.css';
import './styles/base.css';

import { openDB } from './db/idb.js';
import { state, reload } from './state.js';
import { startRouter } from './router.js';
import { setupProgress } from './model/summary.js';
import { h } from './ui/dom.js';
import './ui/install.js'; // listens for the browser's install prompt from the start
import { renderToday } from './screens/today.js';
import { renderSemester } from './screens/semester.js';
import { renderSubjects } from './screens/subjects.js';
import { renderSubject } from './screens/subject.js';
import { renderDeadlines } from './screens/deadlines.js';
import { renderTimetable } from './screens/timetable.js';
import { renderFocus } from './screens/focus.js';
import { renderProgress } from './screens/progress.js';
import { renderCards } from './screens/cards.js';
import { renderQuiz } from './screens/quiz.js';
import { renderAttendance } from './screens/attendance.js';
import { renderRoom } from './screens/room.js';
import { roomsEnabled, joinRoom, onRoomChange, onCheer, publishPresence } from './net/room-client.js';
import { shouldRejoin, focusingCount } from './model/room.js';
import { afterReload } from './state.js';
import { getMeta } from './db/repo.js';
import { rerender } from './router.js';
import { isSheetOpen } from './ui/sheet.js';
import { toast } from './ui/toast.js';
import { buzz } from './ui/alerts.js';

// Every screen except Semester needs a semester first.
const needsSemester = (render) => (...args) => (state.semester ? render(...args) : renderSemester());

const routes = {
  today: { render: needsSemester(renderToday) },
  semester: { render: renderSemester, tab: 'progress' },
  progress: { render: needsSemester(renderProgress) },
  subjects: { render: needsSemester(renderSubjects) },
  subject: { render: needsSemester(renderSubject), tab: 'subjects' },
  deadlines: { render: needsSemester(renderDeadlines) },
  timetable: { render: needsSemester(renderTimetable) },
  focus: { render: needsSemester(renderFocus), tab: 'today' },
  cards: { render: needsSemester(renderCards), tab: 'subjects' },
  quiz: { render: needsSemester(renderQuiz), tab: 'today' },
  attendance: { render: needsSemester(renderAttendance), tab: 'timetable' },
  room: { render: needsSemester(renderRoom), tab: 'today' },
};

function defaultRoute() {
  if (!state.semester) return 'semester';
  // A focus session survives reloads and the app being closed: open straight back into it.
  if (state.timer) return 'focus';
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
  watchForUpdates();
  if (roomsEnabled()) await setupRooms();

  // Ask the browser to keep our data even when space runs low.
  if (navigator.storage?.persist) {
    navigator.storage.persisted().then((already) => already || navigator.storage.persist()).catch(() => {});
  }
}

/**
 * A new version takes over in the background (the service worker updates itself), but this page
 * keeps running the old code until it reloads: offer the reload. Focus timers survive it.
 */
function watchForUpdates() {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  const hadController = Boolean(sw.controller); // no controller yet = first visit, not an update
  sw.addEventListener('controllerchange', () => {
    if (!hadController) return;
    toast('Ascend was updated', { actionLabel: 'Reload', duration: 10000, onAction: () => location.reload() });
  });
  // An installed app can stay open for days: look for a new version when it comes back, hourly at most.
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60 * 60 * 1000) return;
    lastCheck = Date.now();
    sw.getRegistration().then((reg) => reg?.update()).catch(() => {});
  });
}

/** Focus rooms: keep the room told about your timer, redraw when friends change, and rejoin after a reload. */
async function setupRooms() {
  afterReload(() => publishPresence());
  let shown = '';
  onRoomChange((room) => {
    if (isSheetOpen()) return;
    const route = location.hash.replace(/^#\/?/, '').split('/')[0];
    if (route === 'room') {
      // Keep keyboard focus on the same button across the redraw.
      const key = document.activeElement?.dataset?.focusKey;
      rerender();
      if (key) document.querySelector(`[data-focus-key="${key}"]`)?.focus();
      return;
    }
    // Today and Focus only show a summary: redraw when it changes.
    const now = room ? `${room.code}|${room.status}|${room.members.length}|${focusingCount(room.members, room.selfId)}` : '';
    if (now !== shown && (route === 'today' || route === 'focus')) rerender();
    shown = now;
  });
  onCheer((name) => {
    buzz();
    toast(`${name} cheered you on 👏`);
  });
  const last = await getMeta('lastRoom');
  if (state.roomMe?.name && shouldRejoin(last, Date.now())) await joinRoom(last.code, state.roomMe.name);
}

boot();
