import { useEffect, useRef, useState } from 'preact/hooks';
import { LIMITS } from '../../shared/protocol';
import type { ChatLine } from './net';

export function Chat({ lines, you, onSend, placeholder }: { lines: ChatLine[]; you: string | null; onSend: (t: string) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <div class="chat">
      <div class="chat-log" ref={box} aria-live="polite">
        {lines.map((l) => (
          <div key={l.id} class={`line ${l.kind} ${l.from && l.from === you ? 'mine' : ''}`}>
            {(l.kind === 'chat' || l.kind === 'masked' || l.kind === 'team') && <b>{l.name}: </b>}
            {l.kind === 'team' && <span class="tag">✅ </span>}
            <span>{l.text}</span>
          </div>
        ))}
      </div>
      <form
        class="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t) onSend(t);
          setText('');
        }}
      >
        <input
          class="input"
          value={text}
          maxLength={LIMITS.chatMax}
          placeholder={placeholder}
          autocomplete="off"
          autocapitalize="off"
          enterKeyHint="send"
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          aria-label="Chat or guess"
        />
        <button class="btn primary" aria-label="Send">➤</button>
      </form>
    </div>
  );
}
