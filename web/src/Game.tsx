import { useState } from 'preact/hooks';
import type { RoomView } from '../../shared/protocol';
import { Avatar } from './Avatar';
import { Chat } from './Chat';
import { DrawCanvas } from './DrawCanvas';
import { Lobby } from './Lobby';
import { Players } from './Players';
import { Logo } from './Home';
import { useClient, useCountdown } from './hooks';
import type { GameClient } from './net';

function WordBar({ view, you, client }: { view: RoomView; you: string | null; client: GameClient }) {
  const me = view.players.find((p) => p.id === you);
  const drawerName = view.players.find((p) => p.id === view.drawerId)?.name;
  if (view.phase === 'drawing') {
    if (view.word) {
      return <div class="word"><small>{view.drawerId === you ? 'DRAW THIS' : 'YOU GOT IT'}</small><span class="letters known">{view.word}</span></div>;
    }
    return (
      <div class="word">
        <small>GUESS THIS</small>
        <span class="letters">
          {[...view.pattern].map((ch, i) => (ch === ' ' ? <i key={i} class="gap" /> : <b key={i}>{ch === '_' ? '' : ch}</b>))}
          <em>{view.pattern.replace(/[^_a-zA-Z\p{L}\p{N}]/gu, '').length}</em>
        </span>
      </div>
    );
  }
  void me; void client;
  const label =
    view.phase === 'choosing' ? `${drawerName ?? 'Someone'} is choosing a word` :
    view.phase === 'reveal' ? 'Round over' :
    view.phase === 'ended' ? 'Game over' : 'Waiting in lobby';
  return <div class="word"><span class="phase-label">{label}</span></div>;
}

function Overlay({ view, you, client }: { view: RoomView; you: string | null; client: GameClient }) {
  const secs = useCountdown(client, view.phaseEndsAt);
  const players = [...view.players].sort((a, b) => b.score - a.score);
  if (view.phase === 'choosing') {
    const drawer = view.players.find((p) => p.id === view.drawerId);
    if (view.drawerId === you && view.choices) {
      return (
        <div class="overlay">
          <h3>Choose a word to draw</h3>
          <div class="choices">
            {view.choices.map((w, i) => <button key={w} class="btn primary choice" onClick={() => client.send({ t: 'choose', i })}>{w}</button>)}
          </div>
          <p class="muted">Auto-picking in {secs ?? '…'}s</p>
        </div>
      );
    }
    return (
      <div class="overlay">
        {drawer && <Avatar avatar={drawer.avatar} size={90} />}
        <h3>{drawer?.name ?? 'Someone'} is choosing a word…</h3>
      </div>
    );
  }
  if (view.phase === 'reveal' && view.reveal) {
    const why: Record<string, string> = {
      all_guessed: 'Everyone guessed it!',
      time: "Time's up!",
      drawer_left: 'The drawer left.',
    };
    return (
      <div class="overlay">
        <p class="muted">{why[view.reveal.reason] ?? ''}</p>
        {view.reveal.word && <h2>The word was <span class="the-word">{view.reveal.word}</span></h2>}
        <div class="deltas">
          {players.map((p) => (
            <div key={p.id} class="delta"><Avatar avatar={p.avatar} size={28} /><span>{p.name}</span><b class={p.turnDelta ? 'plus' : ''}>{p.turnDelta ? `+${p.turnDelta}` : '0'}</b></div>
          ))}
        </div>
      </div>
    );
  }
  if (view.phase === 'ended') {
    const isHost = !view.isPublic && view.hostId === you;
    return (
      <div class="overlay wide">
        <h2>🏆 Final scores</h2>
        <div class="podium">
          {players.slice(0, 3).map((p, i) => (
            <div key={p.id} class={`pod pod${i + 1}`}>
              <Avatar avatar={p.avatar} size={i === 0 ? 76 : 58} />
              <b>{p.name}</b>
              <span>{p.score}</span>
              <div class="step">{['🥇', '🥈', '🥉'][i]}</div>
            </div>
          ))}
        </div>
        <div class="deltas">
          {players.slice(3).map((p, i) => (
            <div key={p.id} class="delta"><span>#{i + 4}</span><Avatar avatar={p.avatar} size={26} /><span>{p.name}</span><b>{p.score}</b></div>
          ))}
        </div>
        {isHost ? (
          <button class="btn primary big" onClick={() => client.send({ t: 'lobby' })}>Play again</button>
        ) : (
          <p class="muted">Back to the lobby in {secs ?? '…'}s{view.isPublic ? '' : ' (or when the host chooses)'}</p>
        )}
      </div>
    );
  }
  return null;
}

export function Game({ client, onLeave }: { client: GameClient; onLeave: () => void }) {
  useClient(client);
  const view = client.view;
  const you = client.you;
  const [tab, setTab] = useState<'chat' | 'players'>('chat');
  const secs = useCountdown(client, view?.phase === 'drawing' ? view.phaseEndsAt : null);
  if (!view) return <div class="center-screen"><div class="spinner" /><p>{client.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</p></div>;

  const isDrawer = view.drawerId === you;
  const me = view.players.find((p) => p.id === you);
  const canChat = true;
  const placeholder =
    view.phase === 'drawing'
      ? isDrawer ? 'Chat with players who guessed…' : me?.guessed ? 'Chat with other guessers…' : 'Type your guess here…'
      : 'Say something…';
  const showCanvas = view.phase !== 'lobby';
  const low = secs !== null && secs <= 10;

  return (
    <div class={`game phase-${view.phase}`}>
      <header class="topbar">
        <div class="brand"><Logo /></div>
        <div class={`clock ${low ? 'low' : ''}`} aria-label="Time left">{view.phase === 'drawing' && secs !== null ? secs : '⏳'}</div>
        <div class="round">{view.phase === 'lobby' ? 'Lobby' : `Round ${Math.max(1, view.round)} / ${view.settings.rounds}`}</div>
        <WordBar view={view} you={you} client={client} />
        <div class="topright">
          <span class="code" title="Room code">#{view.code}</span>
          <button class="btn small ghost" onClick={onLeave}>Leave</button>
        </div>
      </header>

      {client.status === 'reconnecting' && <div class="banner">Connection lost – reconnecting…</div>}
      {client.toast && <div class="banner warn">{client.toast}</div>}

      <aside class={`side players-col ${tab === 'players' ? 'show' : ''}`}>
        <Players view={view} you={you} onKick={(id) => client.send({ t: 'kick', id })} />
      </aside>

      <main class="stage">
        {view.phase === 'lobby' && <Lobby client={client} view={view} you={you} />}
        {showCanvas && (
          <div class="board-area">
            <DrawCanvas client={client} canDraw={view.phase === 'drawing' && isDrawer} />
            <Overlay view={view} you={you} client={client} />
          </div>
        )}
      </main>

      <aside class={`side chat-col ${tab === 'chat' ? 'show' : ''}`}>
        {canChat && <Chat lines={client.chat} you={you} placeholder={placeholder} onSend={(text) => client.send({ t: 'chat', text })} />}
      </aside>

      <nav class="tabs">
        <button class={tab === 'chat' ? 'sel' : ''} onClick={() => setTab('chat')}>💬 Chat</button>
        <button class={tab === 'players' ? 'sel' : ''} onClick={() => setTab('players')}>👥 Players ({view.players.length})</button>
      </nav>
    </div>
  );
}
