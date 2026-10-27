import { DurableObject } from 'cloudflare:workers';
import {
  CANVAS_H, CANVAS_W, LIMITS, clamp,
  type Avatar, type ChatKind, type ClientMsg, type DrawOp, type Phase,
  type PlayerView, type RoomView, type ServerMsg, type Settings,
} from '../../shared/protocol';
import {
  drawerScore, guessScore, hintTimes, initialSettings, judgeGuess, leaksWord, letterIndexes,
  makePattern, mergeSettings, pickRandom, randomCode, sanitizeAvatar, sanitizeChat, sanitizeName,
  validColor,
} from './logic';
import { loadWords, wordsSync } from './words';
import { matchmakerFor, type Env } from './env';

interface PlayerS {
  id: string;
  token: string;
  name: string;
  avatar: Avatar;
  score: number;
  connected: boolean;
  leftAt: number | null;
  guessedAt: number | null;
  turnDelta: number;
}

interface RoomS {
  code: string;
  isPublic: boolean;
  settings: Settings;
  phase: Phase;
  players: PlayerS[];
  hostId: string | null;
  banned: string[];
  round: number;
  queue: string[]; // players still to draw in this round
  drawerId: string | null;
  word: string | null;
  choices: string[] | null;
  usedWords: string[];
  revealed: number[]; // revealed letter indexes (hints)
  hintTimes: number[]; // upcoming absolute hint timestamps
  phaseEndsAt: number | null;
  startAt: number | null;
  reveal: { word: string; reason: string } | null;
  turnsPlayed: number;
  emptySince: number | null;
}

// timings (ms)
const CHOOSE_MS = 15_000;
const REVEAL_MS = 6_000;
const ENDED_MS = 15_000;
const AUTOSTART_MS = 10_000;
const GRACE_LOBBY_MS = 10_000;
const GRACE_GAME_MS = 45_000;
const EMPTY_TTL_MS = 90_000;
const MAX_OPS = 1500;
const MAX_STROKE_VALUES = 20_000;

const opKey = (i: number) => `op:${String(i).padStart(5, '0')}`;

