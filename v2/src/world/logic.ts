/* ============================================================
 * ワールドの中核ロジック(描画に依存しない。テストできる)
 *   条件式 / 当たり判定と移動 / 出入口・きっかけ・調べる対象 / 障害物(能力ゲート)
 *   シンボル遭遇の有利不利 / 経験値とレベル / 野生の配置 / セーブデータ
 * ============================================================ */
import { MAPS } from './maps.ts';
import { TILE_CHARS, WALKABLE } from './types.ts';
import type { Ability, Cond, MapDef, MapExit, MapId, MapObject, MapTrigger, SpawnZone } from './types.ts';
import { nextRandom } from '../core/rules.ts';
import { PARTY, unitDef } from '../data/units.ts';

/* ---------------- 条件式 ---------------- */
export type VarValue = string | number | boolean | null | undefined;
export type Lookup = (name: string) => VarValue;

const truthy = (v: VarValue) => v !== undefined && v !== null && v !== false && v !== 0 && v !== '';

function atom(a: string, get: Lookup): boolean {
  const s = a.trim();
  const ne = s.indexOf('!=');
  if (ne > 0) return String(get(s.slice(0, ne)) ?? '') !== s.slice(ne + 2);
  const eq = s.indexOf('=');
  if (eq > 0) return String(get(s.slice(0, eq)) ?? '') === s.slice(eq + 1);
  if (s.startsWith('!')) return !truthy(get(s.slice(1)));
  return truthy(get(s));
}

/** すべての節を満たすか。節の中の '|' は「どれか」 */
export function checkCond(cond: Cond | undefined, get: Lookup): boolean {
  if (!cond) return true;
  return cond.every((clause) => clause.split('|').some((a) => atom(a, get)));
}

/* ---------------- 状態 ---------------- */
export type PartyId = (typeof PARTY)[number];
export type FieldItem = 'potion' | 'revive' | 'herb';
export type Dir = { x: number; y: number };

export interface MonsterRecord { seen: number; pacified: number; defeated: number }

export interface GameState {
  version: 1;
  map: MapId;
  x: number;
  y: number;
  facing: Dir;
  party: { level: number; exp: number; hp: Record<PartyId, number> };
  items: Record<FieldItem, number>;
  /** 開けた障害物・取った宝・一度きりのきっかけ・入場時の物語 */
  flags: string[];
  /** 記録帳: 出会ったモンスター */
  records: Record<string, MonsterRecord>;
  /** 記録帳: 出来事 */
  notes: string[];
  /** ink の状態(JSON) */
  story: string | null;
  /** 遊んだ時間(秒) */
  playtime: number;
  /** セーブした時刻(ms) */
  savedAt: number;
}

export function newGame(): GameState {
  const [x, y] = MAPS.hanazono.points.start;
  return {
    version: 1, map: 'hanazono', x, y, facing: { x: 0, y: 1 },
    party: { level: 1, exp: 0, hp: { hinoko: 1, shizuku: 1, konoha: 1 } },
    items: { potion: 0, revive: 0, herb: 0 },
    flags: [], records: {}, notes: [], story: null, playtime: 0, savedAt: 0,
  };
}

export const hasFlag = (s: GameState, f: string) => s.flags.includes(f);
export function addFlag(s: GameState, f: string): void { if (!s.flags.includes(f)) s.flags.push(f); }

/* ---------------- タイル・物体 ---------------- */
export function tileAt(m: MapDef, tx: number, ty: number): string {
  if (ty < 0 || ty >= m.rows.length || tx < 0 || tx >= m.rows[0].length) return '#';
  return m.rows[ty][tx];
}

/** 障害物(ゲート)が塞ぐタイル */
export function gateTiles(o: MapObject): [number, number][] {
  if (!o.gate) return [];
  const x0 = Math.floor(o.x - o.gate.w / 2);
  const y0 = Math.round(o.y) - o.gate.h;
  const out: [number, number][] = [];
  for (let j = 0; j < o.gate.h; j++) for (let i = 0; i < o.gate.w; i++) out.push([x0 + i, y0 + j]);
  return out;
}

const isSolidObject = (o: MapObject) => o.solid ?? (o.kind === 'npc' || o.kind === 'prop' || o.kind === 'guardian'
  || o.kind === 'sign' || o.kind === 'record' || o.kind === 'chest' || o.kind === 'spring');

