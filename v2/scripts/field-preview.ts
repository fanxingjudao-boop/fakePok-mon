/* ============================================================
 * フィールドの絵の確認ページ(scripts/field-preview.mjs が開いて保存する)
 *   5つの地図を、ゲームと同じ置き方で組み立てる:
 *     地面(renderGround) → 木(planTrees: 1タイル1本)・茂み・岩・小物・門・人物を足元の y 順に。
 *   さらに themeAmbience を使った重ね絵(色・光の筋・霧・粒)を 1280×720 の切り抜きに掛ける。
 * ============================================================ */
import { MAPS } from '../src/world/maps.ts';
import { TILE } from '../src/world/types.ts';
import type { MapDef, MapId } from '../src/world/types.ts';
import {
  renderGround, drawTree, drawBush, drawRock, drawProp, drawGate, drawVillager, drawFieldFx, themeAmbience,
  planTrees, drawVineBridge, drawChest, TREE_VARIANTS,
} from '../src/art/field.ts';
import type { FieldSprite, VillagerId } from '../src/art/field.ts';
import yuuUrl from '../src/assets/cutout/char_yuu.webp';
import kaedeUrl from '../src/assets/cutout/char_kaede.webp';
import renUrl from '../src/assets/cutout/char_ren.webp';
import ashUrl from '../src/assets/cutout/char_ashstar.webp';
import dragonUrl from '../src/assets/cutout/boss_forest.webp';
import monUrl from '../src/assets/cutout/mon_w01.webp';

declare global {
  interface Window {
    __field?: { done: boolean; outputs: { name: string; url: string }[]; report: string[]; error?: string };
  }
}

const T = TILE;
const out: { name: string; url: string }[] = [];
const report: string[] = [];
window.__field = { done: false, outputs: out, report };

