/**
 * Procedural placeholder art (Canvas 2D only).
 *
 * Painterly-vector look: bold dark outline, soft radial shading, inner
 * occlusion, rim light, expressive eyes. Everything is deterministic
 * (seeded PRNG, no Math.random) so the same spec always yields the same
 * image. Creatures are authored in a 512x512 design space and scaled.
 */

export type Archetype = 'fox' | 'otter' | 'owl' | 'bud' | 'larva' | 'mouse' | 'cat' | 'crab' | 'device' | 'dragon';

export interface ArtSpec {
  archetype: Archetype;
  primary: string;
  secondary: string;
  accent: string;
  ringCore?: 'small' | 'cracked';
}

export type BackdropTheme = 'forest' | 'ashstar' | 'shrine';

// ---------------------------------------------------------------------------
// basics
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
/** x, y, optional corner flag (1 = sharp corner in smooth paths). */
type Pt = [number, number, number?];
interface Shape {
  p: Path2D;
  b: [number, number, number, number];
}

const TAU = Math.PI * 2;
const U = 512;
const RING = '#3ee0c8';

let INK = '#1b1624';
let LW = 7;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return [c, ctx];
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// color
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

/** Lighten toward warm white. */
function lighten(c: string, t: number): string {
  return mix(c, '#fffaf0', t);
}

/** Darken toward a deep violet (reads more painterly than black). */
function shade(c: string, t: number): string {
  return mix(c, '#1d1533', t);
}

function rgba(c: string, a: number): string {
  const [r, g, b] = hexToRgb(c);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

function bboxOf(pts: Pt[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return [x0, y0, x1, y1];
}

/** Catmull-Rom spline through points, emitted as cubic beziers. */
function crInto(path: Path2D, pts: Pt[], closed: boolean, t = 1): void {
  const n = pts.length;
  if (n < 2) return;
  const get = (i: number): Pt => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const tan = (i: number): [number, number] => {
    const p = get(i);
    if (p[2]) return [0, 0];
    if (!closed && (i <= 0 || i >= n - 1)) {
      const a = get(i - 1);
      const b = get(i + 1);
      return [((b[0] - a[0]) * t) / 6, ((b[1] - a[1]) * t) / 6];
    }
    const a = get(i - 1);
    const b = get(i + 1);
    return [((b[0] - a[0]) * t) / 6, ((b[1] - a[1]) * t) / 6];
  };
  path.moveTo(pts[0][0], pts[0][1]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p1 = get(i);
    const p2 = get(i + 1);
    const t1 = tan(i);
    const t2 = tan(i + 1);
    path.bezierCurveTo(p1[0] + t1[0], p1[1] + t1[1], p2[0] - t2[0], p2[1] - t2[1], p2[0], p2[1]);
  }
  if (closed) path.closePath();
}

function blob(pts: Pt[], t = 1): Shape {
  const p = new Path2D();
  crInto(p, pts, true, t);
  return { p, b: bboxOf(pts) };
}

function curve(pts: Pt[], t = 1): Path2D {
  const p = new Path2D();
  crInto(p, pts, false, t);
  return p;
}

function poly(pts: Pt[]): Shape {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.closePath();
  return { p, b: bboxOf(pts) };
}

function ell(cx: number, cy: number, rx: number, ry: number, rot = 0): Shape {
  const p = new Path2D();
  p.ellipse(cx, cy, rx, ry, rot, 0, TAU);
  const m = rot === 0 ? 0 : 1;
  const ex = m ? Math.max(rx, ry) : rx;
  const ey = m ? Math.max(rx, ry) : ry;
  return { p, b: [cx - ex, cy - ey, cx + ex, cy + ey] };
}

function rrect(x: number, y: number, w: number, h: number, r: number): Shape {
  const p = new Path2D();
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x + rr, y);
  p.arcTo(x + w, y, x + w, y + h, rr);
  p.arcTo(x + w, y + h, x, y + h, rr);
  p.arcTo(x, y + h, x, y, rr);
  p.arcTo(x, y, x + w, y, rr);
  p.closePath();
  return { p, b: [x, y, x + w, y + h] };
}

function star4(x: number, y: number, r: number, thin = 0.3): Shape {
  const pts: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * thin;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr, i % 2 === 0 ? 1 : 0]);
  }
  return blob(pts, 0.6);
}

/** Tapered stroke along a polyline -> closed shape. */
function taper(pts: Pt[], w0: number, w1: number): Shape {
  const n = pts.length;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  return blob([...left, ...right.reverse()], 0.8);
}

function scalePts(pts: Pt[], cx: number, cy: number, k: number, dx = 0, dy = 0): Pt[] {
  return pts.map((p) => [cx + (p[0] - cx) * k + dx, cy + (p[1] - cy) * k + dy, p[2]] as Pt);
}

// ---------------------------------------------------------------------------
// painting primitives
// ---------------------------------------------------------------------------

function scaleOf(ctx: Ctx): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) || 1;
}

/**
 * Soft inner shadow/light: the outside of the shape casts a blurred shadow
 * into the inside, offset by (dx, dy) in user units.
 */
function innerShadow(ctx: Ctx, path: Path2D, color: string, dx: number, dy: number, blur: number): void {
  const m = ctx.getTransform();
  const sc = Math.hypot(m.a, m.b) || 1;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.clip(path);
  const dev = new Path2D();
  dev.rect(-W, -H, W * 3, H * 3);
  dev.addPath(path, m);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const F = W * 4 + 2000;
  ctx.translate(-F, 0);
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(0, blur * sc);
  ctx.shadowOffsetX = F + dx * sc;
  ctx.shadowOffsetY = dy * sc;
  ctx.fillStyle = '#000';
  ctx.fill(dev, 'evenodd');
  ctx.restore();
}

interface PaintOpt {
  ink?: string | null;
  lw?: number;
  rim?: string | null;
  flat?: boolean;
  lx?: number;
  ly?: number;
  occl?: number;
  hl?: number;
}

function paint(ctx: Ctx, s: Shape, base: string, o: PaintOpt = {}): void {
  const [x0, y0, x1, y1] = s.b;
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const m = Math.max(w, h);
  if (o.flat) {
    ctx.fillStyle = base;
    ctx.fill(s.p);
  } else {
    const lx = x0 + w * (o.lx ?? 0.34);
    const ly = y0 + h * (o.ly ?? 0.26);
    const g = ctx.createRadialGradient(lx, ly, m * 0.02, lx, ly, m * 1.05);
    g.addColorStop(0, lighten(base, 0.3));
    g.addColorStop(0.42, base);
    g.addColorStop(1, shade(base, 0.42));
    ctx.fillStyle = g;
    ctx.fill(s.p);
    const oc = o.occl ?? 1;
    if (oc > 0) innerShadow(ctx, s.p, rgba(shade(base, 0.75), 0.55 * oc), -m * 0.045, -m * 0.07, m * 0.12);
    const hl = o.hl ?? 1;
    if (hl > 0) innerShadow(ctx, s.p, rgba('#ffffff', 0.3 * hl), m * 0.025, m * 0.035, m * 0.05);
    if (o.rim !== null && o.rim !== undefined) {
      innerShadow(ctx, s.p, rgba(o.rim, 0.75), -Math.max(2.5, m * 0.02), 0, 2);
    }
  }
  if (o.ink !== null) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = o.ink ?? INK;
    ctx.lineWidth = o.lw ?? LW;
    ctx.stroke(s.p);
    ctx.restore();
  }
}

function clipDo(ctx: Ctx, s: Shape | Path2D, fn: () => void): void {
  ctx.save();
  ctx.clip(s instanceof Path2D ? s : s.p);
  fn();
  ctx.restore();
}

function withGlow(ctx: Ctx, color: string, blur: number, fn: () => void): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * scaleOf(ctx);
  fn();
  ctx.restore();
}