/**
 * マップの通行可否(タイル単位)を作る。表示条件・開けた障害物を反映する。
 * 戻り値 solid[ty][tx]
 */
export function buildSolidGrid(m: MapDef, get: Lookup, flags: readonly string[], hidden: ReadonlySet<string> = new Set()): boolean[][] {
  const grid = m.rows.map((row) => Array.from(row, (c) => !WALKABLE.has(c)));
  for (const o of m.objects) {
    if (hidden.has(o.id) || !checkCond(o.when, get)) continue;
    if (o.gate) {
      const open = flags.includes(o.gate.flag);
      for (const [tx, ty] of gateTiles(o)) if (grid[ty]?.[tx] !== undefined) grid[ty][tx] = !open;
    } else if (isSolidObject(o)) {
      const tx = Math.floor(o.x);
      const ty = Math.floor(o.y - 0.01);
      if (grid[ty]?.[tx] !== undefined) grid[ty][tx] = true;
    }
  }
  return grid;
}

const solidAt = (grid: boolean[][], tx: number, ty: number) => grid[ty]?.[tx] ?? true;

/**
 * 円(半径 r タイル)を (dx, dy) だけ動かす。壁に当たった軸は止め、壁沿いに滑らせる。
 * 角に少しだけ引っかかったときは、横へ逃がして通り抜けやすくする(操作の気持ちよさのため)。
 */
export function moveCircle(grid: boolean[][], x: number, y: number, dx: number, dy: number, r = 0.3): { x: number; y: number; hit: boolean } {
  const blocked = (px: number, py: number) => {
    const x0 = Math.floor(px - r), x1 = Math.floor(px + r - 1e-6);
    const y0 = Math.floor(py - r), y1 = Math.floor(py + r - 1e-6);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(grid, tx, ty)) return true;
    return false;
  };
  let nx = x, ny = y, hit = false;
  // 大きな移動は分割(壁抜け防止)
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (r * 0.9)));
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps, sy = dy / steps;
    if (sx) {
      if (!blocked(nx + sx, ny)) nx += sx;
      else {
        hit = true;
        // 角の助け: 上下どちらかに少しずらせば通れるなら、そちらへ寄せる
        if (!sy) for (const n of [0.18, -0.18]) if (!blocked(nx + sx, ny + n) && !blocked(nx, ny + n)) { ny += Math.sign(n) * Math.min(Math.abs(sx), 0.06); break; }
      }
    }
    if (sy) {
      if (!blocked(nx, ny + sy)) ny += sy;
      else {
        hit = true;
        if (!sx) for (const n of [0.18, -0.18]) if (!blocked(nx + n, ny + sy) && !blocked(nx + n, ny)) { nx += Math.sign(n) * Math.min(Math.abs(sy), 0.06); break; }
      }
    }
  }
  return { x: nx, y: ny, hit };
}

const inRect = (px: number, py: number, r: { x: number; y: number; w: number; h: number }) =>
  px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;

export function exitAt(m: MapDef, x: number, y: number): MapExit | null {
  return m.exits.find((e) => inRect(x, y, e)) ?? null;
}

export function triggersAt(m: MapDef, x: number, y: number, get: Lookup, flags: readonly string[]): MapTrigger[] {
  return m.triggers.filter((t) => inRect(x, y, t) && checkCond(t.when, get) && !(t.once && flags.includes(t.id)));
}

/** 正面にある調べられるもの(近い順で最初の1つ) */
export function interactTarget(m: MapDef, x: number, y: number, facing: Dir, get: Lookup, hidden: ReadonlySet<string> = new Set()): MapObject | null {
  const fx = x + facing.x * 0.8;
  const fy = y + facing.y * 0.8;
  let best: MapObject | null = null;
  let bestD = Infinity;
  for (const o of m.objects) {
    if (hidden.has(o.id) || !checkCond(o.when, get)) continue;
    if (!(o.talk || o.gate || o.item || o.kind === 'record' || o.kind === 'spring')) continue;
    let d: number;
    if (o.gate) {
      d = Math.min(...gateTiles(o).map(([tx, ty]) => Math.hypot(tx + 0.5 - fx, ty + 0.5 - fy)));
    } else {
      const oy = o.kind === 'guardian' ? o.y + 0.6 : o.y - 0.5;
      d = Math.hypot(o.x - fx, oy - fy);
    }
    const reach = o.kind === 'guardian' ? 2.4 : 1.0;
    if (d <= reach && d < bestD) { best = o; bestD = d; }
  }
  return best;
}

