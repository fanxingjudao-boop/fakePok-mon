import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/world/maps.ts';
import {
  buildSolidGrid, checkCond, expForLevel, exitAt, gateTiles, interactTarget, judgeOpening, levelFromExp,
  migrate, moveCircle, newGame, reachable, spawnWild, validateMap,
} from '../src/world/logic.ts';
import type { MapId } from '../src/world/types.ts';
import { WALKABLE } from '../src/world/types.ts';
import { createBattle, peekNextActor } from '../src/core/battle.ts';

const vars = (v: Record<string, string | number | boolean> = {}) => (k: string) => v[k];
const grid = (id: MapId, flags: string[] = [], v: Record<string, string | number | boolean> = {}) =>
  buildSolidGrid(MAPS[id], vars(v), flags);
const at = (p: [number, number]) => `${Math.floor(p[0])},${Math.floor(p[1])}`;
const reach = (id: MapId, from: string, flags: string[] = [], v: Record<string, string | number | boolean> = {}) =>
  reachable(grid(id, flags, v), MAPS[id].points[from]);
const exitTiles = (id: MapId, to: MapId) => {
  const e = MAPS[id].exits.find((x) => x.to === to);
  if (!e) throw new Error('no exit');
  const out: string[] = [];
  for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) out.push(`${x},${y}`);
  return out;
};
const reachesExit = (r: Set<string>, id: MapId, to: MapId) => exitTiles(id, to).some((t) => r.has(t));

