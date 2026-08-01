# AAT's Dueling Ratios

A fraction-arithmetic practice game for two students — solo play, same-device
turn-taking, or online play across two different devices.

## Local development

```bash
npm install
npm run dev
```

Opens a local dev server (Vite) with hot reload.

## Building for production

```bash
npm run build
```

Outputs static files to `dist/` — plain HTML/CSS/JS, deployable anywhere,
including GitHub Pages.

## Deploying to GitHub Pages

This repo includes `.github/workflows/deploy.yml`, which builds and deploys
automatically on every push to `main`. One-time setup:

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to **GitHub Actions**.
4. Push to `main` (or re-run the workflow from the Actions tab) — the site
   will be live at `https://<username>.github.io/<repo-name>/` a minute or
   two later.

No manual `npm run build` + upload needed after that; every push to `main`
redeploys automatically.

## Firebase — important 30-day reminder

The Realtime Database was set up in **test mode**, which allows open
read/write access but **automatically expires after 30 days** — after that,
all reads/writes get denied until the rules are updated. Before that
deadline (or right away, no need to wait), replace the rules in
**Firebase Console → Realtime Database → Rules** with something like:

```json
{
  "rules": {
    "rooms": {
      "$code": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

This requires *some* signed-in user (anonymous sign-in counts) to read or
write a room, which blocks random internet bots while staying simple enough
for a friendly classroom setting — there's no per-room ownership check, so
any signed-in visitor could technically read or write any room code. That's
an intentional simplification for now, not an oversight; worth tightening
further only if this ever needs to hold up against deliberately adversarial
use rather than curious classroom bugs.

## Known v1 limitations of online play

- **Time control isn't available in online mode yet** — syncing a shared
  countdown across two devices (clock drift, pause/resume over network
  latency) is a meaningfully bigger problem than turn-based state sync, and
  was deliberately deferred rather than rushed.
- **No true disconnect/presence detection.** If a player closes their
  browser mid-game, the room simply sits waiting — reopening the same
  room code resumes it, since all state lives in the database rather than
  in-memory. There's no "opponent left" notification.
- **Client-authoritative, no anti-cheat.** Each device computes its own
  correctness/scoring and writes the result — fine for a trusted classroom
  setting, but a technically-inclined student could inspect network traffic
  to see answers early, the same way they already could in local play by
  reading the page's JavaScript.

## Project structure

```
index.html          Vite entry point
src/
  main.js           App wiring: setup screen, local play, online play, rendering
  logic.js          Pure fraction math + board-layout builders (no DOM, no state)
  online.js         Firebase Realtime Database room create/join/sync
  firebase.js       Firebase init + anonymous auth
  style.css         All styling
```
