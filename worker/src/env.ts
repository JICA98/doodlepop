import type { GameRoom } from './room';
import type { Matchmaker } from './matchmaker';

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  ASSETS: Fetcher;
  WORDS?: KVNamespace; // optional: runtime word pack overrides
}

export const matchmakerFor = (env: Env, lang: string) =>
  env.MATCHMAKER.get(env.MATCHMAKER.idFromName(`mm:${lang}`));

export const roomFor = (env: Env, code: string) => env.ROOM.get(env.ROOM.idFromName(code.toLowerCase()));