/* ---------------- 能力ゲート ---------------- */
export const ABILITY_OF: Record<PartyId, Ability> = { hinoko: 'fire', shizuku: 'water', konoha: 'wood' };
export const ABILITY_VERB: Record<Ability, string> = { fire: '焼き払う', water: '洗い流す', wood: '蔓を伸ばす' };

/** 障害物を開けられる仲間(倒れていない、必要な能力を持つ) */
export function gateSolvers(o: MapObject, s: GameState): PartyId[] {
  if (!o.gate) return [];
  return PARTY.filter((id) => o.gate?.need.includes(ABILITY_OF[id]) && s.party.hp[id] > 0);
}

/* ---------------- シンボル遭遇 ---------------- */
/**
 * 開幕の有利不利。
 *  first : 気づかれていない相手、または背中に触れた
 *  ambush: 気づいた相手に、こちらが背を向けたまま触れられた
 */
export function judgeOpening(p: { x: number; y: number; facing: Dir }, e: { x: number; y: number; facing: Dir; alerted: boolean }): 'first' | 'ambush' | 'normal' {
  const dx = p.x - e.x, dy = p.y - e.y;
  const len = Math.hypot(dx, dy) || 1;
  const toP = { x: dx / len, y: dy / len };
  const monLooksAtP = e.facing.x * toP.x + e.facing.y * toP.y;
  const pLooksAtMon = -(p.facing.x * toP.x + p.facing.y * toP.y);
  if (!e.alerted || monLooksAtP < -0.3) return 'first';
  if (pLooksAtMon < -0.3) return 'ambush';
  return 'normal';
}

/* ---------------- 経験値・レベル ---------------- */
export const MAX_LEVEL = 30;
export const expForLevel = (lv: number) => 25 * (lv - 1) * (lv - 1);
export function levelFromExp(exp: number): number {
  let lv = 1;
  while (lv < MAX_LEVEL && exp >= expForLevel(lv + 1)) lv++;
  return lv;
}
/** 倒した・鎮めた敵からの経験値。鎮めると少し減るが、記録帳の「信頼」が増える */
export function expReward(results: { level: number; how: 'defeated' | 'pacified'; guardian?: boolean }[]): number {
  return results.reduce((sum, r) => sum + (r.guardian ? 120 : Math.round((r.how === 'pacified' ? 5 : 6) * r.level)), 0);
}

/* ---------------- 野生の配置 ---------------- */
export interface WildSpawn {
  id: string;
  zone: number;
  species: string;
  level: number;
  /** 戦闘での群れ(先頭が見えている個体) */
  group: string[];
  x: number;
  y: number;
}

function rnd(seed: { v: number }): number {
  const r = nextRandom(seed.v);
  seed.v = r.state;
  return r.value;
}

export function spawnWild(m: MapDef, seedValue: number, get: Lookup, grid: boolean[][]): WildSpawn[] {
  const seed = { v: (seedValue >>> 0) || 1 };
  const out: WildSpawn[] = [];
  m.spawns.forEach((z: SpawnZone, zi) => {
    if (!checkCond(z.when, get)) return;
    for (let k = 0; k < z.count; k++) {
      let tx = 0, ty = 0, ok = false;
      for (let tries = 0; tries < 60 && !ok; tries++) {
        tx = z.x + Math.floor(rnd(seed) * z.w);
        ty = z.y + Math.floor(rnd(seed) * z.h);
        ok = !solidAt(grid, tx, ty) && !out.some((o) => Math.hypot(o.x - tx, o.y - ty) < 3);
      }
      if (!ok) continue;
      const pick = () => z.species[Math.floor(rnd(seed) * z.species.length) % z.species.length];
      const lead = pick();
      const n = z.group[0] + Math.floor(rnd(seed) * (z.group[1] - z.group[0] + 1));
      const group = [lead];
      while (group.length < n) group.push(pick());
      const level = z.level[0] + Math.floor(rnd(seed) * (z.level[1] - z.level[0] + 1));
      out.push({ id: `${m.id}_w${zi}_${k}`, zone: zi, species: lead, level, group, x: tx + 0.5, y: ty + 0.6 });
    }
  });
  return out;
}

