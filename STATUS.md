# Doodlepop – status

**v1 feature-complete for near-parity.** Everything below is implemented and exercised locally with `wrangler dev`
(real workerd + Durable Objects). It has **not** been deployed to a real Cloudflare account (no credentials were
available) – the deploy path was validated only with `wrangler deploy --dry-run`.

## Run locally

Needs Node **22+** (`.nvmrc` provided). No Cloudflare login required.

```bash
npm install
npm run dev            # API/DOs on :8787 + Vite UI on :5173 (proxies /api and /ws)
# open http://localhost:5173 in two windows (second in a private window = second player)
```

Single-process, production-like: `npm run preview` → http://localhost:8787.

## Deploy to your Cloudflare account

```bash
npm install
npx wrangler login                 # or export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
# optional: edit `name` in wrangler.toml (sets <name>.<subdomain>.workers.dev)
npm run deploy                     # builds web/dist, uploads Worker + assets, applies DO migration v1
```

One Worker serves the API, WebSockets and the static UI (Workers Assets). Two SQLite-backed Durable Object classes
(`GameRoom`, `Matchmaker`) are created by migration `v1`; works on the Free plan. Custom domain and the optional KV
word-pack override are documented in `README.md`.

## What exists

- Home: nickname, SVG avatar builder (colour/eyes/mouth/accessory + randomize), language, quick play, private room, join by code/link
- Lobby: player list, invite link, host settings (language, max players 2–12, rounds, draw time, word choices, hints, custom words, custom-only, wrong-guess visibility), kick
- Game: word choice → drawing (22 colours, 4 sizes, brush/fill/eraser/undo/clear, live sync, late-join snapshot) → guessing with speed scoring → reveal → next drawer → leaderboard → play again
- Public matchmaking: per-language Matchmaker DO, fullest-room-first, seat reservations, auto-start, new rooms on demand, client re-queues on a full/vanished room
- Disconnect handling: same-tab reconnect keeps seat and score (45 s in game, 10 s in lobby), drawer leaving ends the turn, <2 players ends the game, host migration
- Chat: wrong guesses masked as `***` (or open), "is close!" hint, private channel for drawer + correct guessers, drawer can't leak the word, rate limit
- Words: 870+ English, starter packs for de/es/fr, KV override, easy to add languages
- Hardening: all client input sanitized/clamped server-side, WebSocket Origin check, only the drawer draws, only the host configures
- Responsive layout (desktop 3-column, mobile stacked with chat/players tabs)

## Verification

| Check | Command | Result at hand-off |
|---|---|---|
| Typecheck (worker + web) | `npm run typecheck` | pass |
| Unit tests (10) | `npm test` | pass |
| Game over real WebSockets (full game, hints/time-out, reconnect, kick, matchmaking) | `npm run test:e2e` | 3/3 consecutive passes after final code |
| Real-browser UI (Chrome via puppeteer-core) | `npm run test:ui` | 4/4 consecutive passes after final code |
| Deploy config | `wrangler deploy --dry-run` | pass |

## Known issues / caveats

- **Local runtime crash on old tooling:** with wrangler 4.86 on Node 20, workerd twice aborted
  (`server.c++:2508` assertion, then a segfault) and the dev server stopped answering. Not seen on wrangler 4.154 / Node 22,
  which is why Node 22 is required. If you ever see "Your worker restarted mid-request" in dev, restart `wrangler dev`.
- **Test timing:** the e2e/UI scripts use wall-clock timeouts. If the machine is suspended mid-run the tests report spurious
  timeouts (I hit this when my sandbox froze between tool calls – the server timestamps showed a 448 s jump, not a lost alarm).
  Run them in the foreground without suspending.
- UI smoke reuses the French public room; repeated runs within a minute see "reconnecting" ghost players from the previous run.
- Not implemented vs. skribbl.io: vote-kick in public rooms, profanity filter beyond input sanitising, drawing-tool extras
  (e.g. brush opacity), sound effects, i18n of the UI itself (only word packs are localised), persistence of finished
  games or stats. Starter de/es/fr packs are small (~150–200 words each).
- Public-room seat counting is eventually consistent; an overbooked room answers `full` and the client retries automatically.
- Not load-tested; each room is a single Durable Object (fine for ≤12 players per room).

## Where things live

`worker/src/room.ts` (game state machine, one alarm drives all timers) · `worker/src/matchmaker.ts` ·
`worker/src/logic.ts` (pure, unit-tested) · `shared/protocol.ts` (wire types, limits) · `web/src/` (Preact UI) ·
`scripts/` (e2e, UI smoke).
