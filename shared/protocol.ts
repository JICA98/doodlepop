// Shared wire protocol + constants between the Worker (Durable Objects) and the web client.

export const CANVAS_W = 800;
export const CANVAS_H = 600;

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'reveal' | 'ended';

export interface Avatar {
  color: number; // body colour index
  eyes: number;
  mouth: number;
  acc: number; // accessory (hat etc.)
}
export const AVATAR_COUNTS = { color: 12, eyes: 8, mouth: 8, acc: 9 } as const;

export interface Language {
  code: string;
  name: string;
}
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
];

export type GuessChat = 'masked' | 'open';

export interface Settings {
  maxPlayers: number;
  rounds: number;
  drawTime: number; // seconds
  wordCount: number; // number of word choices offered to the drawer
  hints: number;
  lang: string;
  customWords: string[];
  customOnly: boolean;
  guessChat: GuessChat; // masked: other guessers see *** for wrong guesses; open: skribbl-style
}

export const LIMITS = {
  maxPlayers: { min: 2, max: 12, def: 8 },
  rounds: { min: 1, max: 10, def: 3 },
  drawTime: { min: 15, max: 240, def: 80 },
  wordCount: { min: 1, max: 5, def: 3 },
  hints: { min: 0, max: 5, def: 2 },
  nameMax: 20,
  chatMax: 100,
  customWordMax: 32,
  customWordsMax: 500,
} as const;

export const DEFAULT_SETTINGS: Settings = {
  maxPlayers: LIMITS.maxPlayers.def,
  rounds: LIMITS.rounds.def,
  drawTime: LIMITS.drawTime.def,
  wordCount: LIMITS.wordCount.def,
  hints: LIMITS.hints.def,
  lang: 'en',
  customWords: [],
  customOnly: false,
  guessChat: 'masked',
};

// ---- Drawing ----
export type DrawOp =
  | { k: 's'; c: string; w: number; p: number[] } // stroke: colour, width, flat [x,y,x,y...]
  | { k: 'f'; c: string; x: number; y: number }; // flood fill

// ---- Views ----
export interface PlayerView {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  connected: boolean;
  guessed: boolean;
  isHost: boolean;
  isDrawer: boolean;
  turnDelta: number;
}

export interface RoomView {
  code: string;
  isPublic: boolean;
  phase: Phase;
  settings: Settings;
  players: PlayerView[];
  hostId: string | null;
  round: number;
  drawerId: string | null;
  phaseEndsAt: number | null;
  startAt: number | null; // lobby auto-start (public rooms)
  serverNow: number;
  pattern: string; // "_ _ a _" style, '_' = hidden letter
  word: string | null; // only for drawer, or during reveal/ended
  choices: string[] | null; // only for drawer in 'choosing'
  reveal: { word: string; reason: string } | null;
}

// ---- Client -> Server ----
export type ClientMsg =
  | { t: 'join'; token: string; name: string; avatar: Avatar }
  | { t: 'settings'; settings: Partial<Settings> }
  | { t: 'start' }
  | { t: 'lobby' } // host: return to lobby after game over
  | { t: 'choose'; i: number }
  | { t: 'chat'; text: string }
  | { t: 'ds'; c: string; w: number; x: number; y: number }
  | { t: 'dp'; p: number[] }
  | { t: 'de' }
  | { t: 'df'; c: string; x: number; y: number }
  | { t: 'undo' }
  | { t: 'clear' }
  | { t: 'kick'; id: string }
  | { t: 'leave' };

export type ChatKind = 'chat' | 'system' | 'correct' | 'close' | 'team' | 'masked' | 'reveal' | 'join' | 'leave';

// ---- Server -> Client ----
export type ServerMsg =
  | { t: 'welcome'; you: string; view: RoomView; ops: DrawOp[] }
  | { t: 'state'; view: RoomView }
  | { t: 'chat'; kind: ChatKind; from?: string; name?: string; text: string }
  | { t: 'ds'; c: string; w: number; x: number; y: number }
  | { t: 'dp'; p: number[] }
  | { t: 'de' }
  | { t: 'df'; c: string; x: number; y: number }
  | { t: 'undo' }
  | { t: 'clear' }
  | { t: 'canvas'; ops: DrawOp[] }
  | { t: 'error'; code: string; msg: string };

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
