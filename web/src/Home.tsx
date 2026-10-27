import { useState } from 'preact/hooks';
import { AVATAR_COUNTS, LANGUAGES, LIMITS, type Avatar as AvatarT } from '../../shared/protocol';
import { Avatar } from './Avatar';
import { randomAvatar, type Profile } from './util';

interface Props {
  profile: Profile;
  setProfile: (p: Profile) => void;
  inviteCode: string | null;
  busy: boolean;
  error: string | null;
  online: number | null;
  onQuickPlay: () => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onClearInvite: () => void;
}

const PARTS: { key: keyof AvatarT; label: string }[] = [
  { key: 'color', label: 'Color' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'mouth', label: 'Mouth' },
  { key: 'acc', label: 'Style' },
];

export function Logo() {
  return (
    <div class="logo" aria-label="Doodlepop">
      <svg viewBox="0 0 64 64" width="54" height="54">
        <rect width="64" height="64" rx="16" fill="#ffd84d" />
        <path d="M12 44c8-22 14 6 22-14s10 4 16-8" fill="none" stroke="#4f3fd8" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="49" cy="47" r="6" fill="#ff6b9a" />
      </svg>
      <span>
        {'Doodlepop'.split('').map((ch, i) => (
          <b key={i} style={{ color: ['#ff6b9a', '#ffd84d', '#1dd1a1', '#48dbfb', '#ff4d8d', '#ff9f43', '#c9b8ff', '#ff6b6b', '#a3f08b'][i] }}>{ch}</b>
        ))}
      </span>
    </div>
  );
}

export function Home(p: Props) {
  const [code, setCode] = useState('');
  const { profile } = p;
  const set = (patch: Partial<Profile>) => p.setProfile({ ...profile, ...patch });
  const cycle = (key: keyof AvatarT, dir: number) => {
    const n = AVATAR_COUNTS[key];
    set({ avatar: { ...profile.avatar, [key]: (profile.avatar[key] + dir + n) % n } });
  };
  const nameOk = profile.name.trim().length > 0;

  return (
    <div class="home">
      <Logo />
      <p class="tagline">Draw it. Guess it. Doodle with friends or strangers.</p>

      <div class="card home-card">
        {p.inviteCode && (
          <div class="invite-banner">
            🎟️ You’ve been invited to room <code>{p.inviteCode}</code>
            <button class="link" onClick={p.onClearInvite}>cancel</button>
          </div>
        )}
        <div class="home-top">
          <input
            class="input name"
            placeholder="Enter your nickname"
            maxLength={LIMITS.nameMax}
            value={profile.name}
            onInput={(e) => set({ name: (e.target as HTMLInputElement).value })}
            aria-label="Nickname"
          />
          <select class="input lang" value={profile.lang} onChange={(e) => set({ lang: (e.target as HTMLSelectElement).value })} aria-label="Language">
            {LANGUAGES.map((l) => <option value={l.code}>{l.name}</option>)}
          </select>
        </div>

        <div class="avatar-editor">
          <Avatar avatar={profile.avatar} size={120} />
          <div class="avatar-parts">
            {PARTS.map((part) => (
              <div class="part" key={part.key}>
                <button aria-label={`Previous ${part.label}`} onClick={() => cycle(part.key, -1)}>◀</button>
                <span>{part.label}</span>
                <button aria-label={`Next ${part.label}`} onClick={() => cycle(part.key, 1)}>▶</button>
              </div>
            ))}
            <button class="btn small ghost" onClick={() => set({ avatar: randomAvatar() })}>🎲 Randomize</button>
          </div>
        </div>

        {p.error && <div class="error-box">{p.error}</div>}

        {p.inviteCode ? (
          <button class="btn primary big" disabled={!nameOk || p.busy} onClick={() => p.onJoin(p.inviteCode!)}>
            {p.busy ? 'Joining…' : 'Join room!'}
          </button>
        ) : (
          <>
            <button class="btn primary big" disabled={!nameOk || p.busy} onClick={p.onQuickPlay}>
              {p.busy ? 'Finding a game…' : 'Play!'}
            </button>
            <button class="btn secondary" disabled={!nameOk || p.busy} onClick={p.onCreate}>Create private room</button>
            <form
              class="join-row"
              onSubmit={(e) => {
                e.preventDefault();
                const c = code.trim().split(/[?/=]/).pop()!.toLowerCase();
                if (c && nameOk) p.onJoin(c);
              }}
            >
              <input class="input" placeholder="Have a room code or link?" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} aria-label="Room code" />
              <button class="btn ghost" disabled={!nameOk || !code.trim() || p.busy}>Join</button>
            </form>
          </>
        )}
        {!nameOk && <div class="hint">Pick a nickname to start playing.</div>}
        {p.online !== null && <div class="online">🟢 {p.online} player{p.online === 1 ? '' : 's'} in public games</div>}
      </div>

      <div class="how">
        <div class="card how-card"><span>✏️</span><b>Draw</b><p>When it’s your turn, pick a word and sketch it.</p></div>
        <div class="card how-card"><span>💬</span><b>Guess</b><p>Type your guess in chat. Faster guesses score more.</p></div>
        <div class="card how-card"><span>🏆</span><b>Win</b><p>Highest score after the final round takes the crown.</p></div>
      </div>
    </div>
  );
}