describe('マップの形', () => {
  it('全マップに書式の誤りがない', () => {
    for (const m of Object.values(MAPS)) expect(validateMap(m)).toEqual([]);
  });

  it('到着地点がすぐ別の出口に重ならない(行き来のループを防ぐ)', () => {
    for (const m of Object.values(MAPS)) for (const e of m.exits) {
      const [x, y] = MAPS[e.to].points[e.point];
      expect(exitAt(MAPS[e.to], x, y), `${m.id}→${e.to}.${e.point}`).toBeNull();
    }
  });

  it('同じ地形の使い回しがない', () => {
    const keys = Object.values(MAPS).map((m) => m.rows.join('\n'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ハナゾノから獣道へ、獣道から湿地・旧街道へ出られる', () => {
    expect(reachesExit(reach('hanazono', 'start'), 'hanazono', 'trail')).toBe(true);
    expect(reachesExit(reach('hanazono', 'start'), 'hanazono', 'road')).toBe(true);
    const t = reach('trail', 'west');
    expect(reachesExit(t, 'trail', 'marsh')).toBe(true);
    expect(reachesExit(t, 'trail', 'road')).toBe(true);
  });

  it('獣道: いばらを焼くまで林の宝へは行けない(分岐+任意エリア)', () => {
    const chest = at([14.5, 3.8]);
    expect(reach('trail', 'west').has(`14,4`)).toBe(false);
    expect(reach('trail', 'west', ['thorn_trail']).has('14,4')).toBe(true);
    void chest;
  });

  it('獣道: 中央の岩山を北と南の二通りで回れる(循環路)', () => {
    const g = grid('trail');
    // 北回りを塞いでも南回りで東へ抜けられる
    const north = g.map((r) => [...r]);
    for (let y = 8; y <= 11; y++) for (let x = 20; x <= 32; x++) north[y][x] = true;
    const r1 = reachable(north, MAPS.trail.points.west);
    expect(reachesExit(r1, 'trail', 'marsh')).toBe(true);
    const south = g.map((r) => [...r]);
    for (let y = 17; y <= 20; y++) for (let x = 19; x <= 33; x++) south[y][x] = true;
    const r2 = reachable(south, MAPS.trail.points.west);
    expect(reachesExit(r2, 'trail', 'marsh')).toBe(true);
  });

  it('旧街道: 倒木が近道を塞ぎ、焼くと村とつながる', () => {
    expect(reachesExit(reach('road', 'north'), 'road', 'hanazono')).toBe(false);
    expect(reachesExit(reach('road', 'north', ['log_road']), 'road', 'hanazono')).toBe(true);
    // 村側から入っても、倒木の向こう(野営地)へは行けない
    expect(reach('road', 'west').has(at(MAPS.road.points.camp))).toBe(false);
  });

  it('湿地: 花粉の壁を払うまで森殿へ行けない / 小島へは蔓の橋が要る', () => {
    expect(reachesExit(reach('marsh', 'west'), 'marsh', 'shrine')).toBe(false);
    expect(reachesExit(reach('marsh', 'west', ['pollen_marsh']), 'marsh', 'shrine')).toBe(true);
    expect(reach('marsh', 'west', ['pollen_marsh']).has('19,18')).toBe(false);
    expect(reach('marsh', 'west', ['vine_marsh']).has('19,18')).toBe(true);
  });

  it('森殿: 入口から祭壇前の広場まで行ける', () => {
    expect(reach('shrine', 'entrance').has('15,12')).toBe(true);
  });

  it('障害物の足元は元の地形が歩けるか、橋になる', () => {
    for (const m of Object.values(MAPS)) for (const o of m.objects) {
      if (!o.gate) continue;
      for (const [x, y] of gateTiles(o)) {
        const c = m.rows[y][x];
        if (o.gate.kind === 'vine') expect(c, `${o.id} ${x},${y}`).toBe('~');
        else expect(WALKABLE.has(c), `${o.id} ${x},${y} = ${c}`).toBe(true);
      }
    }
  });
});

describe('条件式', () => {
  it('否定・等号・「どれか」', () => {
    const v = vars({ a: true, b: false, c: 'listen', n: 0 });
    expect(checkCond(['a'], v)).toBe(true);
    expect(checkCond(['!b'], v)).toBe(true);
    expect(checkCond(['c=listen'], v)).toBe(true);
    expect(checkCond(['c!=listen'], v)).toBe(false);
    expect(checkCond(['b|c=listen'], v)).toBe(true);
    expect(checkCond(['a', 'b'], v)).toBe(false);
    expect(checkCond(['n'], v)).toBe(false);
    expect(checkCond(['missing'], v)).toBe(false);
    expect(checkCond(undefined, v)).toBe(true);
  });
});

describe('移動', () => {
  it('壁は抜けず、壁沿いに滑る', () => {
    const g = [
      [true, true, true, true],
      [true, false, false, true],
      [true, false, false, true],
      [true, true, true, true],
    ];
    const r = moveCircle(g, 1.5, 1.5, -2, 0.2);
    expect(r.x).toBeGreaterThanOrEqual(1.3 - 1e-9);
    expect(r.hit).toBe(true);
    expect(r.y).toBeCloseTo(1.7, 5);
  });

  it('正面の相手に話しかけられる', () => {
    const m = MAPS.hanazono;
    const k = m.objects.find((o) => o.id === 'kaede');
    if (!k) throw new Error('kaede');
    const t = interactTarget(m, k.x - 1, k.y - 0.5, { x: 1, y: 0 }, vars());
    expect(t?.id).toBe('kaede');
    expect(interactTarget(m, k.x - 1, k.y - 0.5, { x: -1, y: 0 }, vars())).toBeNull();
  });
});

describe('シンボル遭遇の有利不利', () => {
  const p = { x: 0, y: 0, facing: { x: 1, y: 0 } };
  it('気づかれる前に触れたら先制', () => {
    expect(judgeOpening(p, { x: 1, y: 0, facing: { x: -1, y: 0 }, alerted: false })).toBe('first');
  });
  it('背中に触れたら先制', () => {
    expect(judgeOpening(p, { x: 1, y: 0, facing: { x: 1, y: 0 }, alerted: true })).toBe('first');
  });
  it('気づかれ、背を向けたまま追いつかれたら不意打ち', () => {
    expect(judgeOpening({ ...p, facing: { x: -1, y: 0 } }, { x: 1, y: 0, facing: { x: -1, y: 0 }, alerted: true })).toBe('ambush');
  });
  it('向かい合って当たれば通常', () => {
    expect(judgeOpening(p, { x: 1, y: 0, facing: { x: -1, y: 0 }, alerted: true })).toBe('normal');
  });
});

describe('成長', () => {
  it('経験値とレベル', () => {
    expect(levelFromExp(0)).toBe(1);
    expect(levelFromExp(expForLevel(2))).toBe(2);
    expect(levelFromExp(expForLevel(6) - 1)).toBe(5);
  });
});

describe('野生の配置', () => {
  it('同じ種なら同じ配置で、歩ける場所に出る', () => {
    const g = grid('trail');
    const a = spawnWild(MAPS.trail, 42, vars(), g);
    const b = spawnWild(MAPS.trail, 42, vars(), g);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
    for (const s of a) expect(g[Math.floor(s.y)][Math.floor(s.x)]).toBe(false);
  });
});

describe('セーブ', () => {
  it('壊れたデータでも安全に読める', () => {
    expect(migrate(null)).toBeNull();
    const s = migrate({ map: 'nowhere', party: { hp: { hinoko: 9 } }, flags: [1, 'x'] });
    expect(s?.map).toBe('hanazono');
    expect(s?.party.hp.hinoko).toBe(1);
    expect(s?.flags).toEqual(['x']);
    const g = newGame();
    expect(migrate(JSON.parse(JSON.stringify(g)))).toEqual(g);
  });
});

describe('フィールドからの戦闘', () => {
  it('不意打ちは敵が先に動く / 先制は味方が先で、敵の盾が1枚欠ける', () => {
    const amb = createBattle('wild', 3, { opening: 'ambush' });
    expect(peekNextActor(amb).side).toBe('enemy');
    const fst = createBattle('wild', 3, { opening: 'first' });
    expect(peekNextActor(fst).side).not.toBe('enemy');
    const e = fst.units.find((u) => u.defId === 'hanamochi');
    expect(e?.shield).toBe((e?.shieldMax ?? 0) - 1);
  });

  it('HP0の仲間は倒れた状態で始まり、レベル差は与ダメとHPに効く', () => {
    const b = createBattle('wild', 3, { partyHp: { hinoko: 0, shizuku: 0.5 }, partyLevel: 5, enemyLevel: 1, enemies: ['konezumi'] });
    const h = b.units.find((u) => u.defId === 'hinoko');
    const s = b.units.find((u) => u.defId === 'shizuku');
    expect(h?.gone).toBe('ko');
    expect(s?.hp).toBe(Math.round((s?.maxHp ?? 0) * 0.5));
    expect(s?.maxHp).toBeGreaterThan(158);
    expect(b.units.filter((u) => u.side === 'enemy').length).toBe(1);
  });
});