function mk(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const x = c.getContext('2d');
  if (!x) throw new Error('no 2d');
  x.imageSmoothingQuality = 'high';
  return [c, x];
}
function load(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

interface Item { img: CanvasImageSource; w: number; h: number; fx: number; fy: number; x: number; y: number; shade?: number; shadow?: number; depth?: number }

function fromSprite(s: FieldSprite, x: number, y: number, scale = 1, shade = 1, depth?: number): Item {
  return { img: s.canvas, w: s.canvas.width * scale, h: s.canvas.height * scale, fx: s.footX * scale, fy: s.footY * scale, x, y, shade, depth };
}
function fromImage(im: HTMLImageElement, x: number, y: number, height: number): Item {
  const k = height / im.naturalHeight;
  return { img: im, w: im.naturalWidth * k, h: height, fx: (im.naturalWidth * k) / 2, fy: height * 0.985, x, y, shadow: (im.naturalWidth * k) * 0.42 };
}

const imgs: Record<string, HTMLImageElement> = {};
const cutout: Record<string, [string, number]> = {
  kaede: ['kaede', 1.95], ren: ['ren', 1.95], ashstar: ['ashstar', 1.95], dragon: ['dragon', 4.2],
};

function mapSize(map: MapDef): [number, number] {
  return [Math.max(...map.rows.map((r) => r.length)), map.rows.length];
}

function compose(map: MapDef, ground: HTMLCanvasElement, opts: { solvedVine?: boolean } = {}): HTMLCanvasElement {
  const [cols, rows] = mapSize(map);
  const [c, x] = mk(cols * T, rows * T);
  x.drawImage(ground, 0, 0);
  const items: Item[] = [];
  for (const t of planTrees(map)) items.push(fromSprite(drawTree(map.theme, t.variant), t.x, t.y, t.scale, t.shade));
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const ch = map.rows[ty][tx];
      const v = (tx * 7 + ty * 13) % 3;
      if (ch === 'b') items.push(fromSprite(drawBush(map.theme, v), (tx + 0.5) * T, (ty + 0.86) * T));
      if (ch === 'R') items.push(fromSprite(drawRock(map.theme, v), (tx + 0.5) * T, (ty + 0.86) * T));
    }
  }
  for (const o of map.objects) {
    const px = o.x * T;
    const py = o.y * T;
    if (o.gate) {
      if (o.gate.kind === 'vine' && opts.solvedVine) items.push(fromSprite(drawVineBridge(o.gate.w, o.gate.h), px, py, 1, 1, py - T * 2));
      else items.push(fromSprite(drawGate(o.gate.kind, o.gate.w, o.gate.h, map.theme), px, py, 1, 1, o.gate.kind === 'vine' ? py - T * 2 : undefined));
      continue;
    }
    if (o.prop) {
      // 床に近い大物(祭壇)は、上に立つ守護獣より先に描く
      const depth = o.prop === 'altar' ? py - T * 1.5 : undefined;
      items.push(fromSprite(drawProp(o.prop, map.theme, 0), px, py, 1, 1, depth));
      continue;
    }
    if (o.art && o.art.startsWith('villager_')) {
      const s = drawVillager(o.art as VillagerId);
      const it = fromSprite(s, px, py);
      items.push(it);
      continue;
    }
    if (o.art && cutout[o.art]) {
      const [key, h] = cutout[o.art];
      const it = fromImage(imgs[key], px, py, h * T);
      items.push(it);
    }
  }
  // player + one wild monster to judge contrast
  const start = map.points.start ?? map.points.west ?? map.points.entrance ?? Object.values(map.points)[0];
  items.push(fromImage(imgs.yuu, (start[0] + 0.6) * T, (start[1] + 0.4) * T, 1.95 * T));
  const sp = map.spawns[0];
  if (sp) items.push(fromImage(imgs.mon, (sp.x + sp.w / 2) * T, (sp.y + sp.h / 2) * T, 1.1 * T));
  items.sort((a, b) => (a.depth ?? a.y) - (b.depth ?? b.y));
  for (const it of items) {
    if (it.shadow) {
      const sh = drawFieldFx('shadow');
      x.drawImage(sh, it.x - it.shadow, it.y - it.shadow * 0.2, it.shadow * 2, it.shadow * 0.4);
    }
    x.save();
    if (it.shade !== undefined && it.shade < 1) x.filter = `brightness(${it.shade})`;
    x.drawImage(it.img, it.x - it.fx, it.y - it.fy, it.w, it.h);
    x.restore();
  }
  if (sp) {
    const ex = drawFieldFx('exclaim');
    x.drawImage(ex, (sp.x + sp.w / 2) * T - ex.width / 2, (sp.y + sp.h / 2) * T - T * 1.35 - ex.height);
  }
  for (const o of map.objects) {
    if (o.kind === 'sign' || o.kind === 'record' || o.kind === 'chest') {
      const ic = drawFieldFx('interact');
      x.drawImage(ic, o.x * T - ic.width / 2, o.y * T - T * 1.9);
      break;
    }
  }
  return c;
}