/* ---------------- 到達できる範囲(テスト・検証用) ---------------- */
export function reachable(grid: boolean[][], from: [number, number]): Set<string> {
  const seen = new Set<string>();
  const q: [number, number][] = [[Math.floor(from[0]), Math.floor(from[1])]];
  while (q.length) {
    const [x, y] = q.pop() as [number, number];
    const k = `${x},${y}`;
    if (seen.has(k) || solidAt(grid, x, y)) continue;
    seen.add(k);
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}

/* ---------------- マップの検査(テストで使う) ---------------- */
export function validateMap(m: MapDef): string[] {
  const errs: string[] = [];
  const w = m.rows[0].length;
  m.rows.forEach((r, i) => {
    if (r.length !== w) errs.push(`${m.id}: ${i}行目の幅 ${r.length} ≠ ${w}`);
    for (const c of r) if (!TILE_CHARS.has(c)) errs.push(`${m.id}: ${i}行目に未知の文字 ${c}`);
  });
  for (const [name, [x, y]] of Object.entries(m.points)) {
    if (!WALKABLE.has(tileAt(m, Math.floor(x), Math.floor(y)))) errs.push(`${m.id}: 地点 ${name} が歩けないタイル`);
  }
  for (const e of m.exits) {
    if (!MAPS[e.to]) errs.push(`${m.id}: 出口の行き先 ${e.to} がない`);
    else if (!MAPS[e.to].points[e.point]) errs.push(`${m.id}: 出口の到着地点 ${e.to}.${e.point} がない`);
  }
  for (const o of m.objects) {
    if (o.kind === 'npc' && o.art?.startsWith('villager') === false && !['kaede', 'ren', 'ashstar', 'gendou'].includes(o.art ?? '')) {
      errs.push(`${m.id}: ${o.id} の絵 ${o.art} が不明`);
    }
  }
  for (const z of m.spawns) for (const sp of z.species) {
    try { unitDef(sp); } catch { errs.push(`${m.id}: 出現する種 ${sp} がない`); }
  }
  return errs;
}

/* ---------------- セーブ ---------------- */
const SAVE_KEY = 'hekikan_v2_save';

export function saveGame(s: GameState): boolean {
  try {
    s.savedAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch { return false; }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch { return null; }
}

export function hasSave(): boolean {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

/** 壊れた・古いセーブを安全に読む(足りない項目は既定値で埋める) */
export function migrate(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<GameState>;
  const base = newGame();
  const map = r.map && r.map in MAPS ? r.map : base.map;
  const hp = { ...base.party.hp, ...(r.party?.hp ?? {}) };
  for (const k of Object.keys(hp) as PartyId[]) hp[k] = Math.max(0, Math.min(1, Number(hp[k]) || 0));
  return {
    ...base,
    map,
    x: Number.isFinite(r.x) ? Number(r.x) : MAPS[map].points[Object.keys(MAPS[map].points)[0]][0],
    y: Number.isFinite(r.y) ? Number(r.y) : MAPS[map].points[Object.keys(MAPS[map].points)[0]][1],
    facing: r.facing && Number.isFinite(r.facing.x) ? r.facing : base.facing,
    party: {
      level: Math.max(1, Math.min(MAX_LEVEL, Number(r.party?.level) || 1)),
      exp: Math.max(0, Number(r.party?.exp) || 0),
      hp,
    },
    items: { ...base.items, ...(r.items ?? {}) },
    flags: Array.isArray(r.flags) ? r.flags.filter((f) => typeof f === 'string') : [],
    records: r.records && typeof r.records === 'object' ? r.records : {},
    notes: Array.isArray(r.notes) ? r.notes.filter((n) => typeof n === 'string') : [],
    story: typeof r.story === 'string' ? r.story : null,
    playtime: Number(r.playtime) || 0,
    savedAt: Number(r.savedAt) || 0,
  };
}
