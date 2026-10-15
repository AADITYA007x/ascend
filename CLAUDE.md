# Ascend: a study planner for college semesters

A calm, motivating study planner. You enter your semester (subjects, units, deadlines, class
timetable); Ascend builds a daily plan around your free time, reshuffles itself when you miss
a day, brings weak topics back first, and shows your progress as a climb through the semester.

## Constraints
- Everything free. I host and own all the code. Ask me before adding any new dependency.
- Plain web app: Vite + vanilla JavaScript (no framework unless I agree). Installable on phones
  (PWA) and works fully offline.
- All data stays on the device (IndexedDB). No accounts, no server, until the "study with
  friends" milestone, which will use a free Cloudflare Worker.
- Phone first: every screen must work well at 390 px wide, with thumb-friendly controls.
- Calm, warm look. One clear action per screen. No guilt-trip messages.

## How we work
- Small working milestones. Plan first (plan mode), then build.
- After each milestone: run it, test it, list new / changed / deleted files, and give me the
  git commands.
- Keep the planner logic (scheduling, reshuffling, spaced revision, priorities) in pure
  functions with tests. That is where bugs hide.
- I use Windows, PowerShell and VS Code, and test in Chrome on PC and Android. Give
  PowerShell-compatible commands. Never append to files with `echo ... >>`; for .gitignore
  or .env edits, tell me to edit the file in VS Code or give me the full file.

## Planner rules
- A semester has subjects (with credits), units, and topics (with an estimated time).
- Deadlines: quizzes, assignments, lab records, mid-sems, end-sems, each with a date and a weight.
- Study only goes into free time (not class hours from the timetable), up to a daily limit I set.
- Priority comes from: deadline closeness × weight × subject credits × topic difficulty.
- Two phases: "keep up" before mid-sems, "exam mode" in the weeks before end-sems.
- Spaced revision: a studied topic comes back after about 1, 3, 7 and 21 days, sooner if
  rated "hard" and later if "easy".
- Missing a day, finishing early or adding topics rebalances the remaining plan automatically.
- Keep buffer days before each exam.

## Milestones
1. Semester setup: subjects, units, topics, deadlines, class timetable; saved on the device.
2. The planner: daily plan in free hours, automatic reshuffle.
3. Focus timer and session rating (easy / okay / hard).
4. Spaced revision and weak topics first.
5. Progress, "on track" warnings, weekly story.
6. The climb: a visual mountain path through the semester; the exam countdown sky.
7. Streaks with rest tokens; the daily "summit" topic (hardest of the day).
8. Flashcards (AI help optional, Gemini free tier through a Worker; the key never in the browser).
9. Phone polish, install as an app, attendance tracker (warn below the college minimum, often 75%).
10. Later: study with friends (shared live focus rooms).