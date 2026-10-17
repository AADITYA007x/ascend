# Ascend focus rooms (optional)

A small Cloudflare Worker behind "Study with friends". Each room is one Durable Object that holds
the live WebSocket connections of the people in it. Ascend works fully without it: if the app is
built without `VITE_ROOMS_URL`, no room buttons appear anywhere.

**What a room shares:** the name you pick, whether you're focusing / on a break / paused, the time
left in your round, your subject's name and your focus minutes today. Never topics, notes, cards or
anything else. Nothing is written to disk on the server, and a room disappears when its last person
leaves. No accounts.

Everything fits Cloudflare's **Workers Free** plan (SQLite-backed Durable Objects, WebSocket
hibernation so quiet rooms cost nothing).

## 1. One-time setup
You need a free Cloudflare account. In PowerShell, from the project folder:

```powershell
cd rooms
npx wrangler login
```

`npx` downloads Wrangler (Cloudflare's tool) just for this. It is not added to the project.

## 2. Allow your app's address
Open `rooms/wrangler.toml` in VS Code and set `ALLOWED_ORIGINS` to where your app runs, comma
separated, with no trailing slash. For example:

```toml
ALLOWED_ORIGINS = "https://ascend.pages.dev,http://localhost:5173,http://localhost:4173"
```

Connections from anywhere else are refused.

## 3. Deploy
```powershell
npx wrangler deploy
```

It prints your Worker's address, e.g. `https://ascend-rooms.<you>.workers.dev`.

## 4. Point the app at it
Edit `.env` in the project root (it is already in `.gitignore`) so it reads, for example:

```
VITE_CARDS_URL=https://ascend-cards.<you>.workers.dev
VITE_ROOMS_URL=wss://ascend-rooms.<you>.workers.dev
```

Note `wss://` for rooms. Leave out `VITE_CARDS_URL` if you don't use the card helper. Then restart
`npm run dev`, or rebuild with `npm run build`.

## Trying it locally first (optional)
```powershell
cd rooms
npx wrangler dev
```

This runs rooms on your PC at `ws://localhost:8787`. Use `VITE_ROOMS_URL=ws://localhost:8787` in
`.env` while testing.

## Limits built in
- 8 people per room, 6-character codes from easy-to-read letters and numbers.
- Messages are small (1 KB) and limited to 20 per 10 seconds per person.
- One cheer per friend every few seconds.

## Updating
Change files in `rooms/src/`, then run `npx wrangler deploy` again from `rooms/`.
