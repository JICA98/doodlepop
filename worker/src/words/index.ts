import { EN_WORDS } from './en';
import { DE_WORDS } from './de';
import { ES_WORDS } from './es';
import { FR_WORDS } from './fr';

/**
 * Bundled word packs. To add a language:
 *   1. add worker/src/words/<code>.ts exporting a string[]
 *   2. register it here
 *   3. add { code, name } to LANGUAGES in shared/protocol.ts
 * Packs can also be extended/overridden at runtime without redeploying by binding a KV namespace
 * named WORDS and storing newline/comma separated text under key `words:<code>` (see README).
 */
export const BUNDLED_WORDS: Record<string, string[]> = {
  en: EN_WORDS,
  de: DE_WORDS,
  es: ES_WORDS,
  fr: FR_WORDS,
};

const cache = new Map<string, string[]>();

export function parseWordText(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,\n]/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0 && w.length <= 32),
    ),
  );
}

/** Loads a language pack (KV override if bound, else bundled). Cached per isolate. */
export async function loadWords(env: { WORDS?: KVNamespace }, lang: string): Promise<string[]> {
  const hit = cache.get(lang);
  if (hit) return hit;
  let words = BUNDLED_WORDS[lang] ?? BUNDLED_WORDS.en;
  if (env.WORDS) {
    try {
      const text = await env.WORDS.get(`words:${lang}`);
      if (text) {
        const parsed = parseWordText(text);
        if (parsed.length >= 20) words = parsed;
      }
    } catch {
      /* fall back to bundled */
    }
  }
  cache.set(lang, words);
  return words;
}

/** Synchronous accessor: whatever is cached, else bundled. */
export function wordsSync(lang: string): string[] {
  return cache.get(lang) ?? BUNDLED_WORDS[lang] ?? BUNDLED_WORDS.en;
}
