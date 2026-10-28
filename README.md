# Doodlepop ✏️

A multiplayer draw-and-guess game (original branding, inspired by the classic gameplay) built entirely on
**Cloudflare Workers + Durable Objects (WebSocket Hibernation) + Workers Assets**. Nickname only — no accounts.

- **Quick play** public matchmaking (per-language Matchmaker DO fills rooms, reserves seats, spins up new rooms)
- **Private rooms** with invite links, host settings, kick, custom words
- Full round flow: word choice → drawing → guessing → speed-based scoring → reveal → next drawer → leaderboard → play again
- Canvas tools: 22 colors, 4 brush sizes, brush / flood-fill / eraser, undo, clear — synced live, late-joiners get the canvas
- Generated SVG avatars (colour × eyes × mouth × accessory = 6,912 combos), no external assets
- Responsive UI (desktop three-column, mobile stacked with tabs)
- Reconnect-safe: refresh or drop and you keep your seat and score (45 s grace in-game, 10 s in lobby)

## Repository layout

```
shared/            Wire protocol + constants shared by Worker and web (TypeScript types)
worker/src/
  index.ts         Worker entry: REST (/api/*), WebSocket routing (/ws/:code), asset fallback
  room.ts          GameRoom Durable Object – the whole game state machine (one DO per room)
  matchmaker.ts    Matchmaker Durable Object – one per language, registry of public rooms
  logic.ts         Pure helpers (scoring, hints, guess matching, sanitizing) – unit tested
  words/           Word packs: en (870+), de, es, fr + loader with optional KV override
worker/test/       Unit tests (node:test)
web/               Vite + Preact frontend (built into web/dist, served by Workers Assets)
scripts/           e2e.mjs (WebSocket-level game test), ui-smoke.mjs (real browser test)
wrangler.toml      One Worker: code + assets + 2 DO classes (SQLite-backed)
```

## Architecture

```
Browser ── GET /            ─► Workers Assets (web/dist, SPA fallback)
        ── POST /api/quickplay ─► Worker ─► Matchmaker DO "mm:<lang>" ─► picks fullest non-full public room
                                                     │                   or creates one (GameRoom.init)
        ── POST /api/rooms ─► Worker ─► GameRoom.init (private)          ▲
        ── WS  /ws/<code>  ─► Worker ─► GameRoom DO "<code>" ── report(players, phase) ──┘
```

* **GameRoom DO** accepts sockets with `ctx.acceptWebSocket` (hibernation API); each socket carries its player id in a
  serialized attachment. Keep-alive `ping`/`pong` is answered by `setWebSocketAutoResponse`, so idle rooms can hibernate
  without waking the DO.
* All game timers (word-choice timeout, draw timer, hint reveals, reveal/leaderboard phases, lobby auto-start,
  reconnect grace, empty-room cleanup) are driven by a **single Durable Object alarm** that is re-armed after every state
  change, so the game survives eviction/hibernation. Game state is persisted to DO storage on every change; drawing ops
  are persisted one key per stroke (`op:00001`…) and rebuilt on wake.
* **Matchmaker DO** keeps a registry of public rooms reported by the rooms themselves (`players/max/phase`), hands out
  the *fullest* room with a free seat, holds short seat reservations (15 s) to avoid stampedes, skips finished games,
  and prunes stale entries on an alarm. If a race overbooks a room the client gets `full` and transparently re-queues.
* Public rooms auto-start 10 s after ≥2 players are present (3 s if full); the leaderboard returns to the lobby
  automatically. Private rooms are host-controlled (host migrates when the host leaves).
