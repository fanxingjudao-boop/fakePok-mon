/* ============================================================
 * フィールドの絵(手続き生成・Canvas 2D のみ)
 *   地面は1枚の大きな canvas(renderGround)。木・建物・小物・門・村人・効果は
 *   足元 (footX, footY) を持つ「立て看板(standee)」として別々に返す。
 *
 *   地面の作り方
 *     1. 各タイルを素材(草/土/苔/泥/石畳/木床/水/深い水/崖/林床)に振り分ける
 *        (b R x r などは周りの素材を受け継ぐ)。
 *     2. 素材ごとに「角を丸め、縁をゆらしたマスク」を作り、継ぎ目のないテクスチャを
 *        そのマスクで切り抜いて重ねる。境目のにじみ・水際の泡・深さ・木陰は、
 *        マスクを縮小→ぼかし→拡大した「やわらかいマスク」で描く。
 *     3. 草むら・花・葦・浮き葉・小石などの細部をまとめて描き、最後に地域ごとの光を乗せる。
 *   ・全面を1画素ずつ触るループは使わない(形・グラデーション・合成・小さな模様だけ)。
 *   ・ctx.filter も使わない(どのブラウザでも同じ見た目)。
 *   ・すべて種から決まる。Math.random は使わない。
 *   ・返す canvas はキャッシュを共有する。受け取った側で描き込まないこと。
 * ============================================================ */
import { TILE } from '../world/types.ts';
import type { FieldTheme, GateKind, MapDef, PropKind } from '../world/types.ts';

export interface FieldSprite {
  canvas: HTMLCanvasElement;
  /** canvas 内の足元(木なら幹の根元、建物なら敷地の下辺の中央) */
  footX: number;
  footY: number;
}
export type FieldFxKind = 'shadow' | 'exclaim' | 'sparkle' | 'leaf' | 'pollen' | 'firefly' | 'interact' | 'ash';
export type VillagerId = 'villager_a' | 'villager_b' | 'villager_c' | 'villager_d';
export interface FieldAmbience {
  /** カメラ/全体に掛ける乗算色 */
  tint: number;
  /** 光の筋・光だまりの色(CSS色) */
  light: string;
  particle: 'leaf' | 'pollen' | 'firefly' | 'ash' | null;
  /** 霧の濃さ 0..1 */
  fog: number;
}
/** planTrees の結果。x, y は地図上の足元(px) */
export interface TreePlacement {
  x: number;
  y: number;
  tx: number;
  ty: number;
  variant: number;
  /** 表示倍率(0.9..1.12) */
  scale: number;
  /** 明るさ(1 = 縁の木, 奥ほど暗い)。Phaser では setTint(gray(shade)) */
  shade: number;
}

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
type Pt3 = [number, number, number];
interface Box { x: number; y: number; w: number; h: number }

const T = TILE;
const TAU = Math.PI * 2;
/** 碧環のターコイズ(src/data/art.ts の HEKIKAN と同じ) */
const HEK = '#3ee0c8';
const INK = 'rgba(38,26,24,0.8)';

// ---------------------------------------------------------------------------
// basics
// ---------------------------------------------------------------------------

