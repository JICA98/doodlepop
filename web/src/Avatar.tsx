import { AVATAR_COUNTS, type Avatar as AvatarT } from '../../shared/protocol';

export const AVATAR_PALETTE = [
  '#ff6b6b', '#ff9f43', '#feca57', '#1dd1a1', '#48dbfb', '#54a0ff',
  '#8b6cf0', '#ff78c4', '#a3cb38', '#c4a484', '#8395a7', '#f368e0',
];
const INK = '#2b2350';

function Eyes({ n }: { n: number }) {
  switch (n % AVATAR_COUNTS.eyes) {
    case 0: return <g fill={INK}><circle cx="36" cy="44" r="4.5" /><circle cx="64" cy="44" r="4.5" /></g>;
    case 1: return <g><circle cx="35" cy="44" r="9" fill="#fff" stroke={INK} strokeWidth="2" /><circle cx="65" cy="44" r="9" fill="#fff" stroke={INK} strokeWidth="2" /><circle cx="37" cy="45" r="4" fill={INK} /><circle cx="63" cy="45" r="4" fill={INK} /></g>;
    case 2: return <g fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round"><path d="M28 45q7 6 14 0" /><path d="M58 45q7 6 14 0" /></g>;
    case 3: return <g><circle cx="36" cy="44" r="4.5" fill={INK} /><path d="M58 46q7-7 14 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" /></g>;
    case 4: return <g><g fill={INK}><circle cx="36" cy="46" r="4.5" /><circle cx="64" cy="46" r="4.5" /></g><g stroke={INK} strokeWidth="3.5" strokeLinecap="round"><path d="M27 36l15 5" /><path d="M73 36l-15 5" /></g></g>;
    case 5: return <g fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round"><path d="M28 48q7-10 14 0" /><path d="M58 48q7-10 14 0" /></g>;
    case 6: return <g><circle cx="50" cy="44" r="12" fill="#fff" stroke={INK} strokeWidth="2" /><circle cx="50" cy="45" r="5.5" fill={INK} /></g>;
    default: return <g fill={INK}><circle cx="36" cy="44" r="7" /><circle cx="64" cy="44" r="7" /><circle cx="38.5" cy="41.5" r="2.4" fill="#fff" /><circle cx="66.5" cy="41.5" r="2.4" fill="#fff" /></g>;
  }
}

function Mouth({ n }: { n: number }) {
  switch (n % AVATAR_COUNTS.mouth) {
    case 0: return <path d="M36 64q14 14 28 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />;
    case 1: return <path d="M34 62q16 22 32 0z" fill="#fff" stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
    case 2: return <ellipse cx="50" cy="68" rx="7" ry="9" fill={INK} />;
    case 3: return <path d="M38 69h24" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />;
    case 4: return <g><path d="M36 64q14 14 28 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" /><path d="M45 71q5 12 10 0z" fill="#ff6b9a" stroke={INK} strokeWidth="2" /></g>;
    case 5: return <circle cx="50" cy="68" r="4.5" fill="none" stroke={INK} strokeWidth="3.5" />;
    case 6: return <path d="M37 73q13-13 26 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />;
    default: return <g><rect x="36" y="62" width="28" height="12" rx="4" fill="#fff" stroke={INK} strokeWidth="3" /><path d="M43 62v12M50 62v12M57 62v12" stroke={INK} strokeWidth="1.5" /></g>;
  }
}

function Accessory({ n }: { n: number }) {
  switch (n % AVATAR_COUNTS.acc) {
    case 1: return <g><path d="M50 -2L34 24h32z" fill="#ff6b9a" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" /><circle cx="50" cy="-2" r="5" fill="#ffd84d" stroke={INK} strokeWidth="2" /></g>;
    case 2: return <path d="M27 22l-3-20 14 11 12-15 12 15 14-11-3 20z" fill="#ffd84d" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />;
    case 3: return <g fill="none" stroke={INK} strokeWidth="3"><circle cx="35" cy="44" r="11" /><circle cx="65" cy="44" r="11" /><path d="M46 43h8" /></g>;
    case 4: return <g fill={INK} stroke={INK} strokeWidth="2" strokeLinejoin="round"><rect x="22" y="36" width="25" height="16" rx="6" /><rect x="53" y="36" width="25" height="16" rx="6" /><path d="M47 40h6" strokeWidth="3" /></g>;
    case 5: return <g><path d="M16 50C14 10 86 10 84 50" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" /><rect x="8" y="40" width="12" height="22" rx="5" fill="#54a0ff" stroke={INK} strokeWidth="2.5" /><rect x="80" y="40" width="12" height="22" rx="5" fill="#54a0ff" stroke={INK} strokeWidth="2.5" /></g>;
    case 6: return <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round"><path d="M70 14l16-9v22z" fill="#ff6b9a" /><path d="M70 14L54 5v22z" fill="#ff6b9a" /><circle cx="70" cy="14" r="4.5" fill="#ffd84d" /></g>;
    case 7: return <g stroke={INK} strokeWidth="3" strokeLinecap="round"><path d="M50 8V-6" /><circle cx="50" cy="-9" r="5" fill="#1dd1a1" /></g>;
    case 8: return <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round"><path d="M18 26C20 4 80 4 82 26z" fill="#54a0ff" /><path d="M60 24h34q-2 8-14 8H60z" fill="#3a78d8" /></g>;
    default: return null;
  }
}

export function Avatar({ avatar, size = 48, className = '' }: { avatar: AvatarT; size?: number; className?: string }) {
  const body = AVATAR_PALETTE[avatar.color % AVATAR_PALETTE.length];
  return (
    <svg className={`avatar ${className}`} width={size} height={size} viewBox="-6 -14 112 120" role="img" aria-label="avatar">
      <circle cx="50" cy="52" r="44" fill={body} stroke={INK} strokeWidth="4" />
      <ellipse cx="34" cy="30" rx="14" ry="8" fill="#fff" opacity=".25" transform="rotate(-25 34 30)" />
      <Eyes n={avatar.eyes} />
      <Mouth n={avatar.mouth} />
      <Accessory n={avatar.acc} />
    </svg>
  );
}
