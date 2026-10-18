# Ascend

A calm, motivating study planner for college semesters. You enter your semester (subjects, units,
topics, deadlines and class timetable). Ascend builds a daily plan around your free time, reshuffles
itself when you miss a day, brings weak topics back first, and shows your progress as a climb
through the semester.

Free, works offline, installs on your phone, and keeps everything on your device. No accounts.

## What's inside
- **Today**: the day's plan in your free hours, the "summit" topic (the hardest of the day),
  revision that's due, streaks with rest tokens, and the weekly story.
- **Focus**: a focus timer with an easy / okay / hard rating after each session. Ratings steer
  spaced revision (about 1, 3, 7 and 21 days, sooner when hard, later when easy).
- **Subjects**: subjects, units and topics, typed in or imported from your syllabus (PDF or
  photos). Each topic has flashcards and quick quizzes.
- **Deadlines**: quizzes, assignments, lab records, mid-sems and end-sems, each with a date and a
  weight. Priority comes from deadline closeness × weight × credits × difficulty, with buffer days
  kept before exams.
- **Timetable**: your classes (typed in or imported from a photo or PDF) and an attendance tracker
  that warns below your college's minimum.
- **Progress**: the mountain climb, the exam countdown sky, and "on track" warnings. The semester
  settings and backups are here too.
- **Study with friends** (optional): live focus rooms that share only your name and timer.

## Run it
You need Node.js 20 or newer. In PowerShell, from this folder:

```powershell
npm install
npm run dev      # http://localhost:5173
npm test         # the planner logic tests
npm run build    # the finished app goes into dist/
npm run preview  # try the built app (offline mode and install work here)
```

## Optional helpers
The app works fully without them. Each is a free Cloudflare Worker with its own guide:
- `worker/`: the AI helper (Gemini free tier) for syllabus import, timetable import and making
  flashcards from notes. See [worker/README.md](worker/README.md).
- `rooms/`: live focus rooms for studying with friends. See [rooms/README.md](rooms/README.md).

Tell the app where they live with a `.env` file in this folder (it is in `.gitignore`), or with
the same variables in your host's build settings:

```
VITE_CARDS_URL=https://ascend-helper.<you>.workers.dev
VITE_ROOMS_URL=wss://ascend-rooms.<you>.workers.dev
```

Without a variable, its buttons are simply hidden.

## Hosting
`npm run build` makes a static site in `dist/`. Any static host works. Ascend runs on Cloudflare
(Workers static assets), on the free plan. Set `VITE_CARDS_URL` and `VITE_ROOMS_URL` in the
build settings, and add the app's address to each helper's `ALLOWED_ORIGINS`.

After you deploy, open copies of the app show "Ascend was updated · Reload".

## Your data and backups
Everything lives in the browser's storage on that device (IndexedDB). Nothing is sent anywhere,
except the files you choose to import through the AI helper and what focus rooms share.

To keep a copy, or to move to a new phone, go to **Progress**, open your semester, and use
**Your data**:
- **Save backup** downloads `ascend-backup-<date>.json`.
- **Restore from backup** replaces everything on the device with a backup file, after showing
  what's in it. On a new phone, the welcome screen has "Restore from a backup".

Clearing the browser's site data for Ascend erases everything that isn't in a backup.

## Project layout
```
src/model/    pure planner logic (scheduling, priorities, revision, streaks…), tested in tests/
src/db/       IndexedDB storage
src/screens/  one file per screen
src/ui/       shared bits: elements, sheets, toasts, backups, install
src/net/      the AI helper and focus room clients
worker/       AI helper Worker
rooms/        focus rooms Worker
```