function glowDot(ctx: Ctx, x: number, y: number, r: number, color: string, a = 1, additive = false): void {
  ctx.save();
  if (additive) ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.35, rgba(color, a * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function groundShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, a = 0.5): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(8,6,16,${a})`);
  g.addColorStop(0.55, `rgba(8,6,16,${a * 0.55})`);
  g.addColorStop(1, 'rgba(8,6,16,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Outlined tube along a path (tails, stalks, antennae, whip cables). */
function tube(ctx: Ctx, path: Path2D, color: string, width: number, hl = true): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = width + LW * 2;
  ctx.stroke(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke(path);
  if (hl && width > 5) {
    ctx.translate(-width * 0.12, -width * 0.18);
    ctx.strokeStyle = rgba(lighten(color, 0.55), 0.5);
    ctx.lineWidth = width * 0.28;
    ctx.stroke(path);
  }
  ctx.restore();
}

function line(ctx: Ctx, pts: Pt[], color: string, width: number, t = 1): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(curve(pts, t));
  ctx.restore();
}

function blush(ctx: Ctx, x: number, y: number, rx: number, color = '#ff6f8a', a = 0.45): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.6);
  glowDot(ctx, 0, 0, rx, color, a);
  ctx.restore();
}

interface EyeOpt {
  look?: number;
  slit?: boolean;
  white?: boolean;
  lid?: number;
  lidColor?: string;
  glow?: boolean;
  pupil?: number;
}

/** Expressive eye: dark rim, gradient iris, pupil and two catchlights. */
function eye(ctx: Ctx, x: number, y: number, rx: number, ry: number, iris: string, o: EyeOpt = {}): void {
  const look = o.look ?? -0.2;
  const outer = ell(x, y, rx, ry);
  if (o.glow) glowDot(ctx, x, y, Math.max(rx, ry) * 2.4, iris, 0.55, true);
  ctx.save();
  ctx.fillStyle = '#16111f';
  ctx.fill(outer.p);
  clipDo(ctx, outer, () => {
    let irx = rx * 0.82;
    let iry = ry * 0.84;
    const ix = x + look * rx;
    const iy = y + ry * 0.06;
    if (o.white) {
      ctx.fillStyle = '#f7f3ea';
      ctx.fill(outer.p);
      innerShadow(ctx, outer.p, 'rgba(60,40,80,0.45)', 0, ry * 0.25, ry * 0.3);
      irx = rx * 0.6;
      iry = ry * 0.66;
    }
    const g = ctx.createLinearGradient(0, iy - iry, 0, iy + iry);
    g.addColorStop(0, shade(iris, 0.55));
    g.addColorStop(0.55, iris);
    g.addColorStop(1, lighten(iris, 0.5));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(ix, iy, irx, iry, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0c0914';
    ctx.beginPath();
    const pk = o.pupil ?? 1;
    if (o.slit) ctx.ellipse(ix, iy, irx * 0.16 * pk, iry * 0.78, 0, 0, TAU);
    else ctx.ellipse(ix, iy, irx * 0.46 * pk, iry * 0.5 * pk, 0, 0, TAU);
    ctx.fill();
    // top-lid shadow
    innerShadow(ctx, outer.p, 'rgba(10,6,20,0.6)', 0, ry * 0.22, ry * 0.25);
    // catchlights
    const cr = Math.min(rx, ry);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.22 + look * rx * 0.5, y - ry * 0.36, cr * 0.34, cr * 0.3, -0.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(x + rx * 0.22 + look * rx * 0.4, y + ry * 0.32, cr * 0.14, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (o.lid !== undefined && o.lidColor) {
      const ly = y - ry + o.lid * ry * 2;
      const lidS = blob([
        [x - rx * 1.4, y - ry * 1.4],
        [x + rx * 1.4, y - ry * 1.4],
        [x + rx * 1.3, ly - ry * 0.18],
        [x, ly + ry * 0.1],
        [x - rx * 1.3, ly + ry * 0.12],
      ]);
      paint(ctx, lidS, o.lidColor, { ink: null, occl: 0, hl: 0 });
      ctx.strokeStyle = INK;
      ctx.lineWidth = LW * 1.1;
      ctx.stroke(curve([[x - rx * 1.3, ly + ry * 0.12], [x, ly + ry * 0.1], [x + rx * 1.3, ly - ry * 0.18]]));
    }
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW * 0.85;
  ctx.stroke(outer.p);
  ctx.restore();
}

/** Turquoise ring-shaped crystal core. */
function ringCore(ctx: Ctx, x: number, y: number, r: number, cracked: boolean, seed: number): void {
  const R = rng(seed);
  const inner = r * 0.52;
  const mid = (r + inner) / 2;
  const thick = r - inner;
  // aura
  glowDot(ctx, x, y, r * (cracked ? 2.2 : 2.3), RING, cracked ? 0.42 : 0.45, true);
  if (cracked) {
    for (let i = 0; i < 6; i++) {
      const a = R() * TAU;
      const d = r * (0.8 + R() * 0.5);
      glowDot(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.4 + R() * 0.6), i % 2 ? '#aefff2' : RING, 0.15 + R() * 0.35, true);
    }
  }
  ctx.save();
  // socket
  ctx.fillStyle = 'rgba(12,20,28,0.55)';
  ctx.beginPath();
  ctx.arc(x, y + r * 0.06, r * 1.13, 0, TAU);
  ctx.fill();
  // hole light
  const hg = ctx.createRadialGradient(x, y, 0, x, y, inner);
  hg.addColorStop(0, 'rgba(230,255,250,0.95)');
  hg.addColorStop(0.5, rgba(RING, 0.55));
  hg.addColorStop(1, rgba('#0d4a48', 0.9));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(x, y, inner, 0, TAU);
  ctx.fill();
  // torus body
  ctx.shadowColor = RING;
  ctx.shadowBlur = r * (cracked ? 0.9 : 0.7) * scaleOf(ctx);
  const tg = ctx.createRadialGradient(x, y, inner, x, y, r);
  tg.addColorStop(0, '#0f6f6a');
  tg.addColorStop(0.3, '#6ff5e0');
  tg.addColorStop(0.5, '#d6fff8');
  tg.addColorStop(0.7, RING);
  tg.addColorStop(1, '#0c5f5c');
  ctx.strokeStyle = tg;
  ctx.lineWidth = thick;
  ctx.beginPath();
  ctx.arc(x, y, mid, 0, TAU);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  // directional shading (lower-right darker)
  const dg = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  dg.addColorStop(0, 'rgba(255,255,255,0.25)');
  dg.addColorStop(0.5, 'rgba(255,255,255,0)');
  dg.addColorStop(1, 'rgba(0,40,50,0.45)');
  ctx.strokeStyle = dg;
  ctx.stroke();
  // facets
  ctx.strokeStyle = 'rgba(220,255,250,0.55)';
  ctx.lineWidth = Math.max(0.8, r * 0.04);
  const facets = cracked ? 10 : 6;
  for (let i = 0; i < facets; i++) {
    const a = (i / facets) * TAU + 0.3;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    ctx.lineTo(x + Math.cos(a + 0.18) * r, y + Math.sin(a + 0.18) * r);
    ctx.stroke();
  }
  // specular arc
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = thick * 0.22;
  ctx.beginPath();
  ctx.arc(x, y, mid + thick * 0.12, Math.PI * 1.08, Math.PI * 1.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - r * 0.62, y - r * 0.62, thick * 0.1, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (cracked) {
    const cracks = 5;
    for (let i = 0; i < cracks; i++) {
      const a0 = (i / cracks) * TAU + R() * 0.9;
      const pts: Pt[] = [];
      let rr = inner * 0.95;
      let a = a0;
      const end = r * (1.05 + R() * 0.55);
      while (rr < end) {
        pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
        rr += r * (0.12 + R() * 0.12);
        a += (R() - 0.5) * 0.35;
      }
      pts.push([x + Math.cos(a) * end, y + Math.sin(a) * end]);
      const cp = new Path2D();
      cp.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j < pts.length; j++) cp.lineTo(pts[j][0], pts[j][1]);
      ctx.save();
      ctx.shadowColor = '#9fffee';
      ctx.shadowBlur = r * 0.25 * scaleOf(ctx);
      ctx.strokeStyle = 'rgba(190,255,245,0.9)';
      ctx.lineWidth = r * 0.07;
      ctx.stroke(cp);
      ctx.restore();
      ctx.strokeStyle = '#08262a';
      ctx.lineWidth = r * 0.035;
      ctx.stroke(cp);
      // branch
      if (pts.length > 3) {
        const b0 = pts[2];
        const ba = a0 + (R() > 0.5 ? 0.6 : -0.6);
        ctx.beginPath();
        ctx.moveTo(b0[0], b0[1]);
        ctx.lineTo(b0[0] + Math.cos(ba) * r * 0.25, b0[1] + Math.sin(ba) * r * 0.25);
        ctx.stroke();
      }
    }
  }
  // outlines
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(LW * 0.55, r * 0.07);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = Math.max(LW * 0.4, r * 0.05);
  ctx.beginPath();
  ctx.arc(x, y, inner, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** Layered flame (outer accent, warm middle, white-yellow core). */
function flame(ctx: Ctx, x: number, y: number, h: number, color: string): void {
  const base: Pt[] = [
    [x - 0.34 * h, y + 0.02 * h],
    [x - 0.42 * h, y - 0.3 * h],
    [x - 0.3 * h, y - 0.66 * h, 1],
    [x - 0.14 * h, y - 0.5 * h],
    [x + 0.04 * h, y - 1.02 * h, 1],
    [x + 0.16 * h, y - 0.6 * h],
    [x + 0.36 * h, y - 0.74 * h, 1],
    [x + 0.4 * h, y - 0.3 * h],
    [x + 0.3 * h, y + 0.04 * h],
    [x, y + 0.16 * h],
  ];
  glowDot(ctx, x, y - h * 0.4, h * 1.3, color, 0.55, true);
  const outer = blob(base, 0.9);
  withGlow(ctx, color, h * 0.35, () => {
    ctx.fillStyle = color;
    ctx.fill(outer.p);
  });
  paint(ctx, outer, color, { occl: 0.4, hl: 0.6 });
  const midS = blob(scalePts(base, x, y + 0.1 * h, 0.68), 0.9);
  paint(ctx, midS, mix(color, '#ffe27a', 0.6), { ink: null, occl: 0, hl: 0.4 });
  const core = blob(scalePts(base, x, y + 0.12 * h, 0.4), 0.9);
  paint(ctx, core, '#fffbe6', { ink: null, occl: 0, hl: 0 });
}

function sparkle(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  glowDot(ctx, x, y, r * 2.6, color, 0.6, true);
  const s = star4(x, y, r, 0.26);
  withGlow(ctx, color, r * 0.8, () => {
    ctx.fillStyle = lighten(color, 0.55);
    ctx.fill(s.p);
  });
  ctx.fillStyle = '#ffffff';
  ctx.fill(star4(x, y, r * 0.5, 0.3).p);
}

function smallMouth(ctx: Ctx, pts: Pt[], w = LW * 0.8): void {
  line(ctx, pts, INK, w);
}

function nose(ctx: Ctx, x: number, y: number, rx: number, ry: number, color = '#241a2c'): void {
  const n = blob([
    [x - rx, y - ry * 0.6],
    [x + rx * 0.6, y - ry * 0.8],
    [x + rx * 0.8, y + ry * 0.2],
    [x, y + ry],
    [x - rx * 0.9, y + ry * 0.3],
  ]);
  paint(ctx, n, color, { lw: LW * 0.6, occl: 0.4 });
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.3, y - ry * 0.35, rx * 0.3, ry * 0.2, -0.3, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// creatures (512 design space, facing LEFT, ground at y ~ 446)
// ---------------------------------------------------------------------------

type Drawer = (ctx: Ctx, s: ArtSpec, R: () => number) => void;

function coreIf(ctx: Ctx, s: ArtSpec, x: number, y: number, fallback: 'small' | 'cracked' | null, seed: number): void {
  const kind = s.ringCore ?? fallback;
  if (!kind) return;
  if (kind === 'small') ringCore(ctx, x, y, 15, false, seed);
  else ringCore(ctx, x, y, 46, true, seed);
}

const drawFox: Drawer = (ctx, s) => {
  const P = s.primary;
  const A = s.accent;
  const cream = mix(P, '#fff4e2', 0.8);
  const sock = shade(P, 0.62);
  groundShadow(ctx, 272, 446, 165, 22);
  // tail
  const tail = blob([
    [318, 420], [382, 420], [440, 392], [472, 340], [476, 286], [460, 244], [434, 228],
    [402, 244], [396, 290], [382, 332], [352, 358], [322, 368],
  ]);
  paint(ctx, tail, P, { rim: A });
  clipDo(ctx, tail, () => {
    const g = ctx.createLinearGradient(430, 330, 430, 226);
    g.addColorStop(0, rgba(A, 0));
    g.addColorStop(1, rgba(mix(A, '#fff2c0', 0.3), 0.85));
    ctx.fillStyle = g;
    ctx.fillRect(380, 220, 100, 120);
  });
  flame(ctx, 434, 240, 96, A);
  // far hind foot
  paint(ctx, ell(300, 438, 34, 13), sock, { occl: 0.5 });
  // body
  const body = blob([
    [222, 300], [288, 284], [346, 308], [378, 360], [372, 414], [330, 442], [258, 444], [218, 420], [204, 368],
  ]);
  paint(ctx, body, P, { rim: A });
  // haunch
  const haunch = blob([[300, 372], [340, 344], [382, 360], [390, 408], [362, 440], [316, 440], [298, 410]]);
  paint(ctx, haunch, P, { rim: A, occl: 0.8 });
  paint(ctx, ell(348, 440, 28, 11), shade(P, 0.4), { occl: 0.5 });
  // front legs (short and chubby, dark paws)
  for (const [lx, sh] of [[248, 0.2], [210, 0]] as [number, number][]) {
    const leg = blob([[lx + 2, 372], [lx + 34, 372], [lx + 36, 420], [lx + 40, 444], [lx + 18, 448], [lx - 4, 444], [lx, 420]]);
    paint(ctx, leg, shade(P, sh), { occl: 0.6 });
    clipDo(ctx, leg, () => {
      ctx.fillStyle = shade(sock, sh * 0.5);
      ctx.beginPath();
      ctx.ellipse(lx + 18, 452, 30, 26, 0, 0, TAU);
      ctx.fill();
      innerShadow(ctx, leg.p, 'rgba(255,255,255,0.22)', 3, 3, 4);
    });
    ctx.strokeStyle = INK;
    ctx.lineWidth = LW;
    ctx.stroke(leg.p);
    line(ctx, [[lx + 12, 440], [lx + 12, 447]], INK, 3);
    line(ctx, [[lx + 24, 440], [lx + 24, 447]], INK, 3);
  }
  // chest fluff (over the tops of the legs)
  const chest = blob([[206, 298], [252, 304], [272, 350], [258, 392], [238, 404, 1], [226, 390], [214, 402, 1], [202, 364]]);
  paint(ctx, chest, cream, { occl: 0.6 });
  // pouch
  line(ctx, [[258, 308], [300, 350], [330, 380]], INK, 9);
  line(ctx, [[258, 308], [300, 350], [330, 380]], '#7a4c30', 5);
  const pouch = blob([[312, 382], [352, 376], [360, 410], [340, 428], [314, 424], [306, 402]]);
  paint(ctx, pouch, '#a06c44', { occl: 0.8 });
  paint(ctx, blob([[308, 384], [356, 378], [352, 398], [334, 404], [310, 398]]), '#8a5a38', { lw: LW * 0.7, occl: 0.4 });
  paint(ctx, ell(334, 400, 5, 5), A, { lw: LW * 0.5, occl: 0 });
  // scarf tails
  const sc = s.secondary;
  const tail1 = blob([[268, 296], [310, 304], [352, 330], [344, 350], [320, 336], [282, 322]]);
  paint(ctx, tail1, shade(sc, 0.15), { occl: 0.6 });
  const tail2 = blob([[270, 300], [306, 322], [330, 366], [312, 372], [292, 340], [266, 318]]);
  paint(ctx, tail2, sc, { occl: 0.6 });
  // scarf band
  const band = blob([[150, 282], [200, 296], [250, 296], [288, 282], [294, 310], [250, 326], [196, 326], [150, 310]]);
  paint(ctx, band, sc, { occl: 0.7 });
  clipDo(ctx, band, () => {
    ctx.strokeStyle = rgba(lighten(sc, 0.6), 0.6);
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(160 + i * 24, 296);
      ctx.lineTo(172 + i * 24, 326);
      ctx.stroke();
    }
  });
  // ears (behind head)
  const earF = blob([[128, 186], [126, 120], [140, 72, 1], [176, 116], [192, 160]]);
  paint(ctx, earF, shade(P, 0.15));
  paint(ctx, blob([[142, 156], [140, 118], [146, 96, 1], [168, 124], [174, 156]]), mix(P, '#3a2233', 0.6), { ink: null, occl: 0.5 });
  const earN = blob([[214, 156], [236, 106], [274, 64, 1], [290, 122], [282, 186]]);
  paint(ctx, earN, P, { rim: A });
  paint(ctx, blob([[234, 150], [248, 112], [272, 88, 1], [278, 132], [270, 168]]), mix(P, '#3a2233', 0.55), { ink: null, occl: 0.5 });
  clipDo(ctx, earN, () => {
    ctx.fillStyle = shade(P, 0.55);
    ctx.beginPath();
    ctx.ellipse(275, 64, 18, 26, 0, 0, TAU);
    ctx.fill();
  });
  // head
  const head = blob([
    [120, 206], [146, 158], [204, 138], [264, 150], [302, 194], [304, 244], [280, 284], [238, 302],
    [206, 300], [184, 292], [160, 302, 1], [150, 284], [128, 290, 1], [124, 266], [112, 240],
  ]);
  paint(ctx, head, P, { rim: A });
  // cheek + muzzle
  clipDo(ctx, head, () => {
    paint(ctx, blob([[110, 250], [150, 244], [206, 262], [214, 300], [150, 312], [108, 290]]), cream, { ink: null, occl: 0.5 });
  });
  const muzzle = blob([[88, 250], [104, 230], [144, 232], [172, 254], [160, 282], [122, 288], [96, 274]]);
  paint(ctx, muzzle, cream, { occl: 0.6 });
  nose(ctx, 94, 248, 13, 10);
  smallMouth(ctx, [[104, 270], [118, 278], [132, 272]]);
  // eyes
  eye(ctx, 198, 218, 23, 29, '#6a3b1e', { look: -0.22 });
  eye(ctx, 142, 214, 15, 26, '#6a3b1e', { look: -0.28 });
  blush(ctx, 232, 258, 22);
  // brows marks
  line(ctx, [[186, 180], [206, 176]], shade(P, 0.5), 5);
  coreIf(ctx, s, 176, 168, 'small', 11);
};

const drawOtter: Drawer = (ctx, s) => {
  const P = s.primary;
  const S = s.secondary;
  const A = s.accent;
  groundShadow(ctx, 262, 448, 170, 22);
  // orbit (back half)
  ctx.save();
  ctx.strokeStyle = rgba(A, 0.35);
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 12]);
  ctx.beginPath();
  ctx.ellipse(250, 300, 190, 58, -0.22, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();
  // tail
  const tail = blob([[300, 426], [366, 414], [432, 420], [478, 438, 1], [440, 452], [360, 454], [300, 450]]);
  paint(ctx, tail, shade(P, 0.12), { rim: A });
  // body
  const body = blob([
    [206, 250], [262, 226], [314, 250], [338, 320], [344, 392], [322, 440], [252, 452], [196, 442], [174, 392], [178, 318],
  ]);
  paint(ctx, body, P, { rim: A });
  const belly = blob([[196, 292], [240, 276], [276, 308], [288, 380], [268, 436], [214, 442], [190, 402], [186, 334]]);
  paint(ctx, belly, S, { occl: 0.7, ink: null });
  // feet
  paint(ctx, ell(214, 446, 30, 12), shade(P, 0.35), { occl: 0.4 });
  paint(ctx, ell(292, 448, 32, 12), shade(P, 0.25), { occl: 0.4 });
  // strap
  const strap = curve([[206, 262], [260, 320], [318, 372]]);
  tube(ctx, strap, '#8a5a3a', 9, false);
  // shell bag
  const shellCol = mix(S, '#ff9f80', 0.4);
  const cx = 330;
  const cy = 412;
  const pts: Pt[] = [[cx - 8, cy + 2]];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * (1.08 + (0.84 * i) / n);
    const rr = 54;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1]);
    if (i < n) {
      const am = Math.PI * (1.08 + (0.84 * (i + 0.5)) / n);
      pts.push([cx + Math.cos(am) * (rr + 7), cy + Math.sin(am) * (rr + 7)]);
    }
  }
  pts.push([cx + 8, cy + 2]);
  const shell = blob(pts, 0.8);
  paint(ctx, shell, shellCol, { occl: 0.7 });
  clipDo(ctx, shell, () => {
    ctx.strokeStyle = rgba(shade(shellCol, 0.5), 0.7);
    ctx.lineWidth = 3;
    for (let i = 1; i < n; i++) {
      const a = Math.PI * (1.08 + (0.84 * i) / n);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70);
      ctx.stroke();
    }
  });
  paint(ctx, rrect(cx - 16, cy - 6, 32, 14, 6), shade(shellCol, 0.3), { lw: LW * 0.7, occl: 0.4 });
  // paws (clasped low on the belly)
  paint(ctx, ell(206, 356, 20, 15, -0.5), P, { occl: 0.5 });
  paint(ctx, ell(240, 362, 20, 15, 0.4), shade(P, 0.08), { occl: 0.5 });
  coreIf(ctx, s, 252, 294, 'small', 21);
  // ears (small, low on the sides of a flat head)
  paint(ctx, ell(176, 144, 14, 12), shade(P, 0.2));
  paint(ctx, ell(288, 150, 15, 13), P);
  paint(ctx, ell(288, 152, 7, 6), shade(P, 0.5), { ink: null, occl: 0 });
  // head
  const head = blob([
    [120, 196], [144, 152], [210, 128], [278, 140], [308, 184], [298, 232], [252, 260], [190, 264], [140, 246],
  ]);
  paint(ctx, head, P, { rim: A });
  const muzzle = blob([[102, 206], [124, 180], [172, 182], [196, 210], [182, 242], [138, 248], [108, 232]]);
  paint(ctx, muzzle, S, { occl: 0.6 });
  nose(ctx, 108, 196, 17, 12);
  smallMouth(ctx, [[112, 222], [124, 230], [136, 224], [148, 230], [158, 222]], LW * 0.7);
  ctx.fillStyle = rgba(shade(S, 0.6), 0.8);
  for (const [dx, dy] of [[138, 206], [150, 214], [134, 216], [158, 204]]) {
    ctx.beginPath();
    ctx.arc(dx, dy, 2.6, 0, TAU);
    ctx.fill();
  }
  for (const w of [[[118, 212], [70, 200]], [[120, 220], [66, 224]], [[124, 228], [76, 246]]] as Pt[][]) {
    line(ctx, w, rgba(INK, 0.8), 2.5);
  }
  eye(ctx, 222, 176, 20, 25, '#2a4f66', { look: -0.22 });
  eye(ctx, 164, 172, 13, 22, '#2a4f66', { look: -0.28 });
  blush(ctx, 246, 214, 20);
  // droplets
  const drop = (x: number, y: number, r: number) => {
    const d = blob([[x, y - r * 1.9, 1], [x + r, y - r * 0.2], [x + r * 0.7, y + r * 0.75], [x, y + r], [x - r * 0.7, y + r * 0.75], [x - r, y - r * 0.2]]);
    glowDot(ctx, x, y, r * 3, A, 0.5, true);
    paint(ctx, d, A, { lw: LW * 0.7, occl: 0.5 });
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.2, r * 0.22, r * 0.34, 0.3, 0, TAU);
    ctx.fill();
  };
  drop(70, 330, 17);
  drop(418, 208, 15);
  drop(420, 318, 12);
  ctx.save();
  ctx.strokeStyle = rgba(A, 0.45);
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 12]);
  ctx.beginPath();
  ctx.ellipse(250, 300, 190, 58, -0.22, Math.PI * 0.05, Math.PI * 0.95);
  ctx.stroke();
  ctx.restore();
};

const drawOwl: Drawer = (ctx, s, R) => {
  const P = s.primary;
  const S = s.secondary;
  const A = s.accent;
  const amber = '#e6a93c';
  groundShadow(ctx, 262, 450, 150, 22);
  // tufts
  paint(ctx, blob([[152, 214], [140, 138, 1], [212, 178]]), shade(P, 0.2));
  paint(ctx, blob([[282, 176], [330, 104, 1], [350, 196]]), P, { rim: A });
  // feet (behind body bottom)
  for (const fx of [222, 286]) {
    for (const d of [-14, 0, 14]) paint(ctx, ell(fx + d, 440, 9, 12), amber, { lw: LW * 0.7, occl: 0.5 });
  }
  // body
  const body = blob([
    [146, 300], [162, 216], [214, 166], [282, 158], [348, 192], [388, 262], [392, 344], [366, 408], [310, 440], [228, 442], [170, 410], [146, 356],
  ]);
  paint(ctx, body, P, { rim: A, lx: 0.3, ly: 0.22 });
  clipDo(ctx, body, () => {
    // speckles
    for (let i = 0; i < 70; i++) {
      const x = 150 + R() * 240;
      const y = 160 + R() * 280;
      ctx.fillStyle = R() > 0.5 ? rgba(shade(P, 0.6), 0.35) : rgba(lighten(P, 0.6), 0.35);
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + R() * 3, 0, TAU);
      ctx.fill();
    }
    // moss
    const moss = (cx: number, cy: number, rx: number, ry: number, n: number) => {
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const k = 0.75 + R() * 0.35;
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
      }
      const m = blob(pts);
      paint(ctx, m, S, { ink: rgba(shade(S, 0.6), 0.9), lw: LW * 0.5, occl: 0.6 });
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = rgba(lighten(S, 0.5), 0.6);
        ctx.beginPath();
        ctx.arc(cx + (R() - 0.5) * rx * 1.4, cy + (R() - 0.5) * ry * 1.2, 2 + R() * 2.5, 0, TAU);
        ctx.fill();
      }
    };
    moss(262, 160, 80, 28, 11);
    moss(376, 372, 30, 46, 9);
    moss(176, 420, 36, 24, 8);
    // facial disc
    const disc = lighten(P, 0.32);
    paint(ctx, ell(232, 272, 58, 60), disc, { ink: rgba(INK, 0.45), lw: LW * 0.5, occl: 0.5 });
    paint(ctx, ell(156, 274, 44, 56), shade(disc, 0.05), { ink: rgba(INK, 0.45), lw: LW * 0.5, occl: 0.5 });
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(body.p);
  // wing
  const wing = blob([[300, 254], [352, 250], [388, 300], [390, 370], [360, 420], [330, 398], [306, 340]]);
  paint(ctx, wing, shade(P, 0.12), { rim: A });
  clipDo(ctx, wing, () => {
    ctx.strokeStyle = rgba(shade(P, 0.5), 0.5);
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(318 + i * 16, 300 + i * 26);
      ctx.quadraticCurveTo(360 + i * 6, 320 + i * 26, 390, 300 + i * 34);
      ctx.stroke();
    }
  });
  // runes
  withGlow(ctx, A, 14, () => {
    ctx.strokeStyle = lighten(A, 0.35);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(344, 300, 13, 0, TAU);
    ctx.moveTo(344, 280);
    ctx.lineTo(344, 320);
    ctx.moveTo(330, 344);
    ctx.lineTo(356, 344);
    ctx.lineTo(344, 362);
    ctx.lineTo(362, 380);
    ctx.moveTo(326, 364);
    ctx.lineTo(334, 390);
    ctx.stroke();
  });
  // eyes
  eye(ctx, 234, 274, 34, 36, amber, { look: -0.2, pupil: 1.35 });
  eye(ctx, 158, 276, 23, 32, amber, { look: -0.28, pupil: 1.35 });
  // beak
  const beak = blob([[180, 300], [206, 302], [190, 336, 1]]);
  paint(ctx, beak, amber, { lw: LW * 0.8, occl: 0.5 });
  // brow lines
  line(ctx, [[196, 228], [236, 222], [268, 236]], rgba(shade(P, 0.6), 0.8), 5);
  // sprout
  line(ctx, [[258, 164], [254, 140], [262, 116]], INK, 11);
  line(ctx, [[258, 164], [254, 140], [262, 116]], '#5aa84a', 5);
  paint(ctx, blob([[260, 122], [236, 100], [212, 104, 1], [230, 124]]), '#79c95a', { lw: LW * 0.7, occl: 0.4 });
  paint(ctx, blob([[262, 118], [282, 94], [308, 96, 1], [290, 118]]), '#8fdc66', { lw: LW * 0.7, occl: 0.4 });
  coreIf(ctx, s, 318, 218, 'small', 31);
};

const drawBud: Drawer = (ctx, s) => {
  const P = s.primary;
  const S = s.secondary;
  const A = s.accent;
  const leafC = '#6fc46a';
  groundShadow(ctx, 256, 448, 160, 22);
  // leaf arms
  paint(ctx, blob([[150, 360], [110, 334], [70, 346, 1], [96, 378], [140, 386]]), leafC, { occl: 0.6 });
  line(ctx, [[140, 368], [104, 356], [80, 352]], rgba(shade(leafC, 0.5), 0.8), 3);
  paint(ctx, blob([[362, 344], [410, 318], [452, 326, 1], [428, 362], [372, 374]]), shade(leafC, 0.1), { occl: 0.6 });
  line(ctx, [[372, 356], [416, 338], [440, 332]], rgba(shade(leafC, 0.5), 0.8), 3);
  // body
  const body = blob([
    [118, 372], [132, 296], [186, 244], [258, 230], [330, 244], [384, 298], [396, 372], [370, 424], [300, 446], [208, 446], [146, 426],
  ]);
  paint(ctx, body, P, { rim: '#ffffff', lx: 0.32, ly: 0.2 });
  // mochi sheen
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(196, 280, 36, 16, -0.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.ellipse(176, 294, 9, 6, -0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
  // sepals
  paint(ctx, blob([[266, 246], [220, 232], [196, 212, 1], [240, 214]]), leafC, { occl: 0.5 });
  paint(ctx, blob([[268, 246], [314, 230], [340, 208, 1], [296, 212]]), shade(leafC, 0.1), { occl: 0.5 });
  // flower
  const fx = 268;
  const fy = 186;
  const angs = [-90, -18, 54, 126, 198];
  const order = [2, 3, 1, 4, 0];
  for (const k of order) {
    const a = (angs[k] * Math.PI) / 180;
    const len = 58;
    const tx = fx + Math.cos(a) * len;
    const ty = fy + Math.sin(a) * len * 0.72;
    const nx = -Math.sin(a) * 26;
    const ny = Math.cos(a) * 26 * 0.72;
    const petal = blob([
      [fx, fy],
      [fx + Math.cos(a) * len * 0.5 + nx, fy + Math.sin(a) * len * 0.36 + ny],
      [tx + nx * 0.4, ty + ny * 0.4],
      [tx + Math.cos(a) * 6, ty + Math.sin(a) * 4, 1],
      [tx - nx * 0.4, ty - ny * 0.4],
      [fx + Math.cos(a) * len * 0.5 - nx, fy + Math.sin(a) * len * 0.36 - ny],
    ]);
    paint(ctx, petal, k === 2 || k === 3 ? shade(S, 0.1) : S, { occl: 0.7 });
    line(ctx, [[fx + Math.cos(a) * 12, fy + Math.sin(a) * 9], [tx - Math.cos(a) * 16, ty - Math.sin(a) * 12]], rgba(lighten(S, 0.6), 0.7), 3);
  }
  glowDot(ctx, fx, fy, 40, A, 0.6, true);
  paint(ctx, ell(fx, fy, 22, 17), mix(A, '#ffc93c', 0.5), { lw: LW * 0.8, occl: 0.5 });
  ctx.fillStyle = rgba(shade(mix(A, '#ffb020', 0.7), 0.3), 0.8);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    ctx.beginPath();
    ctx.arc(fx + Math.cos(a) * 10, fy + Math.sin(a) * 7, 2.5, 0, TAU);
    ctx.fill();
  }
  // face
  eye(ctx, 208, 334, 19, 24, '#4a2a3a', { look: -0.2 });
  eye(ctx, 150, 332, 13, 21, '#4a2a3a', { look: -0.26 });
  blush(ctx, 242, 372, 26, '#ff5d8f', 0.5);
  blush(ctx, 128, 370, 16, '#ff5d8f', 0.45);
  const mouth = blob([[160, 366], [192, 366], [184, 384], [168, 386]]);
  paint(ctx, mouth, '#8a2f4a', { lw: LW * 0.7, occl: 0.3 });
  clipDo(ctx, mouth, () => {
    ctx.fillStyle = '#ff8fae';
    ctx.beginPath();
    ctx.ellipse(176, 388, 10, 7, 0, 0, TAU);
    ctx.fill();
  });
  // pollen
  sparkle(ctx, 176, 170, 14, A);
  sparkle(ctx, 368, 150, 11, A);
  sparkle(ctx, 404, 236, 8, A);
  sparkle(ctx, 126, 232, 7, A);
  coreIf(ctx, s, 318, 300, null, 41);
};

const drawLarva: Drawer = (ctx, s) => {
  const P = s.primary;
  const S = s.secondary;
  const A = s.accent;
  groundShadow(ctx, 276, 446, 190, 22);
  // legs
  for (const [x, y] of [[418, 432], [364, 438], [310, 440], [254, 438], [206, 432]] as [number, number][]) {
    paint(ctx, ell(x, y, 12, 14), S, { lw: LW * 0.7, occl: 0.3 });
  }
  const segs: [number, number, number, number][] = [
    [438, 398, 46, 42],
    [374, 382, 60, 58],
    [300, 366, 72, 70],
  ];
  for (const [x, y, rx, ry] of segs) {
    const seg = ell(x, y, rx, ry);
    paint(ctx, seg, P, { rim: A });
    clipDo(ctx, seg, () => {
      paint(ctx, ell(x + rx * 0.95, y, rx * 0.55, ry * 1.2), S, { ink: null, occl: 0.4 });
      ctx.fillStyle = rgba(shade(S, 0.2), 0.9);
      ctx.beginPath();
      ctx.ellipse(x - rx * 0.1, y - ry * 0.55, rx * 0.16, ry * 0.12, 0, 0, TAU);
      ctx.fill();
    });
    ctx.strokeStyle = INK;
    ctx.lineWidth = LW;
    ctx.stroke(seg.p);
  }
  // antennae (behind head)
  const ant1: Pt[] = [[168, 262], [144, 206], [104, 170]];
  const ant2: Pt[] = [[214, 258], [220, 196], [196, 150]];
  tube(ctx, curve(ant2), S, 7, false);
  tube(ctx, curve(ant1), S, 7, false);
  sparkle(ctx, 196, 146, 16, A);
  sparkle(ctx, 100, 166, 18, A);
  // head
  const head = blob([[98, 326], [118, 270], [176, 244], [240, 256], [270, 310], [262, 372], [216, 404], [146, 402], [104, 372]]);
  paint(ctx, head, lighten(P, 0.08), { rim: A });
  clipDo(ctx, head, () => {
    paint(ctx, ell(230, 252, 60, 24, 0.2), S, { ink: null, occl: 0.3 });
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(head.p);
  // mandibles
  paint(ctx, blob([[108, 372], [86, 386], [80, 404, 1], [100, 398], [122, 384]]), S, { lw: LW * 0.7, occl: 0.3 });
  paint(ctx, blob([[132, 386], [120, 404], [124, 420, 1], [140, 406], [150, 392]]), S, { lw: LW * 0.7, occl: 0.3 });
  eye(ctx, 186, 320, 22, 27, '#3a2a18', { look: -0.22 });
  eye(ctx, 126, 318, 14, 23, '#3a2a18', { look: -0.28 });
  blush(ctx, 222, 360, 20, '#ff7a5a', 0.5);
  smallMouth(ctx, [[122, 364], [138, 372], [154, 366]]);
  coreIf(ctx, s, 300, 330, null, 51);
};

const drawMouse: Drawer = (ctx, s) => {
  const P = s.primary;
  const S = s.secondary;
  const A = s.accent;
  const pink = mix(S, '#d9788a', 0.3);
  groundShadow(ctx, 274, 448, 150, 20);
  // tail
  tube(ctx, curve([[340, 424], [408, 438], [462, 404], [464, 342], [486, 300]]), pink, 9);
  // far foot
  paint(ctx, ell(318, 446, 28, 11), pink, { occl: 0.4 });
  // body
  const body = blob([[212, 300], [270, 282], [332, 312], [368, 372], [358, 426], [300, 446], [228, 446], [196, 412], [190, 352]]);
  paint(ctx, body, P, { rim: '#ffffff' });
  paint(ctx, blob([[206, 330], [244, 320], [268, 370], [256, 428], [218, 432], [200, 390]]), lighten(P, 0.45), { ink: null, occl: 0.5 });
  paint(ctx, ell(232, 446, 28, 11), pink, { occl: 0.4 });
  // ears
  const earFar = ell(162, 150, 52, 54);
  paint(ctx, earFar, shade(P, 0.12));
  paint(ctx, ell(160, 154, 32, 36), shade(pink, 0.1), { ink: null, occl: 0.6 });
  const earNear = ell(290, 138, 64, 66);
  paint(ctx, earNear, P, { rim: '#ffffff' });
  paint(ctx, ell(292, 142, 42, 46), pink, { ink: null, occl: 0.6 });
  // head
  const head = blob([
    [86, 262, 1], [112, 226], [158, 192], [220, 176], [276, 196], [298, 242], [280, 290], [228, 314], [166, 308], [116, 290],
  ], 0.9);
  paint(ctx, head, P, { rim: '#ffffff' });
  clipDo(ctx, head, () => {
    paint(ctx, ell(140, 290, 60, 26, -0.15), lighten(P, 0.5), { ink: null, occl: 0.3 });
  });
  // teeth
  const teeth = rrect(104, 284, 20, 17, 4);
  paint(ctx, teeth, '#fffdf5', { lw: LW * 0.6, occl: 0.3 });
  line(ctx, [[114, 286], [114, 300]], INK, 2);
  smallMouth(ctx, [[98, 282], [112, 286], [128, 282]], LW * 0.7);
  nose(ctx, 88, 262, 11, 9, '#e0708a');
  for (const w of [[[110, 268], [44, 246]], [[112, 276], [40, 276]], [[116, 284], [50, 306]]] as Pt[][]) {
    line(ctx, w, rgba(INK, 0.85), 2.5);
  }
  eye(ctx, 192, 236, 20, 25, '#3a2230', { look: -0.22 });
  eye(ctx, 140, 232, 12, 21, '#3a2230', { look: -0.3 });
  blush(ctx, 226, 274, 20);
  // acorn
  const ax = 186;
  const ay = 372;
  glowDot(ctx, ax, ay, 50, '#fff0c0', 0.25);
  paint(ctx, blob([[ax - 26, ay - 10], [ax + 26, ay - 10], [ax + 28, ay + 22], [ax, ay + 44, 1], [ax - 28, ay + 22]]), A, { occl: 0.7 });
  const cap = blob([[ax - 34, ay - 6], [ax - 28, ay - 30], [ax, ay - 40], [ax + 28, ay - 30], [ax + 34, ay - 6], [ax, ay]]);
  paint(ctx, cap, shade(A, 0.45), { occl: 0.5 });
  clipDo(ctx, cap, () => {
    ctx.strokeStyle = rgba(lighten(A, 0.3), 0.5);
    ctx.lineWidth = 2.5;
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(ax + i * 12 - 20, ay - 44);
      ctx.lineTo(ax + i * 12 + 20, ay);
      ctx.moveTo(ax + i * 12 + 20, ay - 44);
      ctx.lineTo(ax + i * 12 - 20, ay);
      ctx.stroke();
    }
  });
  line(ctx, [[ax + 2, ay - 38], [ax + 8, ay - 52]], INK, 9);
  line(ctx, [[ax + 2, ay - 38], [ax + 8, ay - 52]], shade(A, 0.5), 4);
  // paws
  paint(ctx, ell(ax - 30, ay + 4, 15, 13), P, { occl: 0.4 });
  paint(ctx, ell(ax + 32, ay + 8, 15, 13), shade(P, 0.05), { occl: 0.4 });
  coreIf(ctx, s, 250, 340, null, 61);
};

function bolt(x: number, y: number, h: number, flip = 1): Shape {
  const w = h * 0.5 * flip;
  return poly([
    [x, y],
    [x + w * 0.9, y + h * 0.05],
    [x + w * 0.45, y + h * 0.38],
    [x + w * 0.85, y + h * 0.42],
    [x + w * 0.1, y + h],
    [x + w * 0.3, y + h * 0.55],
    [x - w * 0.05, y + h * 0.5],
  ]);
}

const drawCat: Drawer = (ctx, s) => {
  const P = s.primary;
  const S = s.secondary;
  const A = s.accent;
  const iris = '#7fdc5a';
  groundShadow(ctx, 280, 448, 160, 22);
  // tail
  const tailPath = curve([[350, 416], [410, 400], [436, 330], [420, 262], [436, 206]]);
  tube(ctx, tailPath, P, 26);
  ctx.save();
  ctx.setLineDash([12, 26]);
  ctx.lineDashOffset = 6;
  ctx.strokeStyle = S;
  ctx.lineWidth = 24;
  ctx.lineCap = 'butt';
  ctx.stroke(tailPath);
  ctx.restore();
  // zigzag tip
  const tip = poly(scalePts([
    [423, 214], [440, 172], [426, 172], [462, 104], [454, 150], [472, 150], [448, 196], [451, 214],
  ], 437, 214, 1.3));
  glowDot(ctx, 452, 150, 76, A, 0.55, true);
  withGlow(ctx, A, 18, () => {
    ctx.fillStyle = A;
    ctx.fill(tip.p);
  });
  paint(ctx, tip, lighten(A, 0.2), { occl: 0.3 });
  // far legs
  paint(ctx, rrect(250, 360, 28, 86, 13), shade(P, 0.18), { occl: 0.5 });
  // body
  const body = blob([[222, 312], [290, 290], [352, 318], [384, 378], [374, 430], [322, 448], [250, 448], [214, 420], [204, 364]]);
  paint(ctx, body, P, { rim: A });
  clipDo(ctx, body, () => {
    ctx.fillStyle = S;
    ctx.fill(bolt(312, 290, 70, 1).p);
    ctx.fill(bolt(348, 316, 60, 1).p);
    ctx.fill(bolt(372, 360, 50, 1).p);
    paint(ctx, blob([[204, 340], [240, 328], [262, 380], [244, 440], [210, 430]]), lighten(P, 0.5), { ink: null, occl: 0.5 });
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(body.p);
  // haunch
  const haunch = blob([[304, 380], [346, 352], [388, 378], [388, 426], [356, 448], [310, 444]]);
  paint(ctx, haunch, P, { rim: A, occl: 0.8 });
  clipDo(ctx, haunch, () => {
    ctx.fillStyle = S;
    ctx.fill(bolt(356, 350, 56, 1).p);
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(haunch.p);
  // near front leg
  paint(ctx, rrect(212, 360, 32, 88, 15), P, { occl: 0.5 });
  // ears
  const earF = blob([[130, 204], [132, 118, 1], [190, 168]]);
  paint(ctx, earF, shade(P, 0.15));
  paint(ctx, blob([[142, 190], [140, 140, 1], [174, 172]]), mix(P, '#ff8fa0', 0.55), { ink: null, occl: 0.5 });
  const earN = blob([[226, 164], [278, 92, 1], [296, 204]]);
  paint(ctx, earN, P, { rim: A });
  paint(ctx, blob([[244, 166], [274, 118, 1], [284, 194]]), mix(P, '#ff8fa0', 0.5), { ink: null, occl: 0.5 });
  // head
  const head = blob([[110, 250], [126, 196], [176, 162], [240, 158], [292, 186], [308, 238], [290, 282], [240, 306], [170, 306], [128, 288]]);
  paint(ctx, head, P, { rim: A });
  clipDo(ctx, head, () => {
    ctx.fillStyle = S;
    ctx.fill(bolt(198, 150, 50, 1).p);
    ctx.fill(bolt(232, 156, 44, 1).p);
    ctx.fill(bolt(262, 168, 40, 1).p);
    ctx.save();
    ctx.translate(304, 236);
    ctx.rotate(Math.PI / 2);
    ctx.fill(bolt(0, 0, 40, 1).p);
    ctx.restore();
    paint(ctx, blob([[100, 262], [146, 250], [186, 270], [192, 308], [120, 310]]), lighten(P, 0.55), { ink: null, occl: 0.4 });
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(head.p);
  // face
  eye(ctx, 198, 230, 23, 25, iris, { look: -0.24, slit: true, lid: 0.32, lidColor: P });
  eye(ctx, 142, 228, 15, 22, iris, { look: -0.3, slit: true, lid: 0.32, lidColor: shade(P, 0.05) });
  nose(ctx, 112, 254, 9, 7, '#e7708a');
  // smirk
  const mouth = curve([[120, 274], [136, 282], [152, 278], [172, 280], [192, 262]]);
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW * 0.8;
  ctx.stroke(mouth);
  ctx.restore();
  paint(ctx, poly([[160, 279], [170, 280], [165, 294]]), '#ffffff', { lw: LW * 0.4, occl: 0 });
  blush(ctx, 232, 270, 20, '#ff7a5a', 0.4);
  // whiskers with sparks
  const wh: [Pt, Pt][] = [
    [[118, 262], [52, 242]],
    [[120, 270], [46, 272]],
    [[124, 278], [58, 300]],
    [[288, 262], [336, 250]],
    [[288, 272], [340, 280]],
  ];
  for (const [a, b] of wh) line(ctx, [a, b], rgba(INK, 0.85), 3);
  sparkle(ctx, 50, 242, 8, A);
  sparkle(ctx, 42, 272, 10, A);
  sparkle(ctx, 56, 302, 7, A);
  sparkle(ctx, 344, 280, 7, A);
  coreIf(ctx, s, 216, 190, null, 71);
};

const drawCrab: Drawer = (ctx, s) => {
  const P = s.primary;
  const S = s.secondary;
  const A = s.accent;
  const legC = shade(P, 0.25);
  const clawC = mix(P, '#7ff0d0', 0.25);
  groundShadow(ctx, 270, 446, 190, 22);
  // legs
  const legs: Pt[][] = [
    [[350, 380], [412, 374], [444, 440]],
    [[330, 390], [380, 402], [396, 446]],
    [[196, 390], [150, 404], [132, 444]],
    [[220, 392], [196, 414], [192, 446]],
    [[370, 366], [440, 350], [480, 414]],
  ];
  for (const l of legs) {
    tube(ctx, curve(l, 0.5), legC, 14);
  }
  // small back claw
  tube(ctx, curve([[392, 340], [440, 318]]), clawC, 16);
  paint(ctx, blob([[430, 330], [450, 300], [476, 296, 1], [462, 314], [480, 322, 1], [456, 336]]), clawC, { occl: 0.5 });
  // eyestalks
  tube(ctx, curve([[208, 272], [196, 214], [188, 190]]), legC, 12);
  tube(ctx, curve([[262, 262], [264, 208], [270, 180]]), legC, 12);
  // big claw arm
  tube(ctx, curve([[166, 338], [126, 318], [130, 268]]), clawC, 26);
  // body
  const body = blob([
    [116, 360], [136, 300], [198, 262], [270, 250], [346, 262], [404, 304], [422, 360], [396, 398], [270, 414], [144, 400],
  ]);
  paint(ctx, body, P, { rim: A, ly: 0.18 });
  clipDo(ctx, body, () => {
    paint(ctx, ell(270, 430, 170, 60), S, { ink: rgba(INK, 0.5), lw: LW * 0.6, occl: 0.5 });
    ctx.fillStyle = rgba(lighten(P, 0.55), 0.45);
    for (const [x, y, r] of [[300, 292, 12], [340, 304, 8], [250, 284, 7], [370, 330, 9], [320, 322, 6]] as [number, number, number][]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = rgba(shade(P, 0.5), 0.55);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(150, 320);
    ctx.quadraticCurveTo(270, 280, 400, 320);
    ctx.stroke();
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(body.p);
  // face on shell front
  smallMouth(ctx, [[160, 352], [176, 362], [192, 354]]);
  blush(ctx, 212, 348, 20, '#ff6f8a', 0.45);
  // eyes on stalks
  const eyeBall = (x: number, y: number, r: number) => {
    paint(ctx, ell(x, y, r, r), '#f7f3ea', { occl: 0.5 });
    ctx.fillStyle = '#16111f';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y + r * 0.05, r * 0.52, r * 0.6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - r * 0.45, y - r * 0.22, r * 0.2, 0, TAU);
    ctx.fill();
  };
  eyeBall(186, 184, 20);
  eyeBall(272, 174, 22);
  // big raised pincer (local frame: +x points toward the open tips)
  ctx.save();
  ctx.translate(122, 206);
  ctx.rotate(-1.75);
  ctx.scale(1.15, 1.15);
  ctx.save();
  ctx.translate(24, -22);
  ctx.rotate(-0.42);
  const dactyl = blob([[-6, -12], [34, -30], [80, -26], [108, -4, 1], [76, -2], [36, 10], [-4, 14]]);
  paint(ctx, dactyl, shade(clawC, 0.12), { rim: A, lx: 0.5, ly: 0.8 });
  for (let i = 0; i < 3; i++) {
    paint(ctx, poly([[44 + i * 16, 2 - i * 2], [52 + i * 16, 0 - i * 2], [48 + i * 16, 10 - i * 2]]), '#fff6e6', { lw: 2, occl: 0 });
  }
  ctx.restore();
  const pollex = blob([[20, 0], [60, -4], [100, -12], [126, -22, 1], [114, 8], [72, 32], [24, 36]]);
  paint(ctx, pollex, clawC, { rim: A, lx: 0.5, ly: 0.8 });
  for (let i = 0; i < 3; i++) {
    paint(ctx, poly([[56 + i * 18, 2 - i * 3], [64 + i * 18, 0 - i * 3], [58 + i * 18, -8 - i * 3]]), '#fff6e6', { lw: 2, occl: 0 });
  }
  const palm = blob([[-56, -4], [-40, -38], [0, -46], [36, -32], [50, -2], [36, 30], [0, 42], [-40, 30]]);
  paint(ctx, palm, clawC, { rim: A, lx: 0.5, ly: 0.85 });
  clipDo(ctx, palm, () => {
    ctx.fillStyle = rgba(lighten(clawC, 0.6), 0.55);
    ctx.beginPath();
    ctx.ellipse(-4, 18, 30, 11, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(lighten(clawC, 0.7), 0.7);
    for (const [x, y] of [[-24, -12], [-6, -20], [12, -10], [-14, 4]] as [number, number][]) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, TAU);
      ctx.fill();
    }
  });
  ctx.restore();
  // bubbles
  const bub = (x: number, y: number, r: number) => {
    glowDot(ctx, x, y, r * 2.2, A, 0.4, true);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    g.addColorStop(0, rgba(A, 0.1));
    g.addColorStop(0.8, rgba(A, 0.35));
    g.addColorStop(1, rgba(lighten(A, 0.5), 0.9));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(shade(A, 0.5), 0.9);
    ctx.lineWidth = Math.max(2, LW * 0.4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.38, y - r * 0.4, r * 0.25, r * 0.16, -0.7, 0, TAU);
    ctx.fill();
  };
  bub(340, 186, 18);
  bub(378, 132, 12);
  bub(318, 118, 9);
  bub(400, 208, 7);
  coreIf(ctx, s, 312, 300, null, 81);
};

const drawDevice: Drawer = (ctx, s, R) => {
  const P = s.primary;
  const S = s.secondary;
  const A = s.accent;
  const dark = shade(P, 0.5);
  groundShadow(ctx, 262, 452, 170, 22);
  const leg = (hx: number, hy: number, fx: number, col: string) => {
    tube(ctx, curve([[hx, hy], [fx, 440]]), col, 18, false);
    paint(ctx, poly([[fx - 26, 450], [fx - 16, 428], [fx + 16, 428], [fx + 26, 450]]), shade(col, 0.1), { occl: 0.4 });
    paint(ctx, ell(hx, hy, 16, 16), shade(col, 0.1), { occl: 0.5 });
    ctx.fillStyle = S;
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, TAU);
    ctx.fill();
  };
  leg(290, 392, 300, shade(P, 0.4));
  // cables behind
  tube(ctx, curve([[326, 220], [392, 250], [400, 340], [352, 420]]), '#2a2830', 9);
  // body faces
  const front = poly([[182, 404], [284, 414], [278, 176], [206, 170]]);
  const side = poly([[284, 414], [346, 398], [324, 180], [278, 176]]);
  const cap = poly([[206, 170], [278, 176], [324, 180], [298, 138], [232, 134]]);
  paint(ctx, side, shade(P, 0.3), { lx: 0.2, occl: 0.5 });
  paint(ctx, front, P, { lx: 0.3, occl: 0.5, rim: A });
  paint(ctx, cap, lighten(P, 0.15), { occl: 0.4 });
  // hazard band
  const band = poly([[186, 346], [282, 354], [283, 386], [184, 378]]);
  const bandS = poly([[282, 354], [340, 342], [343, 372], [283, 386]]);
  for (const [b, col] of [[band, S], [bandS, shade(S, 0.3)]] as [Shape, string][]) {
    clipDo(ctx, b, () => {
      ctx.fillStyle = col;
      ctx.fill(b.p);
      ctx.fillStyle = '#231f26';
      for (let i = -6; i < 12; i++) {
        ctx.beginPath();
        ctx.moveTo(170 + i * 24, 390);
        ctx.lineTo(182 + i * 24, 390);
        ctx.lineTo(206 + i * 24, 336);
        ctx.lineTo(194 + i * 24, 336);
        ctx.closePath();
        ctx.fill();
      }
    });
    ctx.strokeStyle = INK;
    ctx.lineWidth = LW * 0.7;
    ctx.stroke(b.p);
  }
  // panel seams & rivets
  ctx.strokeStyle = rgba(shade(P, 0.7), 0.8);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(196, 250);
  ctx.lineTo(281, 256);
  ctx.moveTo(190, 330);
  ctx.lineTo(283, 338);
  ctx.moveTo(281, 256);
  ctx.lineTo(333, 250);
  ctx.moveTo(283, 338);
  ctx.lineTo(340, 328);
  ctx.stroke();
  const rivet = (x: number, y: number) => {
    ctx.fillStyle = shade(P, 0.6);
    ctx.beginPath();
    ctx.arc(x + 1, y + 1, 3.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = lighten(P, 0.5);
    ctx.beginPath();
    ctx.arc(x, y, 2.8, 0, TAU);
    ctx.fill();
  };
  for (let i = 0; i < 6; i++) {
    rivet(214 + i * 12, 184 + i * 0.8);
    rivet(200 + i * 14, 240 + i * 0.9);
    rivet(196 + i * 15, 320 + i * 0.9);
  }
  for (let i = 0; i < 9; i++) {
    rivet(210 - i * 2.6, 190 + i * 22);
    rivet(290 + i * 4.6 + (R() - 0.5), 186 + i * 22);
  }
  // visor (facing left)
  const visor = poly([[196, 200], [262, 204], [258, 226], [194, 224]]);
  paint(ctx, visor, '#18141c', { lw: LW * 0.8, occl: 0 });
  glowDot(ctx, 214, 212, 60, A, 0.6, true);
  withGlow(ctx, A, 16, () => {
    ctx.fillStyle = lighten(A, 0.25);
    ctx.beginPath();
    ctx.ellipse(212, 213, 14, 6, 0, 0, TAU);
    ctx.fill();
  });
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(208, 212, 5, 2.5, 0, 0, TAU);
  ctx.fill();
  // reactor
  const rx = 236;
  const ry = 292;
  paint(ctx, ell(rx, ry, 34, 34), dark, { occl: 0.3 });
  glowDot(ctx, rx, ry, 90, A, 0.55, true);
  const rg = ctx.createRadialGradient(rx - 6, ry - 6, 2, rx, ry, 26);
  rg.addColorStop(0, '#ffffff');
  rg.addColorStop(0.35, lighten(A, 0.4));
  rg.addColorStop(1, shade(A, 0.3));
  withGlow(ctx, A, 20, () => {
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(rx, ry, 25, 0, TAU);
    ctx.fill();
  });
  ctx.strokeStyle = '#1b1720';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(rx - 25, ry);
  ctx.lineTo(rx + 25, ry);
  ctx.moveTo(rx, ry - 25);
  ctx.lineTo(rx, ry + 25);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rx, ry, 14, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW * 0.8;
  ctx.beginPath();
  ctx.arc(rx, ry, 34, 0, TAU);
  ctx.stroke();
  // star emblem on side panel
  ctx.save();
  ctx.translate(306, 292);
  ctx.transform(1, -0.16, 0, 1, 0, 0);
  const st = star4(0, 0, 24, 0.24);
  paint(ctx, st, '#ece6d6', { lw: LW * 0.55, occl: 0.4, hl: 0 });
  ctx.restore();
  // antenna
  tube(ctx, curve([[262, 140], [262, 70]]), '#3a3740', 8, false);
  tube(ctx, curve([[240, 138], [236, 96]]), '#3a3740', 5, false);
  paint(ctx, ell(262, 110, 14, 6), dark, { lw: LW * 0.6, occl: 0.3 });
  glowDot(ctx, 262, 64, 44, A, 0.7, true);
  withGlow(ctx, A, 18, () => {
    ctx.fillStyle = A;
    ctx.beginPath();
    ctx.arc(262, 64, 11, 0, TAU);
    ctx.fill();
  });
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(259, 61, 4, 0, TAU);
  ctx.fill();
  glowDot(ctx, 236, 94, 16, A, 0.8, true);
  // front cable
  tube(ctx, curve([[190, 262], [150, 300], [150, 360], [178, 404]]), '#2a2830', 9);
  paint(ctx, rrect(182, 252, 16, 22, 4), S, { lw: LW * 0.6, occl: 0.3 });
  // front legs
  leg(206, 398, 176, P);
  leg(330, 392, 360, shade(P, 0.15));
  // vents on cap
  ctx.strokeStyle = shade(P, 0.6);
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(236 + i * 14, 150);
    ctx.lineTo(240 + i * 14, 166);
    ctx.stroke();
  }
  coreIf(ctx, s, 236, 292, null, 91);
};

const drawDragon: Drawer = (ctx, s, R) => {
  const P = s.primary;
  const S = s.secondary;
  const A = s.accent;
  const bark = '#7a5638';
  const belly = mix(S, '#d8c890', 0.5);
  const far = shade(P, 0.42);
  groundShadow(ctx, 290, 468, 235, 26, 0.6);
  const branch = (pts: Pt[], w: number, col: string) => {
    paint(ctx, taper(pts, w, Math.max(3, w * 0.28)), col, { lw: LW * 0.75, occl: 0.5, hl: 0.6, rim: A });
  };
  const leaf = (x: number, y: number, a: number, sz: number, col = S) => {
    const c = Math.cos(a);
    const sn = Math.sin(a);
    paint(ctx, blob([
      [x, y, 1],
      [x + c * sz * 0.5 - sn * sz * 0.28, y + sn * sz * 0.5 + c * sz * 0.28],
      [x + c * sz, y + sn * sz, 1],
      [x + c * sz * 0.5 + sn * sz * 0.28, y + sn * sz * 0.5 - c * sz * 0.28],
    ]), col, { lw: LW * 0.45, occl: 0.4, hl: 0.5 });
  };
  const bud = (x: number, y: number, r: number) => {
    glowDot(ctx, x, y, r * 3.2, A, 0.4, true);
    ctx.fillStyle = lighten(A, 0.55);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6, 0, TAU);
    ctx.fill();
  };
  // ---- far antler (behind the head)
  ctx.save();
  ctx.translate(256, 472);
  ctx.scale(0.92, 0.92);
  ctx.translate(-256, -472);
  const farBark = shade(bark, 0.4);
  const farLeaf = shade(S, 0.3);
  branch([[172, 96], [148, 56], [112, 30], [70, 20]], 20, farBark);
  branch([[148, 58], [142, 22], [150, -14]], 11, farBark);
  branch([[112, 32], [94, 0]], 9, farBark);
  branch([[82, 22], [48, 28]], 7, farBark);
  leaf(150, -14, -1.4, 26, farLeaf);
  leaf(150, -12, -2.3, 22, farLeaf);
  leaf(94, 0, -2.0, 24, farLeaf);
  leaf(48, 28, Math.PI + 0.3, 24, farLeaf);
  leaf(70, 20, -2.6, 20, farLeaf);
  // ---- tail curling to the front-right
  const tail = blob([
    [430, 350], [494, 360], [508, 420], [470, 462], [380, 476], [300, 474], [262, 466, 1], [310, 452], [392, 446], [444, 420], [454, 392], [428, 384],
  ]);
  paint(ctx, tail, shade(P, 0.12), { rim: A });
  clipDo(ctx, tail, () => {
    ctx.fillStyle = rgba(belly, 0.75);
    ctx.beginPath();
    ctx.ellipse(390, 484, 130, 26, 0, 0, TAU);
    ctx.fill();
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(tail.p);
  leaf(266, 466, Math.PI - 0.5, 22);
  leaf(268, 468, Math.PI + 0.2, 20, shade(S, 0.15));
  // ---- far legs
  paint(ctx, blob([[236, 360], [276, 356], [284, 420], [290, 462], [242, 464], [244, 420]]), far, { occl: 0.4, hl: 0.3 });
  paint(ctx, blob([[430, 370], [470, 360], [480, 420], [488, 460], [440, 462], [440, 420]]), far, { occl: 0.4, hl: 0.3 });
  // ---- dorsal bark spikes along neck and back
  const spikes: [number, number, number][] = [
    [236, 112, -0.2], [258, 140, 0.1], [272, 178, 0.35], [300, 212, -0.6], [340, 200, -0.8], [382, 198, -1.0], [424, 210, -1.3], [458, 236, -1.6],
  ];
  for (const [x, y, a] of spikes) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    paint(ctx, blob([[x - dy * 14 - dx * 4, y + dx * 14 - dy * 4], [x + dx * 30, y + dy * 30 - 6, 1], [x + dy * 14 - dx * 4, y - dx * 14 - dy * 4]], 0.6), bark, { lw: LW * 0.6, occl: 0.4, hl: 0.4 });
  }
  // ---- body
  const body = blob([
    [176, 322], [220, 258], [300, 220], [400, 218], [466, 262], [486, 326], [458, 378], [360, 398], [240, 398], [184, 376],
  ]);
  paint(ctx, body, P, { rim: A, lx: 0.3, ly: 0.15 });
  clipDo(ctx, body, () => {
    for (let i = 0; i < 80; i++) {
      const x = 180 + R() * 300;
      const y = 260 + R() * 170;
      ctx.strokeStyle = rgba(shade(P, 0.6), 0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 7 + R() * 5, 0.25, Math.PI - 0.25);
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      paint(ctx, ell(250 + i * 40, 396, 25, 12), belly, { ink: rgba(INK, 0.6), lw: 3, occl: 0.4 });
    }
    // moss mantle with a ragged hanging edge
    const edge: Pt[] = [[180, 250], [290, 190], [420, 186], [500, 250], [500, 300]];
    let x = 494;
    let up = true;
    while (x > 190) {
      edge.push([x, 292 - (494 - x) * 0.02 + (up ? 0 : 22 + R() * 16)]);
      x -= 16 + R() * 10;
      up = !up;
    }
    edge.push([196, 290]);
    const moss = blob(edge, 0.9);
    paint(ctx, moss, S, { ink: rgba(shade(S, 0.7), 0.9), lw: 3, occl: 0.6, hl: 0.6 });
    clipDo(ctx, moss, () => {
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = R() > 0.4 ? rgba(lighten(S, 0.45), 0.5) : rgba(shade(S, 0.45), 0.45);
        ctx.beginPath();
        ctx.arc(190 + R() * 310, 190 + R() * 130, 2 + R() * 5, 0, TAU);
        ctx.fill();
      }
    });
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(body.p);
  // hanging vines with glowing buds
  for (const [vx, vy, len] of [[284, 300, 46], [336, 306, 60], [404, 308, 40], [446, 300, 54]] as [number, number, number][]) {
    const v: Pt[] = [[vx, vy], [vx + 6, vy + len * 0.5], [vx - 2, vy + len]];
    line(ctx, v, INK, 7);
    line(ctx, v, '#3f7a3a', 3.5);
    bud(vx - 2, vy + len, 6);
    bud(vx + 5, vy + len * 0.5, 3.5);
  }
  // glowing mushroom clusters
  const shroom = (x: number, y: number, r: number) => {
    glowDot(ctx, x, y - r * 0.5, r * 3, A, 0.32, true);
    paint(ctx, blob([[x - r * 0.24, y - r * 0.6], [x + r * 0.24, y - r * 0.6], [x + r * 0.3, y + r * 0.3], [x - r * 0.3, y + r * 0.3]]), '#efe9d2', { lw: LW * 0.35, occl: 0.3, hl: 0 });
    const capS = blob([
      [x - r, y - r * 0.5], [x - r * 0.6, y - r * 1.1], [x + r * 0.1, y - r * 1.32], [x + r * 0.9, y - r * 0.98], [x + r * 1.05, y - r * 0.45], [x, y - r * 0.62],
    ]);
    withGlow(ctx, A, r * 0.9, () => {
      ctx.fillStyle = A;
      ctx.fill(capS.p);
    });
    paint(ctx, capS, lighten(A, 0.15), { lw: LW * 0.45, occl: 0.25, hl: 1.2 });
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.95, r * 0.14, 0, TAU);
    ctx.fill();
  };
  shroom(298, 212, 17);
  shroom(322, 204, 11);
  shroom(340, 214, 13);
  shroom(430, 220, 15);
  shroom(450, 232, 10);
  shroom(484, 284, 11);
  // ---- near hind leg
  const hind = blob([[360, 320], [430, 300], [470, 352], [458, 410], [456, 462], [392, 464], [396, 420], [364, 382]]);
  paint(ctx, hind, P, { rim: A });
  clipDo(ctx, hind, () => {
    paint(ctx, ell(426, 312, 50, 22, -0.2), S, { ink: rgba(shade(S, 0.7), 0.9), lw: 3, occl: 0.5 });
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(hind.p);
  // ---- neck
  const neck = blob([
    [194, 108], [244, 108], [274, 160], [278, 232], [264, 300], [206, 352], [152, 332], [148, 270], [170, 200], [178, 148],
  ]);
  paint(ctx, neck, P, { rim: A, lx: 0.2 });
  clipDo(ctx, neck, () => {
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      paint(ctx, ell(172 - t * 14 + (t > 0.6 ? (t - 0.6) * 20 : 0), 170 + t * 160, 28, 13, -0.35 + t * 0.35), belly, { ink: rgba(INK, 0.6), lw: 3, occl: 0.4 });
    }
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = rgba(shade(P, 0.6), 0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(200 + R() * 70, 130 + R() * 180, 6 + R() * 4, 0.25, Math.PI - 0.25);
      ctx.stroke();
    }
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(neck.p);
  // ---- near front leg
  const fore = blob([[168, 334], [236, 320], [262, 370], [254, 420], [260, 464], [176, 466], [184, 420], [162, 382]]);
  paint(ctx, fore, P, { rim: A });
  const claws = (x: number, y: number, n: number) => {
    for (let i = 0; i < n; i++) {
      paint(ctx, blob([[x + i * 18 - 7, y - 8], [x + i * 18 + 7, y - 8], [x + i * 18 - 10, y + 8, 1]]), '#ece4cc', { lw: LW * 0.45, occl: 0.3 });
    }
  };
  claws(184, 462, 4);
  claws(400, 460, 3);
  // ---- cracked ring core on the chest
  coreIf(ctx, s, 212, 300, 'cracked', 101);
  // ---- head
  const jaw = blob([[36, 166], [90, 174], [160, 174], [214, 160], [224, 186], [190, 202], [120, 198], [62, 188]]);
  paint(ctx, jaw, shade(P, 0.18), { occl: 0.6, rim: A });
  for (let i = 0; i < 6; i++) {
    paint(ctx, poly([[52 + i * 17, 172], [62 + i * 17, 172], [57 + i * 17, 160]]), '#f2ecd8', { lw: 2, occl: 0 });
  }
  // cheek spikes
  paint(ctx, blob([[212, 118], [268, 104, 1], [232, 142]], 0.6), bark, { lw: LW * 0.6, occl: 0.4 });
  paint(ctx, blob([[216, 146], [262, 160, 1], [224, 170]], 0.6), bark, { lw: LW * 0.6, occl: 0.4 });
  const head = blob([
    [22, 150], [38, 128], [78, 118], [118, 100], [152, 86], [192, 84], [228, 100], [242, 132], [224, 160], [180, 168], [120, 168], [60, 168], [28, 164],
  ]);
  paint(ctx, head, P, { rim: A, lx: 0.45, ly: 0.2 });
  clipDo(ctx, head, () => {
    for (let i = 0; i < 6; i++) {
      paint(ctx, poly([[46 + i * 17, 168], [56 + i * 17, 168], [51 + i * 17, 180]]), '#f2ecd8', { lw: 2, occl: 0 });
    }
    paint(ctx, blob([[168, 86], [214, 80], [240, 118], [218, 134], [196, 110]]), S, { ink: rgba(shade(S, 0.7), 0.9), lw: 3, occl: 0.5 });
    ctx.strokeStyle = rgba(shade(P, 0.6), 0.5);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(60, 150);
    ctx.quadraticCurveTo(110, 140, 150, 150);
    ctx.moveTo(170, 150);
    ctx.quadraticCurveTo(196, 140, 214, 150);
    ctx.stroke();
  });
  // nostril
  ctx.fillStyle = '#0c140c';
  ctx.beginPath();
  ctx.ellipse(44, 134, 7, 3.5, -0.4, 0, TAU);
  ctx.fill();
  // eye under a heavy brow
  const ex = 150;
  const ey = 122;
  glowDot(ctx, ex, ey, 38, '#3dffa0', 0.5, true);
  const eyeS = blob([[124, 126, 1], [140, 116], [166, 114], [178, 118, 1], [162, 130], [140, 132]]);
  withGlow(ctx, '#3dffa0', 12, () => {
    const g = ctx.createRadialGradient(ex, ey, 1, ex, ey, 28);
    g.addColorStop(0, '#f0ffb8');
    g.addColorStop(0.45, '#35e08a');
    g.addColorStop(1, '#0b5e34');
    ctx.fillStyle = g;
    ctx.fill(eyeS.p);
  });
  ctx.fillStyle = '#061006';
  ctx.beginPath();
  ctx.ellipse(151, 123, 2.6, 7.5, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW * 0.8;
  ctx.stroke(eyeS.p);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(145, 120, 2.2, 0, TAU);
  ctx.fill();
  paint(ctx, blob([[104, 116], [140, 98], [186, 96], [196, 106], [168, 114], [130, 118]]), shade(P, 0.3), { lw: LW * 0.8, occl: 0.4, rim: A });
  // ---- near antler (crown of branches)
  branch([[196, 94], [224, 52], [268, 22], [330, 6], [376, -2]], 26, bark);
  branch([[222, 56], [208, 20], [214, -18]], 14, bark);
  branch([[264, 26], [262, -6], [276, -30]], 13, bark);
  branch([[318, 10], [338, -24]], 10, bark);
  branch([[352, 2], [392, 6], [418, 24]], 9, bark);
  branch([[206, 80], [178, 48], [166, 14]], 12, bark);
  const lv: [number, number, number, number, boolean][] = [
    [214, -18, -1.2, 28, false], [214, -16, -2.2, 24, true], [276, -30, -0.9, 28, false], [276, -28, -1.9, 22, true],
    [338, -24, -0.5, 26, false], [338, -22, -1.4, 22, true], [418, 24, 0.5, 28, false], [418, 24, -0.4, 24, true],
    [376, -2, -0.2, 24, false], [166, 14, -2.1, 26, false], [166, 16, -2.9, 22, true], [244, 36, -1.0, 18, true],
  ];
  for (const [x, y, a, sz, dk] of lv) leaf(x, y, a, sz, dk ? shade(S, 0.15) : S);
  bud(300, 16, 7);
  bud(226, 34, 6);
  bud(186, 52, 5);
  bud(390, 4, 5);
  const hv: Pt[] = [[250, 38], [258, 66], [250, 96]];
  line(ctx, hv, INK, 7);
  line(ctx, hv, '#3f7a3a', 3.5);
  bud(250, 98, 6);
  const hv2: Pt[] = [[360, 4], [366, 30], [358, 52]];
  line(ctx, hv2, INK, 7);
  line(ctx, hv2, '#3f7a3a', 3.5);
  bud(358, 54, 5);
  ctx.restore();
};

const DRAWERS: Record<Archetype, Drawer> = {
  fox: drawFox,
  otter: drawOtter,
  owl: drawOwl,
  bud: drawBud,
  larva: drawLarva,
  mouse: drawMouse,
  cat: drawCat,
  crab: drawCrab,
  device: drawDevice,
  dragon: drawDragon,
};

/** Draw a creature FACING LEFT, full body, centered, on a new transparent size x size canvas. */
export function drawCreature(spec: ArtSpec, size: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size, size);
  const k = c.width / U;
  ctx.scale(k, k);
  LW = Math.max(7, 1.9 / k);
  INK = mix(shade(spec.primary, 0.88), '#140f1c', 0.6);
  const R = rng(hashStr(`${spec.archetype}|${spec.primary}|${spec.secondary}`));
  const fn = DRAWERS[spec.archetype] ?? drawFox;
  fn(ctx, spec, R);
  return c;
}

// ---------------------------------------------------------------------------
// backdrops
// ---------------------------------------------------------------------------

function vGrad(ctx: Ctx, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function canopy(ctx: Ctx, R: () => number, x0: number, x1: number, y: number, rMin: number, rMax: number, color: string, jitter: number): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  let x = x0;
  while (x < x1) {
    const r = rMin + R() * (rMax - rMin);
    ctx.moveTo(x + r, y + (R() - 0.5) * jitter);
    ctx.arc(x, y + (R() - 0.5) * jitter, r, 0, TAU);
    x += r * (0.7 + R() * 0.5);
  }
  ctx.fill();
}

function trunk(ctx: Ctx, x: number, top: number, bottom: number, w: number, lean: number, fill: string | CanvasGradient): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.5 + lean, top);
  ctx.bezierCurveTo(x - w * 0.5 + lean * 0.5, (top + bottom) / 2, x - w * 0.45, bottom - w, x - w * 1.3, bottom);
  ctx.lineTo(x + w * 1.3, bottom);
  ctx.bezierCurveTo(x + w * 0.45, bottom - w, x + w * 0.5 + lean * 0.5, (top + bottom) / 2, x + w * 0.5 + lean, top);
  ctx.closePath();
  ctx.fill();
}

function godRays(ctx: Ctx, w: number, h: number, ox: number, oy: number, color: string, n: number, R: () => number, alpha: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.28 + (i / n) * 0.34) + (R() - 0.5) * 0.05;
    const spread = 0.025 + R() * 0.04;
    const len = h * 1.4;
    const g = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
    const al = alpha * (0.4 + R() * 0.6);
    g.addColorStop(0, rgba(color, al));
    g.addColorStop(0.6, rgba(color, al * 0.35));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len);
    ctx.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  void w;
}

function motes(ctx: Ctx, R: () => number, n: number, x0: number, y0: number, x1: number, y1: number, color: string, rMax: number): void {
  for (let i = 0; i < n; i++) {
    const x = x0 + R() * (x1 - x0);
    const y = y0 + R() * (y1 - y0);
    const r = rMax * (0.3 + R() * 0.7);
    glowDot(ctx, x, y, r * 3, color, 0.35 + R() * 0.3, true);
    ctx.fillStyle = rgba(lighten(color, 0.6), 0.9);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, TAU);
    ctx.fill();
  }
}

function vignette(ctx: Ctx, w: number, h: number, a: number): void {
  const g = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.35, w / 2, h * 0.55, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(5,8,12,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function hazeBand(ctx: Ctx, w: number, y: number, hh: number, color: string, a: number): void {
  const g = ctx.createLinearGradient(0, y - hh, 0, y + hh);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.5, rgba(color, a));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, y - hh, w, hh * 2);
}

function lightPool(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, a: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  glowDot(ctx, 0, 0, rx, color, a);
  ctx.restore();
}

function grassTufts(ctx: Ctx, R: () => number, w: number, h: number, y: number, color: string, n: number, maxH: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = R() * w;
    const edge = Math.min(x, w - x) / w;
    const hh = maxH * (0.4 + R() * 0.6) * (edge < 0.25 ? 1 : 0.5);
    const blades = 3 + Math.floor(R() * 4);
    for (let b = 0; b < blades; b++) {
      const bx = x + (b - blades / 2) * 5;
      const lean = (R() - 0.5) * hh * 0.8;
      ctx.beginPath();
      ctx.moveTo(bx - 4, y + h * 0.02);
      ctx.quadraticCurveTo(bx + lean * 0.3, y - hh * 0.5, bx + lean, y - hh);
      ctx.quadraticCurveTo(bx + lean * 0.3 + 3, y - hh * 0.5, bx + 4, y + h * 0.02);
      ctx.fill();
    }
  }
}

function drawForest(ctx: Ctx, w: number, h: number, R: () => number): void {
  const hz = h * 0.6;
  ctx.fillStyle = vGrad(ctx, 0, hz + h * 0.05, [
    [0, '#174a50'],
    [0.35, '#2f7c78'],
    [0.72, '#9cc49a'],
    [0.9, '#f0d68a'],
    [1, '#f6e2a4'],
  ]);
  ctx.fillRect(0, 0, w, h);
  glowDot(ctx, w * 0.6, hz - h * 0.04, h * 0.6, '#fff0b8', 0.55);
  // far tree line
  canopy(ctx, R, -40, w + 60, hz - h * 0.07, h * 0.05, h * 0.1, 'rgba(120,170,140,0.55)', h * 0.05);
  for (let i = 0; i < 24; i++) {
    const x = R() * w;
    ctx.fillStyle = 'rgba(110,160,130,0.5)';
    ctx.fillRect(x, hz - h * 0.12, 3 + R() * 5, h * 0.14);
  }
  canopy(ctx, R, -40, w + 60, hz - h * 0.02, h * 0.04, h * 0.07, 'rgba(92,142,110,0.7)', h * 0.03);
  hazeBand(ctx, w, hz - h * 0.03, h * 0.08, '#f4e4b0', 0.45);
  // mid trunks (framing, away from the centre)
  const trunkCol = vGrad(ctx, 0, hz + h * 0.1, [[0, '#1f4a44'], [1, '#2d5a3c']]);
  const mids: [number, number, number][] = [
    [0.04, 0.05, 0], [0.13, 0.03, 8], [0.22, 0.018, -4], [0.8, 0.02, 5], [0.88, 0.035, -6], [0.97, 0.05, 0],
  ];
  for (const [fx, fw, lean] of mids) {
    trunk(ctx, w * fx, -10, hz + h * 0.06, w * fw, lean, trunkCol);
  }
  // god rays
  godRays(ctx, w, h, w * 0.18, -h * 0.3, '#fff2c0', 8, R, 0.1);
  // top canopy overhang
  canopy(ctx, R, -60, w + 60, h * 0.02, h * 0.07, h * 0.14, '#143a33', h * 0.06);
  canopy(ctx, R, -60, w * 0.3, h * 0.1, h * 0.05, h * 0.1, '#17423a', h * 0.06);
  canopy(ctx, R, w * 0.72, w + 60, h * 0.1, h * 0.05, h * 0.1, '#17423a', h * 0.06);
  // leaf-light speckles in canopy
  for (let i = 0; i < 26; i++) {
    const x = R() * w;
    const y = R() * h * 0.12;
    ctx.fillStyle = `rgba(150,200,130,${0.08 + R() * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 4 + R() * 10, 2 + R() * 4, R() * 3, 0, TAU);
    ctx.fill();
  }
  // ground
  const gy = h * 0.64;
  ctx.fillStyle = vGrad(ctx, gy, h, [[0, '#7da352'], [0.25, '#56813c'], [1, '#243f22']]);
  ctx.beginPath();
  ctx.moveTo(0, gy + h * 0.01);
  ctx.bezierCurveTo(w * 0.3, gy - h * 0.02, w * 0.7, gy + h * 0.02, w, gy - h * 0.005);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  hazeBand(ctx, w, gy, h * 0.03, '#e8e0a0', 0.35);
  for (let i = 0; i < 60; i++) {
    const y = gy + R() * (h - gy);
    const t = (y - gy) / (h - gy);
    ctx.fillStyle = R() > 0.5 ? `rgba(140,190,90,${0.04 + t * 0.05})` : `rgba(20,50,25,${0.05 + t * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(R() * w, y, (20 + R() * 60) * (0.5 + t), (4 + R() * 8) * (0.5 + t), 0, 0, TAU);
    ctx.fill();
  }
  // dappled light pools where combatants stand
  lightPool(ctx, w * 0.27, h * 0.82, w * 0.2, h * 0.07, '#fff2b0', 0.3);
  lightPool(ctx, w * 0.73, h * 0.76, w * 0.18, h * 0.06, '#fff2b0', 0.26);
  // foreground
  grassTufts(ctx, R, w, h, h, '#1a3219', 60, h * 0.1);
  ctx.fillStyle = '#10261a';
  for (const [x, dir] of [[0, 1], [w, -1]] as [number, number][]) {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + dir * (0.2 + i * 0.22);
      const len = h * (0.18 + R() * 0.1);
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.6 + dir * 20, h + Math.sin(a) * len * 0.8, x + Math.cos(a) * len, h + Math.sin(a) * len);
      ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.6 - dir * 10, h + Math.sin(a) * len * 0.5, x, h);
      ctx.fill();
    }
  }
  motes(ctx, R, 38, w * 0.05, h * 0.12, w * 0.95, h * 0.8, '#fff0a8', 3.2);
  vignette(ctx, w, h, 0.45);
}

function crane(ctx: Ctx, x: number, base: number, top: number, jibL: number, jibR: number, col: string, lw: number): void {
  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = lw;
  const mw = lw * 7;
  ctx.beginPath();
  ctx.moveTo(x - mw / 2, base);
  ctx.lineTo(x - mw / 2, top);
  ctx.moveTo(x + mw / 2, base);
  ctx.lineTo(x + mw / 2, top);
  const step = mw * 1.2;
  for (let y = base; y > top; y -= step) {
    ctx.moveTo(x - mw / 2, y);
    ctx.lineTo(x + mw / 2, y - step);
    ctx.moveTo(x + mw / 2, y);
    ctx.lineTo(x - mw / 2, y - step);
  }
  // jib
  const jy = top;
  ctx.moveTo(x - jibL, jy);
  ctx.lineTo(x + jibR, jy);
  ctx.moveTo(x - jibL, jy + mw * 0.7);
  ctx.lineTo(x + jibR * 0.6, jy + mw * 0.7);
  for (let t = -jibL; t < jibR * 0.6; t += step) {
    ctx.moveTo(x + t, jy);
    ctx.lineTo(x + t + step / 2, jy + mw * 0.7);
    ctx.lineTo(x + t + step, jy);
  }
  // mast tip + ties
  ctx.moveTo(x, jy);
  ctx.lineTo(x, jy - mw * 2.4);
  ctx.lineTo(x - jibL * 0.7, jy);
  ctx.moveTo(x, jy - mw * 2.4);
  ctx.lineTo(x + jibR * 0.9, jy);
  // hook cable
  ctx.moveTo(x - jibL * 0.55, jy + mw * 0.7);
  ctx.lineTo(x - jibL * 0.55, jy + (base - jy) * 0.45);
  ctx.stroke();
  ctx.fillRect(x + jibR * 0.75, jy - mw * 0.3, mw * 1.4, mw * 1.3);
  ctx.fillRect(x - jibL * 0.55 - mw * 0.35, jy + (base - jy) * 0.45, mw * 0.7, mw * 0.5);
  ctx.restore();
}

function scaffold(ctx: Ctx, x: number, base: number, cols: number, rows: number, cw: number, rh: number, col: string, lw: number): void {
  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let c = 0; c <= cols; c++) {
    ctx.moveTo(x + c * cw, base);
    ctx.lineTo(x + c * cw, base - rows * rh - rh * 0.3);
  }
  for (let r = 0; r <= rows; r++) {
    ctx.moveTo(x - cw * 0.1, base - r * rh);
    ctx.lineTo(x + cols * cw + cw * 0.1, base - r * rh);
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if ((c + r) % 2 === 0) {
        ctx.moveTo(x + c * cw, base - r * rh);
        ctx.lineTo(x + (c + 1) * cw, base - (r + 1) * rh);
      }
    }
  }
  ctx.stroke();
  ctx.fillStyle = col;
  for (let r = 1; r <= rows; r++) ctx.fillRect(x, base - r * rh - lw * 1.5, cols * cw, lw * 2.2);
  ctx.restore();
}

function stump(ctx: Ctx, R: () => number, x: number, base: number, w: number, hh: number, col: string): void {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.9, base);
  ctx.quadraticCurveTo(x - w * 0.5, base - hh * 0.1, x - w * 0.5, base - hh * 0.6);
  const n = 4 + Math.floor(R() * 4);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x - w * 0.5 + t * w + (R() - 0.5) * w * 0.12;
    const peak = i % 2 === 0 ? 0.7 + R() * 0.45 * (1 - Math.abs(t - 0.4)) : 0.55 + R() * 0.12;
    ctx.lineTo(px, base - hh * peak);
  }
  ctx.lineTo(x + w * 0.5, base - hh * 0.6);
  ctx.quadraticCurveTo(x + w * 0.5, base - hh * 0.1, x + w * 0.9, base);
  ctx.closePath();
  ctx.fill();
  // one broken dead branch
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(2, w * 0.12);
  ctx.lineCap = 'round';
  const side = R() > 0.5 ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x + side * w * 0.3, base - hh * 0.5);
  ctx.lineTo(x + side * w * 0.9, base - hh * 0.75);
  ctx.lineTo(x + side * w * 1.1, base - hh * 0.95);
  ctx.stroke();
}

function drawAshstar(ctx: Ctx, w: number, h: number, R: () => number): void {
  const hz = h * 0.6;
  ctx.fillStyle = vGrad(ctx, 0, hz + h * 0.05, [
    [0, '#34333a'],
    [0.4, '#5d5658'],
    [0.75, '#b77c58'],
    [0.92, '#e09a62'],
    [1, '#eab07a'],
  ]);
  ctx.fillRect(0, 0, w, h);
  glowDot(ctx, w * 0.38, hz - h * 0.05, h * 0.55, '#ffb070', 0.45);
  // smoke plumes
  for (let i = 0; i < 9; i++) {
    const x = R() * w;
    const y = h * (0.12 + R() * 0.35);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.45);
    glowDot(ctx, 0, 0, h * (0.2 + R() * 0.2), '#8a8078', 0.25);
    ctx.restore();
  }
  // far scorched forest line
  canopy(ctx, R, -40, w + 60, hz - h * 0.04, h * 0.03, h * 0.07, 'rgba(120,96,84,0.55)', h * 0.04);
  for (let i = 0; i < 18; i++) {
    const x = R() * w;
    ctx.strokeStyle = 'rgba(96,80,74,0.6)';
    ctx.lineWidth = 2 + R() * 3;
    ctx.beginPath();
    ctx.moveTo(x, hz);
    ctx.lineTo(x + (R() - 0.5) * 10, hz - h * (0.08 + R() * 0.1));
    ctx.stroke();
  }
  // industry silhouettes
  const far = 'rgba(58,52,56,0.72)';
  crane(ctx, w * 0.17, hz + 2, h * 0.14, w * 0.12, w * 0.07, far, 3);
  crane(ctx, w * 0.86, hz + 2, h * 0.24, w * 0.09, w * 0.05, 'rgba(70,62,64,0.6)', 2.4);
  scaffold(ctx, w * 0.64, hz + 2, 4, 5, w * 0.024, h * 0.045, far, 2.4);
  scaffold(ctx, w * 0.27, hz + 2, 3, 3, w * 0.022, h * 0.04, 'rgba(70,62,64,0.6)', 2);
  // tanks
  ctx.fillStyle = far;
  rrectFill(ctx, w * 0.735, hz - h * 0.09, w * 0.05, h * 0.09 + 2, 8);
  rrectFill(ctx, w * 0.79, hz - h * 0.06, w * 0.035, h * 0.06 + 2, 6);
  hazeBand(ctx, w, hz - h * 0.02, h * 0.07, '#e8a878', 0.4);
  // warning lights
  const warn: [number, number, string][] = [
    [w * 0.17, h * 0.14 - h * 0.05, '#ff4a3a'],
    [w * 0.86, h * 0.24 - h * 0.04, '#ff4a3a'],
    [w * 0.64 + w * 0.048, hz - h * 0.24, '#ffa030'],
    [w * 0.27, hz - h * 0.13, '#ffa030'],
    [w * 0.76, hz - h * 0.1, '#ff4a3a'],
  ];
  for (const [x, y, c] of warn) {
    glowDot(ctx, x, y, h * 0.05, c, 0.7, true);
    ctx.fillStyle = lighten(c, 0.6);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, TAU);
    ctx.fill();
  }
  // god rays through haze
  godRays(ctx, w, h, w * 0.12, -h * 0.35, '#ffcf9a', 6, R, 0.06);
  // ground
  const gy = h * 0.64;
  ctx.fillStyle = vGrad(ctx, gy, h, [[0, '#a48a70'], [0.3, '#7c6654'], [1, '#3a302c']]);
  ctx.beginPath();
  ctx.moveTo(0, gy);
  ctx.bezierCurveTo(w * 0.35, gy + h * 0.02, w * 0.65, gy - h * 0.015, w, gy + h * 0.005);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  hazeBand(ctx, w, gy, h * 0.03, '#e6b890', 0.35);
  // tire tracks
  ctx.strokeStyle = 'rgba(50,38,32,0.22)';
  ctx.lineWidth = h * 0.012;
  for (const off of [0, h * 0.035]) {
    ctx.beginPath();
    ctx.moveTo(-10, h * 0.95 + off);
    ctx.bezierCurveTo(w * 0.3, h * 0.8 + off, w * 0.6, h * 0.72 + off * 0.6, w + 10, h * 0.7 + off * 0.5);
    ctx.stroke();
  }
  // rubble
  for (let i = 0; i < 70; i++) {
    const y = gy + R() * (h - gy);
    const t = (y - gy) / (h - gy);
    ctx.fillStyle = R() > 0.5 ? `rgba(200,170,140,${0.1 + t * 0.1})` : `rgba(40,30,28,${0.12 + t * 0.15})`;
    ctx.beginPath();
    ctx.ellipse(R() * w, y, (6 + R() * 26) * (0.5 + t), (2 + R() * 5) * (0.5 + t), 0, 0, TAU);
    ctx.fill();
  }
  lightPool(ctx, w * 0.27, h * 0.82, w * 0.2, h * 0.07, '#ffd0a0', 0.22);
  lightPool(ctx, w * 0.73, h * 0.76, w * 0.18, h * 0.06, '#ffd0a0', 0.2);
  // burned stumps (mid & foreground)
  stump(ctx, R, w * 0.06, gy + h * 0.06, w * 0.05, h * 0.2, '#2a2220');
  stump(ctx, R, w * 0.95, gy + h * 0.1, w * 0.06, h * 0.26, '#241c1a');
  stump(ctx, R, w * 0.45, gy + h * 0.005, w * 0.014, h * 0.05, 'rgba(60,46,42,0.8)');
  stump(ctx, R, w * 0.56, gy + h * 0.01, w * 0.01, h * 0.035, 'rgba(60,46,42,0.8)');
  for (const [x, y] of [[w * 0.06, gy - h * 0.1], [w * 0.95, gy - h * 0.12]] as [number, number][]) {
    glowDot(ctx, x, y, h * 0.03, '#ff7a3a', 0.35, true);
  }
  // hazard barrier bottom-right
  const bx = w * 0.84;
  const by = h * 0.9;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, by, w * 0.2, h * 0.035);
  ctx.clip();
  ctx.fillStyle = '#e07a2a';
  ctx.fillRect(bx, by, w * 0.2, h * 0.035);
  ctx.fillStyle = '#231f26';
  for (let i = 0; i < 20; i++) {
    ctx.beginPath();
    ctx.moveTo(bx + i * 24, by + h * 0.04);
    ctx.lineTo(bx + i * 24 + 12, by + h * 0.04);
    ctx.lineTo(bx + i * 24 + 30, by - 2);
    ctx.lineTo(bx + i * 24 + 18, by - 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#231f26';
  ctx.fillRect(bx + w * 0.02, by + h * 0.035, w * 0.012, h * 0.1);
  ctx.fillRect(bx + w * 0.12, by + h * 0.035, w * 0.012, h * 0.1);
  grassTufts(ctx, R, w, h, h, '#2a2220', 30, h * 0.06);
  // falling ash
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = `rgba(230,220,210,${0.2 + R() * 0.35})`;
    ctx.beginPath();
    ctx.arc(R() * w, R() * h * 0.9, 0.8 + R() * 1.8, 0, TAU);
    ctx.fill();
  }
  motes(ctx, R, 14, 0, h * 0.2, w, h * 0.7, '#ff9a4a', 2.2);
  vignette(ctx, w, h, 0.5);
}

function rrectFill(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.fill(rrect(x, y, w, h, r).p);
}

function drawShrine(ctx: Ctx, w: number, h: number, R: () => number): void {
  const hz = h * 0.6;
  ctx.fillStyle = vGrad(ctx, 0, hz + h * 0.05, [
    [0, '#081820'],
    [0.45, '#123238'],
    [0.85, '#24605e'],
    [1, '#3a807a'],
  ]);
  ctx.fillRect(0, 0, w, h);
  // sacred light from above
  godRays(ctx, w, h, w * 0.5, -h * 0.35, '#8ff0dc', 7, R, 0.08);
  glowDot(ctx, w * 0.5, h * 0.42, h * 0.55, '#6fe0cc', 0.28);
  // distant giant trees
  for (let i = 0; i < 9; i++) {
    const x = w * (0.08 + i * 0.105) + (R() - 0.5) * w * 0.03;
    if (Math.abs(x - w * 0.5) < w * 0.12) continue;
    trunk(ctx, x, -10, hz + h * 0.02, w * (0.025 + R() * 0.02), (R() - 0.5) * 10, 'rgba(26,60,62,0.75)');
  }
  canopy(ctx, R, -40, w + 60, h * 0.04, h * 0.08, h * 0.14, 'rgba(14,40,42,0.9)', h * 0.06);
  hazeBand(ctx, w, hz - h * 0.05, h * 0.12, '#5fb8a8', 0.3);
  // ring gate
  const gx = w * 0.5;
  const gyC = h * 0.4;
  const gr = h * 0.2;
  const stone = '#4d5f5c';
  ctx.save();
  // pillars + beam (torii-like)
  ctx.fillStyle = shade(stone, 0.2);
  ctx.fillRect(gx - gr * 1.28, gyC - gr * 0.9, gr * 0.16, hz - (gyC - gr * 0.9) + h * 0.02);
  ctx.fillRect(gx + gr * 1.12, gyC - gr * 0.9, gr * 0.16, hz - (gyC - gr * 0.9) + h * 0.02);
  ctx.fillStyle = shade(stone, 0.1);
  ctx.beginPath();
  ctx.moveTo(gx - gr * 1.6, gyC - gr * 1.14);
  ctx.quadraticCurveTo(gx, gyC - gr * 1.3, gx + gr * 1.6, gyC - gr * 1.14);
  ctx.lineTo(gx + gr * 1.5, gyC - gr * 1.0);
  ctx.quadraticCurveTo(gx, gyC - gr * 1.12, gx - gr * 1.5, gyC - gr * 1.0);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(gx - gr * 1.35, gyC - gr * 0.86, gr * 2.7, gr * 0.1);
  // ring
  glowDot(ctx, gx, gyC, gr * 1.1, RING, 0.18, true);
  const ringP = new Path2D();
  ringP.arc(gx, gyC, gr, 0, TAU);
  ringP.moveTo(gx + gr * 0.78, gyC);
  ringP.arc(gx, gyC, gr * 0.78, 0, TAU, true);
  const sg = ctx.createLinearGradient(gx - gr, gyC - gr, gx + gr, gyC + gr);
  sg.addColorStop(0, lighten(stone, 0.2));
  sg.addColorStop(1, shade(stone, 0.35));
  ctx.fillStyle = sg;
  ctx.fill(ringP);
  // mossy top
  ctx.strokeStyle = 'rgba(80,130,80,0.6)';
  ctx.lineWidth = gr * 0.06;
  ctx.beginPath();
  ctx.arc(gx, gyC, gr * 0.96, Math.PI * 1.15, Math.PI * 1.7);
  ctx.stroke();
  // runes
  ctx.shadowColor = RING;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = rgba(RING, 0.75);
  ctx.lineWidth = Math.max(1.5, gr * 0.018);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const rr = gr * 0.89;
    const x = gx + Math.cos(a) * rr;
    const y = gyC + Math.sin(a) * rr;
    const s = gr * 0.045;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    const k = i % 4;
    if (k === 0) {
      ctx.moveTo(-s, -s);
      ctx.lineTo(0, s);
      ctx.lineTo(s, -s);
    } else if (k === 1) {
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.moveTo(-s, 0);
      ctx.lineTo(s, 0);
    } else if (k === 2) {
      ctx.arc(0, 0, s * 0.8, 0, TAU);
    } else {
      ctx.moveTo(-s, s);
      ctx.lineTo(-s, -s);
      ctx.lineTo(s, -s * 0.2);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.shadowBlur = 0;
  // inner portal shimmer
  const pg = ctx.createRadialGradient(gx, gyC, 0, gx, gyC, gr * 0.78);
  pg.addColorStop(0, 'rgba(160,255,235,0.18)');
  pg.addColorStop(0.7, 'rgba(62,224,200,0.08)');
  pg.addColorStop(1, 'rgba(62,224,200,0.25)');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.arc(gx, gyC, gr * 0.78, 0, TAU);
  ctx.fill();
  // pedestal
  ctx.fillStyle = shade(stone, 0.3);
  ctx.fillRect(gx - gr * 0.5, gyC + gr * 0.92, gr, hz - (gyC + gr * 0.92) + h * 0.02);
  ctx.fillStyle = shade(stone, 0.15);
  ctx.fillRect(gx - gr * 0.7, hz - h * 0.02, gr * 1.4, h * 0.04);
  ctx.restore();
  // haze veil to push the gate back (keeps the middle calm)
  hazeBand(ctx, w, h * 0.42, h * 0.2, '#2a6a66', 0.35);
  // ground
  const gy = h * 0.63;
  ctx.fillStyle = vGrad(ctx, gy, h, [[0, '#35584c'], [0.35, '#223e36'], [1, '#0c1a18']]);
  ctx.beginPath();
  ctx.moveTo(0, gy);
  ctx.bezierCurveTo(w * 0.3, gy - h * 0.01, w * 0.7, gy - h * 0.01, w, gy);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  hazeBand(ctx, w, gy, h * 0.035, '#7fd8c4', 0.25);
  // stone path toward the gate
  for (let r = 0; r < 7; r++) {
    const t = r / 6;
    const y = gy + (h - gy) * (0.05 + t * 0.95);
    const half = w * (0.05 + t * 0.14);
    const n = 2 + Math.floor(t * 3);
    for (let i = 0; i < n; i++) {
      const x = w * 0.5 - half + (i + 0.5) * ((half * 2) / n);
      ctx.fillStyle = `rgba(110,130,120,${0.12 + t * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(x + (R() - 0.5) * 10, y, (half / n) * 0.85, h * (0.008 + t * 0.018), 0, 0, TAU);
      ctx.fill();
    }
  }
  for (let i = 0; i < 60; i++) {
    const y = gy + R() * (h - gy);
    const t = (y - gy) / (h - gy);
    ctx.fillStyle = R() > 0.5 ? `rgba(90,150,110,${0.06 + t * 0.08})` : `rgba(5,15,12,${0.1 + t * 0.15})`;
    ctx.beginPath();
    ctx.ellipse(R() * w, y, (20 + R() * 50) * (0.5 + t), (3 + R() * 7) * (0.5 + t), 0, 0, TAU);
    ctx.fill();
  }
  lightPool(ctx, w * 0.27, h * 0.82, w * 0.2, h * 0.07, '#8ff0dc', 0.16);
  lightPool(ctx, w * 0.73, h * 0.76, w * 0.2, h * 0.07, '#8ff0dc', 0.16);
  // huge ancient trees framing the scene
  const bigTree = (x: number, tw: number, dir: number) => {
    const g = ctx.createLinearGradient(x - tw, 0, x + tw, 0);
    g.addColorStop(dir > 0 ? 0 : 1, '#0a1614');
    g.addColorStop(0.5 + dir * 0.2, '#1a302c');
    g.addColorStop(dir > 0 ? 1 : 0, '#0e1c1a');
    trunk(ctx, x, -20, h * 0.8, tw, dir * 10, g);
    // roots
    for (let i = 0; i < 4; i++) {
      const sx = x + dir * tw * (0.1 + i * 0.1);
      const ex2 = x + dir * tw * (1.0 + i * 0.5);
      const ey2 = h * (0.7 + i * 0.07);
      const root = taper([
        [sx, h * 0.55],
        [sx + dir * tw * 0.35, h * 0.63 + i * 6],
        [(sx + ex2) / 2 + dir * tw * 0.2, ey2 - h * 0.03],
        [ex2, ey2],
      ], tw * (0.75 - i * 0.12), 8);
      ctx.fillStyle = i % 2 ? '#0e1c1a' : '#11201d';
      ctx.fill(root.p);
    }
    // bark lines
    ctx.strokeStyle = 'rgba(80,120,110,0.18)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const bx = x - tw * 0.4 + (i / 5) * tw * 0.8;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.bezierCurveTo(bx + 10, h * 0.3, bx - 10, h * 0.5, bx + dir * 8, h * 0.66);
      ctx.stroke();
    }
    // moss glow spots
    for (let i = 0; i < 5; i++) {
      glowDot(ctx, x + (R() - 0.5) * tw * 0.8, h * (0.2 + R() * 0.45), 10 + R() * 14, RING, 0.3, true);
    }
  };
  bigTree(w * 0.05, w * 0.12, 1);
  bigTree(w * 0.95, w * 0.12, -1);
  canopy(ctx, R, -60, w + 60, -h * 0.02, h * 0.08, h * 0.14, '#06110f', h * 0.05);
  // stone lanterns silhouettes near trees
  for (const x of [w * 0.2, w * 0.8]) {
    ctx.fillStyle = '#16262a';
    ctx.fillRect(x - 8, hz - h * 0.06, 16, h * 0.07);
    ctx.fillRect(x - 20, hz - h * 0.08, 40, h * 0.02);
    ctx.fillRect(x - 14, hz - h * 0.1, 28, h * 0.025);
    glowDot(ctx, x, hz - h * 0.085, h * 0.04, '#8ff0dc', 0.5, true);
  }
  grassTufts(ctx, R, w, h, h, '#07120f', 50, h * 0.08);
  motes(ctx, R, 34, w * 0.05, h * 0.1, w * 0.95, h * 0.9, '#7ff5dc', 2.6);
  hazeBand(ctx, w, h * 0.66, h * 0.05, '#6fd0bc', 0.12);
  vignette(ctx, w, h, 0.65);
}

