import { DurableObject } from 'cloudflare:workers';
import type { Phase } from '../../shared/protocol';
import { LIMITS } from '../../shared/protocol';
import { randomCode } from './logic';
import { roomFor, type Env } from './env';

/**
 * One Matchmaker DO per language ("mm:<lang>"). It keeps a registry of *public* rooms that report
 * their occupancy, and hands out the fullest room that still has a free seat (creating a new room
 * when none exists). Short-lived seat reservations avoid sending a burst of players to one seat.
 * Overbooking is still possible under races; the client simply retries when a room says "full".
 */
interface Entry {
  code: string;
  players: number; // seats taken (connected + in reconnect grace)
  max: number;
  phase: Phase;
  at: number; // last report time
  reserved: number[]; // timestamps of recent reservations
}

const RESERVE_TTL = 15_000;
const STALE_EMPTY = 2 * 60_000;
const STALE_ANY = 30 * 60_000;

export class Matchmaker extends DurableObject<Env> {
  private rooms = new Map<string, Entry>();
  private lang: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Record<string, Entry>>('rooms');
      if (saved) this.rooms = new Map(Object.entries(saved));
      this.lang = (await ctx.storage.get<string>('lang')) ?? null;
    });
  }

  private async persist() {
    await this.ctx.storage.put('rooms', Object.fromEntries(this.rooms));
    const next = Date.now() + 60_000;
    if (this.rooms.size) await this.ctx.storage.setAlarm(next);
  }

  private free(e: Entry, now: number) {
    const live = e.reserved.filter((t) => now - t < RESERVE_TTL).length;
    return e.max - e.players - live;
  }

  /** Called by rooms whenever occupancy / phase changes. */
  async report(info: { code: string; lang: string; players: number; max: number; phase: Phase; at: number }) {
    this.lang = info.lang;
    const prev = this.rooms.get(info.code);
    const reserved = (prev?.reserved ?? []).filter((t) => t > info.at && Date.now() - t < RESERVE_TTL);
    this.rooms.set(info.code, {
      code: info.code,
      players: info.players,
      max: info.max,
      phase: info.phase,
      at: Date.now(),
      reserved,
    });
    await this.persist();
  }

  async closed(code: string) {
    if (this.rooms.delete(code)) await this.persist();
  }

  /** Pick the best public room for a new player, or create one. Returns the room code. */
  async findRoom(lang: string): Promise<string> {
    const now = Date.now();
    let best: Entry | null = null;
    for (const e of this.rooms.values()) {
      if (this.free(e, now) <= 0) continue;
      if (e.phase === 'ended') continue; // about to reset; skip
      // Prefer fuller rooms so games fill up; empty ghost rooms rank last.
      const rank = (x: Entry) => x.players + x.reserved.filter((t) => now - t < RESERVE_TTL).length;
      if (!best || rank(e) > rank(best)) best = e;
    }
    if (best) {
      best.reserved.push(now);
      await this.persist();
      return best.code;
    }
    // Create a fresh public room.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const ok = await roomFor(this.env, code).init({ code, isPublic: true, settings: { lang } });
      if (!ok) continue;
      this.lang = lang;
      this.rooms.set(code, { code, players: 0, max: LIMITS.maxPlayers.def, phase: 'lobby', at: now, reserved: [now] });
      await this.persist();
      return code;
    }
    throw new Error('could not allocate room');
  }

  async stats() {
    let players = 0;
    for (const e of this.rooms.values()) players += e.players;
    return { rooms: this.rooms.size, players };
  }

  async alarm() {
    const now = Date.now();
    for (const [code, e] of this.rooms) {
      const age = now - e.at;
      if ((e.players === 0 && age > STALE_EMPTY) || age > STALE_ANY) this.rooms.delete(code);
    }
    await this.persist();
  }
}
