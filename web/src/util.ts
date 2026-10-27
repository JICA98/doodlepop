import { AVATAR_COUNTS, type Avatar } from '../../shared/protocol';

export function uid(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch { /* insecure context */ }
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
}

export const randomAvatar = (): Avatar => ({
  color: Math.floor(Math.random() * AVATAR_COUNTS.color),
  eyes: Math.floor(Math.random() * AVATAR_COUNTS.eyes),
  mouth: Math.floor(Math.random() * AVATAR_COUNTS.mouth),
  acc: Math.floor(Math.random() * AVATAR_COUNTS.acc),
});

export interface Profile {
  name: string;
  avatar: Avatar;
  lang: string;
}

export function loadProfile(): Profile {
  try {
    const raw = JSON.parse(localStorage.getItem('doodlepop.profile') ?? 'null');
    if (raw && typeof raw.name === 'string') return raw;
  } catch { /* ignore */ }
  return { name: '', avatar: randomAvatar(), lang: 'en' };
}
export const saveProfile = (p: Profile) => localStorage.setItem('doodlepop.profile', JSON.stringify(p));

/** Per-tab secret that lets a refresh/reconnect reclaim the same player slot. */
export function sessionToken(): string {
  let t = sessionStorage.getItem('doodlepop.token');
  if (!t) {
    t = uid();
    sessionStorage.setItem('doodlepop.token', t);
  }
  return t;
}
