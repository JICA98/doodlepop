import { useEffect, useState } from 'preact/hooks';
import { LANGUAGES, LIMITS, type RoomView, type Settings } from '../../shared/protocol';
import type { GameClient } from './net';
import { useCountdown } from './hooks';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const DRAW_TIMES = [15, 30, 45, 60, 80, 90, 120, 150, 180, 210, 240];

export function Lobby({ client, view, you }: { client: GameClient; view: RoomView; you: string | null }) {
  const isHost = !view.isPublic && view.hostId === you;
  const s = view.settings;
  const set = (patch: Partial<Settings>) => client.send({ t: 'settings', settings: patch });
  const [words, setWords] = useState(s.customWords.join(', '));
  useEffect(() => setWords(s.customWords.join(', ')), [s.customWords.join('|')]);
  const link = `${location.origin}/?room=${view.code}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const startIn = useCountdown(client, view.startAt);
  const connected = view.players.filter((p) => p.connected).length;
  const dis = !isHost;
  const sel = (label: string, value: number | string, opts: (number | string)[], onChange: (v: string) => void, fmt?: (v: any) => string) => (
    <label class="setting">
      <span>{label}</span>
      <select class="input" disabled={dis} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        {opts.map((o) => <option value={o}>{fmt ? fmt(o) : o}</option>)}
      </select>
    </label>
  );

  return (
    <div class="lobby card">
      {view.isPublic ? (
        <div class="public-wait">
          <h2>Public game</h2>
          {connected < 2 ? (
            <p class="big-msg">Waiting for more players… <span class="dots" /></p>
          ) : (
            <p class="big-msg">Game starts in <b>{startIn ?? '…'}</b>s</p>
          )}
          <p class="muted">Players are matched automatically. Want to play with friends? Leave and create a private room.</p>
        </div>
      ) : (
        <>
          <h2>{isHost ? 'Room settings' : 'Waiting for the host…'}</h2>
          <div class="invite">
            <input class="input" readOnly value={link} onFocus={(e) => (e.target as HTMLInputElement).select()} aria-label="Invite link" />
            <button class="btn secondary" onClick={copy}>{copied ? 'Copied!' : '📋 Copy invite'}</button>
          </div>
          <div class="settings-grid">
            {sel('Language', s.lang, LANGUAGES.map((l) => l.code), (v) => set({ lang: v }), (c) => LANGUAGES.find((l) => l.code === c)!.name)}
            {sel('Players', s.maxPlayers, range(LIMITS.maxPlayers.min, LIMITS.maxPlayers.max), (v) => set({ maxPlayers: +v }))}
            {sel('Rounds', s.rounds, range(LIMITS.rounds.min, LIMITS.rounds.max), (v) => set({ rounds: +v }))}
            {sel('Draw time', s.drawTime, DRAW_TIMES, (v) => set({ drawTime: +v }), (v) => `${v}s`)}
            {sel('Word choices', s.wordCount, range(LIMITS.wordCount.min, LIMITS.wordCount.max), (v) => set({ wordCount: +v }))}
            {sel('Hints', s.hints, range(LIMITS.hints.min, LIMITS.hints.max), (v) => set({ hints: +v }))}
            {sel('Wrong guesses in chat', s.guessChat, ['masked', 'open'], (v) => set({ guessChat: v as Settings['guessChat'] }), (v) => (v === 'masked' ? 'Hidden (***)' : 'Visible to all'))}
            <label class="setting check">
              <input type="checkbox" disabled={dis} checked={s.customOnly} onChange={(e) => set({ customOnly: (e.target as HTMLInputElement).checked })} />
              <span>Use custom words only</span>
            </label>
          </div>
          <label class="setting words">
            <span>Custom words <small>(comma or line separated, {s.customWords.length}/{LIMITS.customWordsMax})</small></span>
            <textarea
              class="input"
              rows={3}
              disabled={dis}
              placeholder="pineapple pizza, moon landing, my cat…"
              value={words}
              onInput={(e) => setWords((e.target as HTMLTextAreaElement).value)}
              onBlur={() => isHost && set({ customWords: words as any })}
            />
          </label>
          {isHost ? (
            <button
              class="btn primary big"
              disabled={connected < 2}
              onClick={() => { if (words !== s.customWords.join(', ')) set({ customWords: words as any }); client.send({ t: 'start' }); }}
            >
              {connected < 2 ? 'Need 2+ players to start' : 'Start game!'}
            </button>
          ) : (
            <div class="muted center">The host will start the game when everyone is ready.</div>
          )}
        </>
      )}
    </div>
  );
}
