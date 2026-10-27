import { LANGUAGES, type Settings } from '../../shared/protocol';
import { randomCode } from './logic';
import { matchmakerFor, roomFor, type Env } from './env';

export { GameRoom } from './room';
export { Matchmaker } from './matchmaker';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    const t = await req.text();
    return t.length < 20_000 ? (JSON.parse(t) as Partial<T>) : {};
  } catch {
    return {};
  }
}

const validLang = (l: unknown) => (typeof l === 'string' && LANGUAGES.some((x) => x.code === l) ? l : 'en');
const CODE_RE = /^[a-z0-9]{4,16}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---- WebSocket: /ws/<code>
      if (path.startsWith('/ws/')) {
        const code = decodeURIComponent(path.slice(4)).toLowerCase();
        if (!CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
        const stub = roomFor(env, code);
        const fwd = new URL(request.url);
        fwd.searchParams.set('code', code);
        return stub.fetch(new Request(fwd, request));
      }

      // ---- Create a private room
      if (path === '/api/rooms' && request.method === 'POST') {
        const b = await body<{ settings: Partial<Settings>; lang: string }>(request);
        const settings: Partial<Settings> = { ...(b.settings ?? {}), lang: validLang(b.lang ?? b.settings?.lang) };
        for (let i = 0; i < 6; i++) {
          const code = randomCode();
          if (await roomFor(env, code).init({ code, isPublic: false, settings })) return json({ code });
        }
        return json({ error: 'Could not allocate a room, try again' }, 503);
      }

      // ---- Room info
      const m = path.match(/^\/api\/rooms\/([a-z0-9]+)$/i);
      if (m && request.method === 'GET') {
        const code = m[1].toLowerCase();
        if (!CODE_RE.test(code)) return json({ exists: false }, 404);
        const info = await roomFor(env, code).info();
        return json(info, info.exists ? 200 : 404);
      }

      // ---- Public matchmaking
      if (path === '/api/quickplay' && request.method === 'POST') {
        const b = await body<{ lang: string }>(request);
        const lang = validLang(b.lang);
        const code = await matchmakerFor(env, lang).findRoom(lang);
        return json({ code });
      }

      if (path === '/api/meta') {
        const stats = await Promise.all(LANGUAGES.map((l) => matchmakerFor(env, l.code).stats().catch(() => ({ rooms: 0, players: 0 }))));
        return json({ languages: LANGUAGES, online: stats.reduce((a, s) => a + s.players, 0) });
      }

      if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('request failed', err);
      return json({ error: 'Internal error' }, 500);
    }

    // Static assets (normally served by the platform before reaching us)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
