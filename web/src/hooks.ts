import { useEffect, useReducer, useState } from 'preact/hooks';
import type { GameClient } from './net';

export function useClient(client: GameClient) {
  const [, bump] = useReducer((n: number, _a: number) => n + 1, 0);
  useEffect(() => {
    const off = client.subscribe(() => bump(0));
    // The socket may have delivered messages between first render and this effect; re-sync once.
    bump(0);
    return off;
  }, [client]);
}

/** Seconds remaining until a server timestamp (null → null). Ticks 4×/s. */
export function useCountdown(client: GameClient, endsAt: number | null | undefined): number | null {
  const calc = () => (endsAt ? Math.max(0, Math.ceil((endsAt - client.now()) / 1000)) : null);
  const [v, setV] = useState(calc);
  useEffect(() => {
    setV(calc());
    if (!endsAt) return;
    const id = window.setInterval(() => setV(calc()), 250);
    return () => window.clearInterval(id);
  }, [endsAt, client]);
  return v;
}