/** Painted battle background of w x h. Deterministic. */
export function drawBackdrop(theme: BackdropTheme, w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  const R = rng(hashStr(`bg|${theme}`));
  const W = c.width;
  const H = c.height;
  if (theme === 'ashstar') drawAshstar(ctx, W, H, R);
  else if (theme === 'shrine') drawShrine(ctx, W, H, R);
  else drawForest(ctx, W, H, R);
  return c;
}

// ---------------------------------------------------------------------------
// player emblem
// ---------------------------------------------------------------------------

/** Round emblem for the player: turquoise ring-shaped compass on a warm badge. */
export function drawPlayerEmblem(size: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size, size);
  const k = c.width / 256;
  ctx.scale(k, k);
  LW = Math.max(6, 1.6 / k);
  INK = '#2a1610';
  const cx = 128;
  const cy = 128;
  // drop shadow
  glowDot(ctx, cx, cy + 6, 124, '#000000', 0.45);
  // badge
  const badge = ell(cx, cy, 112, 112);
  const bg = ctx.createRadialGradient(cx - 34, cy - 40, 8, cx, cy, 118);
  bg.addColorStop(0, '#ffe2a0');
  bg.addColorStop(0.45, '#f5a24e');
  bg.addColorStop(1, '#a8501c');
  ctx.fillStyle = bg;
  ctx.fill(badge.p);
  innerShadow(ctx, badge.p, 'rgba(90,30,10,0.6)', -6, -8, 16);
  innerShadow(ctx, badge.p, 'rgba(255,245,210,0.7)', 3, 4, 5);
  // rim
  ctx.strokeStyle = '#6a2e12';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, 106, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,220,160,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 98, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = LW;
  ctx.stroke(badge.p);
  // compass ticks
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a + Math.PI / 2);
    const tri = poly([[0, -94], [11, -70], [-11, -70]]);
    paint(ctx, tri, i === 0 ? '#fff4d8' : '#e8fff9', { lw: LW * 0.6, occl: 0.3, hl: 0 });
    ctx.restore();
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    ctx.fillStyle = 'rgba(90,40,16,0.7)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 80, cy + Math.sin(a) * 80, 4, 0, TAU);
    ctx.fill();
  }
  // ring device
  ringCore(ctx, cx, cy, 64, false, 7);
  // needle
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  const north = poly([[0, -52], [9, 0], [-9, 0]]);
  const south = poly([[0, 52], [9, 0], [-9, 0]]);
  withGlow(ctx, '#ff5a3a', 10, () => {
    ctx.fillStyle = '#ff5a3a';
    ctx.fill(north.p);
  });
  paint(ctx, north, '#ff5a3a', { lw: LW * 0.55, occl: 0.3, hl: 0.4 });
  paint(ctx, south, '#f4ecdc', { lw: LW * 0.55, occl: 0.3, hl: 0.4 });
  ctx.restore();
  paint(ctx, ell(cx, cy, 8, 8), '#ffe08a', { lw: LW * 0.5, occl: 0.3 });
  // gloss
  ctx.save();
  ctx.clip(badge.p);
  const gl = ctx.createLinearGradient(0, 16, 0, 128);
  gl.addColorStop(0, 'rgba(255,255,255,0.35)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.ellipse(cx - 10, 60, 90, 44, -0.2, 0, TAU);
  ctx.fill();
  ctx.restore();
  return c;
}