/** themeAmbience を使った重ね絵(場面側の処理の見本) */
function ambience(map: MapDef, src: HTMLCanvasElement, cx: number, cy: number, seed: number): HTMLCanvasElement {
  const [c, x] = mk(1280, 720);
  const W = src.width;
  const H = src.height;
  const sx = Math.max(0, Math.min(W - 1280, cx - 640));
  const sy = Math.max(0, Math.min(H - 720, cy - 360));
  x.fillStyle = '#000';
  x.fillRect(0, 0, 1280, 720);
  x.drawImage(src, sx, sy, Math.min(1280, W), Math.min(720, H), 0, 0, Math.min(1280, W), Math.min(720, H));
  const a = themeAmbience(map.theme);
  let s = seed;
  const R = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = `#${a.tint.toString(16).padStart(6, '0')}`;
  x.fillRect(0, 0, 1280, 720);
  x.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i++) {
    const x0 = 100 + i * 330 + R() * 120;
    const g = x.createLinearGradient(x0, 0, x0 + 260, 720);
    g.addColorStop(0, a.light);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(x0, -10);
    x.lineTo(x0 + 70 + R() * 50, -10);
    x.lineTo(x0 + 420, 730);
    x.lineTo(x0 + 250, 730);
    x.closePath();
    x.fill();
  }
  x.globalCompositeOperation = 'source-over';
  if (a.fog > 0) {
    const g = x.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, `rgba(240,236,210,${a.fog * 0.35})`);
    g.addColorStop(0.5, `rgba(240,236,210,${a.fog * 0.12})`);
    g.addColorStop(1, `rgba(240,236,210,${a.fog * 0.3})`);
    x.fillStyle = g;
    x.fillRect(0, 0, 1280, 720);
  }
  if (a.particle) {
    const p = drawFieldFx(a.particle);
    for (let i = 0; i < 46; i++) {
      x.globalAlpha = 0.5 + R() * 0.5;
      x.drawImage(p, R() * 1280, R() * 720);
    }
    x.globalAlpha = 1;
  }
  const v = x.createRadialGradient(640, 380, 300, 640, 380, 820);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  x.fillStyle = v;
  x.fillRect(0, 0, 1280, 720);
  x.restore();
  return c;
}

function sheet(): HTMLCanvasElement {
  const [c, x] = mk(2400, 1700);
  x.fillStyle = '#5d7456';
  x.fillRect(0, 0, 2400, 1700);
  x.fillStyle = '#e8f0e0';
  x.font = '14px sans-serif';
  let cx = 20;
  let cy = 20;
  let rowH = 0;
  const put = (s: FieldSprite, label: string) => {
    if (cx + s.canvas.width > 2380) { cx = 20; cy += rowH + 26; rowH = 0; }
    x.drawImage(s.canvas, cx, cy);
    x.strokeStyle = 'rgba(255,80,80,0.9)';
    x.beginPath();
    x.moveTo(cx + s.footX - 4, cy + s.footY);
    x.lineTo(cx + s.footX + 4, cy + s.footY);
    x.moveTo(cx + s.footX, cy + s.footY - 4);
    x.lineTo(cx + s.footX, cy + s.footY + 4);
    x.stroke();
    x.fillText(label, cx, cy + s.canvas.height + 15);
    cx += s.canvas.width + 14;
    rowH = Math.max(rowH, s.canvas.height);
  };
  for (const th of ['village', 'forest', 'road', 'marsh', 'shrine'] as const) {
    for (let v = 0; v < TREE_VARIANTS[th]; v++) put(drawTree(th, v), `${th} ${v}`);
    put(drawBush(th, 0), 'bush');
    put(drawRock(th, 0), 'rock');
  }
  cx = 20; cy += rowH + 30; rowH = 0;
  for (const k of ['great_tree', 'lab', 'house', 'tent', 'device', 'altar', 'shrine_gate'] as const) put(drawProp(k, k === 'tent' || k === 'device' ? 'road' : k === 'altar' || k === 'shrine_gate' ? 'shrine' : 'village'), k);
  cx = 20; cy += rowH + 30; rowH = 0;
  for (const k of ['spring', 'record_stone', 'sign', 'lantern', 'beehive', 'crate', 'stump', 'mushroom'] as const) put(drawProp(k, 'forest'), k);
  put(drawProp('stump', 'forest', 1), 'stump+journal');
  put(drawProp('stump', 'road'), 'stump road');
  put(drawProp('mushroom', 'marsh'), 'mush marsh');
  put(drawProp('mushroom', 'shrine'), 'mush shrine');
  put(drawChest(false), 'chest');
  put(drawChest(true), 'chest open');
  for (const id of ['villager_a', 'villager_b', 'villager_c', 'villager_d'] as const) put(drawVillager(id), id);
  cx = 20; cy += rowH + 30; rowH = 0;
  put(drawGate('log', 1, 4, 'road'), 'log 1x4');
  put(drawGate('thorns', 2, 1, 'forest'), 'thorns 2x1');
  put(drawGate('pollen', 1, 3, 'marsh'), 'pollen 1x3');
  put(drawGate('vine', 2, 1, 'marsh'), 'vine hint');
  put(drawVineBridge(2, 1), 'vine bridge');
  put(drawGate('log', 3, 1, 'road'), 'log 3x1');
  for (const f of ['shadow', 'exclaim', 'interact', 'sparkle', 'leaf', 'pollen', 'firefly', 'ash'] as const) {
    const cv = drawFieldFx(f);
    put({ canvas: cv, footX: cv.width / 2, footY: cv.height / 2 }, f);
  }
  return c;
}