export class GameRoom extends DurableObject<Env> {
  private s: RoomS | null = null;
  private ops: DrawOp[] = [];
  private stroking = false; // last op is an unfinished stroke
  private lastReport = '';
  private chatTimes = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomS>('s');
      if (!saved) return;
      this.s = saved;
      const list = await ctx.storage.list<DrawOp>({ prefix: 'op:' });
      this.ops = [...list.values()];
      // Re-sync connection flags with the sockets that survived hibernation.
      const alive = new Set(this.sockets().map((w) => this.pidOf(w)));
      const now = Date.now();
      for (const p of saved.players) {
        const c = alive.has(p.id);
        if (c !== p.connected) {
          p.connected = c;
          p.leftAt = c ? null : now;
        }
      }
      void loadWords(env, saved.settings.lang);
    });
  }

  // ------------------------------------------------------------------ RPC (called by the Worker)

  /** Creates the room. Returns false if the code is already taken. */
  async init(opts: { code: string; isPublic: boolean; settings?: Partial<Settings> }): Promise<boolean> {
    if (this.s) return false;
    this.s = {
      code: opts.code,
      isPublic: opts.isPublic,
      settings: initialSettings(opts.settings),
      phase: 'lobby',
      players: [],
      hostId: null,
      banned: [],
      round: 0,
      queue: [],
      drawerId: null,
      word: null,
      choices: null,
      usedWords: [],
      revealed: [],
      hintTimes: [],
      phaseEndsAt: null,
      startAt: null,
      reveal: null,
      turnsPlayed: 0,
      emptySince: Date.now(),
    };
    await loadWords(this.env, this.s.settings.lang);
    this.commit();
    return true;
  }

  async info() {
    const s = this.s;
    if (!s) return { exists: false as const };
    return {
      exists: true as const,
      isPublic: s.isPublic,
      players: s.players.length,
      max: s.settings.maxPlayers,
      phase: s.phase,
      lang: s.settings.lang,
    };
  }

  // ------------------------------------------------------------------ WebSocket plumbing

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    if (!this.s) return new Response('Room not found', { status: 404 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.s || typeof raw !== 'string' || raw.length > 16_000) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') return this.onJoin(ws, m);
    const pid = this.pidOf(ws);
    if (!pid) return;
    const p = this.s.players.find((x) => x.id === pid);
    if (!p) return;
    switch (m.t) {
      case 'chat': return this.onChat(p, m.text);
      case 'ds': case 'dp': case 'de': case 'df': case 'undo': case 'clear':
        return this.onDraw(p, m);
      case 'choose': return this.onChoose(p, m.i);
      case 'settings': return this.onSettings(p, m.settings);
      case 'start': return this.onStart(p);
      case 'lobby': return this.onLobbyRequest(p);
      case 'kick': return this.onKick(p, m.id);
      case 'leave':
        this.removePlayer(p.id, 'left');
        try { ws.close(1000, 'left'); } catch { /* ignore */ }
        return;
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.onDisconnect(ws);
  }
  async webSocketError(ws: WebSocket) {
    this.onDisconnect(ws);
  }

  async alarm() {
    if (!this.s) return;
    this.tick();
  }

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }
  private pidOf(ws: WebSocket): string | null {
    try {
      return (ws.deserializeAttachment() as { pid?: string } | null)?.pid ?? null;
    } catch {
      return null;
    }
  }
  private socketsOf(pid: string, except?: WebSocket) {
    return this.sockets().filter((w) => w !== except && w.readyState === WebSocket.OPEN && this.pidOf(w) === pid);
  }
  private send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket gone */ }
  }
  private sendTo(pid: string, msg: ServerMsg) {
    for (const w of this.socketsOf(pid)) this.send(w, msg);
  }
  private sendAll(msg: ServerMsg, exceptPid?: string) {
    const data = JSON.stringify(msg);
    for (const w of this.sockets()) {
      const pid = this.pidOf(w);
      if (!pid || pid === exceptPid) continue;
      try { w.send(data); } catch { /* ignore */ }
    }
  }
  private chat(kind: ChatKind, text: string, extra: { from?: string; name?: string } = {}, to?: string[]) {
    const msg: ServerMsg = { t: 'chat', kind, text, ...extra };
    if (to) to.forEach((pid) => this.sendTo(pid, msg));
    else this.sendAll(msg);
  }

  // ------------------------------------------------------------------ views / persistence

  private connectedCount() {
    return this.s!.players.filter((p) => p.connected).length;
  }

  private viewFor(pid: string): RoomView {
    const s = this.s!;
    const me = s.players.find((p) => p.id === pid);
    const isDrawer = s.drawerId === pid;
    const knowsWord = isDrawer || (s.phase === 'drawing' && !!me?.guessedAt);
    const players: PlayerView[] = s.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      connected: p.connected,
      guessed: !!p.guessedAt,
      isHost: p.id === s.hostId,
      isDrawer: p.id === s.drawerId,
      turnDelta: p.turnDelta,
    }));
    return {
      code: s.code,
      isPublic: s.isPublic,
      phase: s.phase,
      settings: s.settings,
      players,
      hostId: s.hostId,
      round: s.round,
      drawerId: s.drawerId,
      phaseEndsAt: s.phaseEndsAt,
      startAt: s.startAt,
      serverNow: Date.now(),
      pattern: s.word && s.phase === 'drawing' ? makePattern(s.word, s.revealed) : '',
      word: knowsWord && s.phase === 'drawing' ? s.word : null,
      choices: isDrawer && s.phase === 'choosing' ? s.choices : null,
      reveal: s.phase === 'reveal' ? s.reveal : null,
    };
  }

  private broadcastState() {
    for (const w of this.sockets()) {
      const pid = this.pidOf(w);
      if (pid) this.send(w, { t: 'state', view: this.viewFor(pid) });
    }
  }

  /** Persist + broadcast + re-arm alarm + tell matchmaker. Call after every state mutation. */
  private commit() {
    const s = this.s;
    if (!s) return;
    const connected = this.connectedCount();
    s.emptySince = connected === 0 ? (s.emptySince ?? Date.now()) : null;
    void this.ctx.storage.put('s', s);
    this.broadcastState();
    this.schedule();
    this.report();
  }

  private report() {
    const s = this.s;
    if (!s || !s.isPublic) return;
    const key = `${s.players.length}|${s.settings.maxPlayers}|${s.phase}`;
    if (key === this.lastReport) return;
    this.lastReport = key;
    const mm = matchmakerFor(this.env, s.settings.lang);
    this.ctx.waitUntil(
      mm.report({ code: s.code, lang: s.settings.lang, players: s.players.length, max: s.settings.maxPlayers, phase: s.phase, at: Date.now() }).catch(() => {}),
    );
  }

  private graceMs() {
    return this.s!.phase === 'lobby' || this.s!.phase === 'ended' ? GRACE_LOBBY_MS : GRACE_GAME_MS;
  }

  private schedule() {
    const s = this.s;
    if (!s) return;
    const times: number[] = [];
    if (s.phaseEndsAt) times.push(s.phaseEndsAt);
    if (s.phase === 'drawing' && s.hintTimes.length) times.push(s.hintTimes[0]);
    if (s.startAt) times.push(s.startAt);
    for (const p of s.players) if (p.leftAt) times.push(p.leftAt + this.graceMs());
    if (s.emptySince) times.push(s.emptySince + EMPTY_TTL_MS);
    if (!times.length) {
      void this.ctx.storage.deleteAlarm();
      return;
    }
    void this.ctx.storage.setAlarm(Math.max(Math.min(...times), Date.now() + 5));
  }

  // ------------------------------------------------------------------ joining / leaving

  private onJoin(ws: WebSocket, m: Extract<ClientMsg, { t: 'join' }>) {
    const s = this.s!;
    if (this.pidOf(ws)) return;
    const token = typeof m.token === 'string' ? m.token : '';
    if (token.length < 8 || token.length > 80) {
      this.send(ws, { t: 'error', code: 'bad_token', msg: 'Invalid session' });
      return ws.close(4400, 'bad token');
    }
    let p = s.players.find((x) => x.token === token);
    let fresh = false;
    if (p) {
      for (const old of this.socketsOf(p.id)) {
        this.send(old, { t: 'error', code: 'replaced', msg: 'Opened in another tab' });
        try { old.close(4000, 'replaced'); } catch { /* ignore */ }
      }
      p.connected = true;
      p.leftAt = null;
    } else {
      if (s.banned.includes(token)) {
        this.send(ws, { t: 'error', code: 'kicked', msg: 'You were removed from this room' });
        return ws.close(4403, 'kicked');
      }
      if (s.players.length >= s.settings.maxPlayers) {
        this.send(ws, { t: 'error', code: 'full', msg: 'This room is full' });
        return ws.close(4409, 'full');
      }
      let name = sanitizeName(m.name);
      const taken = (n: string) => s.players.some((x) => x.name.toLowerCase() === n.toLowerCase());
      if (taken(name)) {
        let i = 2;
        while (taken(`${name} ${i}`)) i++;
        name = `${name} ${i}`;
      }
      p = {
        id: randomCode(6),
        token,
        name,
        avatar: sanitizeAvatar(m.avatar),
        score: 0,
        connected: true,
        leftAt: null,
        guessedAt: null,
        turnDelta: 0,
      };
      s.players.push(p);
      fresh = true;
      if (this.running()) s.queue.push(p.id);
      if (!s.isPublic && !s.hostId) s.hostId = p.id;
    }
    ws.serializeAttachment({ pid: p.id });
    const ops = this.ops;
    this.send(ws, { t: 'welcome', you: p.id, view: this.viewFor(p.id), ops });
    if (fresh) this.chat('join', `${p.name} joined the room`, { from: p.id });
    else this.chat('join', `${p.name} reconnected`, { from: p.id });
    this.maybeAutostart();
    this.commit();
  }

  private onDisconnect(ws: WebSocket) {
    const s = this.s;
    if (!s) return;
    const pid = this.pidOf(ws);
    if (!pid) return;
    if (this.socketsOf(pid, ws).length) return; // another live socket for the same player
    const p = s.players.find((x) => x.id === pid);
    if (!p) return;
    p.connected = false;
    p.leftAt = Date.now();
    this.afterDeparture(p.id);
    this.maybeAutostart();
    this.commit();
  }

  private running() {
    const ph = this.s!.phase;
    return ph === 'choosing' || ph === 'drawing' || ph === 'reveal';
  }

  /** Shared follow-ups when a player disconnected or was removed. */
  private afterDeparture(pid: string) {
    const s = this.s!;
    if (!this.running()) return;
    if (this.connectedCount() < 2) {
      this.chat('system', 'Not enough players to continue.');
      return this.endGameOrLobby();
    }
    if (s.drawerId === pid && (s.phase === 'choosing' || s.phase === 'drawing')) {
      const name = s.players.find((p) => p.id === pid)?.name ?? 'The drawer';
      this.chat('system', `${name} left while drawing.`);
      return this.endTurn('drawer_left');
    }
    if (s.phase === 'drawing') this.checkAllGuessed();
  }

  private removePlayer(pid: string, why: 'left' | 'timeout' | 'kicked') {
    const s = this.s;
    if (!s) return;
    const p = s.players.find((x) => x.id === pid);
    if (!p) return;
    // Mark gone first so the state machine (drawer left / all guessed / too few players) reacts
    // while the player record still exists for scoring.
    p.connected = false;
    for (const w of this.socketsOf(pid)) {
      try { w.close(1000, why); } catch { /* ignore */ }
    }
    this.afterDeparture(pid);
    if (!this.s) return;
    s.players = s.players.filter((x) => x.id !== pid);
    s.queue = s.queue.filter((id) => id !== pid);
    if (s.hostId === pid) {
      s.hostId = s.isPublic ? null : (s.players.find((x) => x.connected) ?? s.players[0])?.id ?? null;
      const h = s.players.find((x) => x.id === s.hostId);
      if (h) this.chat('system', `${h.name} is now the host.`);
    }
    this.chat('leave', why === 'kicked' ? `${p.name} was removed from the room` : `${p.name} left the room`, { from: pid });
    this.maybeAutostart();
    this.commit();
  }

  private onKick(p: PlayerS, targetId: string) {
    const s = this.s!;
    if (s.isPublic || p.id !== s.hostId || targetId === p.id) return;
    const t = s.players.find((x) => x.id === targetId);
    if (!t) return;
    s.banned.push(t.token);
    for (const w of this.socketsOf(t.id)) this.send(w, { t: 'error', code: 'kicked', msg: 'You were removed by the host' });
    this.removePlayer(t.id, 'kicked');
  }

  // ------------------------------------------------------------------ lobby / settings

  private onSettings(p: PlayerS, patch: Partial<Settings>) {
    const s = this.s!;
    if (s.isPublic || p.id !== s.hostId || s.phase !== 'lobby' || !patch || typeof patch !== 'object') return;
    s.settings = mergeSettings(s.settings, patch, Math.max(2, s.players.length));
    this.ctx.waitUntil(loadWords(this.env, s.settings.lang));
    this.commit();
  }

  private onStart(p: PlayerS) {
    const s = this.s!;
    if (s.phase !== 'lobby') return;
    if (!s.isPublic && p.id !== s.hostId) return;
    if (s.isPublic) return; // public rooms auto start
    this.startGame(p.id);
  }

  private startGame(requester?: string) {
    const s = this.s!;
    const fail = (msg: string) => {
      if (requester) this.sendTo(requester, { t: 'error', code: 'cannot_start', msg });
    };
    if (this.connectedCount() < 2) return fail('You need at least 2 players to start.');
    const { customOnly, customWords, wordCount } = s.settings;
    if (customOnly && customWords.length < wordCount)
      return fail(`Custom-words-only needs at least ${wordCount} custom words (you have ${customWords.length}).`);
    s.players = s.players.filter((p) => p.connected);
    for (const p of s.players) {
      p.score = 0;
      p.turnDelta = 0;
      p.guessedAt = null;
    }
    s.round = 0;
    s.queue = [];
    s.usedWords = [];
    s.turnsPlayed = 0;
    s.startAt = null;
    this.chat('system', 'The game has started. Good luck!');
    this.nextTurn();
  }

  private onLobbyRequest(p: PlayerS) {
    const s = this.s!;
    if (s.isPublic || p.id !== s.hostId || s.phase !== 'ended') return;
    this.toLobby();
  }

  private maybeAutostart() {
    const s = this.s!;
    if (!s.isPublic || s.phase !== 'lobby') {
      s.startAt = null;
      return;
    }
    const c = this.connectedCount();
    if (c < 2) {
      s.startAt = null;
      return;
    }
    const target = Date.now() + (c >= s.settings.maxPlayers ? 3000 : AUTOSTART_MS);
    if (!s.startAt || target < s.startAt) s.startAt = target;
  }

  private toLobby() {
    const s = this.s!;
    s.phase = 'lobby';
    s.drawerId = null;
    s.word = null;
    s.choices = null;
    s.reveal = null;
    s.phaseEndsAt = null;
    s.round = 0;
    s.queue = [];
    s.revealed = [];
    s.hintTimes = [];
    for (const p of s.players) {
      p.guessedAt = null;
      p.turnDelta = 0;
    }
    // drop players that never came back
    for (const p of [...s.players]) if (!p.connected) this.dropSilently(p.id);
    this.clearBoard();
    this.maybeAutostart();
    this.commit();
  }

  private dropSilently(pid: string) {
    const s = this.s!;
    s.players = s.players.filter((p) => p.id !== pid);
    if (s.hostId === pid) s.hostId = s.isPublic ? null : (s.players.find((x) => x.connected) ?? s.players[0])?.id ?? null;
  }

  // ------------------------------------------------------------------ game flow

  private nextTurn() {
    const s = this.s!;
    let drawer: PlayerS | undefined;
    while (!drawer) {
      if (s.queue.length === 0) {
        if (s.round >= s.settings.rounds) return this.endGame();
        s.round++;
        s.queue = s.players.filter((p) => p.connected).map((p) => p.id);
        if (s.queue.length < 2) return this.endGameOrLobby();
        if (s.round > 1 || s.turnsPlayed > 0) this.chat('system', `Round ${s.round} of ${s.settings.rounds}`);
      }
      const id = s.queue.shift()!;
      const p = s.players.find((x) => x.id === id);
      if (p && p.connected) drawer = p;
    }
    for (const p of s.players) {
      p.guessedAt = null;
      p.turnDelta = 0;
    }
    this.clearBoard();
    s.drawerId = drawer.id;
    s.word = null;
    s.revealed = [];
    s.hintTimes = [];
    s.reveal = null;
    s.choices = this.pickChoices();
    if (s.choices.length === 1) {
      this.beginDrawing(s.choices[0]);
      return;
    }
    s.phase = 'choosing';
    s.phaseEndsAt = Date.now() + CHOOSE_MS;
    this.chat('system', `${drawer.name} is choosing a word…`);
    this.commit();
  }

  private pickChoices(): string[] {
    const s = this.s!;
    const { customWords, customOnly, wordCount, lang } = s.settings;
    const base = wordsSync(lang);
    const used = new Set(s.usedWords);
    const freshOf = (arr: string[]) => arr.filter((w) => !used.has(w));
    let customPool = freshOf(customWords);
    let basePool = customOnly ? [] : freshOf(base);
    if (customPool.length + basePool.length < wordCount) {
      s.usedWords = [];
      customPool = customWords.slice();
      basePool = customOnly ? [] : base.slice();
    }
    const out: string[] = [];
    while (out.length < wordCount && customPool.length + basePool.length > 0) {
      const useCustom = customPool.length > 0 && (basePool.length === 0 || Math.random() < 0.4);
      const pool = useCustom ? customPool : basePool;
      const i = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  private onChoose(p: PlayerS, i: number) {
    const s = this.s!;
    if (s.phase !== 'choosing' || s.drawerId !== p.id || !s.choices) return;
    const word = s.choices[Math.floor(Number(i))];
    if (!word) return;
    this.beginDrawing(word);
  }

  private beginDrawing(word: string) {
    const s = this.s!;
    const now = Date.now();
    const drawMs = s.settings.drawTime * 1000;
    s.phase = 'drawing';
    s.word = word;
    s.choices = null;
    s.usedWords.push(word);
    s.revealed = [];
    s.hintTimes = hintTimes(now, drawMs, s.settings.hints, word);
    s.phaseEndsAt = now + drawMs;
    const drawer = s.players.find((p) => p.id === s.drawerId);
    this.chat('system', `${drawer?.name ?? 'Someone'} is drawing now!`);
    this.commit();
  }

  private checkAllGuessed() {
    const s = this.s!;
    if (s.phase !== 'drawing') return;
    const guessers = s.players.filter((p) => p.id !== s.drawerId && p.connected);
    if (guessers.length > 0 && guessers.every((p) => p.guessedAt)) this.endTurn('all_guessed');
  }

  private endTurn(reason: string) {
    const s = this.s!;
    if (s.phase !== 'choosing' && s.phase !== 'drawing') return;
    const word = s.word ?? '';
    const guessers = s.players.filter((p) => p.guessedAt);
    const drawer = s.players.find((p) => p.id === s.drawerId);
    if (drawer && guessers.length) {
      const d = drawerScore(guessers.map((g) => g.turnDelta));
      drawer.turnDelta = d;
      drawer.score += d;
    }
    s.phase = 'reveal';
    s.reveal = { word, reason };
    s.phaseEndsAt = Date.now() + REVEAL_MS;
    s.hintTimes = [];
    s.choices = null;
    if (word) s.turnsPlayed++;
    if (word) this.chat('reveal', `The word was: ${word}`);
    this.commit();
  }

  private endGame() {
    const s = this.s!;
    s.phase = 'ended';
    s.drawerId = null;
    s.word = null;
    s.choices = null;
    s.reveal = null;
    s.hintTimes = [];
    s.phaseEndsAt = Date.now() + ENDED_MS;
    const top = [...s.players].sort((a, b) => b.score - a.score)[0];
    if (top) this.chat('system', `Game over! ${top.name} wins with ${top.score} points.`);
    this.commit();
  }

  private endGameOrLobby() {
    if (this.s!.turnsPlayed > 0) this.endGame();
    else this.toLobby();
  }

  private revealHint() {
    const s = this.s!;
    if (!s.word) return;
    const hidden = letterIndexes(s.word).filter((i) => !s.revealed.includes(i));
    if (hidden.length <= 1) return;
    s.revealed.push(pickRandom(hidden, 1)[0]);
  }

  /** Alarm handler: advance every timer that is due. */
  private tick() {
    const s = this.s!;
    const now = Date.now();

    if (s.emptySince && now - s.emptySince >= EMPTY_TTL_MS) return this.destroy();

    // grace expiry
    for (const p of [...s.players]) {
      if (p.leftAt && now - p.leftAt >= this.graceMs() && !p.connected) {
        this.removePlayer(p.id, 'timeout');
        if (!this.s) return;
      }
    }

    // hints
    if (s.phase === 'drawing') {
      let changed = false;
      while (s.hintTimes.length && s.hintTimes[0] <= now) {
        s.hintTimes.shift();
        this.revealHint();
        changed = true;
      }
      if (changed) this.commit();
    }

    // phase deadline
    if (s.phaseEndsAt && s.phaseEndsAt <= now) {
      switch (s.phase) {
        case 'choosing':
          if (s.choices?.length) this.beginDrawing(s.choices[Math.floor(Math.random() * s.choices.length)]);
          else this.endTurn('no_word');
          break;
        case 'drawing':
          this.endTurn('time');
          break;
        case 'reveal':
          this.nextTurn();
          break;
        case 'ended':
          this.toLobby();
          break;
        default:
          s.phaseEndsAt = null;
      }
    }

    // public lobby auto start
    if (s.startAt && s.startAt <= now && s.phase === 'lobby') {
      s.startAt = null;
      if (this.connectedCount() >= 2) this.startGame();
      else this.commit();
    }
    this.schedule();
  }

  private destroy() {
    const s = this.s!;
    const lang = s.settings.lang;
    const code = s.code;
    for (const w of this.sockets()) try { w.close(1001, 'room closed'); } catch { /* ignore */ }
    if (s.isPublic) this.ctx.waitUntil(matchmakerFor(this.env, lang).closed(code).catch(() => {}));
    this.s = null;
    this.ops = [];
    void this.ctx.storage.deleteAlarm();
    void this.ctx.storage.deleteAll();
  }

  // ------------------------------------------------------------------ chat & guessing

  private onChat(p: PlayerS, raw: string) {
    const s = this.s!;
    const text = sanitizeChat(raw);
    if (!text) return;
    // rate limit: 6 messages / 4 seconds
    const now = Date.now();
    const times = (this.chatTimes.get(p.id) ?? []).filter((t) => now - t < 4000);
    if (times.length >= 6) return this.sendTo(p.id, { t: 'chat', kind: 'system', text: 'You are sending messages too fast.' });
    times.push(now);
    this.chatTimes.set(p.id, times);

    const from = { from: p.id, name: p.name };
    if (s.phase !== 'drawing' || !s.word) return this.chat('chat', text, from);

    const isDrawer = s.drawerId === p.id;
    const teamIds = s.players.filter((x) => x.id === s.drawerId || x.guessedAt).map((x) => x.id);

    if (isDrawer || p.guessedAt) {
      if (leaksWord(text, s.word)) {
        return this.sendTo(p.id, { t: 'chat', kind: 'system', text: "Don't give away the word!" });
      }
      return this.chat('team', text, from, teamIds);
    }

    const verdict = judgeGuess(text, s.word);
    if (verdict === 'correct') {
      const now2 = Date.now();
      const delta = guessScore((s.phaseEndsAt ?? now2) - now2, s.settings.drawTime * 1000);
      p.guessedAt = now2;
      p.turnDelta = delta;
      p.score += delta;
      this.chat('correct', `${p.name} guessed the word!`, { from: p.id });
      this.checkAllGuessed();
      this.commit();
      return;
    }
    if (verdict === 'close') this.sendTo(p.id, { t: 'chat', kind: 'close', text: `"${text}" is close!` });

    if (s.settings.guessChat === 'open') return this.chat('chat', text, from);
    // masked: drawer, correct guessers and the sender see the text; other guessers see ***
    const seeIds = new Set([...teamIds, p.id]);
    for (const x of s.players) {
      this.sendTo(x.id, seeIds.has(x.id)
        ? { t: 'chat', kind: 'chat', text, ...from }
        : { t: 'chat', kind: 'masked', text: '***', ...from });
    }
  }

  // ------------------------------------------------------------------ drawing

  private async clearOpKeys(count: number, from = 0) {
    const keys: string[] = [];
    for (let i = from; i < count; i++) keys.push(opKey(i));
    for (let i = 0; i < keys.length; i += 120) await this.ctx.storage.delete(keys.slice(i, i + 120));
  }

  private clearBoard() {
    const n = this.ops.length;
    this.ops = [];
    this.stroking = false;
    if (n) void this.clearOpKeys(n);
    this.sendAll({ t: 'clear' });
  }

  private finishStroke() {
    if (!this.stroking) return;
    this.stroking = false;
    void this.ctx.storage.put(opKey(this.ops.length - 1), this.ops[this.ops.length - 1]);
  }

  private onDraw(p: PlayerS, m: ClientMsg) {
    const s = this.s!;
    if (s.phase !== 'drawing' || s.drawerId !== p.id) return;
    const px = (v: unknown) => clamp(Math.round(Number(v) || 0), 0, CANVAS_W);
    const py = (v: unknown) => clamp(Math.round(Number(v) || 0), 0, CANVAS_H);
    switch (m.t) {
      case 'ds': {
        if (!validColor(m.c) || this.ops.length >= MAX_OPS) return;
        this.finishStroke();
        const w = clamp(Math.round(Number(m.w) || 4), 1, 64);
        const x = px(m.x), y = py(m.y);
        this.ops.push({ k: 's', c: m.c.toLowerCase(), w, p: [x, y] });
        this.stroking = true;
        return this.sendAll({ t: 'ds', c: m.c.toLowerCase(), w, x, y }, p.id);
      }
      case 'dp': {
        if (!this.stroking || !Array.isArray(m.p)) return;
        const op = this.ops[this.ops.length - 1];
        if (op.k !== 's' || op.p.length > MAX_STROKE_VALUES) return;
        const pts: number[] = [];
        const raw = m.p.slice(0, 400);
        for (let i = 0; i + 1 < raw.length; i += 2) pts.push(px(raw[i]), py(raw[i + 1]));
        if (!pts.length) return;
        op.p.push(...pts);
        return this.sendAll({ t: 'dp', p: pts }, p.id);
      }
      case 'de':
        if (!this.stroking) return;
        this.finishStroke();
        return this.sendAll({ t: 'de' }, p.id);
      case 'df': {
        if (!validColor(m.c) || this.ops.length >= MAX_OPS) return;
        this.finishStroke();
        const op: DrawOp = { k: 'f', c: m.c.toLowerCase(), x: px(m.x), y: py(m.y) };
        this.ops.push(op);
        void this.ctx.storage.put(opKey(this.ops.length - 1), op);
        return this.sendAll({ t: 'df', c: op.c, x: op.x, y: op.y }, p.id);
      }
      case 'undo': {
        this.finishStroke();
        if (!this.ops.length) return;
        this.ops.pop();
        void this.ctx.storage.delete(opKey(this.ops.length));
        return this.sendAll({ t: 'undo' }, p.id);
      }
      case 'clear': {
        this.finishStroke();
        const n = this.ops.length;
        this.ops = [];
        if (n) void this.clearOpKeys(n);
        return this.sendAll({ t: 'clear' }, p.id);
      }
    }
  }
}
void LIMITS;