function mk(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('Canvas 2D is not available');
  x.lineJoin = 'round';
  x.lineCap = 'round';
  return [c, x];
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

function hs(...parts: (string | number)[]): number {
  const str = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const rgbCache = new Map<string, [number, number, number]>();
function rgbOf(c: string): [number, number, number] {
  let v = rgbCache.get(c);
  if (!v) {
    let h = c.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((k) => k + k).join('');
    const n = parseInt(h.slice(0, 6), 16);
    v = Number.isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(c, v);
  }
  return v;
}
function hex(r: number, g: number, b: number): string {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}
function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
function rgba(c: string, a: number): string {
  const [r, g, b] = rgbOf(c);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
/** 暖かい光の方へ */
const lit = (c: string, t: number) => mix(c, '#fff4dc', t);
/** 深い紫がかった影の方へ(黒より絵の具らしい) */
const dk = (c: string, t: number) => mix(c, '#161226', t);

function pick<V>(R: () => number, a: readonly V[]): V {
  return a[Math.floor(R() * a.length) % a.length];
}

// ---------------------------------------------------------------------------
// paths & paint
// ---------------------------------------------------------------------------

/** Catmull-Rom で点を通るなめらかな線 */
function smooth(pts: Pt[], closed = true, k = 1): Path2D {
  const p = new Path2D();
  const n = pts.length;
  const get = (i: number): Pt => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  p.moveTo(pts[0][0], pts[0][1]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    p.bezierCurveTo(
      p1[0] + ((p2[0] - p0[0]) * k) / 6, p1[1] + ((p2[1] - p0[1]) * k) / 6,
      p2[0] - ((p3[0] - p1[0]) * k) / 6, p2[1] - ((p3[1] - p1[1]) * k) / 6,
      p2[0], p2[1],
    );
  }
  if (closed) p.closePath();
  return p;
}
function poly(pts: Pt[]): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.closePath();
  return p;
}
function ellP(cx: number, cy: number, rx: number, ry: number, rot = 0): Path2D {
  const p = new Path2D();
  p.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  return p;
}
function rrect(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  rrInto(p, x, y, x + w, y + h, r, r, r, r);
  return p;
}
function rrInto(p: Path2D, x0: number, y0: number, x1: number, y1: number, tl: number, tr: number, br: number, bl: number): void {
  p.moveTo(x0 + tl, y0);
  p.lineTo(x1 - tr, y0);
  if (tr) p.arcTo(x1, y0, x1, y0 + tr, tr); else p.lineTo(x1, y0);
  p.lineTo(x1, y1 - br);
  if (br) p.arcTo(x1, y1, x1 - br, y1, br); else p.lineTo(x1, y1);
  p.lineTo(x0 + bl, y1);
  if (bl) p.arcTo(x0, y1, x0, y1 - bl, bl); else p.lineTo(x0, y1);
  p.lineTo(x0, y0 + tl);
  if (tl) p.arcTo(x0, y0, x0 + tl, y0, tl); else p.lineTo(x0, y0);
  p.closePath();
}
function lin(x: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = x.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function radG(x: Ctx, cx: number, cy: number, r0: number, r1: number, stops: [number, string][], fx = cx, fy = cy): CanvasGradient {
  const g = x.createRadialGradient(fx, fy, r0, cx, cy, r1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function ink(x: Ctx, p: Path2D, w = 1.2, col = INK): void {
  x.save();
  x.strokeStyle = col;
  x.lineWidth = w;
  x.stroke(p);
  x.restore();
}
function stroke(x: Ctx, p: Path2D, col: string | CanvasGradient, w: number): void {
  x.save();
  x.strokeStyle = col;
  x.lineWidth = w;
  x.stroke(p);
  x.restore();
}
function line(x: Ctx, pts: Pt[], col: string, w: number, k = 1): void {
  stroke(x, smooth(pts, false, k), col, w);
}
/** 地面に落ちるやわらかい影 */
function shadowE(x: Ctx, cx: number, cy: number, rx: number, ry: number, a = 0.45): void {
  x.save();
  x.translate(cx, cy);
  x.scale(1, ry / rx);
  x.fillStyle = radG(x, 0, 0, 0, rx, [[0, `rgba(14,12,22,${a})`], [0.55, `rgba(14,12,22,${a * 0.6})`], [1, 'rgba(14,12,22,0)']]);
  x.beginPath();
  x.arc(0, 0, rx, 0, TAU);
  x.fill();
  x.restore();
}
function glow(x: Ctx, cx: number, cy: number, r: number, col: string, a = 1, add = true): void {
  x.save();
  if (add) x.globalCompositeOperation = 'lighter';
  x.fillStyle = radG(x, cx, cy, 0, r, [[0, rgba(col, a)], [0.35, rgba(col, a * 0.42)], [1, rgba(col, 0)]]);
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
  x.fill();
  x.restore();
}
function clipDo(x: Ctx, p: Path2D, fn: () => void): void {
  x.save();
  x.clip(p);
  fn();
  x.restore();
}
/**
 * 形の内側に、光の反対側(右下)の影の帯と、光側(左上)のふちの明るさを入れる。
 * アニメ塗りの「影色1段」に近い。sh は影の帯の太さ。
 */
function cel(x: Ctx, p: Path2D, base: string, sh = 3, o: { shade?: number; hl?: number; out?: number; ink?: string } = {}): void {
  x.fillStyle = base;
  x.fill(p);
  x.save();
  x.clip(p);
  const q = new Path2D();
  q.rect(-4000, -4000, 8000, 8000);
  q.addPath(p, new DOMMatrix().translateSelf(-sh * 0.8, -sh));
  x.fillStyle = rgba(dk(base, 0.55), o.shade ?? 0.42);
  x.fill(q, 'evenodd');
  if ((o.hl ?? 0.3) > 0) {
    const q2 = new Path2D();
    q2.rect(-4000, -4000, 8000, 8000);
    q2.addPath(p, new DOMMatrix().translateSelf(sh * 0.35, sh * 0.45));
    x.fillStyle = rgba(lit(base, 0.7), o.hl ?? 0.3);
    x.fill(q2, 'evenodd');
  }
  x.restore();
  if ((o.out ?? 1) > 0) ink(x, p, o.out ?? 1, o.ink ?? INK);
}
/** 対角グラデーションで立体に塗る(左上が明るい) */
function vol(x: Ctx, p: Path2D, x0: number, y0: number, x1: number, y1: number, base: string, hi = 0.28, lo = 0.4): void {
  x.fillStyle = lin(x, x0, y0, x1, y1, [[0, lit(base, hi)], [0.45, base], [1, dk(base, lo)]]);
  x.fill(p);
}

const spriteCache = new Map<string, FieldSprite>();
function cached(key: string, fn: () => FieldSprite): FieldSprite {
  let s = spriteCache.get(key);
  if (!s) {
    s = fn();
    spriteCache.set(key, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// palettes
// ---------------------------------------------------------------------------

interface Pal {
  grass: string; grassHi: string; grassLo: string;
  dirt: string; dirtHi: string; dirtLo: string;
  moss: string; mossHi: string;
  mud: string; mudLo: string;
  stone: string; stoneHi: string; stoneLo: string;
  wood: string; woodHi: string; woodLo: string;
  water: string; deep: string; waterHi: string; foam: string;
  rock: string; rockHi: string; rockLo: string;
  floor: string; shade: string; sun: string;
  flowers: string[];
  bark: string;
}

const PAL: Record<FieldTheme, Pal> = {
  village: {
    grass: '#7f9b55', grassHi: '#bcc476', grassLo: '#4b6b40',
    dirt: '#b8976a', dirtHi: '#dcc596', dirtLo: '#846646',
    moss: '#5e8040', mossHi: '#98b05a',
    mud: '#6f5b42', mudLo: '#46382a',
    stone: '#a8a292', stoneHi: '#cdc6b2', stoneLo: '#6e6a5e',
    wood: '#a8774c', woodHi: '#d4a672', woodLo: '#5e3e2a',
    water: '#5fa6a2', deep: '#2a6274', waterHi: '#c4ecdc', foam: '#f4fbf0',
    rock: '#8f8b80', rockHi: '#c4beae', rockLo: '#4e4a46',
    floor: '#27371f', shade: '#1c2a22', sun: '#ffe2a2',
    flowers: ['#f6e4a0', '#f4a6b6', '#fff8ee', '#c6a4ea', '#ffbe6a'],
    bark: '#6e4c36',
  },
  forest: {
    grass: '#5c8a4a', grassHi: '#a2c66e', grassLo: '#2f593a',
    dirt: '#957a58', dirtHi: '#c0a67c', dirtLo: '#5c4632',
    moss: '#4a7a34', mossHi: '#86ae4e',
    mud: '#5c4a36', mudLo: '#3a2e22',
    stone: '#8c9088', stoneHi: '#b8bcb0', stoneLo: '#585e58',
    wood: '#8e6444', woodHi: '#b88a60', woodLo: '#4e3424',
    water: '#4a9a92', deep: '#1d5664', waterHi: '#b4e6d4', foam: '#effaf0',
    rock: '#7e8278', rockHi: '#b2b6a6', rockLo: '#40443e',
    floor: '#172a1c', shade: '#0f2018', sun: '#f6f2b4',
    flowers: ['#fff6dc', '#b4dcff', '#f6d46a', '#eaa8d8'],
    bark: '#4e3a2c',
  },
  road: {
    grass: '#8c8a66', grassHi: '#b8ae82', grassLo: '#5a5a48',
    dirt: '#9e9384', dirtHi: '#c6bca8', dirtLo: '#686058',
    moss: '#6e7448', mossHi: '#9a9c64',
    mud: '#5c5248', mudLo: '#3c3630',
    stone: '#8e8a84', stoneHi: '#b4b0a8', stoneLo: '#5a5652',
    wood: '#7e6858', woodHi: '#a89080', woodLo: '#4a3c34',
    water: '#6a8884', deep: '#34525a', waterHi: '#c0d0c4', foam: '#eef0e8',
    rock: '#8a8680', rockHi: '#b8b2a8', rockLo: '#4a4644',
    floor: '#26261f', shade: '#221e1c', sun: '#ffd2a6',
    flowers: ['#dcd2ae', '#cfa6a0', '#e6ddc4'],
    bark: '#584c44',
  },
  marsh: {
    grass: '#8a9a4c', grassHi: '#c8ca74', grassLo: '#56683a',
    dirt: '#8e7e58', dirtHi: '#b4a276', dirtLo: '#5c4e36',
    moss: '#7a9440', mossHi: '#b6c65c',
    mud: '#6c5e3e', mudLo: '#40361f',
    stone: '#8e8e7c', stoneHi: '#b6b69e', stoneLo: '#5a5a4a',
    wood: '#8a6e4a', woodHi: '#b4966a', woodLo: '#4e3e28',
    water: '#7a8c54', deep: '#3e553a', waterHi: '#dce2a4', foam: '#f2f0c8',
    rock: '#8a8a74', rockHi: '#b8b89a', rockLo: '#4a4a3c',
    floor: '#232b18', shade: '#1e2616', sun: '#fff2a4',
    flowers: ['#fff0a0', '#f6cc5a', '#fff8e2', '#e8e0ff'],
    bark: '#5a4a34',
  },
  shrine: {
    grass: '#4c7864', grassHi: '#80ac90', grassLo: '#284a42',
    dirt: '#6e7064', dirtHi: '#969a8a', dirtLo: '#44463e',
    moss: '#3c7a5c', mossHi: '#74b890',
    mud: '#474a3e', mudLo: '#2c2e26',
    stone: '#8a9a96', stoneHi: '#bccac4', stoneLo: '#56666a',
    wood: '#6a5646', woodHi: '#927a66', woodLo: '#3a2e26',
    water: '#358890', deep: '#133e50', waterHi: '#a4efe2', foam: '#dcfff6',
    rock: '#6e7c7a', rockHi: '#9eb2ac', rockLo: '#34403e',
    floor: '#0c1c1a', shade: '#081616', sun: '#b4f2e2',
    flowers: ['#c4f6ee', '#e2f0ff', '#a0d8ff'],
    bark: '#3e3430',
  },
};

// ---------------------------------------------------------------------------
// seamless textures (256px, drawn with wrap-around)
// ---------------------------------------------------------------------------

type TexKind = 'grass' | 'dirt' | 'moss' | 'mud' | 'floor' | 'rock';
const TEX_N = 256;
const texCache = new Map<string, HTMLCanvasElement>();

function tex(theme: FieldTheme, kind: TexKind, v = 0): HTMLCanvasElement {
  const key = `${theme}|${kind}|${v}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const pal = PAL[theme];
  const N = v ? 184 : TEX_N;
  const k = (N * N) / (TEX_N * TEX_N);
  const [c, x] = mk(N, N);
  const R = rng(hs('tex', theme, kind, v));
  const put = (px: number, py: number, r: number, fn: (X: number, Y: number) => void) => {
    for (let ox = -N; ox <= N; ox += N) {
      for (let oy = -N; oy <= N; oy += N) {
        const X = px + ox;
        const Y = py + oy;
        if (X + r < 0 || X - r > N || Y + r < 0 || Y - r > N) continue;
        fn(X, Y);
      }
    }
  };
  const cols: Record<TexKind, [string, string, string]> = {
    grass: [pal.grass, pal.grassHi, pal.grassLo],
    dirt: [pal.dirt, pal.dirtHi, pal.dirtLo],
    moss: [pal.moss, pal.mossHi, dk(pal.moss, 0.35)],
    mud: [pal.mud, lit(pal.mud, 0.25), pal.mudLo],
    floor: [pal.floor, mix(pal.floor, pal.grassLo, 0.6), dk(pal.floor, 0.4)],
    rock: [pal.rock, pal.rockHi, pal.rockLo],
  };
  const [base, hi, lo] = cols[kind];
  x.fillStyle = base;
  x.fillRect(0, 0, N, N);
  // broad soft dabs: the "painted" under-layer
  for (let i = 0; i < 240 * k; i++) {
    const px = R() * N;
    const py = R() * N;
    const r = 7 + R() * 18;
    const col = R() < 0.5 ? hi : lo;
    const a = 0.05 + R() * 0.11;
    const rot = R() * Math.PI;
    const sy = 0.35 + R() * 0.4;
    x.fillStyle = rgba(col, a);
    put(px, py, r, (X, Y) => {
      x.beginPath();
      x.ellipse(X, Y, r, r * sy, rot, 0, TAU);
      x.fill();
    });
  }
  if (kind === 'grass' || kind === 'floor') {
    const n = (kind === 'grass' ? 950 : 420) * k;
    const ps = [new Path2D(), new Path2D(), new Path2D()];
    for (let i = 0; i < n; i++) {
      const px = R() * N;
      const py = R() * N;
      const len = 3 + R() * 5.5;
      const lean = (R() - 0.5) * 4.5;
      const k = R() < 0.42 ? 0 : R() < 0.72 ? 1 : 2;
      put(px, py, len + 5, (X, Y) => blade(ps[k], X, Y, len, lean, 1.5));
    }
    x.fillStyle = rgba(lo, kind === 'grass' ? 0.5 : 0.6);
    x.fill(ps[0]);
    x.fillStyle = rgba(mix(base, hi, 0.5), 0.45);
    x.fill(ps[1]);
    x.fillStyle = rgba(hi, kind === 'grass' ? 0.55 : 0.25);
    x.fill(ps[2]);
    if (kind === 'floor') {
      // leaf litter
      for (let i = 0; i < 160 * k; i++) {
        const px = R() * N;
        const py = R() * N;
        const col = pick(R, ['#5a4a2e', '#3e3a22', '#2e4426', '#4a3a26']);
        x.fillStyle = rgba(col, 0.35 + R() * 0.3);
        const rot = R() * Math.PI;
        const s = 1.5 + R() * 2.5;
        put(px, py, 6, (X, Y) => {
          x.beginPath();
          x.ellipse(X, Y, s * 1.6, s * 0.7, rot, 0, TAU);
          x.fill();
        });
      }
    }
  } else if (kind === 'dirt' || kind === 'rock') {
    // pebbles
    const n = (kind === 'dirt' ? 120 : 60) * k;
    for (let i = 0; i < n; i++) {
      const px = R() * N;
      const py = R() * N;
      const r = 0.9 + R() * (kind === 'dirt' ? 2.4 : 3.5);
      const col = mix(base, R() < 0.5 ? hi : lo, 0.4 + R() * 0.5);
      put(px, py, r + 3, (X, Y) => {
        x.fillStyle = rgba(lo, 0.45);
        x.beginPath();
        x.ellipse(X + 0.5, Y + 1, r * 1.3, r * 0.9, 0, 0, TAU);
        x.fill();
        x.fillStyle = col;
        x.beginPath();
        x.ellipse(X, Y, r * 1.3, r * 0.9, 0, 0, TAU);
        x.fill();
        x.fillStyle = rgba(hi, 0.55);
        x.beginPath();
        x.ellipse(X - r * 0.35, Y - r * 0.35, r * 0.55, r * 0.35, 0, 0, TAU);
        x.fill();
      });
    }
    if (kind === 'rock') {
      // cracks + lichen
      x.strokeStyle = rgba(lo, 0.45);
      x.lineWidth = 1.1;
      for (let i = 0; i < 26 * k; i++) {
        let px = R() * N;
        let py = R() * N;
        const p = new Path2D();
        p.moveTo(px, py);
        for (let k = 0; k < 4; k++) {
          px += (R() - 0.5) * 22;
          py += (R() - 0.3) * 14;
          p.lineTo(px, py);
        }
        x.stroke(p);
      }
      for (let i = 0; i < 70 * k; i++) {
        const px = R() * N;
        const py = R() * N;
        x.fillStyle = rgba(pick(R, ['#a8b46a', '#c8c89a', '#7a9a6a']), 0.25);
        const r = 1.5 + R() * 3;
        put(px, py, r, (X, Y) => {
          x.beginPath();
          x.arc(X, Y, r, 0, TAU);
          x.fill();
        });
      }
    }
    // fine grit
    for (let i = 0; i < 900 * k; i++) {
      const px = R() * N;
      const py = R() * N;
      x.fillStyle = rgba(R() < 0.5 ? hi : lo, 0.25 + R() * 0.3);
      x.fillRect(px, py, 1, 1);
    }
  } else if (kind === 'moss') {
    for (let i = 0; i < 300 * k; i++) {
      const px = R() * N;
      const py = R() * N;
      const r = 1.6 + R() * 3.4;
      put(px, py, r + 2, (X, Y) => {
        x.fillStyle = rgba(lo, 0.4);
        x.beginPath();
        x.arc(X + 0.6, Y + 0.9, r, 0, TAU);
        x.fill();
        x.fillStyle = rgba(mix(base, hi, R() * 0.6), 0.9);
        x.beginPath();
        x.arc(X, Y, r, 0, TAU);
        x.fill();
        x.fillStyle = rgba(hi, 0.45);
        x.beginPath();
        x.arc(X - r * 0.3, Y - r * 0.35, r * 0.45, 0, TAU);
        x.fill();
      });
    }
  } else if (kind === 'mud') {
    for (let i = 0; i < 90 * k; i++) {
      const px = R() * N;
      const py = R() * N;
      const rx = 3 + R() * 9;
      put(px, py, rx + 2, (X, Y) => {
        x.fillStyle = rgba(lo, 0.35);
        x.beginPath();
        x.ellipse(X, Y, rx, rx * 0.45, 0, 0, TAU);
        x.fill();
        x.fillStyle = 'rgba(255,250,230,0.12)';
        x.beginPath();
        x.ellipse(X - rx * 0.2, Y - rx * 0.2, rx * 0.6, rx * 0.12, 0, 0, TAU);
        x.fill();
      });
    }
    for (let i = 0; i < 600 * k; i++) {
      x.fillStyle = rgba(R() < 0.5 ? hi : lo, 0.25);
      x.fillRect(R() * N, R() * N, 1, 1);
    }
  }
  texCache.set(key, c);
  return c;
}

function pattern(x: Ctx, img: HTMLCanvasElement, ox: number, oy: number): CanvasPattern | string {
  const p = x.createPattern(img, 'repeat');
  if (!p) return '#808080';
  p.setTransform(new DOMMatrix().translateSelf(ox, oy));
  return p;
}
/**
 * 大きさの違う2枚の模様(256px と 184px)を重ねる。周期が合わないので繰り返しが目立たない。
 * 回転・拡大した模様は1画素ずつ補間されて遅いので使わない。
 */
function texFill(x: Ctx, box: Box, theme: FieldTheme, kind: TexKind, R: () => number, second = 0.42): void {
  x.fillStyle = pattern(x, tex(theme, kind, 0), R() * TEX_N, R() * TEX_N);
  x.fillRect(box.x, box.y, box.w, box.h);
  if (second > 0) {
    x.save();
    x.globalAlpha = second;
    x.fillStyle = pattern(x, tex(theme, kind, 1), R() * TEX_N, R() * TEX_N);
    x.fillRect(box.x, box.y, box.w, box.h);
    x.restore();
  }
}

// ---------------------------------------------------------------------------
// ground: materials & masks
// ---------------------------------------------------------------------------

const G_ = 0, D_ = 1, M_ = 2, P_ = 3, S_ = 4, K_ = 5, W_ = 6, X_ = 7, C_ = 8, F_ = 9;
const DIRECT: Record<string, number> = {
  '.': G_, ',': G_, '"': G_, ':': D_, m: M_, p: P_, s: S_, '=': K_, '~': W_, o: W_, W: X_, '#': C_, T: F_,
};

interface Grid {
  cols: number;
  rows: number;
  mat: Int8Array;
  lines: string[];
  at(tx: number, ty: number): number;
  ch(tx: number, ty: number): string;
}

function gridOf(map: MapDef): Grid {
  const rows = map.rows.length;
  const cols = Math.max(...map.rows.map((r) => r.length));
  const mat = new Int8Array(cols * rows).fill(-1);
  const chAt = (tx: number, ty: number) => map.rows[ty]?.[tx] ?? '.';
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) mat[y * cols + x] = DIRECT[chAt(x, y)] ?? -1;
  // b R x r は周りの素材を受け継ぐ(崖と林床は除く)
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    const next = mat.slice();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (mat[y * cols + x] !== -1) continue;
        const cnt = new Array<number>(10).fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const m = mat[ny * cols + nx];
            if (m < 0 || m === F_ || m === C_) continue;
            cnt[m] += dx && dy ? 1 : 2;
          }
        }
        let best = -1;
        let bv = 0;
        for (let k = 0; k < 10; k++) if (cnt[k] > bv) { bv = cnt[k]; best = k; }
        if (best >= 0) { next[y * cols + x] = best; changed = true; }
      }
    }
    mat.set(next);
    if (!changed) break;
  }
  for (let i = 0; i < mat.length; i++) if (mat[i] < 0) mat[i] = G_;
  const cl = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  return {
    cols, rows, mat, lines: map.rows,
    at: (tx, ty) => mat[cl(ty, rows) * cols + cl(tx, cols)],
    ch: (tx, ty) => chAt(cl(tx, cols), cl(ty, rows)),
  };
}

/** やわらかい効果(にじみ・影・光)はこの縮小率の canvas で描いてから1回だけ拡大する */
const Q = 4;

interface Mask {
  /** くっきりした形(こぶ込み)と、そこから削るへこみ。切り抜き(clip)に使う */
  path: Path2D;
  dents: Path2D;
  box: Box;
  /** 地図全体の 1/Q の大きさの形 */
  q: HTMLCanvasElement;
  soft: Map<number, HTMLCanvasElement>;
}

/**
 * test を満たすタイルの形。外側の角を丸め、内側の角に丸い埋め(フィレット)を入れ、
 * 他の素材との境目に、縁に沿って細長いこぶ・へこみを足して手描きの縁にする。地図の外は内側と同じ扱い。
 */
function buildMask(gi: Grid, test: (tx: number, ty: number) => boolean, r: number, wob: number, R: () => number): Mask | null {
  const { cols, rows } = gi;
  const W = cols * T;
  const H = rows * T;
  const inb = (tx: number, ty: number) => test(Math.min(cols - 1, Math.max(0, tx)), Math.min(rows - 1, Math.max(0, ty)));
  const body = new Path2D();
  const bumps = new Path2D();
  const dents = new Path2D();
  let n = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const NB: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const rMax = Math.min(r, T * 0.95);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const px = tx * T;
      const py = ty * T;
      if (test(tx, ty)) {
        n++;
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px + T); y1 = Math.max(y1, py + T);
        const u = inb(tx, ty - 1);
        const d = inb(tx, ty + 1);
        const l = inb(tx - 1, ty);
        const rt = inb(tx + 1, ty);
        // corners: tl tr br bl. Two rounded corners on one side must share the side → at most T/2 each
        const cr = [!u && !l, !u && !rt, !d && !rt, !d && !l];
        const rad = cr.map((on, i) => (on ? (cr[(i + 1) % 4] || cr[(i + 3) % 4] ? Math.min(rMax, T / 2) : rMax) : 0));
        rrInto(body, px, py, px + T, py + T, rad[0], rad[1], rad[2], rad[3]);
        if (wob > 0) {
          const same = [u, d, l, rt];
          for (let k = 0; k < 4; k++) {
            if (same[k]) continue;
            const [nx, ny] = NB[k];
            const sx = nx > 0 ? px + T : px;
            const sy = ny > 0 ? py + T : py;
            const ax = ny !== 0 ? 1 : 0;
            const ay = nx !== 0 ? 1 : 0;
            const rot = ax ? 0 : Math.PI / 2;
            const cnt = 2 + Math.floor(R() * 2);
            for (let j = 0; j < cnt; j++) {
              const t = 0.12 + R() * 0.76;
              const ex = sx + ax * t * T;
              const ey = sy + ay * t * T;
              const rr = wob * (0.45 + R() * 0.6);
              const off = (R() * 0.8 - 0.35) * rr;
              addEll(bumps, ex + nx * off, ey + ny * off, rr * 1.9, rr * 0.75, rot);
            }
            if (R() < 0.8) {
              const t = 0.15 + R() * 0.7;
              const rr = wob * (0.4 + R() * 0.45);
              addEll(dents, sx + ax * t * T - nx * rr * 0.35, sy + ay * t * T - ny * rr * 0.35, rr * 1.8, rr * 0.7, rot);
            }
          }
        }
      } else if (r > 0) {
        const rf = Math.min(r * 0.9, T * 0.9);
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as Pt[]) {
          if (!(inb(tx + sx, ty) && inb(tx, ty + sy) && inb(tx + sx, ty + sy))) continue;
          const cx = px + (sx > 0 ? T : 0);
          const cy = py + (sy > 0 ? T : 0);
          body.moveTo(cx, cy);
          body.lineTo(cx - sx * rf, cy);
          body.arcTo(cx, cy, cx, cy - sy * rf, rf);
          body.closePath();
        }
      }
    }
  }
  if (!n) return null;
  const m = T;
  const bx = Math.max(0, x0 - m);
  const by = Math.max(0, y0 - m);
  const box = { x: bx, y: by, w: Math.min(W, x1 + m) - bx, h: Math.min(H, y1 + m) - by };
  body.addPath(bumps);
  const [q, qx] = mk(Math.ceil(W / Q), Math.ceil(H / Q));
  qx.scale(1 / Q, 1 / Q);
  qx.fillStyle = '#fff';
  qx.fill(body);
  qx.globalCompositeOperation = 'destination-out';
  qx.fill(dents);
  return { path: body, dents, box, q, soft: new Map() };
}

/** 3x3 のならし(加算で平均)。端は外が透明として扱われる */
function box3(src: HTMLCanvasElement, d: number): HTMLCanvasElement {
  const [c, x] = mk(src.width, src.height);
  x.globalCompositeOperation = 'lighter';
  x.globalAlpha = 1 / 9;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) x.drawImage(src, ox * d, oy * d);
  return c;
}
/**
 * マスクのぼかし(1/Q の大きさで返す)。lvl 0 ≈ 8px、1 ≈ 16px、2 ≈ 32px、3 ≈ 64px、4 ≈ 128px。
 * さらに縮小してから小さな canvas で1回ならし、元の 1/Q に拡大して戻す(拡大の補間もぼかしになる)。
 */
function blur(m: Mask, lvl: number): HTMLCanvasElement {
  if (lvl < 0) return m.q;
  const hit = m.soft.get(lvl);
  if (hit) return hit;
  let cur = m.q;
  for (let i = 0; i <= lvl; i++) {
    const [c, x] = mk(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2));
    x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  cur = box3(cur, 1);
  // keep the result at 1/(2Q): soft shapes do not need more, and tinting it is 4x cheaper
  const [c, x] = mk(Math.ceil(m.q.width / 2), Math.ceil(m.q.height / 2));
  x.drawImage(cur, 0, 0, c.width, c.height);
  m.soft.set(lvl, c);
  return c;
}

let tintTmp: [HTMLCanvasElement, Ctx] | null = null;
/** やわらかいマスクを単色に(invert = 1 - mask)。返す canvas は次の呼び出しで上書きされる */
function tintOf(src: HTMLCanvasElement, color: string, invert = false): HTMLCanvasElement {
  if (!tintTmp || tintTmp[0].width !== src.width || tintTmp[0].height !== src.height) tintTmp = mk(src.width, src.height);
  const [c, x] = tintTmp;
  x.save();
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = color;
  if (invert) {
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(src, 0, 0);
  } else {
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillRect(0, 0, c.width, c.height);
  }
  x.restore();
  return c;
}
/** 縮小 canvas o に、色を付けたやわらかいマスクを重ねる(dx, dy は実寸 px) */
function stamp(o: Ctx, src: HTMLCanvasElement, color: string, a: number, invert = false, dx = 0, dy = 0): void {
  o.save();
  o.globalAlpha = a;
  o.drawImage(tintOf(src, color, invert), dx / Q, dy / Q, o.canvas.width, o.canvas.height);
  o.restore();
}

/**
 * 素材を1つ地面に重ねる: 形で切り抜いて(clip)、box の中で paint → 縮小重ね絵 overlay を拡大して上塗り。
 * 別の canvas を経由しないので、全画面の合成は 2〜3 回で済む。
 */
function composite(g: Ctx, box: Box, paint: (x: Ctx) => void, overlay: HTMLCanvasElement | null, m: Mask): void {
  const W = g.canvas.width;
  const H = g.canvas.height;
  g.save();
  g.beginPath();
  g.rect(box.x, box.y, box.w, box.h);
  g.clip();
  g.clip(m.path);
  const notDents = new Path2D();
  notDents.rect(box.x, box.y, box.w, box.h);
  notDents.addPath(m.dents);
  g.clip(notDents, 'evenodd');
  g.save();
  paint(g);
  g.restore();
  if (overlay) g.drawImage(overlay, 0, 0, W, H);
  g.restore();
}

// ---------------------------------------------------------------------------
// ground: batched small details
// ---------------------------------------------------------------------------

interface BatchEntry { z: number; p: Path2D; fill: boolean; col: string; w: number }
function batch() {
  const m = new Map<string, BatchEntry>();
  const get = (z: number, col: string, w: number, fill: boolean): Path2D => {
    const key = `${z}|${col}|${w}|${fill ? 1 : 0}`;
    let e = m.get(key);
    if (!e) {
      e = { z, p: new Path2D(), fill, col, w };
      m.set(key, e);
    }
    return e.p;
  };
  return {
    s: (z: number, col: string, w: number) => get(z, col, w, false),
    f: (z: number, col: string) => get(z, col, 0, true),
    /** 塗りの楕円(前の図形と線でつながらないよう moveTo してから足す) */
    e: (z: number, col: string, cx: number, cy: number, rx: number, ry: number, rot = 0) => addEll(get(z, col, 0, true), cx, cy, rx, ry, rot),
    flush(x: Ctx) {
      const list = [...m.values()].sort((a, b) => a.z - b.z);
      x.save();
      x.lineCap = 'round';
      x.lineJoin = 'round';
      for (const e of list) {
        if (e.fill) {
          x.fillStyle = e.col;
          x.fill(e.p);
        } else {
          x.strokeStyle = e.col;
          x.lineWidth = e.w;
          x.stroke(e.p);
        }
      }
      x.restore();
      m.clear();
    },
  };
}
type Batch = ReturnType<typeof batch>;

function addEll(p: Path2D, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  p.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx);
  p.ellipse(cx, cy, rx, ry, rot, 0, TAU);
}
/** 草の葉1枚(根元が太く先が細い塗りの形。線で描くより速い) */
function blade(p: Path2D, x: number, y: number, h: number, lean: number, w = 1.5): void {
  p.moveTo(x - w * 0.5, y);
  p.quadraticCurveTo(x + lean * 0.25 - w * 0.3, y - h * 0.6, x + lean, y - h);
  p.quadraticCurveTo(x + lean * 0.25 + w * 0.3, y - h * 0.6, x + w * 0.5, y);
  p.closePath();
}
function tuft(b: Batch, x: number, y: number, h: number, n: number, dark: string, light: string, R: () => number, lean = 0, z = 20): void {
  for (let i = 0; i < n; i++) {
    const bx = x + (i - n / 2) * 1.7 + (R() - 0.5) * 1.6;
    const hh = h * (0.55 + R() * 0.55);
    const ln = lean + (R() - 0.5) * h * 0.55;
    blade(b.f(z + (i % 2), i % 2 ? light : dark), bx, y, hh, ln, 1.6);
  }
}
function flower(b: Batch, x: number, y: number, col: string, R: () => number, sz = 1): void {
  b.e(8, 'rgba(24,34,16,0.28)', x + 1, y + 2.2, 3.4 * sz, 1.6 * sz, 0);
  const p = b.f(30, col);
  const rot = R() * TAU;
  for (let k = 0; k < 5; k++) {
    const a = rot + (k / 5) * TAU;
    const px = x + Math.cos(a) * 1.9 * sz;
    const py = y + Math.sin(a) * 1.5 * sz;
    p.moveTo(px + 1.5 * sz, py);
    p.arc(px, py, 1.5 * sz, 0, TAU);
  }
  const c = b.f(31, '#f6d25a');
  c.moveTo(x + 0.9 * sz, y);
  c.arc(x, y, 0.9 * sz, 0, TAU);
}

// ---------------------------------------------------------------------------
// ground: renderGround
// ---------------------------------------------------------------------------

/** 地図まるごとの地面を1枚の canvas に描く(cols*TILE × rows*TILE) */
export function renderGround(map: MapDef, seed?: number): HTMLCanvasElement {
  const theme = map.theme;
  const pal = PAL[theme];
  const gi = gridOf(map);
  const { cols, rows } = gi;
  const W = cols * T;
  const H = rows * T;
  const LW = Math.ceil(W / Q);
  const LH = Math.ceil(H / Q);
  const R = rng(seed ?? hs('ground', map.id));
  const [gc, g] = mk(W, H);
  const full: Box = { x: 0, y: 0, w: W, h: H };
  const is = (...ms: number[]) => (tx: number, ty: number) => ms.includes(gi.at(tx, ty));
  const chIs = (c: string) => (tx: number, ty: number) => gi.ch(tx, ty) === c;
  const low = () => mk(LW, LH);

  const fM = buildMask(gi, is(F_), T * 0.5, 11, R);
  const mM = buildMask(gi, is(M_), T * 0.5, 10, R);
  const pM = buildMask(gi, is(P_), T * 0.5, 8, R);
  const dM = buildMask(gi, is(D_), T * 0.5, 7, R);
  const sM = buildMask(gi, is(S_), T * 0.14, 3, R);
  const wM = buildMask(gi, is(W_, X_), T * 0.9, 11, R);
  const deepM = buildMask(gi, is(X_), T * 0.9, 22, R);
  const kM = buildMask(gi, is(K_), 3, 0, R);
  const cM = buildMask(gi, is(C_), T * 0.28, 4, R);
  const xM = buildMask(gi, chIs('x'), T * 0.4, 0, R);
  const tallM = buildMask(gi, chIs('"'), T * 0.5, 9, R);
  const flowM = buildMask(gi, chIs(','), T * 0.5, 9, R);

  // --- base grass + everything soft that sits on it (one low-res layer) -------------------------
  texFill(g, full, theme, 'grass', R);
  {
    const [uc, u] = low();
    tonal(u, LW, LH, pal, R);
    if (mM) stamp(u, blur(mM, 0), mix(pal.moss, pal.grassLo, 0.45), 0.4);
    if (tallM) stamp(u, blur(tallM, 1), pal.grassLo, 0.55);
    if (flowM) stamp(u, blur(flowM, 1), pal.grassHi, 0.3);
    if (dM) stamp(u, blur(dM, 0), pal.grassLo, 0.4);
    if (pM) stamp(u, blur(pM, 0), pal.grassLo, 0.35);
    if (wM) {
      stamp(u, blur(wM, 1), dk(mix(pal.mud, pal.grassLo, 0.4), 0.25), 0.6);
      stamp(u, blur(wM, 0), lit(pal.dirt, 0.1), 0.35);
    }
    if (sM) stamp(u, blur(sM, 0), '#0a0e10', 0.45, false, 2, 5);
    if (kM) stamp(u, blur(kM, 0), '#0c0a10', 0.5, false, 5, 11);
    if (cM) stamp(u, blur(cM, 0), '#0a0a10', 0.55, false, 6, 12);
    if (xM) stamp(u, blur(xM, 1), pal.shade, 0.5, false, 0, T * 0.15);
    if (fM) {
      stamp(u, blur(fM, 0), pal.floor, 0.9);
      stamp(u, blur(fM, 1), mix(pal.floor, pal.grassLo, 0.3), 0.35);
    }
    g.drawImage(uc, 0, 0, W, H);
  }

  // --- moss (soft edge) ---------------------------------------------------------------------
  if (mM) {
    const [oc, o] = low();
    stamp(o, blur(mM, 1), pal.mossHi, 0.16);
    composite(g, mM.box, (x) => texFill(x, mM.box, theme, 'moss', R, 0), oc, mM);
  }
  // --- mud ------------------------------------------------------------------------------------
  if (pM) {
    const [oc, o] = low();
    stamp(o, blur(pM, 2), lit(pal.mud, 0.35), 0.2);
    stamp(o, blur(pM, 0), pal.mudLo, 0.5, true);
    composite(g, pM.box, (x) => texFill(x, pM.box, theme, 'mud', R, 0), oc, pM);
  }
  // --- dirt paths -----------------------------------------------------------------------------
  if (dM) {
    const [oc, o] = low();
    stamp(o, blur(dM, 1), pal.dirtHi, 0.32);
    stamp(o, blur(dM, 0), pal.dirtLo, 0.6, true);
    composite(g, dM.box, (x) => texFill(x, dM.box, theme, 'dirt', R, 0), oc, dM);
  }
  // --- stone floor ------------------------------------------------------------------------------
  if (sM) {
    const [oc, o] = low();
    stamp(o, blur(sM, 0), dk(pal.stoneLo, 0.3), 0.5, true);
    stamp(o, blur(sM, 1), pal.moss, 0.35, true);
    composite(g, sM.box, (x) => flagstones(x, sM.box, pal, theme, R, gi), oc, sM);
  }
  // --- water ----------------------------------------------------------------------------------
  if (wM) {
    const [oc, o] = low();
    for (let i = 0; i < (wM.box.w * wM.box.h) / 9000; i++) {
      const cx = (wM.box.x + R() * wM.box.w) / Q;
      const cy = (wM.box.y + R() * wM.box.h) / Q;
      const r = (30 + R() * 90) / Q;
      const col = R() < 0.5 ? pal.waterHi : pal.deep;
      o.fillStyle = radG(o, cx, cy, 0, r, [[0, rgba(col, 0.12)], [1, rgba(col, 0)]]);
      o.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    if (deepM) {
      stamp(o, blur(deepM, 2), pal.deep, 0.95);
      stamp(o, blur(deepM, 3), dk(pal.deep, 0.35), 0.6);
    }
    if (fM) stamp(o, blur(fM, 2), dk(pal.deep, 0.4), 0.45);
    {
      // mottled surface: drifting scum / duckweed rafts (marsh) or sky glints (elsewhere)
      const E = Q * 2;
      const [, d] = mk(Math.ceil(W / E), Math.ceil(H / E));
      const rafts = new Path2D();
      const nR = (wM.box.w * wM.box.h) / (theme === 'marsh' ? 5000 : 14000);
      for (let i = 0; i < nR; i++) {
        const cx = wM.box.x + R() * wM.box.w;
        const cy = wM.box.y + R() * wM.box.h;
        const k = 3 + Math.floor(R() * 5);
        for (let j = 0; j < k; j++) addEll(rafts, (cx + (R() - 0.5) * 70) / E, (cy + (R() - 0.5) * 34) / E, (8 + R() * 22) / E, (4 + R() * 9) / E);
      }
      d.fillStyle = theme === 'marsh' ? 'rgba(170,184,86,0.5)' : rgba(pal.waterHi, 0.28);
      d.fill(rafts);
      o.drawImage(box3(d.canvas, 1), 0, 0, LW, LH);
    }
    stamp(o, blur(wM, 1), pal.waterHi, theme === 'marsh' ? 0.25 : 0.45, true);
    stamp(o, blur(wM, -1), pal.foam, theme === 'marsh' ? 0.35 : 0.7, true);
    composite(g, wM.box, (x) => {
      x.fillStyle = lin(x, 0, wM.box.y, 0, wM.box.y + wM.box.h, [[0, lit(pal.water, 0.12)], [1, dk(pal.water, 0.1)]]);
      x.fillRect(wM.box.x, wM.box.y, wM.box.w, wM.box.h);
      waterSurface(x, gi, pal, theme, R);
    }, oc, wM);
  }
  // --- wooden decks ---------------------------------------------------------------------------
  if (kM) {
    composite(g, kM.box, (x) => planks(x, kM.box, pal, R), null, kM);
    deckEdges(g, gi, pal);
  }
  // --- cliffs ---------------------------------------------------------------------------------
  if (cM) {
    const [oc, o] = low();
    stamp(o, blur(cM, 0), '#000000', 0.35, true);
    composite(g, cM.box, (x) => {
      texFill(x, cM.box, theme, 'rock', R, 0);
      cliffFaces(x, gi, pal, R);
    }, oc, cM);
  }

  // --- small details ---------------------------------------------------------------------------
  details(g, gi, pal, theme, R);

  // --- shade, light & mood (low-res, one upscale each) -------------------------------------------
  themeLight(g, gi, theme, pal, R, W, H, fM);
  return gc;
}

/** 大きな色むら(繰り返し模様を隠す)。縮小 canvas に描く */
function tonal(u: Ctx, LW: number, LH: number, pal: Pal, R: () => number): void {
  const n = Math.round((LW * LH * Q * Q) / 22000);
  for (let i = 0; i < n; i++) {
    const x = R() * LW;
    const y = R() * LH;
    const r = (50 + R() * 180) / Q;
    const col = pick(R, [pal.grassHi, pal.grassLo, pal.sun, pal.grassLo, mix(pal.grass, '#6a7a8a', 0.4)]);
    const a = 0.06 + R() * 0.11;
    u.fillStyle = radG(u, x, y, 0, r, [[0, rgba(col, a)], [1, rgba(col, 0)]]);
    u.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function waterSurface(x: Ctx, gi: Grid, pal: Pal, theme: FieldTheme, R: () => number): void {
  const b = batch();
  for (let ty = 0; ty < gi.rows; ty++) {
    for (let tx = 0; tx < gi.cols; tx++) {
      const m = gi.at(tx, ty);
      if (m !== W_ && m !== X_) continue;
      const px = tx * T;
      const py = ty * T;
      const deep = m === X_;
      const n = deep ? 1 + Math.floor(R() * 2) : 1 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const cx = px + R() * T;
        const cy = py + R() * T;
        const w = 6 + R() * 12;
        const p = b.s(10, rgba(pal.waterHi, deep ? 0.18 : 0.32), 1.2);
        p.moveTo(cx - w, cy);
        p.quadraticCurveTo(cx, cy - 2.2, cx + w, cy);
        if (R() < 0.4) {
          const p2 = b.s(10, rgba(dk(pal.deep, 0.2), 0.25), 1.2);
          p2.moveTo(cx - w * 0.7, cy + 3);
          p2.quadraticCurveTo(cx, cy + 5, cx + w * 0.7, cy + 3);
        }
      }
      if (theme === 'marsh') {
        // scum and pollen film
        for (let i = 0; i < 3; i++) {
          const p = b.f(5, rgba(pick(R, ['#b8c060', '#9aa848', '#d8d080']), 0.22));
          const cx = px + R() * T;
          const cy = py + R() * T;
          addEll(p, cx, cy, 4 + R() * 8, 2 + R() * 3);
        }
        for (let i = 0; i < 5; i++) {
          const p = b.f(12, 'rgba(250,236,150,0.55)');
          const cx = px + R() * T;
          const cy = py + R() * T;
          p.moveTo(cx + 0.9, cy);
          p.arc(cx, cy, 0.9, 0, TAU);
        }
      } else if (theme === 'shrine' && R() < 0.35) {
        const p = b.f(12, 'rgba(160,255,235,0.55)');
        const cx = px + R() * T;
        const cy = py + R() * T;
        p.moveTo(cx + 1.2, cy);
        p.arc(cx, cy, 1.2, 0, TAU);
      }
    }
  }
  b.flush(x);
}

function planks(x: Ctx, box: Box, pal: Pal, R: () => number): void {
  const ph = T / 4;
  x.fillStyle = dk(pal.woodLo, 0.45);
  x.fillRect(box.x, box.y, box.w, box.h);
  const y0 = Math.floor(box.y / ph) * ph;
  for (let y = y0; y < box.y + box.h; y += ph) {
    let px = box.x - R() * T * 2;
    while (px < box.x + box.w) {
      const len = T * (1.2 + R() * 2.4);
      const tone = R();
      const base = mix(mix(pal.wood, pal.woodHi, tone * 0.5), pal.woodLo, R() * 0.35);
      x.fillStyle = lin(x, 0, y, 0, y + ph, [[0, lit(base, 0.18)], [0.5, base], [1, dk(base, 0.2)]]);
      x.fillRect(px + 1, y + 1, len - 2, ph - 2);
      // grain
      x.strokeStyle = rgba(dk(base, 0.4), 0.28);
      x.lineWidth = 0.8;
      for (let k = 0; k < 2; k++) {
        const gy = y + 3 + R() * (ph - 6);
        x.beginPath();
        x.moveTo(px + 3, gy);
        x.bezierCurveTo(px + len * 0.3, gy + (R() - 0.5) * 3, px + len * 0.6, gy + (R() - 0.5) * 3, px + len - 3, gy);
        x.stroke();
      }
      if (R() < 0.3) {
        x.fillStyle = rgba(dk(base, 0.5), 0.35);
        x.beginPath();
        x.ellipse(px + len * R(), y + ph / 2, 2.2, 1.3, 0, 0, TAU);
        x.fill();
      }
      // nails
      x.fillStyle = rgba('#2a2018', 0.6);
      x.fillRect(px + 3, y + ph / 2 - 1, 1.5, 1.5);
      x.fillRect(px + len - 5, y + ph / 2 - 1, 1.5, 1.5);
      px += len;
    }
  }
}

/** 木床の南側の厚み・柱と、北側のふちの光 */
function deckEdges(g: Ctx, gi: Grid, pal: Pal): void {
  for (let ty = 0; ty < gi.rows; ty++) {
    for (let tx = 0; tx < gi.cols; tx++) {
      if (gi.at(tx, ty) !== K_) continue;
      const px = tx * T;
      const py = ty * T;
      if (gi.at(tx, ty + 1) !== K_ && ty + 1 < gi.rows) {
        const l = gi.at(tx - 1, ty) !== K_ ? 3 : 0;
        const r = gi.at(tx + 1, ty) !== K_ ? 3 : 0;
        g.fillStyle = lin(g, 0, py + T, 0, py + T + 8, [[0, pal.woodLo], [1, dk(pal.woodLo, 0.5)]]);
        g.fillRect(px + l, py + T - 1, T - l - r, 8);
        g.fillStyle = dk(pal.woodLo, 0.55);
        for (const ox of [T * 0.15, T * 0.65]) g.fillRect(px + ox, py + T + 5, 5, 6);
        g.fillStyle = rgba(pal.woodHi, 0.5);
        g.fillRect(px + l, py + T - 1.5, T - l - r, 1.2);
      }
      if (gi.at(tx, ty - 1) !== K_) {
        g.fillStyle = rgba(lit(pal.woodHi, 0.3), 0.55);
        g.fillRect(px, py + 1, T, 1.4);
      }
      if (gi.at(tx - 1, ty) !== K_) {
        g.fillStyle = rgba(lit(pal.woodHi, 0.3), 0.35);
        g.fillRect(px + 1, py, 1.4, T);
      }
      if (gi.at(tx + 1, ty) !== K_) {
        g.fillStyle = rgba(pal.woodLo, 0.6);
        g.fillRect(px + T - 2.5, py, 2.5, T);
      }
    }
  }
}

/** 崖: 上面(岩肌に苔と草)と、南向きの高い岩壁。左は光、右は影 */
function cliffFaces(x: Ctx, gi: Grid, pal: Pal, R: () => number): void {
  const isC = (tx: number, ty: number) => gi.at(tx, ty) === C_;
  // plateau top: moss & grass cushions, light toward the upper-left
  for (let ty = 0; ty < gi.rows; ty++) {
    for (let tx = 0; tx < gi.cols; tx++) {
      if (!isC(tx, ty) || !isC(tx, ty + 1)) continue;
      const px = tx * T;
      const py = ty * T;
      for (let c = 0; c < 2; c++) {
        const ccx = px + R() * T;
        const ccy = py + R() * T;
        for (let i = 0; i < 9; i++) {
          const cx = ccx + (R() - 0.5) * 18;
          const cy = ccy + (R() - 0.5) * 12;
          const r = 2 + R() * 3;
          x.fillStyle = rgba(dk(pal.moss, 0.4), 0.55);
          x.beginPath();
          x.arc(cx + 0.8, cy + 1.2, r, 0, TAU);
          x.fill();
          x.fillStyle = mix(pal.moss, pal.mossHi, R() * 0.5);
          x.beginPath();
          x.arc(cx, cy, r, 0, TAU);
          x.fill();
          x.fillStyle = rgba(pal.mossHi, 0.5);
          x.beginPath();
          x.arc(cx - r * 0.3, cy - r * 0.35, r * 0.4, 0, TAU);
          x.fill();
        }
      }
      x.strokeStyle = rgba(pal.rockLo, 0.55);
      x.lineWidth = 1.2;
      x.beginPath();
      let cx = px + R() * T;
      let cy = py + R() * T * 0.3;
      x.moveTo(cx, cy);
      for (let k = 0; k < 3; k++) { cx += (R() - 0.5) * 18; cy += T * 0.25; x.lineTo(cx, cy); }
      x.stroke();
    }
  }
  for (let ty = 0; ty < gi.rows; ty++) {
    for (let tx = 0; tx < gi.cols; tx++) {
      if (!isC(tx, ty)) continue;
      const px = tx * T;
      const py = ty * T;
      if (!isC(tx, ty + 1)) {
        // tall south face (most of the last row), rim wobbles
        const top = py + T * 0.05;
        const pts: Pt[] = [];
        for (let i = 0; i <= 6; i++) pts.push([px - 1 + (i / 6) * (T + 2), top + (R() - 0.5) * 7]);
        const face = new Path2D();
        face.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts) face.lineTo(p[0], p[1]);
        face.lineTo(px + T + 1, py + T + 3);
        face.lineTo(px - 1, py + T + 3);
        face.closePath();
        x.fillStyle = lin(x, 0, top, 0, py + T, [[0, mix(pal.rock, pal.rockLo, 0.3)], [0.5, mix(pal.rock, pal.rockLo, 0.7)], [1, dk(pal.rockLo, 0.45)]]);
        x.fill(face);
        clipDo(x, face, () => {
          // blocky columns with lit left edges
          let cx = px - R() * 10;
          while (cx < px + T) {
            const w = 9 + R() * 12;
            x.fillStyle = rgba(pal.rockHi, 0.22);
            x.fillRect(cx, top, 2.2, T);
            x.fillStyle = rgba(dk(pal.rockLo, 0.5), 0.45);
            x.fillRect(cx + w - 1.5, top, 1.5, T);
            cx += w;
          }
          x.strokeStyle = rgba(dk(pal.rockLo, 0.5), 0.5);
          x.lineWidth = 1.2;
          for (let k = 0; k < 3; k++) {
            const sy = top + 9 + k * 12 + R() * 4;
            x.beginPath();
            x.moveTo(px - 1, sy);
            x.bezierCurveTo(px + T * 0.3, sy + (R() - 0.5) * 5, px + T * 0.7, sy + (R() - 0.5) * 5, px + T + 1, sy + (R() - 0.5) * 3);
            x.stroke();
          }
          // hanging moss from the lip
          for (let k = 0; k < 4; k++) {
            const mx = px + R() * T;
            x.fillStyle = rgba(pal.moss, 0.85);
            x.beginPath();
            x.ellipse(mx, top + 3, 3 + R() * 4, 3 + R() * 6, 0, 0, TAU);
            x.fill();
          }
          x.fillStyle = lin(x, 0, py + T - 10, 0, py + T + 3, [[0, 'rgba(10,10,16,0)'], [1, 'rgba(10,10,16,0.55)']]);
          x.fillRect(px - 1, py + T - 10, T + 2, 13);
        });
        x.strokeStyle = rgba(lit(pal.rockHi, 0.3), 0.8);
        x.lineWidth = 2;
        x.beginPath();
        x.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts) x.lineTo(p[0], p[1]);
        x.stroke();
        for (let k = 0; k < 3; k++) {
          const gx = px + R() * T;
          x.strokeStyle = rgba(pal.grassHi, 0.8);
          x.lineWidth = 1.3;
          x.beginPath();
          x.moveTo(gx, top);
          x.lineTo(gx + (R() - 0.5) * 4, top - 5 - R() * 4);
          x.stroke();
        }
      }
      if (!isC(tx - 1, ty)) {
        x.fillStyle = lin(x, px, 0, px + 10, 0, [[0, rgba(pal.rockHi, 0.55)], [1, rgba(pal.rockHi, 0)]]);
        x.fillRect(px, py, 10, T);
      }
      if (!isC(tx + 1, ty)) {
        x.fillStyle = lin(x, px + T - 14, 0, px + T, 0, [[0, rgba(pal.rockLo, 0)], [1, rgba(dk(pal.rockLo, 0.3), 0.75)]]);
        x.fillRect(px + T - 14, py, 14, T);
      }
      if (!isC(tx, ty - 1)) {
        x.fillStyle = rgba(lit(pal.rockHi, 0.3), 0.6);
        x.fillRect(px, py + 1, T, 2);
      }
    }
  }
}

/** 石畳: 行ごとにずらした不ぞろいな板石。森殿では碧く光る刻印と床の大きな環 */
function flagstones(x: Ctx, box: Box, pal: Pal, theme: FieldTheme, R: () => number, gi: Grid): void {
  x.fillStyle = mix(dk(pal.stoneLo, 0.4), pal.moss, 0.25);
  x.fillRect(box.x, box.y, box.w, box.h);
  const runes: [number, number, number, number][] = [];
  let y = box.y;
  while (y < box.y + box.h) {
    const rh = T * (0.72 + R() * 0.4);
    let px = box.x - R() * T;
    while (px < box.x + box.w) {
      const sw = T * (0.8 + R() * 0.9);
      const gap = 1.8;
      const x0 = px + gap + R() * 1.2;
      const y0 = y + gap + R() * 1.2;
      const w = sw - gap * 2 - R() * 1.5;
      const h = rh - gap * 2 - R() * 1.5;
      const base = mix(mix(pal.stone, R() < 0.5 ? pal.stoneHi : pal.stoneLo, R() * 0.45), pal.moss, R() * 0.12);
      const p = rrect(x0, y0, w, h, 3 + R() * 6);
      x.fillStyle = lin(x, x0, y0, x0 + w, y0 + h, [[0, lit(base, 0.12)], [0.5, base], [1, dk(base, 0.18)]]);
      x.fill(p);
      // bevel
      x.save();
      x.clip(p);
      x.strokeStyle = rgba(lit(base, 0.5), 0.35);
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(x0 + 1, y0 + h - 3);
      x.lineTo(x0 + 1, y0 + 1);
      x.lineTo(x0 + w - 3, y0 + 1);
      x.stroke();
      x.strokeStyle = rgba(dk(base, 0.5), 0.35);
      x.beginPath();
      x.moveTo(x0 + 3, y0 + h - 1);
      x.lineTo(x0 + w - 1, y0 + h - 1);
      x.lineTo(x0 + w - 1, y0 + 3);
      x.stroke();
      // wear spots
      for (let k = 0; k < 3; k++) {
        x.fillStyle = rgba(R() < 0.5 ? pal.stoneHi : pal.stoneLo, 0.18);
        x.beginPath();
        x.ellipse(x0 + R() * w, y0 + R() * h, 3 + R() * 7, 2 + R() * 4, R() * 3, 0, TAU);
        x.fill();
      }
      if (R() < 0.25) {
        x.strokeStyle = rgba(dk(base, 0.55), 0.55);
        x.lineWidth = 1;
        x.beginPath();
        let cx = x0 + R() * w;
        let cy = y0;
        x.moveTo(cx, cy);
        for (let k = 0; k < 3; k++) {
          cx += (R() - 0.5) * 10;
          cy += h / 3;
          x.lineTo(cx, cy);
        }
        x.stroke();
      }
      x.restore();
      if (theme === 'shrine' && R() < 0.07 && w > 26 && h > 22 && gi.at(Math.floor((x0 + w / 2) / T), Math.floor((y0 + h / 2) / T)) === S_) runes.push([x0 + w / 2, y0 + h / 2, Math.min(w, h) * 0.28, Math.floor(R() * 6)]);
      px += sw;
    }
    y += rh;
  }
  // moss in the joints
  for (let i = 0; i < (box.w * box.h) / 700; i++) {
    x.fillStyle = rgba(pick(R, [pal.moss, pal.mossHi, dk(pal.moss, 0.3)]), 0.25 + R() * 0.25);
    x.beginPath();
    x.ellipse(box.x + R() * box.w, box.y + R() * box.h, 2 + R() * 4, 1 + R() * 2, 0, 0, TAU);
    x.fill();
  }
  if (theme !== 'shrine') return;
  // big floor ring in the plaza
  let sx = 0, sy = 0, sn = 0;
  for (let ty = 0; ty < gi.rows; ty++) {
    let rowN = 0;
    for (let tx = 0; tx < gi.cols; tx++) if (gi.at(tx, ty) === S_) rowN++;
    if (rowN < 10) continue;
    for (let tx = 0; tx < gi.cols; tx++) if (gi.at(tx, ty) === S_) { sx += tx + 0.5; sy += ty + 0.5; sn++; }
  }
  if (sn > 0) {
    const cx = (sx / sn) * T;
    const cy = (sy / sn) * T;
    const rr = T * 2.7;
    x.save();
    x.strokeStyle = 'rgba(10,20,24,0.55)';
    x.lineWidth = 7;
    x.beginPath();
    x.ellipse(cx, cy, rr, rr * 0.92, 0, 0, TAU);
    x.stroke();
    x.lineWidth = 4;
    x.beginPath();
    x.ellipse(cx, cy, rr * 0.8, rr * 0.8 * 0.92, 0, 0, TAU);
    x.stroke();
    x.restore();
    runes.push([cx, cy, 0, -1]);
  }
  x.save();
  for (const [cx, cy, r, k] of runes) {
    if (k === -1) continue;
    rune(x, cx, cy, r, k, 0.9);
  }
  x.restore();
  runeGlows.push(...runes);
}
/** flagstones → themeLight に刻印の光を渡すための一時置き場(描画1回ごとに空にする) */
const runeGlows: [number, number, number, number][] = [];

function rune(x: Ctx, cx: number, cy: number, r: number, k: number, a: number): void {
  x.save();
  x.translate(cx, cy);
  x.strokeStyle = rgba(HEK, a);
  x.lineWidth = Math.max(1.3, r * 0.14);
  x.beginPath();
  switch (k) {
    case 0: x.arc(0, 0, r, 0, TAU); x.moveTo(0, -r * 1.2); x.lineTo(0, r * 1.2); break;
    case 1: x.moveTo(-r, r * 0.7); x.lineTo(0, -r); x.lineTo(r, r * 0.7); x.moveTo(-r * 0.5, r * 0.1); x.lineTo(r * 0.5, r * 0.1); break;
    case 2: x.arc(0, 0, r * 0.9, Math.PI * 0.15, Math.PI * 1.85); x.moveTo(r * 0.3, 0); x.arc(0, 0, r * 0.3, 0, TAU); break;
    case 3: x.moveTo(-r, -r); x.lineTo(r, r); x.moveTo(r, -r); x.lineTo(-r, r); x.moveTo(r * 0.5, 0); x.arc(0, 0, r * 0.5, 0, TAU); break;
    case 4: x.moveTo(-r, r); x.quadraticCurveTo(0, -r * 1.6, r, r); x.moveTo(0, -r * 0.2); x.lineTo(0, r); break;
    default: x.moveTo(-r, 0); x.lineTo(r, 0); x.moveTo(-r * 0.6, -r * 0.7); x.lineTo(r * 0.6, -r * 0.7); x.moveTo(-r * 0.6, r * 0.7); x.lineTo(r * 0.6, r * 0.7); break;
  }
  x.stroke();
  x.restore();
}

function details(g: Ctx, gi: Grid, pal: Pal, theme: FieldTheme, R: () => number): void {
  const b = batch();
  const bladeDk = dk(pal.grassLo, 0.15);
  const bladeLt = lit(pal.grassHi, 0.1);
  const dryDk = theme === 'road' ? '#6e6448' : pal.grassLo;
  const dryLt = theme === 'road' ? '#c2b384' : pal.grassHi;
  const lily = theme === 'marsh' ? ['#6e9a3c', '#8ab44a', '#5a8434'] : ['#4e8a4a', '#6aa458', '#3e7040'];
  const pads: [number, number, number, number][] = [];
  for (let ty = 0; ty < gi.rows; ty++) {
    for (let tx = 0; tx < gi.cols; tx++) {
      const c = gi.ch(tx, ty);
      const m = gi.at(tx, ty);
      const px = tx * T;
      const py = ty * T;
      const rx = () => px + 4 + R() * (T - 8);
      const ry = () => py + 6 + R() * (T - 8);
      // grass lip over neighbouring paths / mud / water
      if (m === G_ || m === M_ || m === P_) {
        const nb: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [-1, 0, 1], [1, 0, 1]];
        for (const [dx, dy] of nb) {
          const o = gi.at(tx + dx, ty + dy);
          if (m === P_ ? o !== W_ : o !== D_ && o !== P_ && o !== S_ && o !== W_) continue;
          const cnt = 1 + Math.floor(R() * (o === W_ ? 3.5 : 2.2));
          for (let i = 0; i < cnt; i++) {
            const t = 0.1 + R() * 0.8;
            let ex = px + (dx === 0 ? t * T : dx > 0 ? T : 0);
            let ey = py + (dy === 0 ? t * T : dy > 0 ? T : 0);
            ex += dx * (R() * 3);
            ey += dy * (R() * 3) + 3;
            tuft(b, ex, ey, 6 + R() * 5, 3 + Math.floor(R() * 3), theme === 'road' ? dryDk : bladeDk, theme === 'road' ? dryLt : bladeLt, R, dx * 3);
          }
        }
      }
      switch (c) {
        case '.': {
          if (R() < 0.42) tuft(b, rx(), ry(), 5 + R() * 4, 3 + Math.floor(R() * 3), theme === 'road' && R() < 0.6 ? dryDk : bladeDk, theme === 'road' && R() < 0.6 ? dryLt : bladeLt, R);
          if (R() < 0.18) {
            const cx = rx();
            const cy = ry();
            const r = 1.2 + R() * 1.6;
            b.e(6, rgba(pal.rockLo, 0.5), cx + 0.6, cy + 1, r * 1.3, r, 0);
            b.e(7, mix(pal.rock, pal.rockHi, R() * 0.5), cx, cy, r * 1.3, r, 0);
          }
          if (theme === 'village' && R() < 0.2) flower(b, rx(), ry(), pick(R, pal.flowers), R, 0.7);
          if (theme === 'forest' && R() < 0.12) clover(b, rx(), ry(), pal, R);
          if (theme === 'road' && R() < 0.3) {
            const p = b.f(9, rgba('#c8c2b8', 0.35));
            const cx = rx();
            const cy = ry();
            addEll(p, cx, cy, 4 + R() * 8, 2 + R() * 3);
          }
          if (theme === 'marsh' && R() < 0.5) {
            for (let i = 0; i < 4; i++) {
              const cx = rx();
              const cy = ry();
              b.f(40, 'rgba(250,236,140,0.7)').moveTo(cx + 1, cy);
              b.f(40, 'rgba(250,236,140,0.7)').arc(cx, cy, 1, 0, TAU);
            }
          }
          if (theme === 'shrine' && R() < 0.25) {
            const cx = rx();
            const cy = ry();
            b.f(41, 'rgba(150,255,230,0.75)').moveTo(cx + 1.1, cy);
            b.f(41, 'rgba(150,255,230,0.75)').arc(cx, cy, 1.1, 0, TAU);
          }
          break;
        }
        case ',': {
          const n = 4 + Math.floor(R() * 4);
          for (let i = 0; i < n; i++) {
            const fx = rx();
            const fy = ry();
            tuft(b, fx, fy + 2, 4, 3, bladeDk, bladeLt, R);
            flower(b, fx, fy - 2, pick(R, pal.flowers), R, theme === 'road' ? 0.7 : 0.85 + R() * 0.3);
          }
          break;
        }
        case '"': {
          const n = 7 + Math.floor(R() * 4);
          const dark = theme === 'road' ? '#5e5a3e' : dk(pal.grassLo, 0.3);
          const mid = theme === 'road' ? '#8e845a' : pal.grass;
          const light = theme === 'road' ? '#cabd8c' : lit(pal.grassHi, 0.15);
          for (let i = 0; i < n; i++) {
            const x0 = px + 3 + ((i % 4) + R()) * (T / 4.3);
            const y0 = py + 10 + Math.floor(i / 4) * 15 + R() * 8;
            b.e(4, rgba(dk(pal.grassLo, 0.5), 0.35), x0 + 1, y0 + 1, 7, 2.6, 0);
            for (let k = 0; k < 6; k++) {
              const bx = x0 + (k - 3) * 1.8;
              const h = 10 + R() * 9;
              const ln = (R() - 0.5) * 10;
              blade(b.f(24 + (k % 3), k % 3 === 0 ? dark : k % 3 === 1 ? mid : light), bx, y0, h, ln, 2);
            }
          }
          break;
        }
        case ':': {
          if (R() < 0.35) {
            const cx = rx();
            const cy = ry();
            const r = 1.4 + R() * 2;
            b.e(6, rgba(pal.dirtLo, 0.6), cx + 0.7, cy + 1.1, r * 1.3, r, 0);
            b.e(7, mix(pal.dirt, pal.dirtHi, 0.3 + R() * 0.5), cx, cy, r * 1.3, r, 0);
          }
          if (theme === 'road') {
            // tyre ruts toward the camp (east side)
            if (tx > gi.cols * 0.55) {
              const horiz = gi.at(tx - 1, ty) === D_ && gi.at(tx + 1, ty) === D_;
              const vert = gi.at(tx, ty - 1) === D_ && gi.at(tx, ty + 1) === D_;
              const p = b.s(3, 'rgba(60,50,44,0.13)', 2.6);
              const j = () => (R() - 0.5) * 3;
              if (horiz && !vert && R() < 0.75) {
                for (const o of [0.36, 0.64]) { p.moveTo(px, py + T * o + j()); p.quadraticCurveTo(px + T / 2, py + T * o + j(), px + T, py + T * o + j()); }
              } else if (vert && !horiz && R() < 0.75) {
                for (const o of [0.36, 0.64]) { p.moveTo(px + T * o + j(), py); p.quadraticCurveTo(px + T * o + j(), py + T / 2, px + T * o + j(), py + T); }
              }
            }
          }
          if (theme === 'forest' && R() < 0.12) fallenLeaf(b, rx(), ry(), R, ['#b8883a', '#8a6a2e', '#c8a048']);
          if (theme === 'village' && R() < 0.1) fallenLeaf(b, rx(), ry(), R, ['#e8b04a', '#d88040', '#c8a048']);
          break;
        }
        case 'm': {
          const n = 2 + Math.floor(R() * 3);
          for (let i = 0; i < n; i++) {
            const cx = rx();
            const cy = ry();
            const r = 3 + R() * 4;
            b.e(12, rgba(dk(pal.moss, 0.4), 0.4), cx + 1, cy + 1.5, r, r * 0.75, 0);
            b.e(13, mix(pal.moss, pal.mossHi, 0.3 + R() * 0.4), cx, cy, r, r * 0.75, 0);
            b.e(14, rgba(lit(pal.mossHi, 0.3), 0.6), cx - r * 0.3, cy - r * 0.3, r * 0.4, r * 0.28, 0);
          }
          if (theme === 'shrine' && R() < 0.4) {
            const cx = rx();
            const cy = ry();
            b.f(41, 'rgba(150,255,230,0.85)').moveTo(cx + 1.3, cy);
            b.f(41, 'rgba(150,255,230,0.85)').arc(cx, cy, 1.3, 0, TAU);
          }
          break;
        }
        case 'p': {
          if (R() < 0.35) {
            // small puddle
            const cx = rx();
            const cy = ry();
            const w = 5 + R() * 8;
            b.e(5, rgba(dk(pal.mudLo, 0.3), 0.55), cx, cy, w, w * 0.45, 0);
            b.e(6, rgba(mix(pal.water, pal.waterHi, 0.4), 0.55), cx - 0.5, cy - 0.5, w * 0.8, w * 0.3, 0);
          }
          if (R() < 0.3) tuft(b, rx(), ry(), 6, 4, dk(pal.grassLo, 0.2), pal.grassHi, R);
          if (theme === 'marsh') {
            for (let i = 0; i < 3; i++) {
              const cx = rx();
              const cy = ry();
              b.f(40, 'rgba(250,236,140,0.6)').moveTo(cx + 1, cy);
              b.f(40, 'rgba(250,236,140,0.6)').arc(cx, cy, 1, 0, TAU);
            }
          }
          break;
        }
        case 'r': {
          const n = 7 + Math.floor(R() * 5);
          for (let i = 0; i < n; i++) {
            const bx = px + 5 + R() * (T - 10);
            const by = py + 12 + R() * (T - 12);
            const h = 18 + R() * 20;
            const ln = (R() - 0.5) * 8;
            b.e(3, rgba(dk(pal.mudLo, 0.3), 0.3), bx + 2, by + 1, 4, 1.8, 0);
            blade(b.f(26, pick(R, ['#6a7a36', '#8a9a48', '#5a6a30'])), bx, by, h, ln, 2.2);
            if (R() < 0.5) {
              const hx = bx + ln * 0.85;
              const hy = by - h * 0.85;
              b.e(28, '#6e4a2a', hx, hy, 1.9, 4.2, ln * 0.03);
              b.e(29, 'rgba(255,220,170,0.35)', hx - 0.6, hy - 1.2, 0.7, 1.8, 0);
            } else {
              blade(b.f(27, '#a8b460'), bx + 2, by, h * 0.8, ln + 6, 1.6);
            }
          }
          break;
        }
        case 'o': {
          const n = 2 + Math.floor(R() * 2);
          for (let i = 0; i < n; i++) pads.push([px + T * (0.3 + R() * 0.4), py + T * (0.3 + R() * 0.45), T * (0.26 + R() * 0.12), R() * TAU]);
          break;
        }
        case '~': {
          if (theme === 'marsh' && R() < 0.2) pads.push([rx(), ry(), T * (0.12 + R() * 0.08), R() * TAU]);
          break;
        }
        case 'T': {
          if (R() < 0.35) {
            const cx = rx();
            const cy = ry();
            fern(b, cx, cy, dk(pal.grassLo, 0.35), R);
          }
          break;
        }
        default:
          break;
      }
      // road: ash and dead patches near the camp
      if (theme === 'road' && (m === G_ || m === D_) && R() < 0.25) {
        const cx = rx();
        const cy = ry();
        b.e(2, rgba('#b4aea6', 0.18), cx, cy, 6 + R() * 10, 3 + R() * 4, R() * 3);
      }
    }
  }
  b.flush(g);
  // lily pads need gradients: drawn one by one
  for (const [cx, cy, r, a] of pads) lilyPad(g, cx, cy, r, a, lily, R, theme);
}

function clover(b: Batch, x: number, y: number, pal: Pal, R: () => number): void {
  const col = mix(pal.grass, pal.grassHi, 0.6);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + R();
    const p = b.f(15, col);
    const cx = x + Math.cos(a) * 2;
    const cy = y + Math.sin(a) * 1.6;
    p.moveTo(cx + 2, cy);
    p.arc(cx, cy, 2, 0, TAU);
  }
}
function fallenLeaf(b: Batch, x: number, y: number, R: () => number, cols: string[]): void {
  b.e(16, pick(R, cols), x, y, 3, 1.5, R() * TAU);
}
function fern(b: Batch, x: number, y: number, col: string, R: () => number): void {
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k - 2) * 0.55 + (R() - 0.5) * 0.2;
    const l = 8 + R() * 6;
    const p = b.s(18, col, 2.2);
    p.moveTo(x, y);
    p.quadraticCurveTo(x + Math.cos(a) * l * 0.6, y + Math.sin(a) * l * 0.4 - 2, x + Math.cos(a) * l, y + Math.sin(a) * l * 0.6);
  }
}
function lilyPad(g: Ctx, cx: number, cy: number, r: number, a: number, cols: string[], R: () => number, theme: FieldTheme): void {
  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.72);
  g.fillStyle = 'rgba(10,20,20,0.3)';
  g.beginPath();
  g.arc(2, 3, r, 0, TAU);
  g.fill();
  const p = new Path2D();
  p.moveTo(0, 0);
  p.arc(0, 0, r, a + 0.28, a - 0.28 + TAU);
  p.closePath();
  const base = pick(R, cols);
  g.fillStyle = radG(g, -r * 0.3, -r * 0.3, 0, r * 1.3, [[0, lit(base, 0.3)], [0.6, base], [1, dk(base, 0.35)]]);
  g.fill(p);
  g.strokeStyle = rgba(dk(base, 0.5), 0.5);
  g.lineWidth = 1;
  g.stroke(p);
  g.strokeStyle = rgba(lit(base, 0.4), 0.45);
  g.lineWidth = 0.9;
  for (let k = 0; k < 6; k++) {
    const aa = a + 0.5 + (k / 6) * (TAU - 1);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(aa) * r * 0.85, Math.sin(aa) * r * 0.85);
    g.stroke();
  }
  g.restore();
  if (R() < (theme === 'marsh' ? 0.25 : 0.18) && r > T * 0.2) {
    const fx = cx + (R() - 0.5) * r * 0.6;
    const fy = cy - 2;
    const col = theme === 'marsh' ? '#fff2b0' : '#f8c8d8';
    for (let k = 0; k < 6; k++) {
      const aa = (k / 6) * TAU;
      g.fillStyle = k % 2 ? lit(col, 0.4) : col;
      g.beginPath();
      g.ellipse(fx + Math.cos(aa) * 3, fy + Math.sin(aa) * 2, 3.2, 1.7, aa, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#f4d050';
    g.beginPath();
    g.arc(fx, fy, 1.6, 0, TAU);
    g.fill();
  }
}

/**
 * 地域の光と空気。縮小 canvas 3枚(影 = 通常合成 / 光 = soft-light / 地域の特殊合成)を
 * それぞれ1回だけ拡大して重ねる。
 */
function themeLight(g: Ctx, gi: Grid, theme: FieldTheme, pal: Pal, R: () => number, W: number, H: number, fM: Mask | null): void {
  const LW = Math.ceil(W / Q);
  const LH = Math.ceil(H / Q);
  const openAt = (x: number, y: number) => gi.at(Math.floor(x / T), Math.floor(y / T)) !== F_;
  const [pc, p] = mk(LW, LH);
  const [lc, l] = mk(LW, LH);
  const lp = (c: Ctx, x: number, y: number, r: number, col: string, a: number) => pool(c, x / Q, y / Q, r / Q, col, a);
  const grad = (c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => {
    c.fillStyle = lin(c, x0 / Q, y0 / Q, x1 / Q, y1 / Q, stops);
    c.fillRect(0, 0, LW, LH);
  };
  // forest edge: ambient occlusion + the canopy's shadow falling south-east
  if (fM) {
    stamp(p, blur(fM, 2), pal.shade, 0.55);
    stamp(p, blur(fM, 2), pal.shade, 0.3, false, T * 0.2, T * 0.6);
  }
  let special: (() => void) | null = null;
  if (theme === 'village') {
    grad(l, 0, 0, W, H, [[0, 'rgba(255,214,140,0.75)'], [0.55, 'rgba(255,226,170,0.28)'], [1, 'rgba(90,80,150,0.4)']]);
    for (let i = 0; i < (W * H) / 90000; i++) {
      const x = R() * W;
      const y = R() * H;
      if (openAt(x, y)) lp(l, x, y, 60 + R() * 90, pal.sun, 0.35 + R() * 0.2);
    }
  } else if (theme === 'forest') {
    grad(l, 0, 0, W * 0.6, H, [[0, 'rgba(250,255,200,0.5)'], [1, 'rgba(20,60,50,0.45)']]);
    // dappled light through the canopy: many solid spots on a tiny canvas, blurred, then enlarged
    const E = Q * 2;
    const [, d] = mk(Math.ceil(W / E), Math.ceil(H / E));
    const spots = new Path2D();
    const shadeP = new Path2D();
    for (let i = 0; i < (W * H) / 5200; i++) {
      const x = R() * W;
      const y = R() * H;
      if (!openAt(x, y)) continue;
      const r = (R() < 0.25 ? 26 + R() * 30 : 7 + R() * 10) / E;
      addEll(spots, x / E, y / E, r, r * 0.6);
    }
    for (let i = 0; i < (W * H) / 16000; i++) {
      const r = (22 + R() * 40) / E;
      addEll(shadeP, (R() * W) / E, (R() * H) / E, r, r * 0.6);
    }
    d.fillStyle = rgba(pal.sun, 0.55);
    d.fill(spots);
    const soft = box3(d.canvas, 1);
    l.drawImage(soft, 0, 0, LW, LH);
    d.clearRect(0, 0, d.canvas.width, d.canvas.height);
    d.fillStyle = rgba(pal.shade, 0.16);
    d.fill(shadeP);
    p.drawImage(box3(d.canvas, 1), 0, 0, LW, LH);
  } else if (theme === 'road') {
    // drain the colour, harder near the 灰星局 camp (x footprints)
    let cx = W * 0.75, cy = H * 0.45, n = 0, sx = 0, sy = 0;
    for (let ty = 0; ty < gi.rows; ty++) for (let tx = 0; tx < gi.cols; tx++) if (gi.ch(tx, ty) === 'x') { sx += tx; sy += ty; n++; }
    if (n) { cx = (sx / n + 0.5) * T; cy = (sy / n + 0.5) * T; }
    p.fillStyle = radG(p, cx / Q, cy / Q, 0, (T * 11) / Q, [[0, 'rgba(184,176,168,0.36)'], [1, 'rgba(184,176,168,0)']]);
    p.fillRect(0, 0, LW, LH);
    for (let i = 0; i < 16; i++) {
      const a = R() * TAU;
      const d = T * (1 + R() * 8);
      lp(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, 14 + R() * 26, '#2a2420', 0.24);
    }
    grad(l, 0, 0, W, H, [[0, 'rgba(255,200,150,0.45)'], [1, 'rgba(60,50,60,0.4)']]);
    const [dc, d] = mk(LW, LH);
    d.fillStyle = 'rgba(128,128,128,0.2)';
    d.fillRect(0, 0, LW, LH);
    d.fillStyle = radG(d, cx / Q, cy / Q, 0, (T * 13) / Q, [[0, 'rgba(128,128,128,0.72)'], [0.6, 'rgba(128,128,128,0.35)'], [1, 'rgba(128,128,128,0)']]);
    d.fillRect(0, 0, LW, LH);
    special = () => {
      g.save();
      g.globalCompositeOperation = 'saturation';
      g.drawImage(dc, 0, 0, W, H);
      g.restore();
    };
  } else if (theme === 'marsh') {
    grad(l, 0, 0, 0, H, [[0, 'rgba(255,244,160,0.65)'], [1, 'rgba(200,210,120,0.45)']]);
    for (let i = 0; i < (W * H) / 60000; i++) lp(l, R() * W, R() * H, 90 + R() * 160, '#fff6c0', 0.35);
  } else {
    p.fillStyle = radG(p, LW / 2, LH * 0.45, Math.min(LW, LH) * 0.3, Math.max(LW, LH) * 0.7, [[0, 'rgba(4,14,16,0)'], [1, 'rgba(4,14,16,0.55)']]);
    p.fillRect(0, 0, LW, LH);
    for (let i = 0; i < (W * H) / 40000; i++) {
      const x = R() * W;
      const y = R() * H;
      if (openAt(x, y)) lp(l, x, y, 40 + R() * 70, '#9ff0dc', 0.3);
    }
    special = () => {
      g.save();
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = 'rgba(150,196,196,0.55)';
      g.fillRect(0, 0, W, H);
      g.restore();
    };
  }
  special?.();
  g.drawImage(pc, 0, 0, W, H);
  g.save();
  g.globalCompositeOperation = 'soft-light';
  g.drawImage(lc, 0, 0, W, H);
  g.restore();
  // shrine rune glow (collected by flagstones)
  if (runeGlows.length) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [cx, cy, r, k] of runeGlows) {
      if (k === -1) {
        const rr = T * 2.7;
        g.shadowColor = HEK;
        g.shadowBlur = 12;
        g.strokeStyle = 'rgba(62,224,200,0.55)';
        g.lineWidth = 2.2;
        g.beginPath();
        g.ellipse(cx, cy, rr, rr * 0.92, 0, 0, TAU);
        g.stroke();
        g.strokeStyle = 'rgba(62,224,200,0.35)';
        g.beginPath();
        g.ellipse(cx, cy, rr * 0.8, rr * 0.8 * 0.92, 0, 0, TAU);
        g.stroke();
        g.shadowBlur = 0;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          rune(g, cx + Math.cos(a) * rr * 0.9, cy + Math.sin(a) * rr * 0.9 * 0.92, 4.5, i % 6, 0.6);
        }
        glow(g, cx, cy, rr * 1.2, HEK, 0.12);
        continue;
      }
      glow(g, cx, cy, r * 3.2, HEK, 0.35);
      rune(g, cx, cy, r, k, 0.55);
    }
    g.restore();
    runeGlows.length = 0;
  }
}
function pool(g: Ctx, x: number, y: number, r: number, col: string, a: number): void {
  g.save();
  g.translate(x, y);
  g.scale(1, 0.6);
  g.fillStyle = radG(g, 0, 0, 0, r, [[0, rgba(col, a)], [0.5, rgba(col, a * 0.55)], [1, rgba(col, 0)]]);
  g.fillRect(-r, -r, r * 2, r * 2);
  g.restore();
}

// ---------------------------------------------------------------------------
// trees
// ---------------------------------------------------------------------------

/** 地域ごとの木の種類の数(variant はこの数で割った余りを使う) */
export const TREE_VARIANTS: Record<FieldTheme, number> = { village: 4, forest: 5, road: 4, marsh: 4, shrine: 4 };

const LEAVES: Record<FieldTheme, [string, string, string][]> = {
  village: [['#2e5634', '#5a8a46', '#b0c86c'], ['#3a5a2e', '#6e9440', '#cfca6a'], ['#2c5436', '#4e8248', '#98c070'], ['#34583a', '#5e8c50', '#aaca7c']],
  forest: [['#163c2c', '#2e6a3e', '#74a84e'], ['#113834', '#255e4e', '#62a072'], ['#22502c', '#488238', '#a0c858'], ['#15382a', '#2b5e38', '#66944a'], ['#1a4430', '#367444', '#80b25a']],
  road: [['#3a3a2c', '#5c5a42', '#8e8a62'], ['#3c382e', '#625a44', '#948a66'], ['#343a30', '#555e46', '#868c68'], ['#3a3a2c', '#5e5c40', '#948e60']],
  marsh: [['#3e5a26', '#6a8a34', '#b6c45c'], ['#465e24', '#7a9438', '#cacc64'], ['#34522a', '#5c8038', '#a0bc5c'], ['#4a5a28', '#7e8e3c', '#cec86c']],
  shrine: [['#0d2a28', '#1c4e44', '#3f8a70'], ['#0f2e2c', '#22564c', '#4a9480'], ['#0b2624', '#194840', '#366e5e'], ['#11302a', '#255846', '#4e8e6a']],
};

/** 背の高い木(幹の根元が foot)。密に並べると森の壁になるよう、樹冠は横に広く下がふくらむ */
export function drawTree(theme: FieldTheme, variant: number): FieldSprite {
  const n = TREE_VARIANTS[theme];
  const v = ((Math.floor(variant) % n) + n) % n;
  return cached(`tree|${theme}|${v}`, () => {
    const R = rng(hs('tree', theme, v));
    if (theme === 'marsh') return willow(v, R);
    if (theme === 'shrine') return cedar(v, R);
    if (theme === 'road' && v === 3) return deadTree(R);
    return broadleaf(theme, v, R);
  });
}

function clumpPath(cx: number, cy: number, r: number, R: () => number, flatY = 1): Path2D {
  const p = new Path2D();
  p.ellipse(cx, cy, r * 0.84, r * 0.84 * flatY, 0, 0, TAU);
  const n = 9 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + R() * 0.3;
    const rr = r * (0.22 + R() * 0.12);
    const px = cx + Math.cos(a) * (r - rr * 0.9);
    const py = cy + Math.sin(a) * (r - rr * 0.9) * flatY;
    p.moveTo(px + rr, py);
    p.arc(px, py, rr, 0, TAU);
  }
  return p;
}

interface ClumpOpt {
  cols: [string, string, string];
  sun?: string;
  dots?: { col: string; n: number; r: number; glow?: boolean }[];
  flatY?: number;
  shadowA?: number;
}

/** 葉の塊の集まりを1枚の層に描く(後ろ=上から順に。前の塊が後ろに影を落とす) */
function paintCanopy(x: Ctx, W: number, H: number, cl: [number, number, number][], R: () => number, o: ClumpOpt): void {
  const [lc, l] = mk(W, H);
  const [dark, mid, light] = o.cols;
  const flatY = o.flatY ?? 1;
  cl.sort((a, b) => a[1] - b[1]);
  const paths = cl.map(([cx, cy, r]) => clumpPath(cx, cy, r, R, flatY));
  const union = new Path2D();
  for (const p of paths) union.addPath(p);
  l.fillStyle = dark;
  l.fill(union);
  cl.forEach(([cx, cy, r], i) => {
    const p = paths[i];
    const tone = R();
    const c0 = mix(light, mid, tone * 0.35);
    l.save();
    l.shadowColor = rgba(dk(dark, 0.5), o.shadowA ?? 0.6);
    l.shadowBlur = 7;
    l.shadowOffsetY = 3;
    l.fillStyle = radG(l, cx, cy, r * 0.05, r * 1.25, [[0, c0], [0.42, mid], [1, dark]], cx - r * 0.38, cy - r * 0.5);
    l.fill(p);
    l.restore();
    clipDo(l, p, () => {
      for (let k = 0; k < 16; k++) {
        const a = R() * TAU;
        const d = Math.sqrt(R()) * r;
        const lx = cx + Math.cos(a) * d;
        const ly = cy + Math.sin(a) * d * flatY;
        const up = (cx - lx) * 0.6 + (cy - ly);
        const isLit = up > 0;
        l.fillStyle = isLit ? rgba(lit(light, 0.25), 0.4 + R() * 0.3) : rgba(dk(dark, 0.2), 0.35);
        l.beginPath();
        l.ellipse(lx, ly, 2 + R() * 2.4, 1.2 + R() * 1.2, R() * TAU, 0, TAU);
        l.fill();
      }
    });
  });
  // overall light: warm top, cool dark underside
  l.save();
  l.globalCompositeOperation = 'source-atop';
  let top = Infinity, bot = -Infinity;
  for (const [, cy, r] of cl) { top = Math.min(top, cy - r); bot = Math.max(bot, cy + r); }
  l.fillStyle = lin(l, 0, top, 0, bot, [[0, rgba(o.sun ?? '#fff2c0', 0.16)], [0.5, 'rgba(0,0,0,0)'], [1, rgba(dk(dark, 0.6), 0.45)]]);
  l.fillRect(0, 0, W, H);
  l.restore();
  for (const d of o.dots ?? []) {
    for (let i = 0; i < d.n; i++) {
      const c = cl[Math.floor(R() * cl.length)];
      const a = R() * TAU;
      const rr = Math.sqrt(R()) * c[2] * 0.9;
      const px = c[0] + Math.cos(a) * rr;
      const py = c[1] + Math.sin(a) * rr * flatY - c[2] * 0.15;
      if (d.glow) glow(l, px, py, d.r * 4, d.col, 0.5);
      l.fillStyle = d.col;
      l.beginPath();
      l.arc(px, py, d.r * (0.7 + R() * 0.5), 0, TAU);
      l.fill();
      l.fillStyle = rgba('#ffffff', 0.4);
      l.beginPath();
      l.arc(px - d.r * 0.3, py - d.r * 0.3, d.r * 0.35, 0, TAU);
      l.fill();
    }
  }
  x.save();
  x.shadowColor = 'rgba(16,12,24,0.6)';
  x.shadowBlur = 2;
  x.drawImage(lc, 0, 0);
  x.restore();
}

function trunkPath(fx: number, fy: number, w: number, h: number, lean: number): Path2D {
  const p = new Path2D();
  p.moveTo(fx - w * 1.15, fy + 1);
  p.quadraticCurveTo(fx - w * 0.55, fy - w * 0.15, fx - w * 0.5 + lean * 0.3, fy - h * 0.45);
  p.lineTo(fx - w * 0.42 + lean, fy - h);
  p.lineTo(fx + w * 0.42 + lean, fy - h);
  p.lineTo(fx + w * 0.5 + lean * 0.3, fy - h * 0.45);
  p.quadraticCurveTo(fx + w * 0.55, fy - w * 0.15, fx + w * 1.2, fy + 1);
  p.quadraticCurveTo(fx + w * 0.4, fy - w * 0.1, fx + w * 0.1, fy + 2);
  p.quadraticCurveTo(fx - w * 0.3, fy - w * 0.12, fx - w * 1.15, fy + 1);
  p.closePath();
  return p;
}
function paintTrunk(x: Ctx, fx: number, fy: number, w: number, h: number, lean: number, bark: string, R: () => number, moss?: string): void {
  const p = trunkPath(fx, fy, w, h, lean);
  x.fillStyle = lin(x, fx - w, 0, fx + w, 0, [[0, lit(bark, 0.3)], [0.4, bark], [1, dk(bark, 0.5)]]);
  x.fill(p);
  clipDo(x, p, () => {
    x.strokeStyle = rgba(dk(bark, 0.55), 0.45);
    x.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const bx = fx - w * 0.4 + (i / 4) * w * 0.8;
      x.beginPath();
      x.moveTo(bx + lean, fy - h);
      x.quadraticCurveTo(bx + (R() - 0.5) * 3, fy - h * 0.5, bx + (bx - fx) * 0.8, fy);
      x.stroke();
    }
    if (moss) {
      x.fillStyle = rgba(moss, 0.7);
      for (let i = 0; i < 6; i++) {
        x.beginPath();
        x.ellipse(fx - w * 0.3 + (R() - 0.5) * w * 0.6, fy - R() * h * 0.8, 2 + R() * 3, 3 + R() * 4, 0, 0, TAU);
        x.fill();
      }
    }
    // dark base where the canopy shades it
    x.fillStyle = lin(x, 0, fy - h, 0, fy - h * 0.4, [[0, 'rgba(10,10,20,0.55)'], [1, 'rgba(10,10,20,0)']]);
    x.fillRect(fx - w * 2, fy - h, w * 4, h);
  });
  ink(x, p, 1, 'rgba(30,20,20,0.6)');
}

function broadleaf(theme: FieldTheme, v: number, R: () => number): FieldSprite {
  const W = Math.round(T * 2.5);
  const H = Math.round(T * 3.5);
  const [c, x] = mk(W, H);
  const fx = W / 2;
  const fy = H - Math.round(T * 0.38);
  const pal = PAL[theme];
  const cols = LEAVES[theme][v];
  const sparse = theme === 'road';
  shadowE(x, fx + 5, fy - 1, T * 1.0, T * 0.36, 0.5);
  const lean = (R() - 0.5) * 4;
  paintTrunk(x, fx, fy, T * 0.3, T * 1.5, lean, theme === 'village' && v === 1 ? '#7a5a40' : pal.bark, R, theme === 'forest' && v === 3 ? '#6a8a3a' : undefined);
  // main limbs into the crown
  for (const s of [-1, 1]) {
    line(x, [[fx + lean, fy - T * 1.2], [fx + s * T * 0.35, fy - T * 1.65], [fx + s * T * 0.6, fy - T * 2.05]], dk(pal.bark, 0.2), 4);
  }
  const cx = fx + (R() - 0.5) * T * 0.12;
  const cy = fy - T * 1.95;
  const rx = T * (0.95 + R() * 0.1) * (sparse ? 0.95 : 1);
  const ry = T * (0.8 + R() * 0.1);
  const cl: [number, number, number][] = [];
  const sz = sparse ? 0.85 : 1;
  for (let i = 0; i < 4; i++) {
    const t = i / 3 - 0.5;
    cl.push([cx + t * rx * 1.4 + (R() - 0.5) * 5, cy + ry * 0.45 + (R() - 0.5) * 5 - Math.abs(t) * ry * 0.35, T * (0.34 + R() * 0.08) * sz]);
  }
  for (let i = 0; i < 4; i++) {
    const t = i / 3 - 0.5;
    cl.push([cx + t * rx * 1.25 + (R() - 0.5) * 6, cy + (R() - 0.5) * 8, T * (0.38 + R() * 0.1) * sz]);
  }
  for (let i = 0; i < 3; i++) {
    const t = i / 2 - 0.5;
    cl.push([cx + t * rx * 0.8 + (R() - 0.5) * 6, cy - ry * 0.45 + Math.abs(t) * ry * 0.3, T * (0.36 + R() * 0.1) * sz]);
  }
  cl.push([cx + (R() - 0.5) * 8, cy - ry * 0.72, T * (0.32 + R() * 0.08) * sz]);
  if (sparse) {
    // withered: drop a few clumps so branches show through
    for (let i = 0; i < 3; i++) cl.splice(Math.floor(R() * cl.length), 1);
    for (const s of [-1, 1]) {
      branch(x, fx + s * T * 0.3, fy - T * 1.8, -Math.PI / 2 + s * 0.8, T * 0.62, 3.2, 1, R, pal.bark);
    }
  }
  const dots: ClumpOpt['dots'] = [];
  if (theme === 'village' && v === 1) dots.push({ col: '#e8c050', n: 16, r: 2.2 }, { col: '#d88a3a', n: 6, r: 2 });
  if (theme === 'village' && v === 2) dots.push({ col: '#f6d0dc', n: 34, r: 2.1 }, { col: '#fff4f4', n: 14, r: 1.8 });
  if (theme === 'forest' && v === 2) dots.push({ col: '#c43a3a', n: 7, r: 1.8 });
  if (theme === 'road') dots.push({ col: '#a88a54', n: 10, r: 2 });
  paintCanopy(x, W, H, cl, R, { cols, sun: pal.sun });
  if (theme === 'forest' && v === 3) {
    // hanging moss
    for (let i = 0; i < 9; i++) {
      const sx = cx + (R() - 0.5) * rx * 1.6;
      const sy = cy + ry * 0.2 + R() * ry * 0.4;
      line(x, [[sx, sy], [sx + (R() - 0.5) * 3, sy + 8 + R() * 10]], rgba('#9ab86a', 0.7), 2);
    }
  }
  return { canvas: c, footX: fx, footY: fy };
}

function branch(x: Ctx, x0: number, y0: number, a: number, len: number, w: number, depth: number, R: () => number, bark: string): void {
  const x1 = x0 + Math.cos(a) * len;
  const y1 = y0 + Math.sin(a) * len;
  const mx = (x0 + x1) / 2 + (R() - 0.5) * len * 0.25;
  const my = (y0 + y1) / 2 + (R() - 0.5) * len * 0.15;
  const p = new Path2D();
  p.moveTo(x0, y0);
  p.quadraticCurveTo(mx, my, x1, y1);
  stroke(x, p, dk(bark, 0.35), w + 1.2);
  stroke(x, p, bark, w);
  x.save();
  x.translate(-w * 0.2, -w * 0.25);
  stroke(x, p, rgba(lit(bark, 0.4), 0.5), Math.max(0.6, w * 0.35));
  x.restore();
  if (depth <= 0) return;
  const k = 2 + (R() < 0.35 ? 1 : 0);
  for (let i = 0; i < k; i++) {
    const na = a + (i - (k - 1) / 2) * (0.5 + R() * 0.3) + (R() - 0.5) * 0.2;
    branch(x, x1, y1, na, len * (0.62 + R() * 0.15), Math.max(0.8, w * 0.62), depth - 1, R, bark);
  }
}

function deadTree(R: () => number): FieldSprite {
  const W = Math.round(T * 2.4);
  const H = Math.round(T * 3.4);
  const [c, x] = mk(W, H);
  const fx = W / 2;
  const fy = H - Math.round(T * 0.35);
  const bark = '#5e5650';
  shadowE(x, fx + 5, fy - 1, T * 0.8, T * 0.3, 0.45);
  paintTrunk(x, fx, fy, T * 0.3, T * 1.9, 2, bark, R);
  for (const [a, l, w] of [[-2.2, 0.8, 4.5], [-1.0, 0.85, 4.5], [-1.6, 0.75, 4], [-2.7, 0.45, 3], [-0.4, 0.5, 3]] as [number, number, number][]) {
    branch(x, fx + 1 + Math.cos(a) * 3, fy - T * 1.75 + (R() - 0.5) * 6, a, T * l, w, 1, R, bark);
  }
  // scorched base + a few ember cracks
  x.save();
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = lin(x, 0, fy - T * 0.9, 0, fy, [[0, 'rgba(20,16,16,0)'], [1, 'rgba(20,16,16,0.6)']]);
  x.fillRect(0, 0, W, H);
  x.restore();
  return { canvas: c, footX: fx, footY: fy };
}

function willow(v: number, R: () => number): FieldSprite {
  const W = Math.round(T * 2.6);
  const H = Math.round(T * 3.4);
  const [c, x] = mk(W, H);
  const fx = W / 2;
  const fy = H - Math.round(T * 0.38);
  const cols = LEAVES.marsh[v];
  shadowE(x, fx + 5, fy - 1, T * 1.1, T * 0.38, 0.45);
  const lean = (R() - 0.5) * 10;
  // back strands (darker)
  const cx = fx + lean * 0.6;
  const cy = fy - T * 2.05;
  const rx = T * 1.05;
  /** 枝垂れる葉の房(数本の細い帯+葉の点)。front は樹冠の下縁から、後ろは左右の外側に */
  const tresses = (n: number, col: string[], a: number, front: boolean) => {
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n - 0.5 + (R() - 0.5) * 0.08;
      const sx0 = cx + u * rx * (front ? 1.7 : 2.05);
      const sy0 = cy + T * (front ? 0.3 : 0.05) - Math.abs(u) * T * 0.35 + R() * T * 0.12;
      const len = T * (front ? 0.45 + R() * 0.55 : 0.8 + R() * 0.6) * (1 - Math.abs(u) * 0.4);
      const k = 3 + Math.floor(R() * 3);
      for (let j = 0; j < k; j++) {
        const sx = sx0 + (j - k / 2) * 2.2;
        const l = len * (0.7 + R() * 0.35);
        const sway = (R() - 0.5) * 5 + u * 6;
        const col0 = pick(R, col);
        const p = smooth([[sx, sy0], [sx + sway * 0.4, sy0 + l * 0.5], [sx + sway, sy0 + l]], false);
        stroke(x, p, rgba(col0, a), 1.3 + R() * 0.8);
        x.fillStyle = rgba(lit(col0, 0.15), a);
        for (let t = 0.25; t < 1; t += 0.18) {
          const lx = sx + sway * t * t;
          const ly = sy0 + l * t;
          x.beginPath();
          x.ellipse(lx + (j % 2 ? 1.5 : -1.5), ly, 1.9, 1.1, j % 2 ? 0.6 : -0.6, 0, TAU);
          x.fill();
        }
      }
    }
  };
  tresses(8, [cols[0], dk(cols[1], 0.25)], 0.95, false);
  paintTrunk(x, fx, fy, T * 0.36, T * 1.45, lean, '#5a4a34', R, '#7a8a44');
  const cl: [number, number, number][] = [];
  for (let i = 0; i < 5; i++) cl.push([cx + (i / 4 - 0.5) * rx * 1.6, cy + T * 0.1 + (R() - 0.5) * 6, T * (0.36 + R() * 0.08)]);
  for (let i = 0; i < 3; i++) cl.push([cx + (i / 2 - 0.5) * rx * 0.95, cy - T * 0.34 + (R() - 0.5) * 6, T * (0.38 + R() * 0.08)]);
  paintCanopy(x, W, H, cl, R, { cols, sun: '#fff2a4', flatY: 0.8 });
  tresses(7, [cols[1], cols[2], lit(cols[2], 0.2)], 0.9, true);
  return { canvas: c, footX: fx, footY: fy };
}

function cedar(v: number, R: () => number): FieldSprite {
  const W = Math.round(T * 2.4);
  const H = Math.round(T * 3.6);
  const [c, x] = mk(W, H);
  const fx = W / 2;
  const fy = H - Math.round(T * 0.38);
  const cols = LEAVES.shrine[v];
  shadowE(x, fx + 5, fy - 1, T * 1.0, T * 0.38, 0.55);
  // roots
  for (const s of [-1, 1]) {
    const p = smooth([[fx + s * T * 0.1, fy - T * 0.4], [fx + s * T * 0.4, fy - T * 0.12], [fx + s * T * 0.62, fy + 2]], false);
    stroke(x, p, '#2a2220', 7);
    stroke(x, p, '#4e3c32', 4.5);
  }
  paintTrunk(x, fx, fy, T * 0.4, T * 1.6, 0, '#5a3e32', R, '#4a7a4a');
  const cl: [number, number, number][] = [];
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const ty = fy - T * (1.35 + k * 1.55);
    const hw = T * (1.0 - k * 0.62);
    const n = 4 - Math.floor(k * 2.5);
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1) - 0.5;
      cl.push([fx + u * hw * 1.5 + (R() - 0.5) * 4, ty + Math.abs(u) * T * 0.18 + (R() - 0.5) * 4, T * (0.3 + (1 - k) * 0.1 + R() * 0.05)]);
    }
  }
  paintCanopy(x, W, H, cl, R, { cols, sun: '#c8fff0', flatY: 0.62, dots: [{ col: '#bffff2', n: 5, r: 1.4, glow: true }] });
  // hanging moss
  for (let i = 0; i < 7; i++) {
    const c0 = cl[Math.floor(R() * cl.length)];
    const sx = c0[0] + (R() - 0.5) * c0[2];
    const sy = c0[1] + c0[2] * 0.4;
    line(x, [[sx, sy], [sx + (R() - 0.5) * 2, sy + 6 + R() * 8]], rgba('#7ab08a', 0.7), 1.6);
  }
  // firefly-like turquoise lights around
  for (let i = 0; i < 3; i++) glow(x, fx + (R() - 0.5) * T * 1.6, fy - T * (0.5 + R() * 2.2), 7, HEK, 0.7);
  return { canvas: c, footX: fx, footY: fy };
}

// ---------------------------------------------------------------------------
// bushes & rocks
// ---------------------------------------------------------------------------

const BUSH_COLS: Record<FieldTheme, [string, string, string]> = {
  village: ['#2e5a34', '#5a8c48', '#a8c86c'],
  forest: ['#173e2c', '#2f6c40', '#78aa52'],
  road: ['#3e3a2a', '#6a6040', '#a09460'],
  marsh: ['#3e5a26', '#6a8c36', '#b6c45c'],
  shrine: ['#0f2e2a', '#1f5448', '#4a9078'],
};

/** 茂み(約1タイル) */
export function drawBush(theme: FieldTheme, variant: number): FieldSprite {
  const v = ((Math.floor(variant) % 3) + 3) % 3;
  return cached(`bush|${theme}|${v}`, () => {
    const R = rng(hs('bush', theme, v));
    const W = Math.round(T * 1.5);
    const H = Math.round(T * 1.35);
    const [c, x] = mk(W, H);
    const fx = W / 2;
    const fy = H - Math.round(T * 0.18);
    shadowE(x, fx + 3, fy - 3, T * 0.62, T * 0.24, 0.5);
    const cl: [number, number, number][] = [];
    for (let i = 0; i < 3; i++) cl.push([fx + (i - 1) * T * 0.34 + (R() - 0.5) * 3, fy - T * 0.3 + (R() - 0.5) * 3, T * (0.25 + R() * 0.06)]);
    for (let i = 0; i < 2; i++) cl.push([fx + (i - 0.5) * T * 0.36 + (R() - 0.5) * 3, fy - T * 0.58 + (R() - 0.5) * 3, T * (0.25 + R() * 0.06)]);
    if (v === 1) cl.push([fx, fy - T * 0.78, T * 0.2]);
    const dots: ClumpOpt['dots'] = [];
    if (theme === 'village') dots.push({ col: pick(R, ['#f6c0d0', '#fff2f0', '#f8d880']), n: 12, r: 1.8 });
    if (theme === 'forest' && v !== 2) dots.push({ col: '#d8404a', n: 7, r: 1.6 });
    if (theme === 'shrine') dots.push({ col: '#b4fff0', n: 5, r: 1.3, glow: true });
    if (theme === 'marsh') dots.push({ col: '#f8e070', n: 5, r: 1.5 });
    if (theme === 'road') {
      for (let i = 0; i < 4; i++) branch(x, fx + (R() - 0.5) * 10, fy - 6, -Math.PI / 2 + (R() - 0.5) * 1.6, T * 0.5, 1.6, 1, R, '#6a5a4a');
    }
    paintCanopy(x, W, H, cl, R, { cols: BUSH_COLS[theme], dots, shadowA: 0.5 });
    return { canvas: c, footX: fx, footY: fy };
  });
}

/** 岩(約1タイル) */
export function drawRock(theme: FieldTheme, variant: number): FieldSprite {
  const v = ((Math.floor(variant) % 3) + 3) % 3;
  return cached(`rock|${theme}|${v}`, () => {
    const R = rng(hs('rock', theme, v));
    if (theme === 'shrine') return pillarStub(v, R);
    const pal = PAL[theme];
    const W = Math.round(T * 1.4);
    const H = Math.round(T * 1.25);
    const [c, x] = mk(W, H);
    const fx = W / 2;
    const fy = H - Math.round(T * 0.16);
    shadowE(x, fx + 4, fy - 2, T * 0.6, T * 0.22, 0.55);
    const cx = fx;
    const cy = fy - T * 0.4;
    const rx = T * (0.44 + v * 0.03);
    const ry = T * (0.36 + R() * 0.06);
    const pts: Pt[] = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      const k = 0.82 + R() * 0.22;
      const flatBottom = Math.sin(a) > 0.5 ? 0.85 : 1;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k * flatBottom + (Math.sin(a) > 0.3 ? T * 0.12 : 0)]);
    }
    const body = smooth(pts, true, 0.7);
    const base = theme === 'road' ? '#8a847c' : pal.rock;
    vol(x, body, cx - rx, cy - ry, cx + rx, cy + ry + T * 0.1, base, 0.3, 0.5);
    clipDo(x, body, () => {
      // top plane
      x.fillStyle = rgba(lit(base, 0.35), 0.5);
      x.beginPath();
      x.ellipse(cx - rx * 0.12, cy - ry * 0.42, rx * 0.65, ry * 0.38, -0.15, 0, TAU);
      x.fill();
      // facet line
      x.strokeStyle = rgba(dk(base, 0.5), 0.5);
      x.lineWidth = 1.1;
      x.beginPath();
      x.moveTo(cx - rx * 0.8, cy - ry * 0.05);
      x.quadraticCurveTo(cx, cy + ry * 0.1, cx + rx * 0.7, cy - ry * 0.25);
      x.stroke();
      if (theme !== 'road') {
        x.fillStyle = theme === 'marsh' ? '#7a9440' : '#5e8e3a';
        const mp = new Path2D();
        for (let i = 0; i < 9; i++) {
          const mx = cx - rx * 0.7 + R() * rx * 1.2;
          const my = cy - ry * 0.95 + R() * ry * 0.45;
          addEll(mp, mx, my, 4 + R() * 5, 3 + R() * 3);
        }
        x.fill(mp);
        x.fillStyle = rgba('#d8f0a0', 0.35);
        x.beginPath();
        x.ellipse(cx - rx * 0.4, cy - ry * 0.8, 5, 2.4, 0, 0, TAU);
        x.fill();
      }
      if (theme === 'road') {
        x.fillStyle = 'rgba(30,26,26,0.35)';
        x.beginPath();
        x.ellipse(cx + rx * 0.3, cy + ry * 0.5, rx * 0.6, ry * 0.4, 0, 0, TAU);
        x.fill();
      }
    });
    ink(x, body, 1.1);
    // pebbles
    for (let i = 0; i < 3; i++) {
      const px = cx + (R() - 0.5) * rx * 2.3;
      const py = fy - 2 - R() * 4;
      const p = ellP(px, py, 2.5 + R() * 2, 1.8 + R());
      vol(x, p, px - 3, py - 2, px + 3, py + 2, base);
      ink(x, p, 0.8, 'rgba(40,30,30,0.5)');
    }
    return { canvas: c, footX: fx, footY: fy };
  });
}

/** 森殿の R: 折れた古い石柱(苔と、かすかな刻印の光) */
function pillarStub(v: number, R: () => number): FieldSprite {
  const W = Math.round(T * 1.3);
  const H = Math.round(T * 1.9);
  const [c, x] = mk(W, H);
  const fx = W / 2;
  const fy = H - Math.round(T * 0.16);
  const stone = '#7a8c88';
  shadowE(x, fx + 4, fy - 2, T * 0.5, T * 0.18, 0.55);
  // plinth
  const pl = rrect(fx - T * 0.42, fy - T * 0.3, T * 0.84, T * 0.3, 3);
  vol(x, pl, fx - T * 0.42, fy - T * 0.3, fx + T * 0.42, fy, dk(stone, 0.12));
  ink(x, pl, 1);
  const top = fy - T * (1.0 + v * 0.22);
  const r = T * 0.3;
  // shaft with a broken, jagged top
  const shaft = new Path2D();
  shaft.moveTo(fx - r, fy - T * 0.28);
  shaft.lineTo(fx - r, top + 4);
  for (let i = 1; i < 6; i++) shaft.lineTo(fx - r + (i / 6) * r * 2, top + (i % 2 ? -4 - R() * 8 : R() * 4));
  shaft.lineTo(fx + r, top + 6);
  shaft.lineTo(fx + r, fy - T * 0.28);
  shaft.closePath();
  x.fillStyle = lin(x, fx - r, 0, fx + r, 0, [[0, lit(stone, 0.28)], [0.45, stone], [1, dk(stone, 0.5)]]);
  x.fill(shaft);
  clipDo(x, shaft, () => {
    for (let k = -2; k <= 2; k++) {
      x.fillStyle = 'rgba(10,20,26,0.22)';
      x.fillRect(fx + k * r * 0.4 - 0.8, top - 10, 1.6, T * 1.4);
    }
    x.fillStyle = rgba('#4e8a5c', 0.8);
    for (let i = 0; i < 8; i++) {
      x.beginPath();
      x.ellipse(fx - r * 0.4 + (R() - 0.5) * r, fy - T * 0.3 - R() * T * 0.5, 3 + R() * 3, 3 + R() * 5, 0, 0, TAU);
      x.fill();
    }
    x.fillStyle = 'rgba(210,225,215,0.35)';
    x.fillRect(fx - r, top - 10, r * 2, 5);
  });
  ink(x, shaft, 1.1);
  x.save();
  x.globalCompositeOperation = 'lighter';
  glow(x, fx - 2, (top + fy) / 2, 9, HEK, 0.3);
  rune(x, fx - 2, (top + fy) / 2 - 2, 3.2, v * 2 + 1, 0.7);
  x.restore();
  // rubble
  for (let i = 0; i < 3; i++) {
    const px = fx + (R() - 0.5) * T * 0.9;
    const py = fy - 1 - R() * 3;
    const p = ellP(px, py, 3 + R() * 2, 2 + R());
    vol(x, p, px - 3, py - 2, px + 3, py + 2, stone);
    ink(x, p, 0.8, 'rgba(40,30,30,0.5)');
  }
  return { canvas: c, footX: fx, footY: fy };
}

// ---------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------

/** 小物・建物。chest は variant 1 で開いた状態 */
export function drawProp(kind: PropKind, theme: FieldTheme, variant = 0): FieldSprite {
  return cached(`prop|${kind}|${theme}|${variant}`, () => {
    const R = rng(hs('prop', kind, theme, variant));
    switch (kind) {
      case 'great_tree': return greatTree(R);
      case 'lab': return lab(R);
      case 'house': return house(R, variant);
      case 'tent': return tent(R);
      case 'device': return device(R);
      case 'spring': return spring(R);
      case 'record_stone': return recordStone(theme);
      case 'sign': return sign(theme, R);
      case 'lantern': return lantern();
      case 'beehive': return beehive(R);
      case 'shrine_gate': return shrineGate(R);
      case 'altar': return altar(R);
      case 'stump': return stump(theme, variant, R);
      case 'crate': return crate(R);
      case 'mushroom': return mushrooms(theme, R);
      case 'chest': return chest(variant === 1);
      default: return sign(theme, R);
    }
  });
}

/** 宝(編みかご)。opened = 開いたあと */
export function drawChest(opened: boolean): FieldSprite {
  return drawProp('chest', 'forest', opened ? 1 : 0);
}

function sprite(w: number, h: number, footFromBottom: number): [HTMLCanvasElement, Ctx, number, number] {
  const [c, x] = mk(w, h);
  return [c, x, c.width / 2, c.height - footFromBottom];
}

function sign(theme: FieldTheme, R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 1.2, T * 1.5, T * 0.15);
  shadowE(x, fx + 3, fy - 1, T * 0.4, T * 0.14, 0.5);
  const wood = theme === 'road' ? '#8a7666' : theme === 'shrine' ? '#6e6258' : '#a47a50';
  const post = rrect(fx - 3, fy - T * 0.95, 6, T * 0.95, 2);
  vol(x, post, fx - 3, 0, fx + 3, 0, dk(wood, 0.2));
  ink(x, post, 1);
  const bw = T * 0.9;
  const bh = T * 0.46;
  const bx = fx - bw / 2;
  const by = fy - T * 1.2;
  const board = poly([[bx, by + 3], [bx + bw - 8, by], [bx + bw, by + bh / 2], [bx + bw - 8, by + bh], [bx + 2, by + bh - 1]]);
  vol(x, board, bx, by, bx + bw, by + bh, wood, 0.25, 0.35);
  clipDo(x, board, () => {
    x.strokeStyle = rgba(dk(wood, 0.5), 0.4);
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(bx, by + bh / 2);
    x.lineTo(bx + bw, by + bh / 2 + 1);
    x.stroke();
    // painted mark: a small ring and arrow in the village turquoise
    x.strokeStyle = rgba(theme === 'road' ? '#e8e0d0' : '#e8f8ee', 0.85);
    x.lineWidth = 1.8;
    x.beginPath();
    x.arc(bx + bw * 0.3, by + bh / 2, 5, 0, TAU);
    x.moveTo(bx + bw * 0.5, by + bh / 2);
    x.lineTo(bx + bw * 0.78, by + bh / 2);
    x.moveTo(bx + bw * 0.7, by + bh / 2 - 4);
    x.lineTo(bx + bw * 0.78, by + bh / 2);
    x.lineTo(bx + bw * 0.7, by + bh / 2 + 4);
    x.stroke();
  });
  ink(x, board, 1.1);
  x.fillStyle = '#3a2a20';
  x.fillRect(fx - 1, by + 4, 2, 2);
  // grass at the base
  for (let i = 0; i < 6; i++) line(x, [[fx - 8 + i * 3, fy], [fx - 9 + i * 3 + (R() - 0.5) * 4, fy - 6 - R() * 4]], i % 2 ? '#8aa858' : '#4e6e3a', 1.3);
  return { canvas: c, footX: fx, footY: fy };
}

function lantern(): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 1.3, T * 2.2, T * 0.15);
  shadowE(x, fx + 3, fy - 1, T * 0.35, T * 0.13, 0.5);
  glow(x, fx + 8, fy - T * 1.45, T * 1.0, '#ffb458', 0.35);
  const post = rrect(fx - 2.5, fy - T * 1.85, 5, T * 1.85, 2);
  vol(x, post, fx - 3, 0, fx + 3, 0, '#5a3e2c');
  ink(x, post, 1);
  // arm
  const arm = rrect(fx - 2, fy - T * 1.83, T * 0.42, 4, 2);
  vol(x, arm, fx, fy - T * 1.83, fx + T * 0.4, fy - T * 1.8, '#5a3e2c');
  ink(x, arm, 0.9);
  const lx = fx + T * 0.33;
  const ly = fy - T * 1.42;
  line(x, [[lx, fy - T * 1.8], [lx, ly - 10]], '#2a2020', 1.2);
  // woven lantern body
  const body = smooth([[lx, ly - 11], [lx + 8, ly - 6], [lx + 9, ly + 3], [lx + 5, ly + 10], [lx - 5, ly + 10], [lx - 9, ly + 3], [lx - 8, ly - 6]]);
  x.fillStyle = radG(x, lx, ly, 1, 13, [[0, '#fff2c0'], [0.45, '#ffb860'], [1, '#c8642a']], lx - 2, ly - 2);
  x.fill(body);
  clipDo(x, body, () => {
    x.strokeStyle = 'rgba(120,60,20,0.45)';
    x.lineWidth = 0.9;
    for (let k = -2; k <= 2; k++) {
      x.beginPath();
      x.ellipse(lx, ly + k * 4, 10, 2, 0, 0, Math.PI);
      x.stroke();
    }
  });
  ink(x, body, 1);
  x.fillStyle = '#3a2a20';
  x.fillRect(lx - 5, ly - 12, 10, 3);
  x.fillRect(lx - 4, ly + 9, 8, 2.5);
  glow(x, lx, ly, 22, '#ffd080', 0.55);
  return { canvas: c, footX: fx, footY: fy };
}

function beehive(R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 1.2, T * 1.6, T * 0.15);
  shadowE(x, fx + 3, fy - 1, T * 0.45, T * 0.16, 0.5);
  // stand
  for (const s of [-1, 1]) {
    const leg = rrect(fx + s * T * 0.28 - 2, fy - T * 0.5, 4, T * 0.5, 1.5);
    vol(x, leg, 0, 0, 1, 1, '#5e4230');
    ink(x, leg, 0.9);
  }
  const top = rrect(fx - T * 0.42, fy - T * 0.56, T * 0.84, 6, 2);
  vol(x, top, fx - T * 0.4, fy - T * 0.56, fx + T * 0.4, fy - T * 0.5, '#7a5638');
  ink(x, top, 1);
  // skep dome
  const by = fy - T * 0.56;
  const dome = smooth([[fx - T * 0.38, by], [fx - T * 0.36, by - T * 0.35], [fx - T * 0.2, by - T * 0.66], [fx, by - T * 0.74], [fx + T * 0.2, by - T * 0.66], [fx + T * 0.36, by - T * 0.35], [fx + T * 0.38, by]]);
  vol(x, dome, fx - T * 0.4, by - T * 0.75, fx + T * 0.4, by, '#d0a45a', 0.35, 0.45);
  clipDo(x, dome, () => {
    x.strokeStyle = 'rgba(110,70,30,0.55)';
    x.lineWidth = 1.2;
    for (let k = 1; k < 6; k++) {
      const yy = by - (k / 6) * T * 0.72;
      x.beginPath();
      x.moveTo(fx - T * 0.45, yy + 2);
      x.quadraticCurveTo(fx, yy + 5, fx + T * 0.45, yy + 2);
      x.stroke();
    }
    x.strokeStyle = 'rgba(255,240,190,0.35)';
    for (let k = 1; k < 6; k++) {
      const yy = by - (k / 6) * T * 0.72 - 2;
      x.beginPath();
      x.moveTo(fx - T * 0.3, yy + 2);
      x.quadraticCurveTo(fx - T * 0.1, yy + 4, fx + T * 0.05, yy + 3.5);
      x.stroke();
    }
  });
  ink(x, dome, 1.1);
  const door = ellP(fx, by - 4, 4.5, 3);
  x.fillStyle = '#2a1a10';
  x.fill(door);
  // honey drip + bees
  x.fillStyle = '#f0a830';
  x.beginPath();
  x.ellipse(fx + 3, by - 1, 1.6, 2.6, 0, 0, TAU);
  x.fill();
  for (let i = 0; i < 3; i++) bee(x, fx + (R() - 0.3) * T * 0.9, by - T * (0.5 + R() * 0.5));
  return { canvas: c, footX: fx, footY: fy };
}
function bee(x: Ctx, bx: number, by: number): void {
  x.fillStyle = 'rgba(255,255,255,0.7)';
  x.beginPath();
  x.ellipse(bx - 1, by - 2.2, 1.6, 1.1, -0.5, 0, TAU);
  x.ellipse(bx + 1.4, by - 2.2, 1.6, 1.1, 0.5, 0, TAU);
  x.fill();
  x.fillStyle = '#f2c230';
  x.beginPath();
  x.ellipse(bx, by, 2.4, 1.6, 0, 0, TAU);
  x.fill();
  x.fillStyle = '#2a2020';
  x.fillRect(bx - 0.4, by - 1.5, 1, 3);
}

function recordStone(theme: FieldTheme): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 1.4, T * 2.3, T * 0.18);
  const R = rng(hs('record', theme));
  glow(x, fx, fy - 4, T * 0.8, HEK, 0.22);
  shadowE(x, fx + 4, fy - 1, T * 0.5, T * 0.17, 0.55);
  const base = theme === 'shrine' ? '#7a8e8a' : theme === 'road' ? '#8a8680' : '#8e948a';
  // plinth stones
  for (const [ox, w] of [[-T * 0.34, T * 0.3], [T * 0.08, T * 0.32], [-T * 0.1, T * 0.28]] as [number, number][]) {
    const p = smooth([[fx + ox, fy], [fx + ox + 2, fy - 7], [fx + ox + w - 2, fy - 8], [fx + ox + w, fy - 1]]);
    vol(x, p, fx + ox, fy - 8, fx + ox + w, fy, dk(base, 0.1));
    ink(x, p, 0.9);
  }
  const top = fy - T * 1.9;
  const body = smooth([[fx - T * 0.3, fy - 4], [fx - T * 0.34, fy - T * 0.9], [fx - T * 0.28, top + T * 0.28], [fx - T * 0.08, top], [fx + T * 0.16, top + 2], [fx + T * 0.3, top + T * 0.3], [fx + T * 0.34, fy - T * 0.8], [fx + T * 0.3, fy - 4]]);
  vol(x, body, fx - T * 0.34, top, fx + T * 0.34, fy, base, 0.3, 0.5);
  clipDo(x, body, () => {
    // right face darker (3/4 volume)
    x.fillStyle = 'rgba(20,24,34,0.28)';
    x.beginPath();
    x.moveTo(fx + T * 0.14, top);
    x.quadraticCurveTo(fx + T * 0.1, fy - T * 1.0, fx + T * 0.16, fy);
    x.lineTo(fx + T * 0.5, fy);
    x.lineTo(fx + T * 0.5, top);
    x.fill();
    // moss at the bottom and the crown
    x.fillStyle = rgba('#5e8e4a', 0.85);
    for (let i = 0; i < 10; i++) {
      x.beginPath();
      x.ellipse(fx + (R() - 0.5) * T * 0.7, fy - 3 - R() * 10, 3 + R() * 4, 2 + R() * 2, 0, 0, TAU);
      x.fill();
    }
    for (let i = 0; i < 5; i++) {
      x.beginPath();
      x.ellipse(fx - T * 0.12 + (R() - 0.5) * T * 0.3, top + 3 + R() * 5, 3 + R() * 3, 1.8, 0, 0, TAU);
      x.fill();
    }
    // lichen specks
    x.fillStyle = 'rgba(210,220,170,0.35)';
    for (let i = 0; i < 12; i++) x.fillRect(fx + (R() - 0.5) * T * 0.6, top + R() * T * 1.7, 1.5, 1.5);
  });
  ink(x, body, 1.2);
  // carved glowing ring
  const ry = fy - T * 1.12;
  x.strokeStyle = 'rgba(20,30,34,0.6)';
  x.lineWidth = 5;
  x.beginPath();
  x.arc(fx - 1, ry, T * 0.2, 0, TAU);
  x.stroke();
  x.save();
  x.globalCompositeOperation = 'lighter';
  glow(x, fx - 1, ry, T * 0.55, HEK, 0.45);
  x.shadowColor = HEK;
  x.shadowBlur = 8;
  x.strokeStyle = '#8ff5e4';
  x.lineWidth = 2.2;
  x.beginPath();
  x.arc(fx - 1, ry, T * 0.2, 0, TAU);
  x.stroke();
  x.shadowBlur = 0;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    x.fillStyle = rgba(HEK, 0.8);
    x.beginPath();
    x.arc(fx - 1 + Math.cos(a) * T * 0.29, ry + Math.sin(a) * T * 0.29, 1.1, 0, TAU);
    x.fill();
  }
  x.restore();
  return { canvas: c, footX: fx, footY: fy };
}

function spring(R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 2.2, T * 1.9, T * 0.25);
  const cx = fx;
  const cy = fy - T * 0.52;
  const rx = T * 0.78;
  const ry = T * 0.42;
  shadowE(x, cx + 4, cy + 6, rx * 1.35, ry * 1.4, 0.4);
  const stones = (front: boolean) => {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const isFront = Math.sin(a) > 0;
      if (isFront !== front) continue;
      const sx = cx + Math.cos(a) * (rx + 5);
      const sy = cy + Math.sin(a) * (ry + 4);
      const w = 8 + R() * 5;
      const h = 6 + R() * 3;
      const p = smooth([[sx - w / 2, sy + h * 0.3], [sx - w * 0.4, sy - h * 0.5], [sx, sy - h * 0.7], [sx + w * 0.45, sy - h * 0.4], [sx + w / 2, sy + h * 0.35], [sx, sy + h * 0.5]]);
      vol(x, p, sx - w / 2, sy - h, sx + w / 2, sy + h, mix('#9a988a', '#7a8a7a', R()), 0.35, 0.45);
      clipDo(x, p, () => {
        x.fillStyle = rgba('#6a9a54', 0.7);
        x.beginPath();
        x.ellipse(sx - w * 0.2, sy - h * 0.5, w * 0.3, h * 0.25, 0, 0, TAU);
        x.fill();
      });
      ink(x, p, 0.9);
    }
  };
  stones(false);
  const pool = ellP(cx, cy, rx, ry);
  x.fillStyle = radG(x, cx, cy, 2, rx, [[0, '#d8fff4'], [0.35, '#7ee8d6'], [0.8, '#2f9a98'], [1, '#1e6a70']], cx - rx * 0.2, cy - ry * 0.2);
  x.fill(pool);
  clipDo(x, pool, () => {
    x.strokeStyle = 'rgba(255,255,255,0.45)';
    x.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      x.beginPath();
      x.ellipse(cx + (R() - 0.5) * rx * 0.6, cy + (R() - 0.5) * ry * 0.6, 5 + k * 5, 2 + k * 2, 0, 0, TAU);
      x.stroke();
    }
    x.fillStyle = 'rgba(10,40,50,0.35)';
    x.beginPath();
    x.ellipse(cx, cy - ry * 0.8, rx, ry * 0.4, 0, 0, TAU);
    x.fill();
  });
  x.save();
  x.globalCompositeOperation = 'lighter';
  glow(x, cx, cy, rx * 1.3, HEK, 0.35);
  for (let i = 0; i < 8; i++) {
    const bx = cx + (R() - 0.5) * rx * 1.2;
    const by = cy + (R() - 0.5) * ry;
    x.fillStyle = 'rgba(220,255,245,0.8)';
    x.beginPath();
    x.arc(bx, by, 0.8 + R() * 1.3, 0, TAU);
    x.fill();
  }
  // rising motes
  for (let i = 0; i < 6; i++) glow(x, cx + (R() - 0.5) * rx * 1.2, cy - T * (0.2 + R() * 0.8), 4 + R() * 3, '#bffff0', 0.6);
  x.restore();
  // steam wisps
  for (let i = 0; i < 3; i++) {
    const sx = cx + (i - 1) * rx * 0.45;
    line(x, [[sx, cy - 2], [sx + 4, cy - 12], [sx - 3, cy - 22], [sx + 2, cy - 32]], 'rgba(235,255,250,0.18)', 5);
  }
  stones(true);
  return { canvas: c, footX: fx, footY: fy };
}

function stump(theme: FieldTheme, variant: number, R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 1.4, T * 1.3, T * 0.16);
  const burnt = theme === 'road';
  const bark = burnt ? '#4a3e38' : '#6a4a34';
  shadowE(x, fx + 3, fy - 2, T * 0.55, T * 0.2, 0.5);
  const rx = T * 0.38;
  const ty = fy - T * 0.55;
  // roots
  for (const [a, l] of [[-0.3, 0.6], [0.35, 0.55], [Math.PI + 0.2, 0.6], [Math.PI - 0.4, 0.5]] as [number, number][]) {
    const ex = fx + Math.cos(a) * T * l;
    const ey = fy - 3 + Math.abs(Math.sin(a)) * 3;
    const p = smooth([[fx + Math.cos(a) * rx * 0.7, fy - T * 0.2], [(fx + ex) / 2 + Math.cos(a) * 4, fy - T * 0.12], [ex, ey]], false);
    stroke(x, p, dk(bark, 0.4), 7);
    stroke(x, p, bark, 5);
  }
  const body = new Path2D();
  body.moveTo(fx - rx, ty);
  body.lineTo(fx - rx - 2, fy - T * 0.16);
  body.quadraticCurveTo(fx, fy - T * 0.02, fx + rx + 2, fy - T * 0.16);
  body.lineTo(fx + rx, ty);
  body.ellipse(fx, ty, rx, rx * 0.45, 0, 0, Math.PI, true);
  body.closePath();
  x.fillStyle = lin(x, fx - rx, 0, fx + rx, 0, [[0, lit(bark, 0.25)], [0.45, bark], [1, dk(bark, 0.5)]]);
  x.fill(body);
  clipDo(x, body, () => {
    x.strokeStyle = rgba(dk(bark, 0.5), 0.5);
    x.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const bx = fx - rx + (k + 0.5) * (rx * 2 / 5);
      x.beginPath();
      x.moveTo(bx, ty);
      x.lineTo(bx + (R() - 0.5) * 3, fy);
      x.stroke();
    }
    if (!burnt) {
      x.fillStyle = rgba('#6a9a44', 0.8);
      for (let k = 0; k < 5; k++) {
        x.beginPath();
        x.ellipse(fx - rx * 0.5 + R() * rx * 0.6, ty + 6 + R() * 10, 3 + R() * 3, 2 + R() * 2, 0, 0, TAU);
        x.fill();
      }
    }
  });
  ink(x, body, 1.1);
  const topP = ellP(fx, ty, rx, rx * 0.45);
  x.fillStyle = burnt ? radG(x, fx, ty, 1, rx, [[0, '#4a3a30'], [1, '#1e1614']]) : radG(x, fx, ty, 1, rx, [[0, '#e8c894'], [0.7, '#c89a64'], [1, '#8a603c']]);
  x.fill(topP);
  x.strokeStyle = burnt ? 'rgba(255,140,60,0.35)' : 'rgba(120,80,40,0.5)';
  x.lineWidth = 0.9;
  for (let k = 1; k <= 3; k++) {
    x.beginPath();
    x.ellipse(fx, ty, rx * k * 0.25, rx * 0.45 * k * 0.25, 0, 0, TAU);
    x.stroke();
  }
  ink(x, topP, 1);
  if (burnt) glow(x, fx + 3, ty + 1, 6, '#ff7a3a', 0.4);
  if (variant === 1) {
    // a field journal resting on the stump
    x.save();
    x.translate(fx - 2, ty - 1);
    x.rotate(-0.18);
    const cover = rrect(-9, -6, 18, 12, 2);
    vol(x, cover, -9, -6, 9, 6, '#3e6a8a');
    ink(x, cover, 0.9);
    x.fillStyle = '#f4ecd8';
    x.fillRect(-8, -5, 16, 3);
    x.strokeStyle = HEK;
    x.lineWidth = 1.2;
    x.beginPath();
    x.arc(2, 2, 2.5, 0, TAU);
    x.stroke();
    x.restore();
  }
  return { canvas: c, footX: fx, footY: fy };
}

function crate(R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 1.2, T * 1.3, T * 0.15);
  shadowE(x, fx + 4, fy - 2, T * 0.52, T * 0.18, 0.55);
  const w = T * 0.8;
  const fh = T * 0.52;
  const th = T * 0.28;
  const x0 = fx - w / 2;
  const frontY = fy - fh;
  const front = rrect(x0, frontY, w, fh, 2);
  const top = poly([[x0, frontY], [x0 + 4, frontY - th], [x0 + w + 4, frontY - th], [x0 + w, frontY]]);
  const metal = '#5e6268';
  vol(x, top, x0, frontY - th, x0 + w, frontY, '#8a8e90', 0.3, 0.3);
  vol(x, front, x0, frontY, x0 + w, fy, metal, 0.2, 0.45);
  clipDo(x, front, () => {
    x.fillStyle = '#ff8a2a';
    x.fillRect(x0, frontY + fh * 0.38, w, 6);
    x.fillStyle = 'rgba(255,240,200,0.5)';
    x.fillRect(x0, frontY + fh * 0.38, w, 1.4);
    // stencil star
    star(x, fx + w * 0.22, frontY + fh * 0.2, 5, 'rgba(230,226,220,0.75)');
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(x0, fy - 5, w, 5);
  });
  ink(x, top, 1);
  ink(x, front, 1.1);
  // frame corners
  x.fillStyle = '#34383e';
  for (const cx of [x0 + 1, x0 + w - 4]) x.fillRect(cx, frontY + 1, 3, fh - 2);
  x.fillStyle = 'rgba(200,200,200,0.6)';
  for (const cx of [x0 + 2.5, x0 + w - 2.5]) for (const cy of [frontY + 4, fy - 5]) x.fillRect(cx - 0.8, cy - 0.8, 1.6, 1.6);
  // ash dust
  x.fillStyle = 'rgba(200,196,190,0.35)';
  for (let i = 0; i < 6; i++) x.fillRect(x0 + R() * w, frontY - th + R() * th, 2, 1);
  return { canvas: c, footX: fx, footY: fy };
}
/** 灰星局の紋: 6本の線の星(灰色の輪の中) */
function star(x: Ctx, cx: number, cy: number, r: number, col: string): void {
  x.save();
  x.strokeStyle = col;
  x.lineWidth = Math.max(1, r * 0.28);
  x.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + Math.PI / 2;
    x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    x.lineTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
  }
  x.stroke();
  x.fillStyle = col;
  x.beginPath();
  x.arc(cx, cy, r * 0.3, 0, TAU);
  x.fill();
  x.restore();
}

function mushrooms(theme: FieldTheme, R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 1.1, T * 1.0, T * 0.14);
  const glowy = theme === 'marsh' || theme === 'shrine';
  const cap = theme === 'marsh' ? '#f0d86a' : theme === 'shrine' ? '#5ee0c8' : '#d8683a';
  shadowE(x, fx + 2, fy - 2, T * 0.42, T * 0.15, 0.45);
  const list: [number, number, number][] = [[-10, 0, 1], [6, 2, 0.8], [-2, -3, 1.2], [13, -1, 0.6], [-16, 3, 0.55]];
  list.sort((a, b) => a[1] - b[1]);
  for (const [ox, oy, s] of list) {
    const bx = fx + ox;
    const by = fy + oy - 2;
    const h = 12 * s;
    const stem = rrect(bx - 2.2 * s, by - h, 4.4 * s, h, 2 * s);
    vol(x, stem, bx - 3, by - h, bx + 3, by, '#efe6d0');
    ink(x, stem, 0.8);
    const cp = new Path2D();
    cp.ellipse(bx, by - h, 8 * s, 6.5 * s, 0, Math.PI, 0);
    cp.quadraticCurveTo(bx, by - h + 3 * s, bx - 8 * s, by - h);
    cp.closePath();
    if (glowy) glow(x, bx, by - h - 2, 14 * s, cap, 0.35);
    vol(x, cp, bx - 8 * s, by - h - 6 * s, bx + 8 * s, by - h, cap, 0.35, 0.35);
    x.fillStyle = 'rgba(255,250,235,0.85)';
    for (let k = 0; k < 3; k++) {
      x.beginPath();
      x.arc(bx + (R() - 0.5) * 9 * s, by - h - 2.5 * s - R() * 2 * s, 1.1 * s, 0, TAU);
      x.fill();
    }
    ink(x, cp, 0.9);
  }
  return { canvas: c, footX: fx, footY: fy };
}

function chest(opened: boolean): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 1.3, T * 1.4, T * 0.15);
  const R = rng(hs('chest', opened ? 1 : 0));
  shadowE(x, fx + 3, fy - 2, T * 0.5, T * 0.17, 0.5);
  const w = T * 0.78;
  const fh = T * 0.38;
  const x0 = fx - w / 2;
  const fyTop = fy - fh;
  const wick = '#c89a5a';
  const weave = (p: Path2D, x0: number, y0: number, w: number, h: number) => {
    vol(x, p, x0, y0, x0 + w, y0 + h, wick, 0.3, 0.4);
    clipDo(x, p, () => {
      const cw = 5;
      const ch = 4;
      for (let yy = y0; yy < y0 + h; yy += ch) {
        for (let xx = x0 + ((yy - y0) / ch % 2) * cw; xx < x0 + w; xx += cw * 2) {
          x.fillStyle = rgba('#8a5a2a', 0.35);
          x.fillRect(xx, yy, cw, ch - 0.8);
          x.fillStyle = rgba('#fff0c8', 0.25);
          x.fillRect(xx + cw, yy, cw, 1);
        }
      }
    });
  };
  if (opened) {
    // lid flipped back
    const lid = poly([[x0 - 1, fyTop - 2], [x0 + 3, fyTop - T * 0.42], [x0 + w - 3, fyTop - T * 0.42], [x0 + w + 1, fyTop - 2]]);
    weave(lid, x0, fyTop - T * 0.42, w, T * 0.4);
    ink(x, lid, 1);
    const inner = poly([[x0 + 2, fyTop], [x0 + 5, fyTop - 8], [x0 + w - 5, fyTop - 8], [x0 + w - 2, fyTop]]);
    x.fillStyle = '#3a2418';
    x.fill(inner);
    glow(x, fx, fyTop - 3, T * 0.5, '#ffe7a0', 0.6);
    glow(x, fx, fyTop - 6, T * 0.35, HEK, 0.45);
  } else {
    const lid = poly([[x0 - 2, fyTop + 2], [x0 + 2, fyTop - T * 0.22], [x0 + w - 2, fyTop - T * 0.22], [x0 + w + 2, fyTop + 2]]);
    weave(lid, x0, fyTop - T * 0.22, w, T * 0.25);
    ink(x, lid, 1);
  }
  const front = rrect(x0, fyTop, w, fh, 3);
  weave(front, x0, fyTop, w, fh);
  ink(x, front, 1.1);
  // bound corners
  x.fillStyle = '#7a4a26';
  x.fillRect(x0, fyTop + 1, 3, fh - 2);
  x.fillRect(x0 + w - 3, fyTop + 1, 3, fh - 2);
  // turquoise ribbon + ring clasp
  x.fillStyle = '#2fb8a4';
  x.fillRect(fx - 2.5, fyTop - (opened ? 0 : T * 0.2), 5, fh + (opened ? 0 : T * 0.2));
  x.fillStyle = 'rgba(200,255,245,0.5)';
  x.fillRect(fx - 2.5, fyTop - (opened ? 0 : T * 0.2), 1.3, fh + (opened ? 0 : T * 0.2));
  if (!opened) {
    x.strokeStyle = '#e8d080';
    x.lineWidth = 2;
    x.beginPath();
    x.arc(fx, fyTop + 3, 3.4, 0, TAU);
    x.stroke();
    glow(x, fx, fyTop + 3, 9, HEK, 0.35);
  } else {
    for (let i = 0; i < 4; i++) {
      const sx = fx + (R() - 0.5) * w * 0.8;
      const sy = fyTop - 10 - R() * 12;
      sparkle(x, sx, sy, 3 + R() * 2, '#fff6c8');
    }
  }
  return { canvas: c, footX: fx, footY: fy };
}
function sparkle(x: Ctx, cx: number, cy: number, r: number, col: string): void {
  x.save();
  x.globalCompositeOperation = 'lighter';
  glow(x, cx, cy, r * 2.2, col, 0.5);
  x.fillStyle = col;
  x.beginPath();
  x.moveTo(cx, cy - r);
  x.quadraticCurveTo(cx, cy, cx + r, cy);
  x.quadraticCurveTo(cx, cy, cx, cy + r);
  x.quadraticCurveTo(cx, cy, cx - r, cy);
  x.quadraticCurveTo(cx, cy, cx, cy - r);
  x.fill();
  x.restore();
}

// --- big village props ------------------------------------------------------------------------

function shingleRoof(x: Ctx, roof: Path2D, x0: number, y0: number, x1: number, y1: number, cols: string[], R: () => number, rowH = 7, w = 9): void {
  clipDo(x, roof, () => {
    x.fillStyle = dk(cols[0], 0.3);
    x.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let yy = y0; yy < y1 + rowH; yy += rowH) {
      const off = (Math.round((yy - y0) / rowH) % 2) * (w / 2);
      for (let xx = x0 - w + off; xx < x1 + w; xx += w) {
        const col = mix(pick(R, cols), '#000000', ((yy - y0) / (y1 - y0)) * 0.1);
        const p = new Path2D();
        p.moveTo(xx, yy - rowH * 0.3);
        p.lineTo(xx + w, yy - rowH * 0.3);
        p.lineTo(xx + w, yy + rowH * 0.55);
        p.quadraticCurveTo(xx + w / 2, yy + rowH * 1.1, xx, yy + rowH * 0.55);
        p.closePath();
        x.fillStyle = lin(x, 0, yy - rowH * 0.3, 0, yy + rowH, [[0, lit(col, 0.22)], [1, dk(col, 0.25)]]);
        x.fill(p);
        x.strokeStyle = rgba(dk(col, 0.6), 0.45);
        x.lineWidth = 0.8;
        x.stroke(p);
      }
    }
    // light from the upper left
    x.fillStyle = lin(x, x0, y0, x1, y1, [[0, 'rgba(255,236,190,0.28)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(20,10,30,0.3)']]);
    x.fillRect(x0, y0, x1 - x0, y1 - y0);
  });
}

function window4(x: Ctx, cx: number, cy: number, w: number, h: number, frame: string, round = false): void {
  const p = round ? ellP(cx, cy, w / 2, h / 2) : rrect(cx - w / 2, cy - h / 2, w, h, 2);
  x.fillStyle = radG(x, cx, cy, 1, Math.max(w, h) * 0.7, [[0, '#fff0b8'], [0.6, '#f6b458'], [1, '#b8642e']]);
  x.fill(p);
  x.strokeStyle = frame;
  x.lineWidth = 2;
  x.stroke(p);
  x.lineWidth = 1.4;
  x.beginPath();
  x.moveTo(cx, cy - h / 2);
  x.lineTo(cx, cy + h / 2);
  x.moveTo(cx - w / 2, cy);
  x.lineTo(cx + w / 2, cy);
  x.stroke();
  glow(x, cx, cy, Math.max(w, h) * 1.1, '#ffc070', 0.22);
}

function mapleLeaf(x: Ctx, cx: number, cy: number, r: number, col: string, rot = 0): void {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  const pts: Pt[] = [];
  const lobes = [1, 0.92, 0.6, 0.6, 0.92];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * TAU;
    const k = i % 2 === 0 ? lobes[i / 2] : 0.4;
    pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
  }
  const p = poly(pts);
  x.fillStyle = col;
  x.fill(p);
  x.strokeStyle = rgba(dk(col, 0.5), 0.8);
  x.lineWidth = 0.8;
  x.stroke(p);
  x.beginPath();
  x.moveTo(0, r * 0.3);
  x.lineTo(0, r * 1.05);
  x.stroke();
  x.restore();
}

function lab(R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 6, T * 5.6, T * 0.2);
  const hw = T * 2.42;
  shadowE(x, fx + 8, fy - T * 0.9, T * 3.0, T * 1.35, 0.5);
  const wallTop = fy - T * 2.1;
  const baseTop = fy - T * 0.36;
  // stone foundation
  const found = rrect(fx - hw - 4, baseTop, hw * 2 + 8, T * 0.36, 3);
  vol(x, found, fx - hw, baseTop, fx + hw, fy, '#8e887a', 0.25, 0.45);
  clipDo(x, found, () => {
    x.strokeStyle = 'rgba(40,34,30,0.45)';
    x.lineWidth = 1;
    for (let xx = fx - hw; xx < fx + hw; xx += 14) {
      x.beginPath();
      x.moveTo(xx + (R() * 4), baseTop);
      x.lineTo(xx + R() * 4, fy);
      x.stroke();
    }
    x.beginPath();
    x.moveTo(fx - hw - 4, baseTop + T * 0.18);
    x.lineTo(fx + hw + 4, baseTop + T * 0.18);
    x.stroke();
  });
  ink(x, found, 1.1);
  // timber wall
  const wall = rrect(fx - hw, wallTop, hw * 2, baseTop - wallTop + 1, 2);
  const wood = '#b88656';
  x.fillStyle = lin(x, fx - hw, 0, fx + hw, 0, [[0, lit(wood, 0.18)], [0.6, wood], [1, dk(wood, 0.3)]]);
  x.fill(wall);
  clipDo(x, wall, () => {
    for (let xx = fx - hw; xx < fx + hw; xx += 8) {
      x.fillStyle = rgba(R() < 0.5 ? '#fff0d0' : '#5a3a22', 0.08 + R() * 0.08);
      x.fillRect(xx, wallTop, 8, baseTop - wallTop);
      x.fillStyle = 'rgba(70,40,24,0.35)';
      x.fillRect(xx, wallTop, 1, baseTop - wallTop);
    }
    // eave shadow
    x.fillStyle = lin(x, 0, wallTop, 0, wallTop + 16, [[0, 'rgba(20,10,20,0.55)'], [1, 'rgba(20,10,20,0)']]);
    x.fillRect(fx - hw, wallTop, hw * 2, 16);
    // corner posts / beams
    x.fillStyle = '#6a4228';
    x.fillRect(fx - hw, wallTop, 6, baseTop - wallTop);
    x.fillRect(fx + hw - 6, wallTop, 6, baseTop - wallTop);
    x.fillRect(fx - hw, baseTop - 5, hw * 2, 5);
  });
  ink(x, wall, 1.2);
  // windows
  window4(x, fx - T * 1.45, wallTop + T * 0.8, T * 0.72, T * 0.55, '#5a3620');
  window4(x, fx + T * 1.45, wallTop + T * 0.8, T * 0.55, T * 0.55, '#5a3620', true);
  mapleLeaf(x, fx + T * 1.45, wallTop + T * 0.8, 7, 'rgba(200,70,40,0.75)', 0.2);
  // flower boxes
  for (const bx of [fx - T * 1.45]) {
    const box = rrect(bx - T * 0.42, wallTop + T * 1.12, T * 0.84, 7, 2);
    vol(x, box, bx - 20, 0, bx + 20, 0, '#7a4a2a');
    ink(x, box, 0.9);
    for (let i = 0; i < 7; i++) {
      x.fillStyle = pick(R, ['#f07a5a', '#f8d060', '#f4a6b6', '#6a9a48', '#5a8a40']);
      x.beginPath();
      x.arc(bx - T * 0.36 + i * 5.5, wallTop + T * 1.1 - R() * 3, 2.6, 0, TAU);
      x.fill();
    }
  }
  // door (center, where the path starts)
  const dw = T * 0.72;
  const dh = T * 1.2;
  const door = new Path2D();
  door.moveTo(fx - dw / 2, baseTop);
  door.lineTo(fx - dw / 2, baseTop - dh + dw / 2);
  door.arc(fx, baseTop - dh + dw / 2, dw / 2, Math.PI, 0);
  door.lineTo(fx + dw / 2, baseTop);
  door.closePath();
  vol(x, door, fx - dw / 2, baseTop - dh, fx + dw / 2, baseTop, '#7a4628', 0.2, 0.4);
  clipDo(x, door, () => {
    x.strokeStyle = 'rgba(40,20,10,0.5)';
    x.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      x.beginPath();
      x.moveTo(fx - dw / 2 + (k * dw) / 4, baseTop - dh);
      x.lineTo(fx - dw / 2 + (k * dw) / 4, baseTop);
      x.stroke();
    }
  });
  ink(x, door, 1.2);
  x.fillStyle = '#e8c060';
  x.beginPath();
  x.arc(fx + dw * 0.3, baseTop - dh * 0.4, 1.8, 0, TAU);
  x.fill();
  // step
  const step = rrect(fx - dw * 0.7, fy - 7, dw * 1.4, 7, 2);
  vol(x, step, fx - dw, fy - 7, fx + dw, fy, '#a09a8a');
  ink(x, step, 0.9);
  // maple sign above the door
  const sg = ellP(fx, wallTop + T * 0.22, T * 0.42, T * 0.24);
  vol(x, sg, fx - T * 0.4, wallTop, fx + T * 0.4, wallTop + T * 0.45, '#e8d8b0');
  ink(x, sg, 1.1);
  mapleLeaf(x, fx, wallTop + T * 0.2, T * 0.16, '#d0502e', 0);
  // roof (maple shingles)
  const eave = wallTop + 8;
  const ridge = fy - T * 4.75;
  const ov = T * 0.34;
  const roof = new Path2D();
  roof.moveTo(fx - hw - ov, eave);
  roof.lineTo(fx - hw + T * 0.3, ridge + 6);
  roof.quadraticCurveTo(fx, ridge - 6, fx + hw - T * 0.3, ridge + 6);
  roof.lineTo(fx + hw + ov, eave);
  roof.quadraticCurveTo(fx, eave + 7, fx - hw - ov, eave);
  roof.closePath();
  shadowE(x, fx, eave + 6, hw + ov, 10, 0.35);
  shingleRoof(x, roof, fx - hw - ov, ridge - 8, fx + hw + ov, eave + 8, ['#c0583a', '#d06a3c', '#b04632', '#d8843e', '#c8a040'], R, 8, 10);
  ink(x, roof, 1.3);
  // ridge cap
  line(x, [[fx - hw + T * 0.28, ridge + 6], [fx, ridge - 1], [fx + hw - T * 0.28, ridge + 6]], '#5a2a1c', 5);
  line(x, [[fx - hw + T * 0.28, ridge + 5], [fx, ridge - 2], [fx + hw - T * 0.28, ridge + 5]], 'rgba(255,200,150,0.35)', 1.5);
  // skylight & chimney
  const sky = poly([[fx - T * 1.2, ridge + T * 1.25], [fx - T * 1.1, ridge + T * 0.55], [fx - T * 0.4, ridge + T * 0.55], [fx - T * 0.3, ridge + T * 1.25]]);
  x.fillStyle = lin(x, 0, ridge + T * 0.55, 0, ridge + T * 1.25, [[0, '#bfe8f0'], [1, '#4a8a9a']]);
  x.fill(sky);
  x.strokeStyle = '#4a2a1c';
  x.lineWidth = 2;
  x.stroke(sky);
  x.strokeStyle = 'rgba(255,255,255,0.55)';
  x.lineWidth = 1.2;
  x.beginPath();
  x.moveTo(fx - T * 1.02, ridge + T * 1.1);
  x.lineTo(fx - T * 0.8, ridge + T * 0.7);
  x.stroke();
  const ch = rrect(fx + T * 1.15, ridge - T * 0.05, T * 0.36, T * 0.7, 2);
  vol(x, ch, fx + T * 1.15, ridge, fx + T * 1.5, ridge + T * 0.7, '#8a7c6c');
  ink(x, ch, 1.1);
  for (let i = 0; i < 4; i++) {
    const sx = fx + T * 1.33 + i * 5;
    const sy = ridge - T * 0.15 - i * 12;
    x.fillStyle = `rgba(240,236,230,${0.3 - i * 0.06})`;
    x.beginPath();
    x.arc(sx, sy, 5 + i * 2.5, 0, TAU);
    x.fill();
  }
  // weather vane (maple)
  line(x, [[fx, ridge - 1], [fx, ridge - T * 0.5]], '#3a2a20', 1.6);
  mapleLeaf(x, fx, ridge - T * 0.58, 6, '#e0643a', 0.4);
  // potted plants & a book crate by the door
  const pot = (px: number) => {
    const p = poly([[px - 6, fy - 12], [px + 6, fy - 12], [px + 4, fy - 2], [px - 4, fy - 2]]);
    vol(x, p, px - 6, fy - 12, px + 6, fy, '#b8683e');
    ink(x, p, 0.9);
    for (let i = 0; i < 6; i++) line(x, [[px, fy - 12], [px + (i - 2.5) * 3, fy - 20 - R() * 8]], i % 2 ? '#5a8a3a' : '#7aaa4a', 2);
  };
  pot(fx - dw * 0.95);
  pot(fx + dw * 1.0);
  const bc = rrect(fx + T * 1.7, fy - 16, 22, 14, 2);
  vol(x, bc, fx + T * 1.7, fy - 16, fx + T * 1.7 + 22, fy, '#9a6a3e');
  ink(x, bc, 0.9);
  x.fillStyle = '#f2ead8';
  x.fillRect(fx + T * 1.7 + 3, fy - 20, 7, 5);
  x.fillStyle = '#6a9ac8';
  x.fillRect(fx + T * 1.7 + 11, fy - 21, 6, 6);
  // ivy on the left corner
  for (let i = 0; i < 18; i++) {
    x.fillStyle = pick(R, ['#4e7a3a', '#6a9a48', '#3e6230']);
    x.beginPath();
    x.ellipse(fx - hw + 4 + R() * 12, wallTop + 6 + R() * (baseTop - wallTop), 3, 2, R() * 3, 0, TAU);
    x.fill();
  }
  return { canvas: c, footX: fx, footY: fy };
}

function house(R: () => number, variant: number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 6, T * 5.8, T * 0.2);
  const hw = T * 2.2;
  shadowE(x, fx + 8, fy - T * 0.7, T * 2.9, T * 1.2, 0.5);
  const floorY = fy - T * 0.85;
  const post = '#5e4230';
  // stilts + bracing
  for (let i = 0; i < 5; i++) {
    const px = fx - hw + 4 + (i / 4) * (hw * 2 - 8);
    const p = rrect(px - 3.5, floorY, 7, fy - floorY, 2);
    vol(x, p, px - 4, 0, px + 4, 0, post, 0.25, 0.4);
    ink(x, p, 1);
    shadowE(x, px + 2, fy - 1, 7, 3, 0.4);
  }
  x.strokeStyle = dk(post, 0.2);
  x.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    const a = fx - hw + 4 + (i / 4) * (hw * 2 - 8);
    const b = fx - hw + 4 + ((i + 1) / 4) * (hw * 2 - 8);
    x.beginPath();
    x.moveTo(a, floorY + 4);
    x.lineTo(b, fy - 6);
    x.stroke();
  }
  // platform
  const plat = rrect(fx - hw - 8, floorY - 5, hw * 2 + 16, 10, 2);
  vol(x, plat, fx - hw, floorY - 5, fx + hw, floorY + 5, '#8a6242', 0.3, 0.4);
  ink(x, plat, 1.1);
  const wallTop = fy - T * 2.35;
  const wall = rrect(fx - hw, wallTop, hw * 2, floorY - 5 - wallTop, 3);
  const straw = variant === 1 ? '#c4a676' : '#ccac74';
  x.fillStyle = lin(x, fx - hw, 0, fx + hw, 0, [[0, lit(straw, 0.2)], [0.6, straw], [1, dk(straw, 0.3)]]);
  x.fill(wall);
  clipDo(x, wall, () => {
    // woven wall: diagonal lattice
    x.lineWidth = 1.3;
    for (let k = -30; k < 40; k++) {
      const xx = fx - hw + k * 7;
      x.strokeStyle = 'rgba(120,80,40,0.35)';
      x.beginPath();
      x.moveTo(xx, wallTop);
      x.lineTo(xx + 70, floorY);
      x.stroke();
      x.strokeStyle = 'rgba(255,240,200,0.25)';
      x.beginPath();
      x.moveTo(xx + 70, wallTop);
      x.lineTo(xx, floorY);
      x.stroke();
    }
    x.fillStyle = lin(x, 0, wallTop, 0, wallTop + 18, [[0, 'rgba(20,10,20,0.55)'], [1, 'rgba(20,10,20,0)']]);
    x.fillRect(fx - hw, wallTop, hw * 2, 18);
    x.fillStyle = '#6a4a30';
    x.fillRect(fx - hw, wallTop, 5, floorY - wallTop);
    x.fillRect(fx + hw - 5, wallTop, 5, floorY - wallTop);
  });
  ink(x, wall, 1.2);
  // dyed cloth hanging from the rail (weavers' village)
  const cloth = poly([[fx + T * 0.95, wallTop + 10], [fx + T * 1.75, wallTop + 10], [fx + T * 1.7, floorY - 8], [fx + T * 0.98, floorY - 10]]);
  const clothCols = variant === 1 ? ['#c85a4a', '#e8c070', '#3a6aa0'] : ['#2f8aa0', '#3ee0c8', '#e8a040'];
  x.fillStyle = clothCols[0];
  x.fill(cloth);
  clipDo(x, cloth, () => {
    for (let k = 0; k < 6; k++) {
      x.fillStyle = clothCols[1 + (k % 2)];
      x.fillRect(fx + T * 0.9, wallTop + 14 + k * 9, T, 3);
    }
    x.fillStyle = 'rgba(0,0,0,0.2)';
    x.fillRect(fx + T * 1.45, wallTop, T, T * 2);
  });
  ink(x, cloth, 1);
  // round door + round window
  const door = ellP(fx - T * 0.3, floorY - T * 0.55, T * 0.34, T * 0.46);
  x.fillStyle = radG(x, fx - T * 0.3, floorY - T * 0.5, 2, T * 0.5, [[0, '#6a4020'], [1, '#2a1a10']]);
  x.fill(door);
  x.strokeStyle = '#5a3a22';
  x.lineWidth = 3;
  x.stroke(door);
  ink(x, door, 1);
  // bead curtain
  for (let k = -2; k <= 2; k++) line(x, [[fx - T * 0.3 + k * 5, floorY - T * 0.95], [fx - T * 0.3 + k * 5, floorY - T * 0.35]], rgba('#e8c070', 0.6), 1.2);
  window4(x, fx - T * 1.4, wallTop + T * 0.72, T * 0.5, T * 0.5, '#5a3a22', true);
  // ladder
  for (const s of [-1, 1]) line(x, [[fx - T * 0.3 + s * 8, floorY + 3], [fx - T * 0.3 + s * 11, fy]], '#6a4a30', 3);
  for (let k = 1; k < 4; k++) {
    const yy = floorY + (k / 4) * (fy - floorY);
    line(x, [[fx - T * 0.3 - 9, yy], [fx - T * 0.3 + 9, yy]], '#7a5a3a', 2.5);
  }
  // woven dome roof (two tiers)
  const eave = wallTop + 10;
  const roofTop = fy - T * 5.35;
  const rw = hw + T * 0.45;
  const roof = new Path2D();
  roof.moveTo(fx - rw, eave);
  roof.bezierCurveTo(fx - rw * 0.98, eave - T * 1.5, fx - rw * 0.55, roofTop + T * 0.5, fx, roofTop + T * 0.35);
  roof.bezierCurveTo(fx + rw * 0.55, roofTop + T * 0.5, fx + rw * 0.98, eave - T * 1.5, fx + rw, eave);
  roof.quadraticCurveTo(fx, eave + 10, fx - rw, eave);
  roof.closePath();
  shadowE(x, fx, eave + 8, rw, 10, 0.35);
  const thatch = '#c8a060';
  x.fillStyle = radG(x, fx - rw * 0.3, eave - T * 1.6, 5, rw * 1.6, [[0, lit(thatch, 0.35)], [0.45, thatch], [1, dk(thatch, 0.5)]]);
  x.fill(roof);
  clipDo(x, roof, () => {
    // woven bands following the dome
    for (let k = 0; k < 11; k++) {
      const t = k / 10;
      const yy = eave - t * (eave - roofTop - T * 0.35);
      const ww = rw * Math.sqrt(1 - t * t * 0.9);
      x.strokeStyle = 'rgba(110,70,30,0.5)';
      x.lineWidth = 1.5;
      x.beginPath();
      x.ellipse(fx, yy, ww, 7 * (1 - t * 0.6), 0, 0, Math.PI);
      x.stroke();
      x.strokeStyle = 'rgba(255,236,180,0.3)';
      x.lineWidth = 1;
      x.beginPath();
      x.ellipse(fx, yy - 2, ww, 7 * (1 - t * 0.6), 0, 0.2, Math.PI * 0.55);
      x.stroke();
    }
    // ribs
    for (let k = -5; k <= 5; k++) {
      x.strokeStyle = 'rgba(100,60,28,0.4)';
      x.lineWidth = 1.2;
      x.beginPath();
      x.moveTo(fx + k * rw * 0.19, eave + 6);
      x.quadraticCurveTo(fx + k * rw * 0.16, eave - T * 1.8, fx, roofTop + T * 0.35);
      x.stroke();
    }
  });
  ink(x, roof, 1.3);
  // fringe along the eave
  for (let k = 0; k < 40; k++) {
    const t = k / 39;
    const ex = fx - rw + t * rw * 2;
    const ey = eave + Math.sin(t * Math.PI) * 7;
    line(x, [[ex, ey - 2], [ex + (R() - 0.5) * 2, ey + 5 + R() * 3]], k % 2 ? '#9a7040' : '#d8b070', 1.6);
  }
  // top cap
  const cap = new Path2D();
  cap.moveTo(fx - T * 0.55, roofTop + T * 0.55);
  cap.quadraticCurveTo(fx - T * 0.5, roofTop - T * 0.1, fx, roofTop - T * 0.25);
  cap.quadraticCurveTo(fx + T * 0.5, roofTop - T * 0.1, fx + T * 0.55, roofTop + T * 0.55);
  cap.closePath();
  vol(x, cap, fx - T * 0.5, roofTop - T * 0.25, fx + T * 0.5, roofTop + T * 0.55, '#b88a4e', 0.3, 0.4);
  ink(x, cap, 1.1);
  line(x, [[fx, roofTop - T * 0.25], [fx + 3, roofTop - T * 0.55]], '#6a4a30', 2);
  x.fillStyle = HEK;
  x.beginPath();
  x.arc(fx + 3, roofTop - T * 0.58, 2.5, 0, TAU);
  x.fill();
  glow(x, fx + 3, roofTop - T * 0.58, 8, HEK, 0.4);
  return { canvas: c, footX: fx, footY: fy };
}

function greatTree(R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 9.4, T * 11, T * 0.45);
  const bark = '#6a5040';
  shadowE(x, fx + 12, fy - T * 1.7, T * 4.3, T * 2.0, 0.55);
  // trunk
  const tb = fy - T * 1.2;
  // root flares: thick, tapered, hugging the deck. Back ones behind the trunk, front ones over it.
  const root = (s: number, start: number, reach: number, drop: number, wk: number) => {
    const sx = fx + s * T * start;
    const sy = tb - T * 0.55 + Math.abs(drop) * T * 0.2;
    const ex = fx + s * T * reach;
    const ey = tb + T * drop;
    const cx = fx + s * T * ((start + reach) * 0.5 + 0.25);
    const cy = sy + (ey - sy) * 0.1 - T * 0.12;
    const pts: Pt[] = [];
    const left: Pt[] = [];
    const right: Pt[] = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      pts.push([mt * mt * sx + 2 * mt * t * cx + t * t * ex, mt * mt * sy + 2 * mt * t * cy + t * t * ey]);
    }
    for (let i = 0; i <= n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n, i + 1)];
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const w = (T * 0.95 * wk * (1 - i / n) ** 1.1 + 7) / 2;
      left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
      right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
    }
    const rp = smooth([...left, ...right.reverse()], true, 0.8);
    shadowE(x, ex + 4, ey + 3, T * 0.6, T * 0.16, 0.35);
    vol(x, rp, Math.min(sx, ex), sy - T * 0.4, Math.max(sx, ex), ey + 8, bark, 0.3, 0.5);
    clipDo(x, rp, () => {
      x.strokeStyle = rgba(dk(bark, 0.6), 0.4);
      x.lineWidth = 1;
      x.stroke(smooth(pts, false));
      x.fillStyle = rgba('#6e9a48', 0.6);
      for (let k = 0; k < 4; k++) {
        const pp = pts[1 + Math.floor(R() * (n - 3))];
        x.beginPath();
        x.ellipse(pp[0] - 3, pp[1] - 5, 4 + R() * 5, 2 + R() * 2, 0, 0, TAU);
        x.fill();
      }
    });
    ink(x, rp, 1.2);
  };
  root(-1, 1.2, 3.5, -0.6, 0.85);
  root(1, 1.2, 3.3, -0.65, 0.8);
  root(-1, 1.45, 3.0, 0.3, 1.0);
  root(1, 1.45, 3.2, 0.25, 1.0);
  const tt = fy - T * 6.4;
  const trunk = smooth([
    [fx - T * 1.75, tb], [fx - T * 1.2, tb - T * 1.2], [fx - T * 1.05, tb - T * 2.6], [fx - T * 1.2, tt + T * 0.6], [fx - T * 1.9, tt - T * 0.4],
    [fx - T * 0.6, tt], [fx + T * 0.1, tt - T * 0.6], [fx + T * 0.7, tt], [fx + T * 1.9, tt - T * 0.3], [fx + T * 1.15, tt + T * 0.7],
    [fx + T * 1.05, tb - T * 2.5], [fx + T * 1.25, tb - T * 1.1], [fx + T * 1.8, tb], [fx, tb + T * 0.25],
  ], true, 0.9);
  x.fillStyle = lin(x, fx - T * 1.8, 0, fx + T * 1.8, 0, [[0, lit(bark, 0.25)], [0.35, bark], [0.8, dk(bark, 0.35)], [1, dk(bark, 0.55)]]);
  x.fill(trunk);
  clipDo(x, trunk, () => {
    // ridged bark
    for (let i = 0; i < 22; i++) {
      const bx = fx - T * 1.6 + (i / 21) * T * 3.2;
      const p = smooth([[bx, tb + 4], [bx + (R() - 0.5) * 10, tb - T * 2], [bx * 0.9 + fx * 0.1 + (R() - 0.5) * 10, tt + T * 0.5], [fx + (bx - fx) * 1.3, tt - T * 0.5]], false);
      stroke(x, p, rgba(dk(bark, 0.6), 0.45), 2);
      x.save();
      x.translate(-2, 0);
      stroke(x, p, rgba(lit(bark, 0.4), 0.18), 1.5);
      x.restore();
    }
    // withering: pale dry patches
    for (let i = 0; i < 7; i++) {
      x.fillStyle = rgba('#b8a888', 0.18);
      x.beginPath();
      x.ellipse(fx + (R() - 0.5) * T * 2, tb - R() * T * 4.5, 8 + R() * 12, 14 + R() * 20, 0, 0, TAU);
      x.fill();
    }
    // moss on the lit side
    x.fillStyle = rgba('#6e9a48', 0.55);
    for (let i = 0; i < 16; i++) {
      x.beginPath();
      x.ellipse(fx - T * 1.1 + R() * T * 0.8, tb - R() * T * 4.5, 3 + R() * 5, 5 + R() * 7, 0, 0, TAU);
      x.fill();
    }
    // hollow
    x.fillStyle = radG(x, fx + T * 0.35, tb - T * 0.75, 2, T * 0.55, [[0, '#0e0a0a'], [1, '#3a2a22']]);
    x.beginPath();
    x.ellipse(fx + T * 0.35, tb - T * 0.7, T * 0.36, T * 0.52, 0, 0, TAU);
    x.fill();
    // top shade under canopy
    x.fillStyle = lin(x, 0, tt - T * 0.5, 0, tt + T * 1.8, [[0, 'rgba(10,12,20,0.7)'], [1, 'rgba(10,12,20,0)']]);
    x.fillRect(fx - T * 3, tt - T, T * 6, T * 3);
  });
  ink(x, trunk, 1.5);
  root(-1, 0.95, 2.6, 0.7, 0.9);
  root(1, 0.9, 2.4, 0.75, 0.85);
  root(-1, 0.25, 1.1, 0.95, 0.75);
  // glowing ring carved into the trunk + veins
  const ry = tb - T * 2.1;
  x.save();
  x.globalCompositeOperation = 'lighter';
  glow(x, fx - T * 0.2, ry, T * 1.2, HEK, 0.3);
  x.shadowColor = HEK;
  x.shadowBlur = 10;
  x.strokeStyle = 'rgba(120,250,225,0.85)';
  x.lineWidth = 2.6;
  x.beginPath();
  x.ellipse(fx - T * 0.2, ry, T * 0.42, T * 0.45, 0, 0, TAU);
  x.stroke();
  x.lineWidth = 1.3;
  x.strokeStyle = 'rgba(90,230,205,0.5)';
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const p = smooth([[fx - T * 0.2 + s * T * 0.4, ry + (k - 0.5) * 10], [fx + s * T * (0.7 + R() * 0.2), ry + (k ? 30 : -30)], [fx + s * T * (0.9 + R() * 0.3), ry + (k ? 70 : -70)]], false);
      x.stroke(p);
    }
  }
  x.restore();
  // wrap-around deck (front half) with railing, and stairs on the right
  const dy = tb - T * 3.2;
  const drx = T * 2.3;
  const dry = T * 0.62;
  const deckTop = new Path2D();
  deckTop.ellipse(fx, dy, drx, dry, 0, 0, Math.PI);
  deckTop.ellipse(fx, dy - 2, drx * 0.52, dry * 0.5, 0, Math.PI, 0, true);
  deckTop.closePath();
  // brackets
  for (let k = -3; k <= 3; k++) {
    const bx = fx + k * drx * 0.28;
    const by = dy + Math.sqrt(1 - (k * 0.28) ** 2) * dry;
    line(x, [[bx, by], [fx + k * T * 0.3, by + T * 0.7]], '#4a3222', 3.5);
  }
  const rim = new Path2D();
  rim.ellipse(fx, dy, drx, dry, 0, 0, Math.PI);
  rim.lineTo(fx - drx, dy + 7);
  rim.ellipse(fx, dy + 7, drx, dry, 0, Math.PI, 0, true);
  rim.closePath();
  x.fillStyle = '#5a3a26';
  x.fill(rim);
  x.fillStyle = lin(x, 0, dy - dry, 0, dy + dry, [[0, '#c8966a'], [1, '#8a6040']]);
  x.fill(deckTop);
  clipDo(x, deckTop, () => {
    x.strokeStyle = 'rgba(70,40,24,0.55)';
    x.lineWidth = 1;
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI;
      x.beginPath();
      x.moveTo(fx + Math.cos(a) * drx * 0.5, dy + Math.sin(a) * dry * 0.5);
      x.lineTo(fx + Math.cos(a) * drx, dy + Math.sin(a) * dry);
      x.stroke();
    }
  });
  ink(x, rim, 1.1);
  // railing
  const railY = -T * 0.42;
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI;
    const px = fx + Math.cos(a) * drx * 0.97;
    const py = dy + Math.sin(a) * dry * 0.97;
    line(x, [[px, py], [px, py + railY]], '#5a3a26', 2.4);
  }
  const rail = new Path2D();
  rail.ellipse(fx, dy + railY, drx * 0.97, dry * 0.97, 0, 0, Math.PI);
  stroke(x, rail, '#4a2e1e', 4);
  stroke(x, rail, '#a07048', 2);
  // hanging lanterns on the rail
  for (const a of [0.35, 1.2, 2.1, 2.8]) {
    const px = fx + Math.cos(a) * drx * 0.97;
    const py = dy + Math.sin(a) * dry * 0.97 + railY;
    line(x, [[px, py], [px, py + 9]], '#2a2020', 1);
    glow(x, px, py + 13, 16, '#ffc070', 0.5);
    x.fillStyle = radG(x, px, py + 13, 0, 5, [[0, '#fff0c0'], [1, '#e0782e']]);
    x.beginPath();
    x.ellipse(px, py + 13, 3.8, 4.8, 0, 0, TAU);
    x.fill();
  }
  // spiral stairs on the right front
  for (let k = 0; k < 11; k++) {
    const t = k / 10;
    const sx = fx + T * (2.35 - t * 0.55) + Math.sin(t * 2.2) * T * 0.25;
    const sy = fy - T * 1.0 - t * (fy - T * 1.0 - (dy + dry * 0.5));
    const st = rrect(sx - T * 0.38, sy - 4, T * 0.76, 7, 2);
    vol(x, st, sx - T * 0.4, sy - 4, sx + T * 0.4, sy + 3, '#b0825a', 0.3, 0.4);
    ink(x, st, 0.9);
    if (k % 2 === 0) line(x, [[sx + T * 0.36, sy + 3], [sx + T * 0.36, sy - T * 0.4]], '#5a3a26', 2);
  }
  line(x, [[fx + T * 2.7, fy - T * 1.4], [fx + T * 2.4, fy - T * 2.4], [fx + T * 2.0, dy - T * 0.2]], '#8a5e3a', 2.5);
  // canopy: huge, a bit tired (yellowing clumps)
  const cl: [number, number, number][] = [];
  const ccx = fx;
  const ccy = fy - T * 8.0;
  for (let i = 0; i < 26; i++) {
    const a = R() * TAU;
    const d = Math.sqrt(R());
    cl.push([ccx + Math.cos(a) * d * T * 3.4, ccy + Math.sin(a) * d * T * 1.7, T * (0.7 + R() * 0.45)]);
  }
  for (let i = 0; i < 7; i++) cl.push([ccx + (i / 6 - 0.5) * T * 7.2, ccy + T * 1.2 + (R() - 0.5) * 10 - Math.abs(i / 6 - 0.5) * T, T * (0.72 + R() * 0.2)]);
  // limbs into the crown
  for (const s of [-1, 1]) {
    for (const k of [0.6, 1.4]) {
      const p = smooth([[fx + s * T * 0.4, tt + T * 0.3], [fx + s * T * (1.2 * k), tt - T * 0.8], [fx + s * T * (2.2 * k), ccy + T * 0.6]], false);
      stroke(x, p, dk(bark, 0.4), 11 - k * 3);
      stroke(x, p, bark, 8 - k * 3);
    }
  }
  const [lc, l] = mk(c.width, c.height);
  paintCanopy(l, c.width, c.height, cl, R, { cols: ['#2c4a2c', '#5a7e3e', '#a8b85e'], sun: '#ffe6a8' });
  // yellowing: clusters of tired ochre leaves on some clumps (painted leaves, not a glow)
  l.save();
  l.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 5; i++) {
    const c0 = cl[Math.floor(R() * cl.length)];
    for (let k = 0; k < 34; k++) {
      const a = R() * TAU;
      const d = Math.sqrt(R()) * c0[2] * 0.95;
      const lx = c0[0] + Math.cos(a) * d;
      const ly = c0[1] + Math.sin(a) * d;
      const up = c0[1] - ly + (c0[0] - lx) * 0.5;
      l.fillStyle = rgba(pick(R, up > 0 ? ['#d8c060', '#e0c870', '#c8a848'] : ['#a08434', '#8a7430', '#b09040']), 0.85);
      l.beginPath();
      l.ellipse(lx, ly, 2.4 + R() * 2.2, 1.4 + R() * 1.2, R() * TAU, 0, TAU);
      l.fill();
    }
  }
  l.restore();
  x.drawImage(lc, 0, 0);
  // falling yellow leaves + turquoise motes
  for (let i = 0; i < 14; i++) {
    const lx = fx + (R() - 0.5) * T * 7;
    const ly = ccy + T * 1.2 + R() * T * 4;
    x.fillStyle = pick(R, ['#e8c050', '#d8a040', '#c8b060']);
    x.beginPath();
    x.ellipse(lx, ly, 3, 1.6, R() * TAU, 0, TAU);
    x.fill();
  }
  for (let i = 0; i < 10; i++) glow(x, fx + (R() - 0.5) * T * 6, ccy + (R() - 0.3) * T * 3, 6 + R() * 5, HEK, 0.55);
  glow(x, fx, ccy, T * 3.5, HEK, 0.06);
  return { canvas: c, footX: fx, footY: fy };
}

// --- 灰星局 (Ashstar bureau) -------------------------------------------------------------------

function tent(R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 4, T * 3.4, T * 0.25);
  const hw = T * 1.5;
  shadowE(x, fx + 8, fy - T * 0.7, T * 2.0, T * 0.95, 0.5);
  const canvasC = '#8e9296';
  const apexF: Pt = [fx, fy - T * 1.75];
  const apexB: Pt = [fx + 2, fy - T * 2.65];
  const gl: Pt = [fx - hw, fy - 2];
  const gr: Pt = [fx + hw, fy - 2];
  const bl: Pt = [fx - hw + 4, fy - T * 1.05];
  const br: Pt = [fx + hw + 4, fy - T * 1.05];
  const left = poly([gl, apexF, apexB, bl]);
  const right = poly([gr, apexF, apexB, br]);
  vol(x, left, bl[0], apexB[1], apexF[0], gl[1], lit(canvasC, 0.12), 0.2, 0.2);
  x.fillStyle = lin(x, apexF[0], 0, br[0], 0, [[0, dk(canvasC, 0.2)], [1, dk(canvasC, 0.45)]]);
  x.fill(right);
  const stripe = (p: Path2D, a: Pt, b: Pt, c2: Pt, d: Pt) => {
    clipDo(x, p, () => {
      for (const t of [0.45, 0.62]) {
        const p1: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const p2: Pt = [d[0] + (c2[0] - d[0]) * t, d[1] + (c2[1] - d[1]) * t];
        x.strokeStyle = '#ff8a2a';
        x.lineWidth = 5;
        x.beginPath();
        x.moveTo(p1[0], p1[1]);
        x.lineTo(p2[0], p2[1]);
        x.stroke();
        x.strokeStyle = 'rgba(255,236,190,0.7)';
        x.lineWidth = 1.2;
        x.beginPath();
        x.moveTo(p1[0], p1[1] - 1.5);
        x.lineTo(p2[0], p2[1] - 1.5);
        x.stroke();
      }
      // ash streaks
      x.fillStyle = 'rgba(60,58,58,0.2)';
      for (let i = 0; i < 6; i++) {
        x.beginPath();
        x.ellipse(a[0] + (b[0] - a[0]) * R() + (R() - 0.5) * 30, a[1] + (b[1] - a[1]) * R(), 8, 3, 0.5, 0, TAU);
        x.fill();
      }
    });
  };
  stripe(left, gl, apexF, apexB, bl);
  stripe(right, gr, apexF, apexB, br);
  ink(x, left, 1.2);
  ink(x, right, 1.2);
  // front gable with open door
  const gable = poly([gl, apexF, gr]);
  vol(x, gable, gl[0], apexF[1], gr[0], gl[1], canvasC, 0.25, 0.3);
  clipDo(x, gable, () => {
    x.fillStyle = '#ff8a2a';
    x.fillRect(gl[0], fy - T * 0.34, hw * 2, 5);
    x.fillStyle = 'rgba(255,236,190,0.7)';
    x.fillRect(gl[0], fy - T * 0.34, hw * 2, 1.2);
  });
  ink(x, gable, 1.2);
  const door = poly([[fx - T * 0.5, fy - 2], [fx, fy - T * 1.35], [fx + T * 0.5, fy - 2]]);
  x.fillStyle = lin(x, 0, fy - T * 1.3, 0, fy, [[0, '#1a1a20'], [1, '#34343c']]);
  x.fill(door);
  // tied-back flaps
  for (const s of [-1, 1]) {
    const flap = poly([[fx + s * T * 0.02, fy - T * 1.33], [fx + s * T * 0.56, fy - 2], [fx + s * T * 0.8, fy - 3], [fx + s * T * 0.3, fy - T * 0.9]]);
    vol(x, flap, fx, fy - T * 1.3, fx + s * T * 0.8, fy, lit(canvasC, 0.15));
    ink(x, flap, 1);
  }
  // emblem above the door: ash star in a ring
  const ex = fx;
  const ey = fy - T * 1.45;
  x.fillStyle = '#3a3c42';
  x.beginPath();
  x.arc(ex, ey, 7.5, 0, TAU);
  x.fill();
  x.strokeStyle = '#ff8a2a';
  x.lineWidth = 1.6;
  x.stroke();
  star(x, ex, ey, 5, '#e8e6e2');
  // guy ropes + stakes
  for (const [px, py, sx, sy] of [[gl[0] + 10, fy - T * 0.4, gl[0] - T * 0.3, fy - T * 0.1], [gr[0] - 10, fy - T * 0.4, gr[0] + T * 0.3, fy - T * 0.1], [bl[0] + 8, fy - T * 1.3, bl[0] - T * 0.3, fy - T * 1.1], [br[0] - 4, fy - T * 1.3, br[0] + T * 0.35, fy - T * 1.1]] as [number, number, number, number][]) {
    line(x, [[px, py], [sx, sy]], 'rgba(230,226,220,0.7)', 1);
    x.fillStyle = '#ff8a2a';
    x.fillRect(sx - 1.5, sy - 4, 3, 6);
  }
  // antenna with orange light at the back
  line(x, [[apexB[0] + 4, apexB[1] + 4], [apexB[0] + 8, apexB[1] - T * 0.7]], '#2a2c30', 1.6);
  glow(x, apexB[0] + 8, apexB[1] - T * 0.7, 9, '#ff8a2a', 0.8);
  return { canvas: c, footX: fx, footY: fy };
}

function device(R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 3.4, T * 4, T * 0.3);
  const hw = T * 0.95;
  // orange glow on the ground
  glow(x, fx, fy - T * 0.7, T * 1.7, '#ff8a2a', 0.35);
  shadowE(x, fx + 6, fy - T * 0.6, T * 1.3, T * 0.62, 0.55);
  // cables snaking out
  const cables: Pt[][] = [
    [[fx - T * 0.5, fy - T * 0.5], [fx - T * 1.1, fy - T * 0.2], [fx - T * 1.5, fy - T * 0.5], [fx - T * 1.6, fy - T * 0.05]],
    [[fx + T * 0.5, fy - T * 0.45], [fx + T * 1.1, fy - T * 0.1], [fx + T * 1.3, fy - T * 0.6], [fx + T * 1.65, fy - T * 0.35]],
    [[fx + T * 0.2, fy - T * 0.25], [fx + T * 0.5, fy + 2], [fx + T * 1.0, fy + 4]],
  ];
  for (const cb of cables) {
    const p = smooth(cb, false);
    stroke(x, p, '#16161a', 6);
    stroke(x, p, '#3a3c44', 3.5);
    x.save();
    x.translate(-0.8, -1);
    stroke(x, p, 'rgba(200,200,210,0.35)', 1);
    x.restore();
  }
  // base plate
  const plate = rrect(fx - hw, fy - T * 1.7, hw * 2, T * 1.45, 6);
  vol(x, plate, fx - hw, fy - T * 1.7, fx + hw, fy - T * 0.25, '#4a4c52', 0.25, 0.4);
  ink(x, plate, 1.2);
  const lip = rrect(fx - hw, fy - T * 0.4, hw * 2, T * 0.3, 4);
  x.fillStyle = '#2a2a30';
  x.fill(lip);
  clipDo(x, lip, () => {
    for (let k = -10; k < 10; k++) {
      x.fillStyle = '#f0b030';
      x.beginPath();
      x.moveTo(fx + k * 10, fy - T * 0.1);
      x.lineTo(fx + k * 10 + 5, fy - T * 0.1);
      x.lineTo(fx + k * 10 + 13, fy - T * 0.4);
      x.lineTo(fx + k * 10 + 8, fy - T * 0.4);
      x.fill();
    }
  });
  ink(x, lip, 1.1);
  x.fillStyle = '#9a9ca4';
  for (const [bx, by] of [[-hw + 6, -T * 1.6], [hw - 6, -T * 1.6], [-hw + 6, -T * 0.55], [hw - 6, -T * 0.55]] as Pt[]) {
    x.beginPath();
    x.arc(fx + bx, fy + by, 2, 0, TAU);
    x.fill();
  }
  // control box on the left
  const cb = rrect(fx - hw + 4, fy - T * 1.35, T * 0.5, T * 0.6, 3);
  vol(x, cb, fx - hw, fy - T * 1.35, fx - hw + T * 0.5, fy - T * 0.75, '#5a5e66');
  ink(x, cb, 1);
  for (let k = 0; k < 3; k++) {
    x.fillStyle = k === 0 ? '#ff4a3a' : k === 1 ? '#ffb030' : '#6aff9a';
    x.beginPath();
    x.arc(fx - hw + 10 + k * 6, fy - T * 1.2, 1.8, 0, TAU);
    x.fill();
  }
  // central reactor cylinder
  const cx = fx + T * 0.12;
  const bot = fy - T * 0.75;
  const top = fy - T * 2.9;
  const r = T * 0.52;
  const cyl = new Path2D();
  cyl.moveTo(cx - r, top);
  cyl.lineTo(cx - r, bot);
  cyl.ellipse(cx, bot, r, r * 0.4, 0, Math.PI, 0, true);
  cyl.lineTo(cx + r, top);
  cyl.closePath();
  x.fillStyle = lin(x, cx - r, 0, cx + r, 0, [[0, '#9a9ea6'], [0.3, '#70747c'], [0.75, '#3e4048'], [1, '#26282e']]);
  x.fill(cyl);
  clipDo(x, cyl, () => {
    for (const yy of [top + 10, bot - 10]) {
      x.fillStyle = '#2a2c32';
      x.fillRect(cx - r, yy - 3, r * 2, 6);
      x.fillStyle = 'rgba(220,220,230,0.3)';
      x.fillRect(cx - r, yy - 3, r * 2, 1);
    }
    // vents
    for (let k = 0; k < 4; k++) {
      x.fillStyle = 'rgba(20,20,24,0.6)';
      x.fillRect(cx + r * 0.2, top + 22 + k * 5, r * 0.6, 2);
    }
  });
  ink(x, cyl, 1.3);
  // glowing core window
  const coreY = (top + bot) / 2 + 4;
  x.save();
  x.globalCompositeOperation = 'lighter';
  glow(x, cx, coreY, T * 1.1, '#ff8a2a', 0.55);
  x.restore();
  const win = ellP(cx - 3, coreY, r * 0.62, T * 0.34);
  x.fillStyle = radG(x, cx - 3, coreY, 1, T * 0.4, [[0, '#fff4c0'], [0.35, '#ffb040'], [0.8, '#ff6a1a'], [1, '#8a2a10']]);
  x.fill(win);
  x.strokeStyle = '#1e1e24';
  x.lineWidth = 3;
  x.stroke(win);
  // cracked hekikan ring being forced inside the core
  x.strokeStyle = 'rgba(62,224,200,0.8)';
  x.lineWidth = 1.6;
  x.beginPath();
  x.arc(cx - 3, coreY, 7, 0.3, TAU - 0.5);
  x.stroke();
  // top cap + antenna mast
  const capP = ellP(cx, top, r, r * 0.4);
  vol(x, capP, cx - r, top - r * 0.4, cx + r, top + r * 0.4, '#8a8e96', 0.3, 0.3);
  ink(x, capP, 1.1);
  line(x, [[cx + 4, top - 2], [cx + 6, top - T * 0.95]], '#1e1e24', 2.5);
  line(x, [[cx - 6, top - T * 0.55], [cx + 16, top - T * 0.6]], '#1e1e24', 1.5);
  glow(x, cx + 6, top - T * 0.98, 12, '#ff3b2a', 0.9);
  x.fillStyle = '#ffd0c0';
  x.beginPath();
  x.arc(cx + 6, top - T * 0.98, 2, 0, TAU);
  x.fill();
  // hazard sign
  const hz = poly([[cx - r - 2, bot - 26], [cx - r - 12, bot - 8], [cx - r + 8, bot - 8]]);
  x.fillStyle = '#f0b030';
  x.fill(hz);
  ink(x, hz, 1);
  x.fillStyle = '#1e1e24';
  x.fillRect(cx - r - 3, bot - 20, 2, 6);
  x.fillRect(cx - r - 3, bot - 12, 2, 2);
  // sparks + turquoise wisps being pulled in
  for (let i = 0; i < 5; i++) sparkle(x, cx + (R() - 0.5) * T * 1.4, coreY + (R() - 0.5) * T * 1.2, 2 + R() * 2, '#ffd080');
  for (let i = 0; i < 3; i++) {
    const a = R() * TAU;
    const d = T * (0.9 + R() * 0.4);
    const p = smooth([[cx + Math.cos(a) * d, coreY + Math.sin(a) * d * 0.6], [cx + Math.cos(a + 0.6) * d * 0.6, coreY + Math.sin(a + 0.6) * d * 0.4], [cx, coreY]], false);
    stroke(x, p, 'rgba(62,224,200,0.35)', 2);
  }
  return { canvas: c, footX: fx, footY: fy };
}

// --- shrine ----------------------------------------------------------------------------------

function stonePillar(x: Ctx, cx: number, bottom: number, top: number, w: number, R: () => number, stone: string): void {
  const p = smooth([[cx - w * 0.55, bottom], [cx - w * 0.5, (bottom + top) / 2], [cx - w * 0.44, top + 4], [cx - w * 0.3, top], [cx + w * 0.3, top], [cx + w * 0.44, top + 4], [cx + w * 0.5, (bottom + top) / 2], [cx + w * 0.55, bottom]], true, 0.4);
  vol(x, p, cx - w / 2, top, cx + w / 2, bottom, stone, 0.3, 0.5);
  clipDo(x, p, () => {
    x.fillStyle = 'rgba(10,20,26,0.3)';
    x.fillRect(cx + w * 0.12, top, w, bottom - top);
    for (const t of [0.18, 0.82]) {
      const yy = top + (bottom - top) * t;
      x.fillStyle = 'rgba(10,20,26,0.35)';
      x.fillRect(cx - w, yy, w * 2, 4);
      x.fillStyle = 'rgba(220,240,235,0.25)';
      x.fillRect(cx - w, yy - 1, w * 2, 1.2);
    }
    x.fillStyle = rgba('#4e8a5c', 0.75);
    for (let i = 0; i < 10; i++) {
      x.beginPath();
      x.ellipse(cx - w * 0.3 + (R() - 0.5) * w * 0.5, bottom - R() * (bottom - top) * 0.5, 2 + R() * 4, 3 + R() * 5, 0, 0, TAU);
      x.fill();
    }
  });
  ink(x, p, 1.2);
  // glowing runes down the pillar
  x.save();
  x.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const yy = top + (bottom - top) * (0.32 + k * 0.16);
    glow(x, cx - 2, yy, 8, HEK, 0.35);
    rune(x, cx - 2, yy, 3.2, (k * 2 + 1) % 6, 0.85);
  }
  x.restore();
}

function shrineGate(R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 5.2, T * 5.4, T * 0.3);
  const stone = '#7a8c88';
  const px = T * 1.85;
  shadowE(x, fx - px + 6, fy - 2, T * 0.6, T * 0.2, 0.55);
  shadowE(x, fx + px + 6, fy - 2, T * 0.6, T * 0.2, 0.55);
  const top = fy - T * 3.4;
  for (const s of [-1, 1]) {
    // base block
    const b = rrect(fx + s * px - T * 0.42, fy - T * 0.34, T * 0.84, T * 0.34, 3);
    vol(x, b, fx + s * px - T * 0.42, fy - T * 0.34, fx + s * px + T * 0.42, fy, dk(stone, 0.1));
    ink(x, b, 1.1);
    stonePillar(x, fx + s * px, fy - T * 0.3, top, T * 0.56, R, stone);
  }
  // crescent arch
  const ay = top + T * 0.25;
  const arch = new Path2D();
  arch.moveTo(fx - px - T * 0.45, ay + 6);
  arch.quadraticCurveTo(fx, ay - T * 1.9, fx + px + T * 0.45, ay + 6);
  arch.lineTo(fx + px + T * 0.2, ay + T * 0.35);
  arch.quadraticCurveTo(fx, ay - T * 1.2, fx - px - T * 0.2, ay + T * 0.35);
  arch.closePath();
  vol(x, arch, fx - px, ay - T * 1.4, fx + px, ay + T * 0.4, stone, 0.3, 0.45);
  clipDo(x, arch, () => {
    x.fillStyle = rgba('#4e8a5c', 0.7);
    for (let i = 0; i < 14; i++) {
      const t = R();
      x.beginPath();
      x.ellipse(fx - px + t * px * 2, ay - Math.sin(t * Math.PI) * T * 0.95 - 3, 3 + R() * 5, 2 + R() * 2, 0, 0, TAU);
      x.fill();
    }
  });
  ink(x, arch, 1.3);
  // runes along the arch
  x.save();
  x.globalCompositeOperation = 'lighter';
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    const rx = fx - px + t * px * 2;
    const ryy = ay - Math.sin(t * Math.PI) * T * 0.8 + 4;
    rune(x, rx, ryy, 2.6, k % 6, 0.75);
  }
  x.restore();
  // keystone ring
  const kx = fx;
  const ky = ay - T * 0.95;
  const ring = new Path2D();
  ring.arc(kx, ky, T * 0.5, 0, TAU);
  ring.arc(kx, ky, T * 0.32, 0, TAU, true);
  vol(x, ring, kx - T * 0.5, ky - T * 0.5, kx + T * 0.5, ky + T * 0.5, lit(stone, 0.05), 0.35, 0.5);
  ink(x, ring, 1.2);
  x.save();
  x.globalCompositeOperation = 'lighter';
  glow(x, kx, ky, T * 1.1, HEK, 0.35);
  x.shadowColor = HEK;
  x.shadowBlur = 8;
  x.strokeStyle = 'rgba(140,255,230,0.9)';
  x.lineWidth = 2;
  x.beginPath();
  x.arc(kx, ky, T * 0.41, 0, TAU);
  x.stroke();
  x.restore();
  x.fillStyle = radG(x, kx, ky, 0, T * 0.32, [[0, 'rgba(190,255,240,0.5)'], [1, 'rgba(62,224,200,0.1)']]);
  x.beginPath();
  x.arc(kx, ky, T * 0.32, 0, TAU);
  x.fill();
  // hanging vines
  for (let i = 0; i < 9; i++) {
    const t = 0.08 + R() * 0.84;
    const vx = fx - px + t * px * 2;
    const vy = ay - Math.sin(t * Math.PI) * T * 0.62 + T * 0.2;
    const len = T * (0.4 + R() * 0.9);
    line(x, [[vx, vy], [vx + (R() - 0.5) * 6, vy + len * 0.5], [vx + (R() - 0.5) * 4, vy + len]], '#2e5a3a', 2);
    for (let k = 0; k < 4; k++) {
      x.fillStyle = pick(R, ['#4e8a4a', '#6aa458']);
      x.beginPath();
      x.ellipse(vx + (R() - 0.5) * 5, vy + (k / 4) * len, 2.6, 1.5, R() * 3, 0, TAU);
      x.fill();
    }
  }
  return { canvas: c, footX: fx, footY: fy };
}

function altar(R: () => number): FieldSprite {
  const [c, x, fx, fy] = sprite(T * 9, T * 9, T * 0.3);
  const stone = '#7c8e8a';
  // back obelisks with lamps
  for (const s of [-1, 1]) {
    const ox = fx + s * T * 3.5;
    const ob = fy - T * 3.4;
    shadowE(x, ox + 5, ob, T * 0.5, T * 0.2, 0.5);
    stonePillar(x, ox, ob, ob - T * 2.8, T * 0.5, R, stone);
    glow(x, ox, ob - T * 3.05, T * 0.8, HEK, 0.55);
    x.fillStyle = '#c8fff0';
    x.beginPath();
    x.arc(ox, ob - T * 3.05, 3, 0, TAU);
    x.fill();
  }
  // great standing ring behind the dais
  const rcx = fx;
  const rcy = fy - T * 5.6;
  const rr = T * 1.95;
  const ring = new Path2D();
  ring.arc(rcx, rcy, rr, 0, TAU);
  ring.arc(rcx, rcy, rr * 0.76, 0, TAU, true);
  // ring feet
  for (const s of [-1, 1]) {
    const f = rrect(rcx + s * rr * 0.6 - T * 0.35, rcy + rr * 0.55, T * 0.7, T * 0.9, 4);
    vol(x, f, rcx - rr, rcy, rcx + rr, rcy + rr * 1.5, dk(stone, 0.15));
    ink(x, f, 1.1);
  }
  x.save();
  x.globalCompositeOperation = 'lighter';
  glow(x, rcx, rcy, rr * 1.4, HEK, 0.22);
  x.restore();
  x.fillStyle = radG(x, rcx, rcy, 0, rr * 0.76, [[0, 'rgba(170,255,235,0.22)'], [0.7, 'rgba(62,224,200,0.08)'], [1, 'rgba(62,224,200,0.3)']]);
  x.beginPath();
  x.arc(rcx, rcy, rr * 0.76, 0, TAU);
  x.fill();
  vol(x, ring, rcx - rr, rcy - rr, rcx + rr, rcy + rr, stone, 0.3, 0.5);
  clipDo(x, ring, () => {
    x.fillStyle = rgba('#4e8a5c', 0.7);
    for (let i = 0; i < 18; i++) {
      const a = Math.PI * (1.05 + R() * 0.9);
      x.beginPath();
      x.ellipse(rcx + Math.cos(a) * rr * 0.9, rcy + Math.sin(a) * rr * 0.9, 4 + R() * 6, 3 + R() * 3, a, 0, TAU);
      x.fill();
    }
    // crack
    x.strokeStyle = 'rgba(10,16,20,0.7)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(rcx + rr * 0.7, rcy - rr * 0.5);
    x.lineTo(rcx + rr * 0.85, rcy - rr * 0.3);
    x.lineTo(rcx + rr * 0.8, rcy - rr * 0.1);
    x.stroke();
  });
  ink(x, ring, 1.4);
  x.save();
  x.globalCompositeOperation = 'lighter';
  x.shadowColor = HEK;
  x.shadowBlur = 10;
  x.strokeStyle = 'rgba(140,255,230,0.8)';
  x.lineWidth = 2;
  x.beginPath();
  x.arc(rcx, rcy, rr * 0.88, 0, TAU);
  x.stroke();
  x.shadowBlur = 0;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    rune(x, rcx + Math.cos(a) * rr * 0.88, rcy + Math.sin(a) * rr * 0.88, 3.2, i % 6, 0.7);
  }
  x.restore();
  // dais: two tiers
  const tier = (cy: number, rx: number, ry: number, h: number, col: string) => {
    const side = new Path2D();
    side.ellipse(fx, cy, rx, ry, 0, 0, Math.PI);
    side.lineTo(fx - rx, cy - h);
    side.ellipse(fx, cy - h, rx, ry, 0, Math.PI, 0, true);
    side.closePath();
    x.fillStyle = lin(x, fx - rx, 0, fx + rx, 0, [[0, lit(col, 0.1)], [0.5, dk(col, 0.2)], [1, dk(col, 0.5)]]);
    x.fill(side);
    clipDo(x, side, () => {
      for (let k = -12; k <= 12; k++) {
        const bx = fx + k * rx * 0.08;
        x.strokeStyle = 'rgba(10,16,20,0.35)';
        x.lineWidth = 1;
        x.beginPath();
        x.moveTo(bx, cy - h);
        x.lineTo(bx, cy + ry);
        x.stroke();
      }
    });
    ink(x, side, 1.2);
    const topP = ellP(fx, cy - h, rx, ry);
    x.fillStyle = radG(x, fx - rx * 0.2, cy - h - ry * 0.3, 4, rx, [[0, lit(col, 0.25)], [0.6, col], [1, dk(col, 0.25)]]);
    x.fill(topP);
    ink(x, topP, 1.2);
  };
  shadowE(x, fx + 10, fy - T * 2.2, T * 4.3, T * 2.0, 0.5);
  tier(fy - T * 2.2, T * 3.9, T * 1.55, T * 0.35, dk(stone, 0.08));
  tier(fy - T * 2.75, T * 3.0, T * 1.15, T * 0.35, stone);
  // engraved ring on top
  const ty = fy - T * 3.1;
  x.strokeStyle = 'rgba(10,20,24,0.5)';
  x.lineWidth = 4;
  x.beginPath();
  x.ellipse(fx, ty, T * 1.9, T * 0.72, 0, 0, TAU);
  x.stroke();
  x.save();
  x.globalCompositeOperation = 'lighter';
  x.strokeStyle = 'rgba(62,224,200,0.6)';
  x.lineWidth = 1.6;
  x.beginPath();
  x.ellipse(fx, ty, T * 1.9, T * 0.72, 0, 0, TAU);
  x.stroke();
  glow(x, fx, ty, T * 1.6, HEK, 0.12);
  x.restore();
  // front steps
  for (let k = 0; k < 3; k++) {
    const sw = T * (1.4 - k * 0.12);
    const sy = fy - T * 0.25 - k * T * 0.32;
    const st = rrect(fx - sw, sy - T * 0.3, sw * 2, T * 0.34, 3);
    vol(x, st, fx - sw, sy - T * 0.3, fx + sw, sy, mix(stone, '#9aaaa4', 0.2 + k * 0.1), 0.3, 0.4);
    clipDo(x, st, () => {
      x.fillStyle = 'rgba(10,16,20,0.35)';
      x.fillRect(fx - sw, sy - 6, sw * 2, 6);
    });
    ink(x, st, 1.1);
  }
  // moss & small lights on the dais
  for (let i = 0; i < 20; i++) {
    const a = R() * Math.PI;
    x.fillStyle = rgba(pick(R, ['#4e8a5c', '#3c7a5c', '#6aa47a']), 0.7);
    x.beginPath();
    x.ellipse(fx + Math.cos(a) * T * 3.7, fy - T * 2.2 + Math.sin(a) * T * 1.45 - 4, 4 + R() * 6, 2 + R() * 2, 0, 0, TAU);
    x.fill();
  }
  for (let i = 0; i < 8; i++) glow(x, fx + (R() - 0.5) * T * 7, fy - T * (2 + R() * 4), 5 + R() * 4, HEK, 0.6);
  return { canvas: c, footX: fx, footY: fy };
}

// ---------------------------------------------------------------------------
// gates
// ---------------------------------------------------------------------------

/**
 * 能力で開く障害物。w×h タイルの敷地に合わせて描く。footX/footY は敷地の下辺の中央
 * (MapObject の x, y と同じ取り決め)。vine は「まだ渡れない水」なので浮き葉だけのほのかな手がかり。
 */
export function drawGate(kind: GateKind, w: number, h: number, theme: FieldTheme): FieldSprite {
  return cached(`gate|${kind}|${w}|${h}|${theme}`, () => {
    const R = rng(hs('gate', kind, w, h, theme));
    if (kind === 'log') return fallenLog(w, h, R, theme);
    if (kind === 'thorns') return thorns(w, h, R);
    if (kind === 'pollen') return pollenWall(w, h, R);
    return vineHint(w, h, R);
  });
}

function fallenLog(w: number, h: number, R: () => number, theme: FieldTheme): FieldSprite {
  const mossCols = theme === 'road' ? ['#5a6640', '#66704a', '#4c5838'] : ['#4e7434', '#5e8440', '#44682e'];
  const vertical = h >= w;
  const len = (vertical ? h : w) * T + T * 0.5;
  const thick = T * 1.3;
  const tilt = vertical ? 0.42 : 0;
  // draw the log lying "north-south" (upright on screen), then rotate for the horizontal case
  const LW = thick + T * 2.8;
  const LH = len + T * 2.0;
  const [lc, x] = mk(LW, LH);
  const cx = LW / 2;
  const y0 = T * 1.1;
  const y1 = y0 + len;
  const bark = '#6a5038';
  x.save();
  x.translate(cx, (y0 + y1) / 2);
  x.rotate(tilt);
  x.translate(-cx, -(y0 + y1) / 2);
  // ground shadow along the shaded (right) side
  x.fillStyle = 'rgba(14,12,22,0.3)';
  x.beginPath();
  x.ellipse(cx + thick * 0.28, (y0 + y1) / 2 + 6, thick * 0.5, len * 0.5, 0, 0, TAU);
  x.fill();
  // side branches lying on the ground
  for (const [t, s, l] of [[0.22, -1, 0.75], [0.5, 1, 0.9], [0.74, -1, 0.6]] as Pt3[]) {
    const by = y0 + len * t;
    const bx = cx + s * thick * 0.4;
    const p = smooth([[bx, by], [bx + s * T * l * 0.5, by + T * 0.08], [bx + s * T * l, by - T * 0.05]], false);
    x.save();
    x.translate(3, 5);
    stroke(x, p, 'rgba(14,12,22,0.35)', 7);
    x.restore();
    stroke(x, p, dk(bark, 0.45), 7.5);
    stroke(x, p, bark, 5);
    for (let k = 0; k < 3; k++) leafShape(x, bx + s * T * l * (0.5 + k * 0.22), by - 3 + (R() - 0.5) * 6, 4, R() * TAU, pick(R, ['#6a8a3a', '#8a7a3a', '#5a7a34']));
  }
  // torn-up root plate at the north end: a wide disc of earth and roots standing on edge
  const pw = T * 1.8;
  const ph = T * 1.55;
  const pcy = y0 - T * 0.2;
  const plate: Pt[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const k = 0.78 + R() * 0.3;
    plate.push([cx + Math.cos(a) * (pw / 2) * k, pcy + Math.sin(a) * (ph / 2) * k]);
  }
  const pp = smooth(plate, true, 0.7);
  x.save();
  x.translate(4, 8);
  x.fillStyle = 'rgba(14,12,22,0.35)';
  x.fill(pp);
  x.restore();
  // roots sticking out of the plate
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + R() * 0.3;
    const r0 = 0.7;
    const r1 = 1.05 + R() * 0.35;
    const p = smooth([[cx + Math.cos(a) * (pw / 2) * r0, pcy + Math.sin(a) * (ph / 2) * r0], [cx + Math.cos(a + 0.15) * (pw / 2) * (r0 + r1) / 2, pcy + Math.sin(a + 0.15) * (ph / 2) * (r0 + r1) / 2 - 3], [cx + Math.cos(a - 0.1) * (pw / 2) * r1, pcy + Math.sin(a - 0.1) * (ph / 2) * r1]], false);
    stroke(x, p, '#2e2218', 4.5);
    stroke(x, p, '#8a6a48', 2.6);
  }
  vol(x, pp, cx - pw / 2, pcy - ph / 2, cx + pw / 2, pcy + ph / 2, '#5a4430', 0.2, 0.45);
  clipDo(x, pp, () => {
    // earth clods and root cross-sections
    for (let i = 0; i < 14; i++) {
      x.fillStyle = pick(R, ['rgba(40,30,20,0.6)', 'rgba(110,86,60,0.5)', 'rgba(70,56,40,0.6)']);
      x.beginPath();
      x.ellipse(cx + (R() - 0.5) * pw * 0.8, pcy + (R() - 0.5) * ph * 0.7, 3 + R() * 5, 2 + R() * 4, R() * 3, 0, TAU);
      x.fill();
    }
    for (let i = 0; i < 7; i++) {
      const rx = cx + (R() - 0.5) * pw * 0.6;
      const ry = pcy + (R() - 0.5) * ph * 0.5;
      x.fillStyle = '#b89468';
      x.beginPath();
      x.arc(rx, ry, 2 + R() * 2, 0, TAU);
      x.fill();
    }
    // a grassy lip along the top (it used to be the ground surface)
    x.fillStyle = '#6a7e44';
    x.fillRect(cx - pw, pcy - ph / 2 - 6, pw * 2, 10);
  });
  ink(x, pp, 1.2);
  for (let i = 0; i < 9; i++) {
    const gx = cx - pw * 0.4 + (i / 8) * pw * 0.8;
    line(x, [[gx, pcy - ph * 0.4], [gx + (R() - 0.5) * 5, pcy - ph * 0.4 - 6 - R() * 5]], i % 2 ? '#9aa860' : '#6a7a40', 1.6);
  }
  // dangling root hairs
  for (let i = 0; i < 6; i++) {
    const hx = cx + (R() - 0.5) * pw * 0.7;
    line(x, [[hx, pcy + ph * 0.35], [hx + (R() - 0.5) * 4, pcy + ph * 0.35 + 6 + R() * 8]], 'rgba(60,44,30,0.8)', 1.2);
  }
  // body: a cylinder seen from above (both sides shaded, lit strip left of centre)
  const body = smooth([[cx - thick / 2, y0 + 8], [cx - thick / 2 - 2, (y0 + y1) / 2], [cx - thick / 2 + 1, y1 - 6], [cx + thick / 2 - 1, y1 - 6], [cx + thick / 2 + 2, (y0 + y1) / 2], [cx + thick / 2, y0 + 8]], true, 0.5);
  x.fillStyle = lin(x, cx - thick / 2, 0, cx + thick / 2, 0, [[0, dk(bark, 0.25)], [0.3, lit(bark, 0.22)], [0.55, bark], [1, dk(bark, 0.6)]]);
  x.fill(body);
  clipDo(x, body, () => {
    for (let i = 0; i < 10; i++) {
      const bx = cx - thick / 2 + (i + 0.5) * (thick / 10);
      const p = smooth([[bx, y0], [bx + (R() - 0.5) * 5, y0 + len * 0.33], [bx + (R() - 0.5) * 5, y0 + len * 0.66], [bx, y1]], false);
      stroke(x, p, rgba(dk(bark, 0.55), 0.5), 1.6);
    }
    // bark plates catching light
    for (let i = 0; i < 16; i++) {
      x.fillStyle = rgba(lit(bark, 0.45), 0.25);
      x.beginPath();
      x.ellipse(cx - thick * 0.2 + (R() - 0.5) * thick * 0.3, y0 + R() * len, 2.5, 7 + R() * 8, 0, 0, TAU);
      x.fill();
    }
    // moss cushions in clumps along the top
    for (let c = 0; c < 6; c++) {
      const my = y0 + len * (0.08 + c * 0.16 + R() * 0.06);
      const mx = cx - thick * 0.12 + (R() - 0.5) * thick * 0.35;
      for (let k = 0; k < 7; k++) {
        const ox = mx + (R() - 0.5) * 16;
        const oy = my + (R() - 0.5) * 18;
        const r = 3 + R() * 4;
        x.fillStyle = rgba('#2e4a24', 0.5);
        x.beginPath();
        x.arc(ox + 1, oy + 1.5, r, 0, TAU);
        x.fill();
        x.fillStyle = pick(R, mossCols);
        x.beginPath();
        x.arc(ox, oy, r, 0, TAU);
        x.fill();
        x.fillStyle = 'rgba(220,240,160,0.35)';
        x.beginPath();
        x.arc(ox - r * 0.3, oy - r * 0.35, r * 0.4, 0, TAU);
        x.fill();
      }
    }
    x.fillStyle = lin(x, cx, 0, cx + thick / 2, 0, [[0, 'rgba(10,10,20,0)'], [1, 'rgba(10,10,20,0.35)']]);
    x.fillRect(cx, y0, thick, len);
  });
  ink(x, body, 1.3);
  // big cut face toward the viewer (south end)
  const ey = y1 - 8;
  const endP = ellP(cx, ey, thick / 2 + 1, thick * 0.34);
  x.fillStyle = radG(x, cx, ey, 1, thick / 2, [[0, '#e0c090'], [0.7, '#b48a58'], [1, '#6a4a30']]);
  x.fill(endP);
  x.strokeStyle = 'rgba(110,70,40,0.55)';
  x.lineWidth = 1;
  for (let k = 1; k <= 4; k++) {
    x.beginPath();
    x.ellipse(cx, ey, (thick / 2) * k * 0.22, thick * 0.34 * k * 0.22, 0, 0, TAU);
    x.stroke();
  }
  x.strokeStyle = 'rgba(40,24,14,0.7)';
  x.beginPath();
  x.moveTo(cx, ey);
  x.lineTo(cx + thick * 0.32, ey - 6);
  x.stroke();
  const barkRim = new Path2D();
  barkRim.ellipse(cx, ey, thick / 2 + 1, thick * 0.34, 0, 0, TAU);
  stroke(x, barkRim, '#4a3424', 3);
  ink(x, endP, 1.2);
  // shelf mushrooms on the shaded side
  for (let i = 0; i < 5; i++) {
    const my = y0 + len * (0.2 + R() * 0.55);
    const mxx = cx + thick * 0.47;
    const m = new Path2D();
    m.ellipse(mxx + 3, my, 5, 3, 0, -Math.PI * 0.5, Math.PI * 0.5);
    m.closePath();
    vol(x, m, mxx, my - 3, mxx + 8, my + 3, '#d8844a', 0.3, 0.3);
    ink(x, m, 0.8);
  }
  x.restore();
  if (vertical) return { canvas: lc, footX: LW / 2, footY: y0 + h * T + T * 0.25 };
  const [c, r] = mk(LH, LW);
  r.translate(LH / 2, LW / 2);
  r.rotate(-Math.PI / 2);
  r.drawImage(lc, -LW / 2, -LH / 2);
  return { canvas: c, footX: LH / 2, footY: LW / 2 + thick * 0.45 };
}

function thorns(w: number, h: number, R: () => number): FieldSprite {
  const W = (w + 0.9) * T;
  const H = (h + 1.6) * T;
  const [c, x] = mk(W, H);
  const fx = W / 2;
  const fy = H - T * 0.3;
  const x0 = fx - (w * T) / 2;
  const x1 = fx + (w * T) / 2;
  shadowE(x, fx + 5, fy - (h * T) / 2, (w * T) / 2 + 12, (h * T) / 2 + 6, 0.6);
  // dark mass
  const mass = smooth([[x0 - 4, fy - 2], [x0, fy - h * T * 0.6], [x0 + T * 0.4, fy - h * T - T * 0.1], [fx, fy - h * T - T * 0.25], [x1 - T * 0.4, fy - h * T - T * 0.05], [x1, fy - h * T * 0.6], [x1 + 4, fy - 2], [fx, fy + 3]]);
  x.fillStyle = radG(x, fx, fy - h * T * 0.6, 4, W * 0.6, [[0, '#2a1e26'], [1, '#140e14']]);
  x.fill(mass);
  const stems = (n: number, col: string, hl: string, wid: number) => {
    for (let i = 0; i < n; i++) {
      const sx = x0 - 6 + R() * (x1 - x0 + 12);
      const sy = fy - R() * h * T * 0.5;
      const peak = fy - h * T - T * (0.2 + R() * 0.7);
      const ex = sx + (R() - 0.5) * T * 1.6;
      const ey = fy - R() * h * T * 0.6;
      const p = new Path2D();
      p.moveTo(sx, sy);
      p.bezierCurveTo(sx + (ex - sx) * 0.1, peak, ex - (ex - sx) * 0.1, peak, ex, ey);
      stroke(x, p, col, wid);
      x.save();
      x.translate(-0.7, -1);
      stroke(x, p, hl, wid * 0.35);
      x.restore();
      // thorns along the curve
      for (let k = 1; k < 9; k++) {
        const t = k / 9;
        const mt = 1 - t;
        const bx = mt * mt * mt * sx + 3 * mt * mt * t * (sx + (ex - sx) * 0.1) + 3 * mt * t * t * (ex - (ex - sx) * 0.1) + t * t * t * ex;
        const byy = mt * mt * mt * sy + 3 * mt * mt * t * peak + 3 * mt * t * t * peak + t * t * t * ey;
        const s = k % 2 ? 1 : -1;
        x.fillStyle = col;
        x.beginPath();
        x.moveTo(bx - 2.4, byy);
        x.lineTo(bx + s * 3, byy - 8);
        x.lineTo(bx + 2.4, byy);
        x.fill();
      }
    }
  };
  stems(9, '#2a1a20', 'rgba(140,90,110,0.35)', 4.2);
  // dark leaves
  for (let i = 0; i < 18; i++) {
    x.fillStyle = pick(R, ['#23382a', '#2e4a30', '#1c2c22']);
    x.beginPath();
    x.ellipse(x0 + R() * (x1 - x0), fy - R() * (h * T + T * 0.6), 4, 2.2, R() * TAU, 0, TAU);
    x.fill();
  }
  stems(8, '#4e2e38', 'rgba(230,170,180,0.45)', 3.6);
  // berries
  for (let i = 0; i < 7; i++) {
    const bx = x0 + R() * (x1 - x0);
    const by = fy - R() * (h * T + T * 0.4);
    x.fillStyle = '#8a1e36';
    x.beginPath();
    x.arc(bx, by, 2.4, 0, TAU);
    x.fill();
    x.fillStyle = 'rgba(255,200,210,0.6)';
    x.beginPath();
    x.arc(bx - 0.8, by - 0.8, 0.8, 0, TAU);
    x.fill();
  }
  return { canvas: c, footX: fx, footY: fy };
}

function pollenWall(w: number, h: number, R: () => number): FieldSprite {
  const W = (w + 2) * T;
  const H = (h + 2.2) * T;
  const [c, x] = mk(W, H);
  const fx = W / 2;
  const fy = H - T * 0.55;
  const cy = fy - (h * T) / 2;
  const cyTop = fy - h * T - T * 0.6;
  // haze body
  for (let i = 0; i < 40; i++) {
    const bx = fx + (R() - 0.5) * (w * T + T * 0.8);
    const by = cyTop + R() * (fy - cyTop);
    const r = T * (0.45 + R() * 0.55);
    x.fillStyle = radG(x, bx, by, 0, r, [[0, rgba(pick(R, ['#f8e070', '#fff0a0', '#e8d060']), 0.2 + R() * 0.12)], [1, 'rgba(248,224,112,0)']]);
    x.fillRect(bx - r, by - r, r * 2, r * 2);
  }
  x.save();
  x.globalCompositeOperation = 'lighter';
  glow(x, fx, cy, (h * T) / 2 + T * 0.4, '#fff2a0', 0.28);
  // swirls
  for (let i = 0; i < 7; i++) {
    const sx = fx + (R() - 0.5) * w * T;
    const sy = cyTop + R() * (fy - cyTop);
    const r = 6 + R() * 12;
    x.strokeStyle = 'rgba(255,248,200,0.3)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.arc(sx, sy, r, R() * TAU, R() * TAU + 3.5);
    x.stroke();
  }
  // glowing motes
  for (let i = 0; i < 40; i++) {
    const mx = fx + (R() - 0.5) * (w * T + T * 1.2);
    const my = cyTop - T * 0.2 + R() * (fy - cyTop + T * 0.3);
    glow(x, mx, my, 3 + R() * 4, '#ffe890', 0.6);
    x.fillStyle = 'rgba(255,255,230,0.9)';
    x.beginPath();
    x.arc(mx, my, 0.9 + R() * 0.8, 0, TAU);
    x.fill();
  }
  x.restore();
  // a few fat pollen puffs with a little volume
  for (let i = 0; i < 6; i++) {
    const bx = fx + (R() - 0.5) * w * T * 1.1;
    const by = fy - R() * h * T;
    const r = 5 + R() * 5;
    x.fillStyle = radG(x, bx, by, 0, r, [[0, 'rgba(255,250,210,0.75)'], [0.6, 'rgba(246,220,110,0.45)'], [1, 'rgba(246,220,110,0)']], bx - r * 0.3, by - r * 0.3);
    x.beginPath();
    x.arc(bx, by, r, 0, TAU);
    x.fill();
  }
  return { canvas: c, footX: fx, footY: fy };
}

function vineHint(w: number, h: number, R: () => number): FieldSprite {
  const W = (w + 0.6) * T;
  const H = (h + 0.6) * T;
  const [c, x] = mk(W, H);
  const fx = W / 2;
  const fy = H - T * 0.3;
  for (let i = 0; i < 4; i++) {
    const lx = fx + (R() - 0.5) * w * T * 0.8;
    const ly = fy - R() * h * T * 0.8 - 6;
    x.strokeStyle = 'rgba(220,255,230,0.35)';
    x.lineWidth = 1;
    x.beginPath();
    x.ellipse(lx, ly + 1, 9, 3.5, 0, 0, TAU);
    x.stroke();
    x.fillStyle = 'rgba(10,30,20,0.3)';
    x.beginPath();
    x.ellipse(lx + 1.5, ly + 2, 5, 2.4, 0, 0, TAU);
    x.fill();
    leafShape(x, lx, ly, 5.5, R() * TAU, pick(R, ['#6ab84a', '#8ad05a']));
  }
  glow(x, fx, fy - (h * T) / 2, T * 0.7, '#9aff9a', 0.18);
  return { canvas: c, footX: fx, footY: fy };
}

function leafShape(x: Ctx, cx: number, cy: number, r: number, rot: number, col: string): void {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  const p = new Path2D();
  p.moveTo(-r, 0);
  p.quadraticCurveTo(0, -r * 0.7, r, 0);
  p.quadraticCurveTo(0, r * 0.7, -r, 0);
  x.fillStyle = lin(x, 0, -r * 0.5, 0, r * 0.5, [[0, lit(col, 0.3)], [1, dk(col, 0.3)]]);
  x.fill(p);
  x.strokeStyle = rgba(dk(col, 0.5), 0.8);
  x.lineWidth = 0.8;
  x.stroke(p);
  x.beginPath();
  x.moveTo(-r * 0.8, 0);
  x.lineTo(r * 0.8, 0);
  x.strokeStyle = rgba(lit(col, 0.5), 0.6);
  x.stroke();
  x.restore();
}

/**
 * 蔓の橋(vine の門を開いたあと)。vertical = 南北に渡る(既定: w >= h、つまり横長の敷地は縦に渡る)。
 * footX/footY は敷地の下辺の中央。橋は両岸に少しはみ出す。
 */
export function drawVineBridge(w: number, h: number, vertical = w >= h): FieldSprite {
  return cached(`vinebridge|${w}|${h}|${vertical ? 1 : 0}`, () => {
    const R = rng(hs('vinebridge', w, h));
    const over = T * 0.7;
    const span = (vertical ? h : w) * T + over * 2;
    const width = (vertical ? w : h) * T * 0.82;
    const LW = width + T * 1.0;
    const LH = span + T * 0.3;
    const [lc, x] = mk(LW, LH);
    const cx = LW / 2;
    const y0 = T * 0.15;
    const y1 = y0 + span;
    // shadow on the water
    x.fillStyle = 'rgba(10,24,16,0.35)';
    x.beginPath();
    x.ellipse(cx + 6, (y0 + y1) / 2 + 6, width * 0.55, span * 0.45, 0, 0, TAU);
    x.fill();
    // woven deck of bent branches (slightly bowed, uneven)
    const n = Math.round(span / 7);
    for (let i = 0; i < n; i++) {
      const sy = y0 + 3 + (i / n) * (span - 6);
      const bow = 2 + R() * 2;
      const xl = cx - width / 2 + (R() - 0.5) * 4;
      const xr = cx + width / 2 + (R() - 0.5) * 4;
      const p = new Path2D();
      p.moveTo(xl, sy);
      p.quadraticCurveTo(cx, sy + bow, xr, sy);
      p.lineTo(xr, sy + 5.5);
      p.quadraticCurveTo(cx, sy + bow + 5.5, xl, sy + 5.5);
      p.closePath();
      vol(x, p, xl, sy, xr, sy + 6, mix('#8a6a3e', '#6a7e3a', R() * 0.6), 0.35, 0.4);
      ink(x, p, 0.7, 'rgba(30,24,16,0.55)');
    }
    // twisted vine rails
    for (const s of [-1, 1]) {
      const rx0 = cx + s * (width / 2 + 1);
      for (let k = 0; k < 2; k++) {
        const pts: Pt[] = [];
        for (let i = 0; i <= 10; i++) pts.push([rx0 + Math.sin(i * 1.25 + k * 1.7) * 3.2, y0 + (i / 10) * span]);
        const p = smooth(pts, false);
        stroke(x, p, '#233e1e', 5.5);
        stroke(x, p, k ? '#5a8a3a' : '#44742e', 3.4);
        x.save();
        x.translate(-0.8, -0.8);
        stroke(x, p, 'rgba(200,240,150,0.35)', 1);
        x.restore();
      }
      for (let i = 0; i < 11; i++) {
        const ly = y0 + R() * span;
        leafShape(x, rx0 + s * (3 + R() * 4), ly, 4.5 + R() * 2, s * (0.4 + R() * 0.9) + (s < 0 ? Math.PI : 0), pick(R, ['#5a9a40', '#7ab84a', '#4a8a38']));
      }
      for (let i = 0; i < 3; i++) {
        const ly = y0 + R() * span;
        x.fillStyle = pick(R, ['#fff0a0', '#f8c8d8', '#ffffff']);
        x.beginPath();
        x.arc(rx0 + s * 5, ly, 2.2, 0, TAU);
        x.fill();
      }
    }
    // leafy knots anchoring both ends on the banks
    for (const ey of [y0 + 4, y1 - 4]) {
      for (let i = 0; i < 12; i++) {
        leafShape(x, cx + (R() - 0.5) * width * 1.2, ey + (R() - 0.5) * 10, 5 + R() * 2, R() * TAU, pick(R, ['#4e8a3a', '#6aa448', '#3e7430']));
      }
    }
    if (vertical) return { canvas: lc, footX: cx, footY: y1 - over };
    const [c, r] = mk(LH, LW);
    r.translate(LH / 2, LW / 2);
    r.rotate(-Math.PI / 2);
    r.drawImage(lc, -LW / 2, -LH / 2);
    return { canvas: c, footX: LH / 2, footY: LW / 2 + (h * T) / 2 };
  });
}

// ---------------------------------------------------------------------------
// villagers
// ---------------------------------------------------------------------------

interface Face { skin: string; eyeX: number; eyeY: number; eyeCol: string; mouth: 'smile' | 'flat' | 'grin' | 'open'; brow?: 'calm' | 'stern'; blush?: number; eyeR?: number }

/** 顔(3/4、左向き)。単位は人物の設計座標 */
function paintFace(x: Ctx, f: Face): void {
  const { eyeX, eyeY } = f;
  const er = f.eyeR ?? 1;
  const eye = (ex: number, w: number) => {
    const p = ellP(ex, eyeY, 1.9 * w * er, 2.7 * er);
    x.fillStyle = '#fbf6ee';
    x.fill(p);
    x.fillStyle = f.eyeCol;
    x.beginPath();
    x.ellipse(ex - 0.4 * w, eyeY + 0.2, 1.45 * w * er, 2.2 * er, 0, 0, TAU);
    x.fill();
    x.fillStyle = '#1c1420';
    x.beginPath();
    x.ellipse(ex - 0.5 * w, eyeY + 0.3, 0.8 * w * er, 1.3 * er, 0, 0, TAU);
    x.fill();
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.arc(ex - 0.9 * w, eyeY - 0.8 * er, 0.65 * er, 0, TAU);
    x.fill();
    // upper lid line
    x.strokeStyle = '#2a1a1e';
    x.lineWidth = 1.1;
    x.beginPath();
    x.moveTo(ex - 2.3 * w * er, eyeY - 1.2 * er);
    x.quadraticCurveTo(ex, eyeY - 3.4 * er, ex + 2.1 * w * er, eyeY - 1.6 * er);
    x.stroke();
  };
  eye(eyeX - 4.6, 0.8);
  eye(eyeX + 2.6, 1);
  if (f.brow) {
    x.strokeStyle = 'rgba(50,30,24,0.8)';
    x.lineWidth = 1;
    x.beginPath();
    const s = f.brow === 'stern' ? 1 : -0.5;
    x.moveTo(eyeX - 6.5, eyeY - 4.8 - s * 0.3);
    x.lineTo(eyeX - 3, eyeY - 4.8 + s * 0.6);
    x.moveTo(eyeX + 0.8, eyeY - 4.9 + s * 0.6);
    x.lineTo(eyeX + 4.8, eyeY - 5.2 - s * 0.4);
    x.stroke();
  }
  // nose tip & mouth
  x.strokeStyle = rgba(dk(f.skin, 0.4), 0.7);
  x.lineWidth = 0.9;
  x.beginPath();
  x.moveTo(eyeX - 2.5, eyeY + 3.2);
  x.lineTo(eyeX - 3.2, eyeY + 4.6);
  x.stroke();
  x.strokeStyle = '#6a2e2a';
  x.lineWidth = 1.1;
  x.beginPath();
  const my = eyeY + 7.4;
  if (f.mouth === 'grin') {
    x.fillStyle = '#8a3a36';
    x.moveTo(eyeX - 4.5, my - 0.5);
    x.quadraticCurveTo(eyeX - 1.8, my + 3.2, eyeX + 0.8, my - 0.6);
    x.closePath();
    x.fill();
  } else if (f.mouth === 'open') {
    x.fillStyle = '#8a3a36';
    x.ellipse(eyeX - 2, my, 1.4, 1.1, 0, 0, TAU);
    x.fill();
  } else if (f.mouth === 'smile') {
    x.moveTo(eyeX - 4, my - 0.3);
    x.quadraticCurveTo(eyeX - 2, my + 1.3, eyeX, my - 0.4);
    x.stroke();
  } else {
    x.moveTo(eyeX - 3.6, my);
    x.lineTo(eyeX - 0.6, my - 0.2);
    x.stroke();
  }
  if (f.blush) {
    for (const bx of [eyeX - 6, eyeX + 3.5]) {
      x.fillStyle = radG(x, bx, eyeY + 4, 0, 3, [[0, `rgba(240,120,120,${f.blush})`], [1, 'rgba(240,120,120,0)']]);
      x.beginPath();
      x.arc(bx, eyeY + 4, 3, 0, TAU);
      x.fill();
    }
  }
}

/** 村人4人(3/4、左向き)。約1.7タイル。foot = 足元 */
export function drawVillager(id: VillagerId): FieldSprite {
  return cached(`villager|${id}`, () => {
    const W = Math.round(T * 1.5);
    const H = Math.round(T * 2.0);
    const [c, x] = mk(W, H);
    const fx = W / 2;
    const fy = H - 5;
    shadowE(x, fx + 2, fy, T * 0.42, T * 0.14, 0.45);
    const kid = id === 'villager_c';
    const s = ((T * 1.7) / 100) * (kid ? 0.78 : 1);
    x.save();
    x.translate(fx, fy);
    x.scale(s, s);
    x.lineJoin = 'round';
    x.lineCap = 'round';
    const lw = 1.25 / s;
    if (id === 'villager_a') villagerA(x, lw);
    else if (id === 'villager_b') villagerB(x, lw);
    else if (id === 'villager_c') villagerC(x, lw);
    else villagerD(x, lw);
    x.restore();
    return { canvas: c, footX: fx, footY: fy };
  });
}

function legsBoots(x: Ctx, lw: number, pants: string, boot: string, top = -34, spread = 5.5): void {
  for (const [ox, back] of [[spread, true], [-spread + 1, false]] as [number, boolean][]) {
    const leg = rrect(ox - 3.6, top, 7.2, -top - 5, 3);
    cel(x, leg, back ? dk(pants, 0.12) : pants, 2.5, { out: lw });
    const bt = smooth([[ox - 7, -1], [ox - 6.5, -6], [ox - 3.2, -9.5], [ox + 3.6, -9], [ox + 4, -1]], true, 0.6);
    cel(x, bt, back ? dk(boot, 0.12) : boot, 2, { out: lw });
  }
}

function villagerA(x: Ctx, lw: number): void {
  const skin = '#e6b48c';
  const cloak = '#4f7a46';
  // back arm
  const back = rrect(9, -60, 7, 24, 3.5);
  cel(x, back, dk(cloak, 0.2), 2, { out: lw });
  legsBoots(x, lw, '#4e4a3e', '#3e2e24', -30);
  // tunic under cloak
  const tunic = smooth([[-13, -58], [-15, -26], [15, -26], [13, -58]], true, 0.4);
  cel(x, tunic, '#8a6a4a', 4, { out: lw });
  // cloak (long, parted in front)
  const cl = smooth([[-3, -64], [-17, -56], [-21, -24], [-11, -20], [-6, -42], [4, -44], [8, -21], [20, -24], [17, -58], [8, -64]], true, 0.6);
  cel(x, cl, cloak, 6, { out: lw });
  // belt + pouch
  const belt = rrect(-12, -38, 22, 4, 1.5);
  cel(x, belt, '#5a3a26', 1, { out: lw * 0.8 });
  const pouch = rrect(4, -37, 7, 8, 2);
  cel(x, pouch, '#8a5a36', 1.5, { out: lw * 0.8 });
  // front arm holding the spyglass forward
  const arm = smooth([[-9, -58], [-16, -50], [-20, -46], [-16, -42], [-10, -48], [-4, -54]], true, 0.6);
  cel(x, arm, cloak, 3, { out: lw });
  const glass = poly([[-17, -48], [-37, -54], [-38, -50], [-18, -44]]);
  x.save();
  cel(x, glass, '#c8a050', 2, { out: lw, hl: 0.45 });
  x.restore();
  for (const t of [0.25, 0.6]) {
    const bx = -17 + (-37 + 17) * t;
    const by = -46 + (-52 + 46) * t;
    x.fillStyle = '#7a5a28';
    x.fillRect(bx - 1, by - 3, 2, 6);
  }
  const hand = ellP(-18, -45.5, 3.4, 3);
  cel(x, hand, skin, 1, { out: lw });
  // head
  const face = ellP(-3, -73, 11, 12);
  // hood back
  const hood = smooth([[-12, -86], [2, -91], [14, -84], [16, -70], [12, -60], [0, -58], [-14, -62]], true, 0.8);
  cel(x, hood, cloak, 4, { out: lw });
  cel(x, face, skin, 2.5, { out: lw, hl: 0.2 });
  clipDo(x, face, () => {
    // stubble
    x.fillStyle = 'rgba(110,80,60,0.35)';
    x.beginPath();
    x.ellipse(-5, -64, 8, 4.5, 0, 0, TAU);
    x.fill();
    // hood shadow on forehead
    x.fillStyle = 'rgba(40,40,30,0.35)';
    x.beginPath();
    x.ellipse(-2, -85, 13, 6, 0, 0, TAU);
    x.fill();
  });
  paintFace(x, { skin, eyeX: -5, eyeY: -74, eyeCol: '#4a5a3a', mouth: 'flat', brow: 'stern', eyeR: 0.85 });
  // hood rim framing the face
  const rim = new Path2D();
  rim.moveTo(-15, -64);
  rim.quadraticCurveTo(-17, -84, -4, -87);
  rim.quadraticCurveTo(8, -88, 10, -76);
  stroke(x, rim, dk(cloak, 0.25), 4.4);
  stroke(x, rim, lit(cloak, 0.2), 2);
}

function villagerB(x: Ctx, lw: number): void {
  const skin = '#f0c8a2';
  const hair = '#3a2634';
  // long hair behind
  const backHair = smooth([[-6, -86], [10, -86], [16, -70], [15, -48], [8, -44], [2, -60], [-6, -70]], true, 0.8);
  cel(x, backHair, hair, 3, { out: lw });
  // skirt
  const skirt = smooth([[-11, -44], [-17, -8], [-6, -4], [8, -4], [17, -8], [11, -44]], true, 0.5);
  cel(x, skirt, '#c89a58', 6, { out: lw });
  clipDo(x, skirt, () => {
    x.fillStyle = '#8a4a3a';
    x.fillRect(-20, -14, 40, 3);
    x.fillStyle = '#2f8aa0';
    x.fillRect(-20, -10, 40, 2);
  });
  // feet
  for (const ox of [-6, 3]) {
    const ft = ellP(ox - 1, -2.5, 4.5, 2.5);
    cel(x, ft, '#6a3e2a', 1, { out: lw });
  }
  // blouse
  const blouse = smooth([[-11, -60], [-12, -42], [12, -42], [11, -60]], true, 0.4);
  cel(x, blouse, '#efe2c8', 4, { out: lw });
  // dyed shawl over the shoulders
  const shawl = smooth([[-14, -62], [-16, -48], [-8, -40], [0, -46], [8, -40], [16, -48], [14, -62], [0, -65]], true, 0.7);
  cel(x, shawl, '#3a5aa0', 5, { out: lw });
  clipDo(x, shawl, () => {
    for (let k = 0; k < 4; k++) {
      x.fillStyle = k % 2 ? '#3ee0c8' : '#e8a040';
      x.fillRect(-20, -58 + k * 5, 40, 1.8);
    }
  });
  // fringe
  for (let k = 0; k < 7; k++) line(x, [[-14 + k * 1.3, -47 + k * 1.1], [-15 + k * 1.3, -43 + k * 1.1]], '#2a4a8a', 1.1);
  // hands holding a skein of yarn
  const yarn = ellP(-11, -44, 5, 4);
  cel(x, yarn, '#3ec8b4', 2, { out: lw });
  x.strokeStyle = 'rgba(20,90,80,0.6)';
  x.lineWidth = 0.8;
  x.beginPath();
  x.moveTo(-15, -45);
  x.quadraticCurveTo(-11, -40, -7, -45);
  x.moveTo(-14, -42);
  x.quadraticCurveTo(-11, -48, -8, -42);
  x.stroke();
  const hand = ellP(-6, -45, 3, 2.6);
  cel(x, hand, skin, 1, { out: lw });
  // neck + head
  const neck = rrect(-3, -66, 6, 6, 2);
  cel(x, neck, dk(skin, 0.1), 1, { out: 0 });
  const face = ellP(-3, -75, 10.5, 11.5);
  cel(x, face, skin, 2.5, { out: lw, hl: 0.2 });
  paintFace(x, { skin, eyeX: -4.5, eyeY: -75, eyeCol: '#6a3a5a', mouth: 'smile', brow: 'calm', blush: 0.35, eyeR: 1.05 });
  // bangs + braid over the front shoulder
  const bangs = smooth([[-14, -76], [-12, -86], [-2, -90], [10, -86], [13, -74], [8, -79], [2, -82], [-4, -80], [-9, -78]], true, 0.7);
  cel(x, bangs, hair, 2.5, { out: lw });
  for (let k = 0; k < 5; k++) {
    const b = ellP(-12 - k * 0.4, -68 + k * 4.2, 3.2, 2.8);
    cel(x, b, hair, 1.2, { out: lw * 0.8 });
  }
  x.fillStyle = '#3ee0c8';
  x.beginPath();
  x.arc(-13.5, -48, 1.8, 0, TAU);
  x.fill();
  // hair flower
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU;
    x.fillStyle = '#f4a6b6';
    x.beginPath();
    x.arc(7 + Math.cos(a) * 2, -85 + Math.sin(a) * 2, 1.6, 0, TAU);
    x.fill();
  }
  x.fillStyle = '#f8d860';
  x.beginPath();
  x.arc(7, -85, 1, 0, TAU);
  x.fill();
}

function villagerC(x: Ctx, lw: number): void {
  const skin = '#f2c49a';
  const hair = '#9a5e34';
  legsBoots(x, lw, '#e8c89a', '#6a4a30', -30, 5);
  // shorts
  const shorts = smooth([[-11, -40], [-12, -27], [0, -26], [12, -27], [11, -40]], true, 0.4);
  cel(x, shorts, '#4e6070', 3, { out: lw });
  // shirt + oversized vest
  const shirt = smooth([[-12, -62], [-13, -38], [13, -38], [12, -62]], true, 0.5);
  cel(x, shirt, '#5a8ac8', 4, { out: lw });
  const vest = smooth([[-13, -62], [-15, -36], [-4, -36], [-3, -56], [3, -56], [4, -36], [15, -36], [13, -62], [0, -64]], true, 0.5);
  cel(x, vest, '#d8a040', 5, { out: lw });
  x.fillStyle = '#8a5a20';
  for (const yy of [-52, -44]) {
    x.beginPath();
    x.arc(-8, yy, 1.2, 0, TAU);
    x.fill();
  }
  // arms: front one raised in a wave
  const back = rrect(9, -60, 6, 18, 3);
  cel(x, back, dk('#5a8ac8', 0.15), 2, { out: lw });
  const arm = smooth([[-9, -60], [-17, -70], [-20, -80], [-15, -82], [-12, -72], [-4, -60]], true, 0.6);
  cel(x, arm, '#5a8ac8', 3, { out: lw });
  const hand = ellP(-18, -83, 3.6, 3.4);
  cel(x, hand, skin, 1, { out: lw });
  // big head
  const face = ellP(-2, -76, 13, 13.5);
  const backHair = smooth([[-8, -92], [10, -92], [17, -80], [14, -66], [4, -64], [0, -76]], true, 0.8);
  cel(x, backHair, hair, 3, { out: lw });
  cel(x, face, skin, 3, { out: lw, hl: 0.2 });
  paintFace(x, { skin, eyeX: -4, eyeY: -75, eyeCol: '#3a6a9a', mouth: 'grin', blush: 0.45, eyeR: 1.3 });
  // messy spikes
  const spikes = smooth([[-16, -80], [-18, -88], [-12, -86], [-12, -95], [-5, -90], [-1, -99], [3, -91], [10, -96], [11, -88], [17, -88], [14, -80], [6, -84], [-3, -86], [-10, -84]], true, 0.5);
  cel(x, spikes, hair, 3, { out: lw });
  // goggles on the forehead
  const strap = new Path2D();
  strap.moveTo(-15, -85);
  strap.quadraticCurveTo(0, -90, 16, -83);
  stroke(x, strap, '#3a2a26', 3.2);
  for (const [gx, r] of [[-9, 4.6], [1.5, 5.2]] as Pt[]) {
    const ring = ellP(gx, -86, r, r * 0.9);
    cel(x, ring, '#b8a07a', 1.2, { out: lw });
    const lens = ellP(gx, -86, r * 0.68, r * 0.6);
    x.fillStyle = radG(x, gx, -86, 0, r, [[0, '#bff8ee'], [0.6, '#3ec8b4'], [1, '#1e7a70']], gx - 1.5, -87.5);
    x.fill(lens);
    x.fillStyle = 'rgba(255,255,255,0.85)';
    x.beginPath();
    x.arc(gx - 1.4, -87.5, 1.1, 0, TAU);
    x.fill();
  }
}

function villagerD(x: Ctx, lw: number): void {
  const skin = '#d8a67e';
  const suit = '#ece4cc';
  legsBoots(x, lw, dk(suit, 0.08), '#5a4030', -32);
  // back arm
  const back = rrect(9, -60, 7, 24, 3.5);
  cel(x, back, dk(suit, 0.18), 2, { out: lw });
  // suit body
  const body = smooth([[-13, -60], [-16, -28], [16, -28], [13, -60]], true, 0.5);
  cel(x, body, suit, 5, { out: lw });
  // yellow apron with stripes
  const apron = smooth([[-9, -54], [-12, -26], [10, -26], [8, -54]], true, 0.4);
  cel(x, apron, '#e8b440', 4, { out: lw });
  clipDo(x, apron, () => {
    x.fillStyle = 'rgba(80,50,20,0.55)';
    for (const yy of [-46, -38, -30]) x.fillRect(-14, yy, 28, 2.4);
  });
  // front arm with a honey jar
  const arm = smooth([[-9, -58], [-15, -48], [-16, -40], [-11, -39], [-8, -48], [-3, -55]], true, 0.6);
  cel(x, arm, suit, 3, { out: lw });
  const jar = rrect(-21, -46, 10, 11, 3);
  x.fillStyle = radG(x, -16, -41, 1, 8, [[0, '#ffe08a'], [0.6, '#f0a030'], [1, '#b8661a']], -18, -44);
  x.fill(jar);
  ink(x, jar, lw);
  x.fillStyle = '#8a5a3a';
  x.fillRect(-21.5, -48, 11, 3);
  x.fillStyle = 'rgba(255,255,255,0.6)';
  x.fillRect(-19.5, -44, 1.6, 6);
  const glove = ellP(-13, -40, 4, 3.5);
  cel(x, glove, '#c8b890', 1.2, { out: lw });
  // head
  const face = ellP(-3, -72, 10.5, 11.5);
  cel(x, face, skin, 2.5, { out: lw, hl: 0.2 });
  paintFace(x, { skin, eyeX: -5, eyeY: -72, eyeCol: '#5a3a24', mouth: 'smile', brow: 'calm', eyeR: 0.95 });
  // wide-brim hat
  const crown = smooth([[-9, -82], [-7, -92], [2, -95], [10, -91], [11, -82]], true, 0.6);
  const brim = ellP(0, -82, 21, 6.5);
  cel(x, brim, '#d8c080', 2.5, { out: lw });
  cel(x, crown, '#d8c080', 3, { out: lw });
  x.fillStyle = '#8a6a3a';
  x.fillRect(-9, -85.5, 20, 2.6);
  // veil hanging from the brim
  const veil = new Path2D();
  veil.moveTo(-20, -81);
  veil.quadraticCurveTo(-22, -68, -17, -58);
  veil.lineTo(15, -58);
  veil.quadraticCurveTo(21, -68, 20, -81);
  veil.quadraticCurveTo(0, -76, -20, -81);
  veil.closePath();
  x.fillStyle = 'rgba(245,245,240,0.38)';
  x.fill(veil);
  clipDo(x, veil, () => {
    x.strokeStyle = 'rgba(60,60,60,0.22)';
    x.lineWidth = 0.6;
    for (let k = -24; k < 24; k += 2.2) {
      x.beginPath();
      x.moveTo(k, -84);
      x.lineTo(k, -56);
      x.stroke();
    }
    for (let k = -84; k < -56; k += 2.2) {
      x.beginPath();
      x.moveTo(-24, k);
      x.lineTo(24, k);
      x.stroke();
    }
  });
  ink(x, veil, lw * 0.7, 'rgba(60,50,40,0.45)');
  bee(x, -26, -64);
  bee(x, 18, -88);
}

// ---------------------------------------------------------------------------
// fx
// ---------------------------------------------------------------------------

/** 小さな効果の絵(中心基準で使う) */
export function drawFieldFx(kind: FieldFxKind): HTMLCanvasElement {
  return cached(`fx|${kind}`, () => {
    let c: HTMLCanvasElement;
    let x: Ctx;
    switch (kind) {
      case 'shadow': {
        [c, x] = mk(T * 1.0, T * 0.4);
        shadowE(x, c.width / 2, c.height / 2, c.width / 2, c.height / 2, 0.5);
        break;
      }
      case 'exclaim': {
        [c, x] = mk(30, 36);
        const b = new Path2D();
        b.moveTo(15, 34);
        b.lineTo(11, 27);
        b.arcTo(2, 27, 2, 14, 7);
        b.arcTo(2, 2, 15, 2, 9);
        b.arcTo(28, 2, 28, 14, 9);
        b.arcTo(28, 27, 19, 27, 7);
        b.lineTo(15, 34);
        b.closePath();
        x.save();
        x.shadowColor = 'rgba(0,0,0,0.35)';
        x.shadowBlur = 3;
        x.shadowOffsetY = 1.5;
        x.fillStyle = '#fffaf0';
        x.fill(b);
        x.restore();
        ink(x, b, 1.6, '#3a2020');
        const ex = poly([[12.5, 6], [17.5, 6], [16.3, 18], [13.7, 18]]);
        x.fillStyle = '#ff5a3a';
        x.fill(ex);
        x.beginPath();
        x.arc(15, 22.5, 2.4, 0, TAU);
        x.fill();
        break;
      }
      case 'interact': {
        [c, x] = mk(26, 28);
        const b = new Path2D();
        b.moveTo(13, 26);
        b.lineTo(9.5, 20.5);
        b.arcTo(2, 20.5, 2, 11, 6);
        b.arcTo(2, 2, 13, 2, 8);
        b.arcTo(24, 2, 24, 11, 8);
        b.arcTo(24, 20.5, 16.5, 20.5, 6);
        b.closePath();
        x.save();
        x.shadowColor = 'rgba(0,0,0,0.3)';
        x.shadowBlur = 2;
        x.shadowOffsetY = 1;
        x.fillStyle = 'rgba(16,40,44,0.88)';
        x.fill(b);
        x.restore();
        stroke(x, b, HEK, 1.6);
        x.fillStyle = '#dffff8';
        for (const dx of [-5, 0, 5]) {
          x.beginPath();
          x.arc(13 + dx, 11.5, 1.8, 0, TAU);
          x.fill();
        }
        break;
      }
      case 'sparkle': {
        [c, x] = mk(20, 20);
        sparkle(x, 10, 10, 7, '#e8fff8');
        glow(x, 10, 10, 9, HEK, 0.4);
        break;
      }
      case 'leaf': {
        [c, x] = mk(16, 12);
        leafShape(x, 8, 6, 6, 0.3, '#8ab84a');
        break;
      }
      case 'pollen': {
        [c, x] = mk(12, 12);
        glow(x, 6, 6, 6, '#fff0a0', 0.8, false);
        x.fillStyle = '#fffbe0';
        x.beginPath();
        x.arc(6, 6, 1.4, 0, TAU);
        x.fill();
        break;
      }
      case 'firefly': {
        [c, x] = mk(20, 20);
        glow(x, 10, 10, 10, '#b8ff9a', 0.7, false);
        glow(x, 10, 10, 5, '#eaffc8', 0.9, false);
        break;
      }
      default: {
        [c, x] = mk(8, 8);
        x.fillStyle = 'rgba(220,214,206,0.85)';
        x.beginPath();
        x.ellipse(4, 4, 2.6, 1.8, 0.4, 0, TAU);
        x.fill();
        break;
      }
    }
    return { canvas: c, footX: c.width / 2, footY: c.height / 2 };
  }).canvas;
}

// ---------------------------------------------------------------------------
// ambience & placement hints
// ---------------------------------------------------------------------------

/** 場面の重ね絵のための目安 */
export function themeAmbience(theme: FieldTheme): FieldAmbience {
  switch (theme) {
    case 'village': return { tint: 0xfff1dc, light: 'rgba(255,222,160,0.20)', particle: 'leaf', fog: 0.04 };
    case 'forest': return { tint: 0xeef6e4, light: 'rgba(244,255,196,0.24)', particle: 'leaf', fog: 0.1 };
    case 'road': return { tint: 0xe4dcd4, light: 'rgba(255,206,166,0.14)', particle: 'ash', fog: 0.2 };
    case 'marsh': return { tint: 0xf6f2d0, light: 'rgba(255,240,150,0.22)', particle: 'pollen', fog: 0.32 };
    default: return { tint: 0xcfe9e6, light: 'rgba(140,240,220,0.18)', particle: 'firefly', fog: 0.24 };
  }
}

/**
 * T タイルに木を置く計画。1タイル1本を基本に、足元を少しずらし大きさをばらつかせ、
 * 奥(開けた場所から3タイル以上)は一部を間引いて暗くする。y の小さい順に並べて返す(=描く順)。
 */
export function planTrees(map: MapDef, seed?: number): TreePlacement[] {
  const gi = gridOf(map);
  const R = rng(seed ?? hs('trees', map.id));
  const { cols, rows } = gi;
  const isT = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= cols || ty >= rows ? true : gi.ch(tx, ty) === 'T');
  const dist = (tx: number, ty: number) => {
    for (let d = 1; d <= 3; d++) {
      for (let dy = -d; dy <= d; dy++) {
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          if (!isT(tx + dx, ty + dy)) return d;
        }
      }
    }
    return 4;
  };
  const n = TREE_VARIANTS[map.theme];
  const out: TreePlacement[] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (!isT(tx, ty)) continue;
      const d = dist(tx, ty);
      const r = R();
      if (d >= 3 && r < 0.3) continue;
      let variant = Math.floor(R() * n);
      if (map.theme === 'road' && variant === 3 && R() < 0.5) variant = Math.floor(R() * 3);
      out.push({
        tx, ty,
        x: (tx + 0.5) * T + (R() - 0.5) * T * 0.36,
        y: (ty + 0.92 + (ty === 0 ? 0.5 : ty === 1 && isT(tx, 0) ? 0.2 : 0)) * T + (R() - 0.5) * T * 0.24,
        variant,
        scale: 0.92 + R() * 0.2 + (d >= 3 ? 0.06 : 0),
        shade: d <= 1 ? 1 : d === 2 ? 0.82 : 0.66,
      });
    }
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}
