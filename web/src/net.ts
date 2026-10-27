import type { Avatar, ChatKind, ClientMsg, RoomView, ServerMsg } from '../../shared/protocol';
import { Board } from './board';

export type Status = 'connecting' | 'open' | 'reconnecting' | 'closed';
export interface ChatLine {
  id: number;
  kind: ChatKind;
  name?: string;
  from?: string;
  text: string;
}
export interface Fatal {
  code: string;
  msg: string;
}

const TERMINAL = new Set(['full', 'kicked', 'replaced', 'bad_token', 'notfound']);

/** Owns the WebSocket for one room: auto-reconnect, heartbeat, state + chat store, draw board. */
export class GameClient {
  view: RoomView | null = null;
  you: string | null = null;
  chat: ChatLine[] = [];
  status: Status = 'connecting';
  toast: string | null = null;
  clockOffset = 0; // serverNow - clientNow
  readonly board = new Board();
  onFatal: (f: Fatal) => void = () => {};

  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private attempts = 0;
  private closedByUs = false;
  private fatal = false;
  private hb: number | undefined;
  private retryTimer: number | undefined;
  private chatSeq = 0;
  private everJoined = false;

  constructor(
    readonly code: string,
    private profile: { name: string; avatar: Avatar; token: string },
  ) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  now() {
    return Date.now() + this.clockOffset;
  }

  async start() {
    try {
      const r = await fetch(`/api/rooms/${this.code}`);
      if (r.status === 404) return this.die('notfound', 'That room does not exist (anymore).');
    } catch { /* offline: connect() will keep retrying */ }
    this.connect();
  }

  private connect() {
    if (this.closedByUs || this.fatal) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/${this.code}`);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'join', token: this.profile.token, name: this.profile.name, avatar: this.profile.avatar });
      window.clearInterval(this.hb);
      this.hb = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 20_000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      let m: ServerMsg;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.handle(m);
    };
    ws.onclose = () => {
      window.clearInterval(this.hb);
      if (this.ws !== ws || this.closedByUs || this.fatal) return;
      this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private scheduleRetry() {
    this.status = 'reconnecting';
    this.emit();
    this.attempts++;
    if (this.attempts > 25) return this.die('lost', 'Connection lost. Please rejoin.');
    const delay = Math.min(5000, 400 * 2 ** Math.min(this.attempts, 4));
    this.retryTimer = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/rooms/${this.code}`);
        if (r.status === 404) return this.die('notfound', 'This room has closed.');
      } catch { /* still offline */ }
      this.connect();
    }, delay);
  }

  private die(code: string, msg: string) {
    this.fatal = true;
    this.status = 'closed';
    this.emit();
    this.onFatal({ code, msg });
  }

  private handle(m: ServerMsg) {
    if (this.board.apply(m) && m.t !== 'canvas') return;
    switch (m.t) {
      case 'welcome':
        this.you = m.you;
        this.status = 'open';
        this.attempts = 0;
        this.setView(m.view);
        this.board.setOps(m.ops);
        if (this.everJoined) this.addChat({ kind: 'system', text: 'Reconnected.' });
        this.everJoined = true;
        break;
      case 'state':
        this.setView(m.view);
        break;
      case 'chat':
        this.addChat(m);
        break;
      case 'error':
        if (TERMINAL.has(m.code)) this.die(m.code, m.msg);
        else { this.toast = m.msg; this.addChat({ kind: 'system', text: m.msg }); this.emit(); window.setTimeout(() => { this.toast = null; this.emit(); }, 4000); }
        break;
    }
  }

  private setView(v: RoomView) {
    this.clockOffset = v.serverNow - Date.now();
    this.view = v;
    this.emit();
  }

  private addChat(m: { kind: ChatKind; text: string; name?: string; from?: string }) {
    this.chat.push({ id: ++this.chatSeq, kind: m.kind, text: m.text, name: m.name, from: m.from });
    if (this.chat.length > 200) this.chat.splice(0, this.chat.length - 200);
    this.emit();
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Explicitly leave the room (frees the seat immediately). */
  leave() {
    this.send({ t: 'leave' });
    this.destroy();
  }

  destroy() {
    this.closedByUs = true;
    window.clearInterval(this.hb);
    window.clearTimeout(this.retryTimer);
    try { this.ws?.close(); } catch { /* ignore */ }
    this.listeners.clear();
  }
}
