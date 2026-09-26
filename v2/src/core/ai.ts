/* ============================================================
 * 味方の自動方針(バランスシミュレーション・自動プレイ用)
 * 「そこそこ上手い人間」を想定: 判明した弱点を突く、ブレイク中を叩く、
 * 大技の溜めを優先して止める、危なければ回復・かばう、鎮められるなら鎮める。
 * 弱点は「判明しているもの」だけを使う(人間と同じ情報量)。
 * ============================================================ */
import type { Action, BattleState, Guard, Timing, Unit } from './types.ts';
import {
  activeAllies, activeEnemies, allies, createBattle, estimateDamage, intentForecast, isActive,
  performAction, performEnemy, previewTimeline, skillOptions, startTurn, unit, validTargets, type BattleSetup,
} from './battle.ts';
import { unitDef } from '../data/units.ts';
import { nextRandom } from './rules.ts';

export function chooseAllyAction(b: BattleState): Action {
  const u = unit(b, b.actor as string);
  const opts = skillOptions(b, u).filter((o) => o.usable);
  const has = (id: string) => opts.some((o) => o.skill.id === id);

  if (u.side === 'player') return choosePlayerAction(b, u, has);

  // 3体共鳴: 敵が複数、または守護獣のとき
  if (has('r_hekikan') && (activeEnemies(b).length >= 2 || activeEnemies(b).some((e) => unitDef(e.defId).guardian))) {
    return { skillId: 'r_hekikan' };
  }
  const hurt = activeAllies(b).slice().sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp);
  if (has('r_rain') && hurt.filter((a) => a.hp < a.maxHp * 0.55).length >= 2) return { skillId: 'r_rain' };
  if (has('w_heal') && hurt[0] && hurt[0].hp < hurt[0].maxHp * 0.42) return { skillId: 'w_heal', target: hurt[0].uid };

  // かばう: 次に大ダメージを受けそうな仲間を守る
  if (has('w_cover') && u.hp > u.maxHp * 0.5) {
    for (const e of activeEnemies(b)) {
      const f = intentForecast(b, e);
      if (!f || f.skill.target !== 'enemy') continue;
      const t = f.targets[0];
      if (!t || t.uid === u.uid) continue;
      const tu = unit(b, t.uid);
      if (t.dmg >= tu.hp * 0.8) return { skillId: 'w_cover', target: t.uid };
    }
  }

  // 攻撃技を採点
  const next = previewTimeline(b, 3).map((x) => x.uid);
  let best: { a: Action; score: number } | null = null;
  for (const o of opts) {
    const s = o.skill;
    if (s.kind !== 'attack') continue;
    const targets = s.target === 'enemy' ? validTargets(b, u, s) : s.target === 'allEnemies' ? activeEnemies(b) : [];
    const score = (t: Unit) => {
      let v = estimateDamage(b, u, t, s) * 1.1;
      const g = unitDef(t.defId).guardian;
      if (!g && v >= t.hp) v += 60;
      if (t.shieldMax > 0 && !t.broken) {
        const known = s.elements.some((e) => t.revealed.includes(e));
        if (known) {
          const hits = s.hits ?? 1;
          v += hits * 18;
          if (t.shield <= hits) v += 45;
          if (t.charging) v += 60;
          if (g && t.hp <= t.maxHp * g.pacifyAt) v += 40;
        }
      }
      if (unitDef(t.defId).controller) v += 25;
      if (s.effects?.delay && next.includes(t.uid)) v += 12;
      return v;
    };
    if (s.target === 'allEnemies') {
      const v = targets.reduce((acc, t) => acc + score(t), 0) - s.cost * 7;
      if (!best || v > best.score) best = { a: { skillId: s.id }, score: v };
    } else {
      for (const t of targets) {
        const v = score(t) - s.cost * 7;
        if (!best || v > best.score) best = { a: { skillId: s.id, target: t.uid }, score: v };
      }
    }
  }
  if (best) return best.a;
  const any = opts[0];
  return { skillId: any.skill.id, target: validTargets(b, u, any.skill)[0]?.uid };
}

function choosePlayerAction(b: BattleState, u: Unit, has: (id: string) => boolean): Action {
  if (has('p_pacify')) {
    const t = validTargets(b, u, skillOptions(b, u).find((o) => o.skill.id === 'p_pacify')!.skill)[0];
    if (t) return { skillId: 'p_pacify', target: t.uid };
  }
  if (has('p_revive')) {
    const ko = allies(b).find((a) => a.gone === 'ko');
    if (ko) return { skillId: 'p_revive', target: ko.uid };
  }
  const low = activeAllies(b).slice().sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
  if (has('p_potion') && low && low.hp < low.maxHp * 0.35) return { skillId: 'p_potion', target: low.uid };
  const unknown = activeEnemies(b)
    .filter((e) => e.shieldMax > 0 && e.revealed.length < e.weaknesses.length)
    .sort((x, y) => y.maxHp - x.maxHp)[0];
  if (unknown) return { skillId: 'p_observe', target: unknown.uid };
  return { skillId: 'p_cheer' };
}

/* ---------------- 対戦を最後まで回す(シミュレーション) ---------------- */
export interface SkillProfile {
  timing: Record<Timing, number>;
  guard: Record<Guard, number>;
}
/** 入力の上手さのプロファイル(シミュレーション用) */
export const PROFILES: Record<'casual' | 'average' | 'skilled' | 'auto', SkillProfile> = {
  casual: { timing: { perfect: 0.15, good: 0.55, miss: 0.3 }, guard: { perfect: 0.1, good: 0.45, none: 0.45 } },
  average: { timing: { perfect: 0.3, good: 0.55, miss: 0.15 }, guard: { perfect: 0.2, good: 0.55, none: 0.25 } },
  skilled: { timing: { perfect: 0.6, good: 0.35, miss: 0.05 }, guard: { perfect: 0.45, good: 0.45, none: 0.1 } },
  /** 設定「自動」: 攻撃は常に Good、防御は7割の確率で Good(半減) */
  auto: { timing: { perfect: 0, good: 1, miss: 0 }, guard: { perfect: 0, good: 0.7, none: 0.3 } },
};
export const HUMAN_AVERAGE = PROFILES.average;
export const AUTO_MODE = PROFILES.auto;

export interface SimResult { outcome: 'win' | 'lose' | 'stalemate'; turns: number; stats: BattleState['stats']; alive: number }

export function simulate(encounterId: string, seed: number, profile: SkillProfile = HUMAN_AVERAGE, maxTurns = 400, setup: BattleSetup = {}): SimResult {
  const b = createBattle(encounterId, seed, setup);
  let r = (seed * 2654435761) >>> 0 || 7;
  const roll = <K extends string>(dist: Record<K, number>): K => {
    const n = nextRandom(r); r = n.state;
    let x = n.value;
    for (const k of Object.keys(dist) as K[]) { x -= dist[k]; if (x <= 0) return k; }
    return Object.keys(dist)[0] as K;
  };
  while (!b.outcome && b.turn < maxTurns) {
    const t = startTurn(b);
    if (t.skip || b.outcome) continue;
    if (t.actor.side === 'enemy') performEnemy(b, roll(profile.guard));
    else performAction(b, chooseAllyAction(b), roll(profile.timing));
  }
  return {
    outcome: b.outcome ?? 'stalemate',
    turns: b.turn,
    stats: b.stats,
    alive: allies(b).filter(isActive).length,
  };
}