* Players may join games in progress (they are appended to the current round's drawing queue).
* Nobody trusts the client: all inputs are clamped/sanitized server-side (names, avatar indexes, colours, coordinates,
  settings, message sizes/rates). Only the drawer may draw; only the host may change settings/start/kick.

## Gameplay rules implemented

| Feature | Behaviour |
|---|---|
| Settings | players 2–12, rounds 1–10, draw time 15–240 s, word choices 1–5, hints 0–5, language, custom words (≤500), custom-words-only, wrong-guess visibility |
| Word choice | drawer picks from N words (auto-pick after 15 s). Custom words are mixed in (~40 % per slot) or used exclusively. No repeats within a game |
| Scoring | guesser: `50 + 450 × timeLeft/drawTime` (50–500); drawer: average of the guessers' points. Turn ends early when everybody guessed |
| Hints | evenly spaced letter reveals, never the whole word |
| Guessing | case/accents/punctuation-insensitive (`Ice-Cream` = `icecream`); off-by-one typos privately answer "is close!" |
| Chat | Wrong guesses are shown as `***` to other guessers by default (drawer and players who already guessed see the text; switch to “Visible to all” in settings for classic behaviour). Correct guessers + drawer chat in a private channel; the drawer can't type the word; rate limited |
| Disconnects | refresh/reconnect with same per-tab token keeps seat + score; drawer leaving ends the turn; <2 connected players ends the game |

## Local development

Requirements: **Node 22+** (current wrangler requires it; wrangler 4.86 on Node 20 was the last combo and its local workerd could segfault under load). No Cloudflare account/login needed for local dev (wrangler runs workerd locally).

```bash
npm install
npm run dev          # wrangler dev (API/DOs) on :8787 + Vite UI on :5173 (proxying /api and /ws)
# open http://localhost:5173 in two browser windows (use a private window for the 2nd player)
```

Alternative “production-like” single process: `npm run preview` (builds the UI, serves everything from the Worker on :8787).

### Tests

```bash
npm run typecheck     # tsc for worker + web
npm test              # unit tests (scoring, matching, sanitizing, settings, word packs)
npm run dev:api       # (separate terminal; needs `npm run build` or `node scripts/ensure-dist.mjs` once)
npm run test:e2e      # full game over real WebSockets against :8787 (BASE=... to override, ONLY=private|timers|matchmaking for one section)
npm run build && npm run test:ui   # real-browser smoke test (needs Chrome: CHROME_PATH=/path/to/chrome)
```

`test:e2e` covers: room creation, host-only settings/start, word choice privacy, draw relay + late-join snapshot,
masked chat, close-guess, drawer leak filter, speed-based scoring, reconnect, full game → leaderboard → play again,
full-room rejection, kick, hints/time-out, drawer disconnect, public matchmaking (fill, language isolation, auto-start).

## Deploy to your Cloudflare account

1. `npm install`
2. `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` for CI)
3. (optional) change `name` in `wrangler.toml` – that determines `https://<name>.<your-subdomain>.workers.dev`
4. `npm run deploy` – builds the UI to `web/dist` and runs `wrangler deploy` (uploads Worker, static assets, creates the
   two SQLite-backed Durable Object classes via migration `v1`).
5. Open the printed URL. For a custom domain add a route/custom domain in the dashboard or in `wrangler.toml`
   (`routes = [{ pattern = "play.example.com", custom_domain = true }]`).

Durable Objects with SQLite storage are available on the Workers **Free plan** as well as paid.

### Optional: edit word lists without redeploying (KV)

```bash
npx wrangler kv namespace create WORDS           # copy the id it prints
# in wrangler.toml uncomment the [[kv_namespaces]] block and paste the id
printf 'pineapple\nmoon landing\n...' > en.txt   # ≥ 20 words, comma or newline separated
npx wrangler kv key put --binding WORDS "words:en" --path en.txt
```
A pack in KV replaces the bundled list for that language (cached per isolate until it restarts).

### Adding a language
1. `worker/src/words/<code>.ts` exporting `string[]`
2. register in `worker/src/words/index.ts`
3. add `{ code, name }` to `LANGUAGES` in `shared/protocol.ts` (the UI picks it up automatically)

## Configuration knobs
Timings live at the top of `worker/src/room.ts` (`CHOOSE_MS`, `REVEAL_MS`, `ENDED_MS`, `AUTOSTART_MS`, grace periods).
Limits/defaults live in `shared/protocol.ts` (`LIMITS`, `DEFAULT_SETTINGS`). Scoring is in `worker/src/logic.ts`.

## Trademarks / assets
Doodlepop is an independent project. Name, logo, avatars, colours, UI and word lists are original; nothing is copied
from skribbl.io.
