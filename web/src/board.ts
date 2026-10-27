import { CANVAS_H, CANVAS_W, type DrawOp, type ServerMsg } from '../../shared/protocol';

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Scanline flood fill. Deterministic so every client reproduces the same result. */
export function floodFill(ctx: CanvasRenderingContext2D, sx: number, sy: number, hex: string) {
  const W = CANVAS_W, H = CANVAS_H;
  sx = Math.min(W - 1, Math.max(0, Math.round(sx)));
  sy = Math.min(H - 1, Math.max(0, Math.round(sy)));
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const [fr, fg, fb] = hexToRgb(hex);
  const i0 = (sy * W + sx) * 4;
  const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  const TOL = 48;
  const near = (i: number) =>
    Math.abs(d[i] - tr) <= TOL && Math.abs(d[i + 1] - tg) <= TOL && Math.abs(d[i + 2] - tb) <= TOL;
  if (Math.abs(tr - fr) < 4 && Math.abs(tg - fg) < 4 && Math.abs(tb - fb) < 4) return;
  const seen = new Uint8Array(W * H);
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    while (x >= 0 && !seen[y * W + x] && near((y * W + x) * 4)) x--;
    x++;
    let up = false, down = false;
    while (x < W && !seen[y * W + x] && near((y * W + x) * 4)) {
      const p = y * W + x;
      seen[p] = 1;
      d[p * 4] = fr; d[p * 4 + 1] = fg; d[p * 4 + 2] = fb; d[p * 4 + 3] = 255;
      if (y > 0) {
        const n = near(((y - 1) * W + x) * 4) && !seen[(y - 1) * W + x];
        if (n && !up) { stack.push(x, y - 1); up = true; } else if (!n) up = false;
      }
      if (y < H - 1) {
        const n = near(((y + 1) * W + x) * 4) && !seen[(y + 1) * W + x];
        if (n && !down) { stack.push(x, y + 1); down = true; } else if (!n) down = false;
      }
      x++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Holds the authoritative list of draw ops on the client and renders them to an attached canvas. */
export class Board {
  ops: DrawOp[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.redraw();
  }
  detach() {
    this.canvas = null;
    this.ctx = null;
  }

  redraw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (const op of this.ops) this.paint(op);
  }

  private dot(c: string, w: number, x: number, y: number) {
    const ctx = this.ctx!;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, w / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  private seg(c: string, w: number, x0: number, y0: number, x1: number, y1: number) {
    const ctx = this.ctx!;
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  private paint(op: DrawOp) {
    if (!this.ctx) return;
    if (op.k === 'f') return floodFill(this.ctx, op.x, op.y, op.c);
    this.dot(op.c, op.w, op.p[0], op.p[1]);
    for (let i = 2; i + 1 < op.p.length; i += 2) this.seg(op.c, op.w, op.p[i - 2], op.p[i - 1], op.p[i], op.p[i + 1]);
  }

  // ---- mutations (used for both local drawing and server relays)
  startStroke(c: string, w: number, x: number, y: number) {
    this.ops.push({ k: 's', c, w, p: [x, y] });
    if (this.ctx) this.dot(c, w, x, y);
  }
  addPoints(pts: number[]) {
    const op = this.ops[this.ops.length - 1];
    if (!op || op.k !== 's') return;
    let px = op.p[op.p.length - 2], py = op.p[op.p.length - 1];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      if (this.ctx) this.seg(op.c, op.w, px, py, pts[i], pts[i + 1]);
      px = pts[i]; py = pts[i + 1];
    }
    op.p.push(...pts);
  }
  fill(c: string, x: number, y: number) {
    const op: DrawOp = { k: 'f', c, x, y };
    this.ops.push(op);
    this.paint(op);
  }
  undo() {
    this.ops.pop();
    this.redraw();
  }
  clear() {
    this.ops = [];
    this.redraw();
  }
  setOps(ops: DrawOp[]) {
    this.ops = ops.map((o) => (o.k === 's' ? { ...o, p: [...o.p] } : { ...o }));
    this.redraw();
  }

  /** Apply a draw-related server message. Returns true if it was one. */
  apply(m: ServerMsg): boolean {
    switch (m.t) {
      case 'ds': this.startStroke(m.c, m.w, m.x, m.y); return true;
      case 'dp': this.addPoints(m.p); return true;
      case 'de': return true;
      case 'df': this.fill(m.c, m.x, m.y); return true;
      case 'undo': this.undo(); return true;
      case 'clear': this.clear(); return true;
      case 'canvas': this.setOps(m.ops); return true;
    }
    return false;
  }
}
