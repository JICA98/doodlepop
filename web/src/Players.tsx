import type { RoomView } from '../../shared/protocol';
import { Avatar } from './Avatar';

export function Players({ view, you, onKick }: { view: RoomView; you: string | null; onKick?: (id: string) => void }) {
  const inGame = view.phase !== 'lobby';
  const ranked = [...view.players].sort((a, b) => b.score - a.score);
  const rank = new Map(ranked.map((p, i) => [p.id, i + 1]));
  const list = inGame ? ranked : view.players;
  const canKick = !!onKick && !view.isPublic && view.hostId === you;
  return (
    <div class="players" role="list">
      {list.map((p) => (
        <div
          key={p.id}
          role="listitem"
          class={`player ${p.guessed ? 'guessed' : ''} ${p.isDrawer ? 'drawer' : ''} ${p.connected ? '' : 'offline'} ${p.id === you ? 'me' : ''}`}
        >
          {inGame && <span class="rank">#{rank.get(p.id)}</span>}
          <Avatar avatar={p.avatar} size={40} />
          <div class="pinfo">
            <div class="pname">
              {p.name}
              {p.id === you && <small> (you)</small>}
            </div>
            <div class="pscore">
              {p.score} pts
              {view.phase === 'reveal' && p.turnDelta > 0 && <em> +{p.turnDelta}</em>}
              {!p.connected && <em class="off"> · reconnecting</em>}
            </div>
          </div>
          <div class="badges">
            {p.isHost && <span title="Host">👑</span>}
            {p.isDrawer && view.phase !== 'lobby' && view.phase !== 'ended' && <span title="Drawing">✏️</span>}
            {p.guessed && view.phase === 'drawing' && <span title="Guessed it!">✅</span>}
            {canKick && p.id !== you && (
              <button class="kick" title="Remove player" aria-label={`Remove ${p.name}`} onClick={() => onKick!(p.id)}>✕</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
