import { useEffect, useRef, useState } from 'preact/hooks';
import { CANVAS_H, CANVAS_W } from '../../shared/protocol';
import type { GameClient } from './net';

const COLORS = [
  '#ffffff', '#c1c1c1', '#ef130b', '#ff7100', '#ffe400', '#00cc00', '#00b2ff', '#231fd3', '#a300ba', '#d37caa', '#a0522d',
  '#000000', '#4c4c4c', '#740b07', '#c23800', '#e8a200', '#005510', '#00569e', '#0e0865', '#550069', '#a75574', '#63300d',
];
const SIZES = [4, 10, 20, 36];
type Tool = 'brush' | 'eraser' | 'fill';

export function DrawCanvas({ client, canDraw }: { client: GameClient; canDraw: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(SIZES[1]);
  const st = useRef({ drawing: false, pending: [] as number[], timer: 0, last: [0, 0] });

  useEffect(() => {
    const c = ref.current!;
    client.board.attach(c);
    return () => client.board.detach();
  }, [client]);

  const pos = (e: PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [
      Math.round(((e.clientX - r.left) * CANVAS_W) / r.width),
      Math.round(((e.clientY - r.top) * CANVAS_H) / r.height),
    ];
  };
  const flush = () => {
    const s = st.current;
    window.clearTimeout(s.timer);
    s.timer = 0;
    if (s.pending.length) {
      client.send({ t: 'dp', p: s.pending });
      s.pending = [];
    }
  };
  const strokeColor = tool === 'eraser' ? '#ffffff' : color;
  const strokeSize = tool === 'eraser' ? Math.max(size, 12) : size;

  const down = (e: PointerEvent) => {
    if (!canDraw) return;
    e.preventDefault();
    const [x, y] = pos(e);
    if (tool === 'fill') {
      client.board.fill(color, x, y);
      client.send({ t: 'df', c: color, x, y });
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    st.current.drawing = true;
    st.current.last = [x, y];
    client.board.startStroke(strokeColor, strokeSize, x, y);
    client.send({ t: 'ds', c: strokeColor, w: strokeSize, x, y });
  };
  const move = (e: PointerEvent) => {
    const s = st.current;
    if (!s.drawing) return;
    const events = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
    const pts: number[] = [];
    for (const ev of events && events.length ? events : [e]) {
      const [x, y] = pos(ev);
      if (Math.abs(x - s.last[0]) + Math.abs(y - s.last[1]) < 2) continue;
      pts.push(x, y);
      s.last = [x, y];
    }
    if (!pts.length) return;
    client.board.addPoints(pts);
    s.pending.push(...pts);
    if (s.pending.length >= 100) flush();
    else if (!s.timer) s.timer = window.setTimeout(flush, 40);
  };
  const up = () => {
    const s = st.current;
    if (!s.drawing) return;
    s.drawing = false;
    flush();
    client.send({ t: 'de' });
  };

  // Stop drawing if we lose the right to draw mid-stroke.
  useEffect(() => { if (!canDraw) st.current.drawing = false; }, [canDraw]);

  return (
    <div class="canvas-block">
      <div class="canvas-wrap">
        <canvas
          ref={ref}
          width={CANVAS_W}
          height={CANVAS_H}
          class={canDraw ? `can-draw tool-${tool}` : ''}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={(e) => (e.buttons === 0 ? up() : undefined)}
        />
      </div>
      {canDraw && (
        <div class="toolbar">
          <div class="palette" role="group" aria-label="Colors">
            {COLORS.map((c) => (
              <button
                key={c}
                class={`swatch ${color === c && tool !== 'eraser' ? 'sel' : ''}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onClick={() => { setColor(c); if (tool === 'eraser') setTool('brush'); }}
              />
            ))}
          </div>
          <div class="tools">
            <div class="sizes" role="group" aria-label="Brush size">
              {SIZES.map((s) => (
                <button key={s} class={`size ${size === s ? 'sel' : ''}`} aria-label={`Size ${s}`} onClick={() => setSize(s)}>
                  <i style={{ width: Math.max(6, s * 0.7), height: Math.max(6, s * 0.7) }} />
                </button>
              ))}
            </div>
            <button class={`tool ${tool === 'brush' ? 'sel' : ''}`} onClick={() => setTool('brush')} title="Brush">✏️</button>
            <button class={`tool ${tool === 'fill' ? 'sel' : ''}`} onClick={() => setTool('fill')} title="Fill">🪣</button>
            <button class={`tool ${tool === 'eraser' ? 'sel' : ''}`} onClick={() => setTool('eraser')} title="Eraser">🧽</button>
            <button class="tool" title="Undo" onClick={() => { client.board.undo(); client.send({ t: 'undo' }); }}>↩️</button>
            <button class="tool" title="Clear canvas" onClick={() => { client.board.clear(); client.send({ t: 'clear' }); }}>🗑️</button>
          </div>
        </div>
      )}
    </div>
  );
}
