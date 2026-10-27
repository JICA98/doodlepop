import { useEffect, useRef, useState } from 'preact/hooks';
import { Game } from './Game';
import { Home } from './Home';
import { GameClient } from './net';
import { loadProfile, saveProfile, sessionToken, type Profile } from './util';

const qp = () => new URLSearchParams(location.search).get('room')?.toLowerCase().replace(/[^a-z0-9]/g, '') || null;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`Server said ${r.status}`);
  return r.json();
}

export function App() {
  const [profile, setProfileState] = useState<Profile>(loadProfile);
  const [client, setClient] = useState<GameClient | null>(null);
  const [invite, setInvite] = useState<string | null>(qp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<number | null>(null);
  const quickRetries = useRef(0);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const setProfile = (p: Profile) => {
    setProfileState(p);
    saveProfile(p);
  };

  useEffect(() => {
    if (client) return;
    api<{ online: number }>('/api/meta').then((m) => setOnline(m.online)).catch(() => {});
  }, [client]);

  const enter = (code: string, quick = false) => {
    const p = profileRef.current;
    const c = new GameClient(code, { name: p.name.trim(), avatar: p.avatar, token: sessionToken() });
    c.onFatal = async (f) => {
      c.destroy();
      sessionStorage.removeItem('doodlepop.room');
      // Matchmaking race (room filled / vanished between lookup and join): just ask again.
      if (quick && (f.code === 'full' || f.code === 'notfound') && quickRetries.current < 3) {
        quickRetries.current++;
        return quickPlay(true);
      }
      setClient(null);
      setBusy(false);
      setError(f.msg);
      history.replaceState(null, '', '/');
      setInvite(null);
    };
    sessionStorage.setItem('doodlepop.room', code);
    history.replaceState(null, '', `/?room=${code}`);
    setClient(c);
    setBusy(false);
    void c.start();
  };

  const quickPlay = async (retry = false) => {
    if (!retry) quickRetries.current = 0;
    setBusy(true);
    setError(null);
    try {
      const { code } = await api<{ code: string }>('/api/quickplay', { lang: profileRef.current.lang });
      enter(code, true);
    } catch (e) {
      setBusy(false);
      setError('Could not reach the matchmaker. Please try again.');
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { code } = await api<{ code: string }>('/api/rooms', { lang: profileRef.current.lang });
      enter(code);
    } catch {
      setBusy(false);
      setError('Could not create a room. Please try again.');
    }
  };

  const join = (code: string) => {
    setError(null);
    enter(code);
  };

  // Refresh inside a room → rejoin automatically with the same session token.
  useEffect(() => {
    const code = qp();
    if (code && sessionStorage.getItem('doodlepop.room') === code && profile.name.trim()) enter(code);
  }, []);

  const leave = () => {
    client?.leave();
    sessionStorage.removeItem('doodlepop.room');
    history.replaceState(null, '', '/');
    setInvite(null);
    setClient(null);
  };

  if (client) return <Game client={client} onLeave={leave} />;
  return (
    <Home
      profile={profile}
      setProfile={setProfile}
      inviteCode={invite}
      busy={busy}
      error={error}
      online={online}
      onQuickPlay={() => quickPlay()}
      onCreate={create}
      onJoin={join}
      onClearInvite={() => { setInvite(null); history.replaceState(null, '', '/'); }}
    />
  );
}
