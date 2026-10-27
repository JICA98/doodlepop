// End-to-end test against a running `wrangler dev` (default http://localhost:8787).
// Usage: npm run test:e2e   (BASE=http://host:port to override)
import WebSocket from 'ws';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓', msg);
  else { failures++; console.log('  ✗ FAIL:', msg); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body) => (await fetch(BASE + path, { method: 'POST', body: JSON.stringify(body ?? {}) })).json();

class Client {
  constructor(name, code, token = `tok-${name}-${Math.random().toString(36).slice(2)}`) {
    this.name = name; this.code = code; this.token = token;
    this.msgs = []; this.view = null; this.id = null; this.ops = []; this.chat = []; this.errors = [];
  }
  connect() {
    return new Promise((resolve) => {
      this.ws = new WebSocket(`${WS}/ws/${this.code}`);
      this.ws.on('open', () => this.send({ t: 'join', token: this.token, name: this.name, avatar: { color: 1, eyes: 2, mouth: 3, acc: 4 } }));
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        this.msgs.push(m);
        if (m.t === 'welcome') { this.id = m.you; this.view = m.view; this.ops = m.ops; resolve(this); }
        if (m.t === 'state') this.view = m.view;
        if (m.t === 'chat') this.chat.push(m);
        if (m.t === 'error') { this.errors.push(m); resolve(this); }
      });
      this.ws.on('error', () => resolve(this));
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async until(pred, ms = 8000, label = 'condition') {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred(this)) return true; await sleep(25); }
    throw new Error(`timeout waiting for ${label} (${this.name}); phase=${this.view?.phase}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

async function privateGame() {
  console.log('\n== Private room full game ==');
  const { code } = await post('/api/rooms', { lang: 'en' });
  ok(/^[a-z0-9]{8}$/.test(code), `room code created (${code})`);
  const info = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
  ok(info.exists && !info.isPublic, 'room info endpoint');
  ok((await fetch(`${BASE}/api/rooms/zzzzzzzz`)).status === 404, 'unknown room → 404');

  const a = await new Client('Alice', code).connect();
  const b = await new Client('Bob', code).connect();
  const c = await new Client('Cara', code).connect();
  ok(a.view.hostId === a.id, 'first player is host');
  await a.until((x) => x.view.players.length === 3, 3000, '3 players');

  b.send({ t: 'start' });
  await sleep(200);
  ok(a.view.phase === 'lobby', 'non-host cannot start');

  a.send({ t: 'settings', settings: { rounds: 1, drawTime: 30, hints: 1, wordCount: 3, customWords: 'zorp, blimflark', maxPlayers: 5 } });
  await a.until((x) => x.view.settings.customWords.length === 2, 2000, 'settings applied');
  ok(a.view.settings.rounds === 1 && a.view.settings.maxPlayers === 5, 'host settings applied');
  b.send({ t: 'settings', settings: { rounds: 9 } });
  await sleep(150);
  ok(a.view.settings.rounds === 1, 'non-host settings ignored');

  a.send({ t: 'start' });
  const all = [a, b, c];
  await Promise.all(all.map((x) => x.until((y) => y.view.phase === 'choosing', 3000, 'choosing')));
  let drawer = all.find((x) => x.view.drawerId === x.id);
  ok(drawer.view.choices?.length === 3, 'drawer gets 3 word choices');
  ok(all.filter((x) => x !== drawer).every((x) => !x.view.choices), 'others do not get choices');

  // late joiner mid-game
  const d = new Client('Dan', code);
  let drawn = false;
  let first = true;
  for (let turn = 0; turn < 4; turn++) {
    if (!first) {
      await Promise.all(all.map((x) => x.until((y) => y.view.phase === 'choosing', 9000, `choosing turn ${turn}`)));
      drawer = all.find((x) => x.view.drawerId === x.id);
    }
    first = false;
    drawer.send({ t: 'choose', i: 1 });
    await Promise.all(all.map((x) => x.until((y) => y.view.phase === 'drawing', 3000, 'drawing')));
    const word = drawer.view.word;
    const guessers = all.filter((x) => x !== drawer);
    ok(!!word && guessers.every((g) => !g.view.word && /_/.test(g.view.pattern)), `turn ${turn}: only drawer sees word "${word}"; pattern=${guessers[0].view.pattern}`);

    if (!drawn) {
      drawn = true;
      drawer.send({ t: 'ds', c: '#ff0000', w: 8, x: 10, y: 10 });
      drawer.send({ t: 'dp', p: [20, 20, 30, 40] });
      drawer.send({ t: 'de' });
      drawer.send({ t: 'df', c: '#00ff00', x: 100, y: 100 });
      await guessers[0].until((x) => x.msgs.some((m) => m.t === 'df'), 2000, 'draw relay');
      ok(guessers[0].msgs.some((m) => m.t === 'ds') && guessers[0].msgs.some((m) => m.t === 'dp'), 'stroke relayed to guessers');
      guessers[1].send({ t: 'ds', c: '#000000', w: 4, x: 1, y: 1 });
      await sleep(150);
      ok(!drawer.msgs.some((m) => m.t === 'ds' && m.c === '#000000'), 'non-drawer cannot draw');
      drawer.send({ t: 'ds', c: '#0000ff', w: 4, x: 5, y: 5 }); drawer.send({ t: 'de' });
      drawer.send({ t: 'undo' });
      await guessers[0].until((x) => x.msgs.some((m) => m.t === 'undo'), 2000, 'undo relay');
      // late join gets canvas snapshot (stroke + fill = 2 ops)
      await d.connect();
      ok(d.ops.length === 2 && d.ops[0].k === 's' && d.ops[1].k === 'f', `late joiner receives canvas snapshot (${d.ops.length} ops)`);
      ok(d.view.pattern.length > 0 && !d.view.word, 'late joiner sees pattern, not word');
      all.push(d);
      await a.until((x) => x.view.players.length === 4, 2000, '4 players');
      // masked chat
      const [g1, g2] = guessers;
      g1.send({ t: 'chat', text: 'definitely-wrong-guess' });
      await drawer.until((x) => x.chat.some((m) => m.text === 'definitely-wrong-guess'), 2000, 'drawer sees guess');
      await g2.until((x) => x.chat.some((m) => m.from === g1.id), 2000, 'g2 got message');
      ok(g2.chat.some((m) => m.kind === 'masked' && m.text === '***') && !g2.chat.some((m) => m.text === 'definitely-wrong-guess'), 'other guessers see *** for wrong guess');
      // close guess feedback
      g1.send({ t: 'chat', text: word.slice(0, -1) });
      await sleep(200);
      if (word.length >= 4) ok(g1.chat.some((m) => m.kind === 'close'), 'close-guess feedback to sender');
      // drawer leak filter
      drawer.send({ t: 'chat', text: `it is ${word}` });
      await sleep(200);
      ok(drawer.chat.some((m) => m.text.includes("Don't give away")), 'drawer cannot leak the word');
    }

    // everyone guesses correctly, some with delay to check speed ordering
    const others = all.filter((x) => x !== drawer);
    others[0].send({ t: 'chat', text: word.toUpperCase() });
    await sleep(1200);
    others.slice(1).forEach((g) => g.send({ t: 'chat', text: word }));
    await Promise.all(all.map((x) => x.until((y) => y.view.phase === 'reveal', 3000, 'reveal')));
    const v = a.view;
    ok(v.reveal.word === word && v.reveal.reason === 'all_guessed', 'turn ends early when all guessed');
    const dv = v.players.find((p) => p.id === drawer.id);
    const gv = others.map((o) => v.players.find((p) => p.id === o.id));
    ok(gv.every((p) => p.turnDelta > 0) && gv[0].turnDelta >= gv[gv.length - 1].turnDelta, `guesser points are speed based (${gv.map((p) => p.turnDelta)})`);
    ok(dv.turnDelta > 0, `drawer earns points (${dv.turnDelta})`);
    if (turn === 0) {
      // reconnect mid-game keeps identity + score
      const prev = c.view.players.find((p) => p.id === c.id).score;
      c.close();
      await a.until((x) => x.view.players.find((p) => p.id === c.id)?.connected === false, 3000, 'disconnect flagged');
      const c2 = new Client('Cara', code, c.token);
      await c2.connect();
      ok(c2.id === c.id && c2.view.players.find((p) => p.id === c2.id).score === prev, 'reconnect restores same player + score');
      all[2] = c2; // use the reconnected client from here on
    }
  }
  await Promise.all(all.map((x) => x.until((y) => y.view.phase === 'ended', 12000, 'ended')));
  ok(true, 'game reached final leaderboard');
  const scores = a.view.players.map((p) => p.score);
  ok(scores.every((s) => s > 0), `all players scored (${scores})`);
  a.send({ t: 'lobby' });
  await a.until((x) => x.view.phase === 'lobby', 2000, 'back to lobby');
  ok(a.view.phase === 'lobby' && a.view.drawerId === null, 'host returned room to lobby (play again)');
  a.send({ t: 'start' });
  await a.until((x) => x.view.phase === 'choosing', 2000, 'second game starts');
  ok(a.view.players.every((p) => p.score === 0), 'play again resets scores');

  // full room / kick
  const e = await new Client('Eve', code).connect();
  ok(e.view?.players.length === 5, 'fifth player joined (max 5)');
  const f = await new Client('Fay', code).connect();
  ok(f.errors[0]?.code === 'full', 'sixth player rejected: room full');
  a.send({ t: 'kick', id: e.id });
  await e.until((x) => x.errors.some((m) => m.code === 'kicked'), 2000, 'kicked');
  ok(true, 'host can kick');
  [a, b, all[2], d, e].forEach((x) => x.close());
}

async function matchmaking() {
  console.log('\n== Public matchmaking ==');
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await post('/api/quickplay', { lang: 'en' })).code);
  ok(new Set(codes).size === 1, `3 sequential quickplays land in the same room (${codes[0]})`);
  const clients = [];
  for (let i = 0; i < 3; i++) clients.push(await new Client(`Pub${i}`, codes[0]).connect());
  ok(clients.every((c) => c.view.isPublic), 'room is public');
  await clients[0].until((x) => x.view.startAt, 3000, 'startAt');
  ok(clients[0].view.startAt > Date.now(), 'auto-start countdown set once 2+ players present');
  clients[0].send({ t: 'start' }); await sleep(150);
  ok(clients[0].view.phase === 'lobby', 'players cannot manually start a public room');
  const german = (await post('/api/quickplay', { lang: 'de' })).code;
  ok(german !== codes[0], 'different language → different room');
  const meta = await (await fetch(`${BASE}/api/meta`)).json();
  ok(meta.online >= 3, `meta reports online players (${meta.online})`);
  console.log('  … waiting for public auto-start (~10s)');
  await clients[0].until((x) => x.view.phase === 'choosing', 16000, 'public auto start');
  ok(true, 'public room auto-started');
  // fill the room, ensure matchmaker moves on to a new room
  const rest = [];
  for (let i = 0; i < 5; i++) { const cd = (await post('/api/quickplay', { lang: 'en' })).code; rest.push(await new Client(`Fill${i}`, cd).connect()); }
  const full = (await post('/api/quickplay', { lang: 'en' })).code;
  ok(full !== codes[0], `full room (8/8) is skipped; new room ${full}`);
  // everyone leaves → room reports empty
  clients[0].send({ t: 'leave' });
  await sleep(300);
  [...clients, ...rest].forEach((c) => c.close());
}

async function timers() {
  console.log('\n== Timers: hints, time-out, drawer disconnect ==');
  const { code } = await post('/api/rooms', { lang: 'en' });
  const a = await new Client('Ann', code).connect();
  const b = await new Client('Ben', code).connect();
  const c = await new Client('Cy', code).connect();
  a.send({ t: 'settings', settings: { rounds: 2, drawTime: 15, hints: 2, wordCount: 1 } });
  await a.until((x) => x.view.settings.wordCount === 1, 2000, 'settings');
  a.send({ t: 'start' });
  // wordCount 1 → no choosing phase
  await Promise.all([a, b, c].map((x) => x.until((y) => y.view.phase === 'drawing', 3000, 'drawing (auto-picked)')));
  const all = [a, b, c];
  const drawer = all.find((x) => x.view.drawerId === x.id);
  const guesser = all.find((x) => x !== drawer);
  const shown = () => [...guesser.view.pattern].filter((ch) => ch !== '_' && ch !== ' ' && ch !== '-').length;
  const word = drawer.view.word;
  ok(shown() === 0, `no letters revealed at start (${guesser.view.pattern})`);
  const t0 = Date.now();
  await guesser.until((x) => shown() >= 1, 15000, 'first hint');
  console.log(`  … first hint after ${Math.round((Date.now() - t0) / 1000)}s: ${guesser.view.pattern}`);
  ok(shown() === 1, 'first hint reveals one letter');
  await guesser.until((x) => shown() >= 2 || x.view.phase === 'reveal', 15000, 'second hint');
  ok(shown() >= 2 || word.replace(/[^a-z]/g, '').length < 3, `second hint reveals another letter (${guesser.view.pattern})`);
  await Promise.all(all.map((x) => x.until((y) => y.view.phase === 'reveal', 20000, 'time-out reveal')));
  ok(a.view.reveal.reason === 'time' && a.view.reveal.word === word, 'turn ends when time runs out and reveals the word');
  ok(a.view.players.every((p) => p.turnDelta === 0), 'no points when nobody guesses');
  // next turn: drawer disconnects immediately
  await Promise.all(all.map((x) => x.until((y) => y.view.phase === 'drawing', 9000, 'next drawing')));
  const d2 = all.find((x) => x.view.drawerId === x.id);
  d2.close();
  const watcher = all.find((x) => x !== d2);
  await watcher.until((x) => x.view.phase === 'reveal', 3000, 'reveal after drawer left');
  ok(watcher.view.reveal.reason === 'drawer_left', 'drawer disconnect ends the turn');
  // remaining 2 players continue; one more leaves → fewer than 2 → game ends / lobby
  await watcher.until((x) => x.view.phase === 'drawing', 9000, 'game continues with remaining players');
  ok(true, 'game continues without the disconnected drawer');
  const other = all.find((x) => x !== d2 && x !== watcher);
  [a, b, c].forEach((x) => x.close());
  void other;
}

try {
  await privateGame();
  await timers();
  await matchmaking();
} catch (e) {
  failures++;
  console.error('\nERROR:', e.message);
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL E2E CHECKS PASSED');
process.exit(failures ? 1 : 0);
