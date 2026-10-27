// Pure game logic helpers (no Cloudflare APIs) so they can be unit-tested in Node.
import {
  AVATAR_COUNTS, DEFAULT_SETTINGS, LANGUAGES, LIMITS, clamp,
  type Avatar, type Settings,
} from '../../shared/protocol';

/** Lowercase, strip diacritics, drop everything but letters/digits. */
export function canon(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export type GuessResult = 'correct' | 'close' | 'wrong';
export function judgeGuess(guess: string, word: string): GuessResult {
  const g = canon(guess);
  const w = canon(word);
  if (!g) return 'wrong';
  if (g === w) return 'correct';
  if (w.length >= 4 && levenshtein(g, w) === 1) return 'close';
  return 'wrong';
}

/** Does free text contain the secret word (used to stop the drawer leaking it)? */
export function leaksWord(text: string, word: string): boolean {
  const w = canon(word);
  return w.length > 0 && canon(text).includes(w);
}

const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

export function letterIndexes(word: string): number[] {
  const out: number[] = [];
  [...word].forEach((ch, i) => isLetter(ch) && out.push(i));
  return out;
}

/** "_" for hidden letters, other characters (space, hyphen...) pass through. */
export function makePattern(word: string, revealed: number[]): string {
  const set = new Set(revealed);
  return [...word].map((ch, i) => (isLetter(ch) ? (set.has(i) ? ch : '_') : ch)).join('');
}

/** Speed based score for a correct guess: 50..500 points. */
export function guessScore(timeLeftMs: number, drawTimeMs: number): number {
  const frac = clamp(timeLeftMs / drawTimeMs, 0, 1);
  return Math.round(50 + 450 * frac);
}

export function drawerScore(guesserScores: number[]): number {
  if (!guesserScores.length) return 0;
  return Math.round(guesserScores.reduce((a, b) => a + b, 0) / guesserScores.length);
}

/** Absolute timestamps at which to reveal hint letters. */
export function hintTimes(start: number, drawTimeMs: number, hints: number, word: string): number[] {
  const n = Math.min(hints, Math.max(0, letterIndexes(word).length - 1));
  return Array.from({ length: n }, (_, i) => Math.round(start + (drawTimeMs * (i + 1)) / (n + 1)));
}

export function pickRandom<T>(arr: T[], n: number, rnd: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ---- sanitising user input ----
export function sanitizeName(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.nameMax);
  return s || 'Player';
}

export function sanitizeAvatar(raw: any): Avatar {
  const f = (v: unknown, max: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 && n < max ? n : 0;
  };
  return {
    color: f(raw?.color, AVATAR_COUNTS.color),
    eyes: f(raw?.eyes, AVATAR_COUNTS.eyes),
    mouth: f(raw?.mouth, AVATAR_COUNTS.mouth),
    acc: f(raw?.acc, AVATAR_COUNTS.acc),
  };
}

export function sanitizeChat(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.chatMax);
}

export function parseCustomWords(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const w = String(item).replace(/\s+/g, ' ').trim().toLowerCase();
    if (w.length < 1 || w.length > LIMITS.customWordMax) continue;
    if (!/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= LIMITS.customWordsMax) break;
  }
  return out;
}

const int = (v: unknown, lim: { min: number; max: number }, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? clamp(n, lim.min, lim.max) : fallback;
};

/** Merge a partial settings update from an untrusted client into `prev`. */
export function mergeSettings(prev: Settings, patch: Partial<Settings>, minMaxPlayers = 2): Settings {
  const next: Settings = { ...prev };
  if (patch.maxPlayers !== undefined)
    next.maxPlayers = Math.max(minMaxPlayers, int(patch.maxPlayers, LIMITS.maxPlayers, prev.maxPlayers));
  if (patch.rounds !== undefined) next.rounds = int(patch.rounds, LIMITS.rounds, prev.rounds);
  if (patch.drawTime !== undefined) next.drawTime = int(patch.drawTime, LIMITS.drawTime, prev.drawTime);
  if (patch.wordCount !== undefined) next.wordCount = int(patch.wordCount, LIMITS.wordCount, prev.wordCount);
  if (patch.hints !== undefined) next.hints = int(patch.hints, LIMITS.hints, prev.hints);
  if (patch.lang !== undefined && LANGUAGES.some((l) => l.code === patch.lang)) next.lang = patch.lang;
  if (patch.customWords !== undefined) next.customWords = parseCustomWords(patch.customWords);
  if (patch.customOnly !== undefined) next.customOnly = !!patch.customOnly;
  if (patch.guessChat === 'masked' || patch.guessChat === 'open') next.guessChat = patch.guessChat;
  return next;
}

export function initialSettings(patch?: Partial<Settings>): Settings {
  return mergeSettings({ ...DEFAULT_SETTINGS }, patch ?? {});
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomCode(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const validColor = (c: unknown): c is string => typeof c === 'string' && COLOR_RE.test(c);
