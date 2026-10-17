# Ascend AI helper (optional)

A tiny Cloudflare Worker that asks Gemini for help with two things:
- **Make cards from my notes**: pasted notes become draft flashcards.
- **Import timetable**: a photo or PDF of your class timetable becomes a list of classes.

You check and edit everything before it is saved. The Gemini key lives only in a Worker secret and
is never in the app. Ascend works fully without this.

Everything here is on free tiers: Cloudflare Workers Free and the Gemini API free tier.

## 1. Get a Gemini API key
1. Go to Google AI Studio (aistudio.google.com) and choose **Get API key**.
2. Create a key. Keep it private: don't commit it or paste it into the app.
3. Note the name of a model on the free tier (shown in AI Studio). The Worker uses
   `gemini-2.5-flash` unless you set `GEMINI_MODEL`. Model names change over time, so check this.

## 2. Create the Worker (dashboard, no install)
1. Go to dash.cloudflare.com, then **Workers & Pages**, then **Create**, then **Create Worker**.
   Name it e.g. `ascend-cards` and deploy the starter.
2. Choose **Edit code**, replace everything with the contents of `worker/worker.js`, then **Deploy**.
3. Open **Settings**, then **Variables and secrets**, and add:
   | Name | Type | Value |
   |---|---|---|
   | `GEMINI_API_KEY` | **Secret** | your key from step 1 |
   | `ALLOWED_ORIGINS` | Text | where your app runs, comma separated, e.g. `https://ascend.pages.dev,http://localhost:5173` |
   | `GEMINI_MODEL` | Text (optional) | e.g. `gemini-2.5-flash` |
4. Deploy again, then copy the Worker URL, e.g. `https://ascend-cards.<you>.workers.dev`.

Requests from any origin not on `ALLOWED_ORIGINS` are refused. Notes are limited to 12,000
characters, and at most 20 cards come back.

## 3. Point the app at it
Create a file named `.env` in the project root (it is already in `.gitignore`) containing:

```
VITE_CARDS_URL=https://ascend-cards.<you>.workers.dev
```

Restart `npm run dev`, or rebuild with `npm run build`. The button appears on each topic's
Flashcards screen. Without `VITE_CARDS_URL` the button is hidden, and everything else works
offline as before.

## Updating
Paste the new `worker/worker.js` into the dashboard editor and deploy. No settings change.

## Privacy note
Notes and timetable images are sent to Google's Gemini API only to read them, and nothing is kept
by the Worker. On Gemini's free tier, Google may use what you send to improve its models, so don't
send anything private.