const VIEWS: Record<MapId, [number, number][]> = {
  hanazono: [[7, 9], [18, 10], [12, 17]],
  trail: [[19.5, 15], [9, 6], [38, 10]],
  road: [[33, 12], [8, 13]],
  marsh: [[22, 10], [21, 19]],
  shrine: [[15, 10], [15, 26]],
};

/** ?bench=<mapId>: renderGround だけを何度も回して時間を測る(プロファイル用) */
async function bench(id: MapId): Promise<void> {
  const map = MAPS[id];
  const times: number[] = [];
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    const g = renderGround(map);
    g.getContext('2d')?.getImageData(0, 0, 1, 1);
    times.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 0));
  }
  report.push(`bench ${id}: ${times.map((t) => t.toFixed(0)).join(' / ')}`);
  window.__field!.done = true;
}

async function main(): Promise<void> {
  const benchId = new URLSearchParams(location.search).get('bench') as MapId | null;
  if (benchId && MAPS[benchId]) return bench(benchId);
  const status = document.getElementById('status');
  imgs.yuu = await load(yuuUrl);
  imgs.kaede = await load(kaedeUrl);
  imgs.ren = await load(renUrl);
  imgs.ashstar = await load(ashUrl);
  imgs.dragon = await load(dragonUrl);
  imgs.mon = await load(monUrl);
  for (const id of Object.keys(MAPS) as MapId[]) {
    const map = MAPS[id];
    const times: number[] = [];
    let ground: HTMLCanvasElement | null = null;
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      ground = renderGround(map, i === 3 ? 12345 : undefined);
      // force the raster to finish so timing includes the real work
      ground.getContext('2d')?.getImageData(0, 0, 1, 1);
      times.push(performance.now() - t0);
    }
    ground = renderGround(map);
    const [cols, rows] = mapSize(map);
    report.push(`${id} ${cols}x${rows} (${cols * T}x${rows * T}px) renderGround ms: ${times.map((t) => t.toFixed(0)).join(' / ')} (first run includes texture setup)`);
    out.push({ name: `field-${id}-ground.png`, url: ground.toDataURL('image/png') });
    const full = compose(map, ground);
    out.push({ name: `field-${id}.png`, url: full.toDataURL('image/png') });
    VIEWS[id].forEach(([vx, vy], i) => {
      const v = ambience(map, full, vx * T, vy * T, 7 + i);
      out.push({ name: `field-${id}-view${i + 1}.png`, url: v.toDataURL('image/png') });
    });
    if (id === 'marsh') {
      const solved = compose(map, ground, { solvedVine: true });
      out.push({ name: 'field-marsh-view3-bridge.png', url: ambience(map, solved, 21 * T, 20 * T, 3).toDataURL('image/png') });
    }
    if (status) status.textContent = `done ${id}`;
    await new Promise((r) => setTimeout(r, 0));
  }
  out.push({ name: 'field-sheet.png', url: sheet().toDataURL('image/png') });
  window.__field!.done = true;
}

main().catch((e: unknown) => {
  window.__field!.error = String(e instanceof Error ? e.stack : e);
  window.__field!.done = true;
});
