/* ============================================================
 * 共鳴バトル — ルール定数と計算式
 * ============================================================ */
import type { Element, FieldElement, Timing, Guard } from './types.ts';

/** 属性の巡り: 火→森→雷→潮→火(矢印の先に強い) */
export const BEATS: Record<FieldElement, FieldElement> = {
  fire: 'wood',
  wood: 'thunder',
  thunder: 'water',
  water: 'fire',
};

export const ELEMENT_NAME: Record<Element, string> = {
  fire: '火', water: '潮', wood: '森', thunder: '雷', none: '無',
};

export const RP_MAX = 10;
export const FIELD_PERIOD = 6;        // 場が移り変わるまでの行動数
export const DELAY_BASE = 1000;       // 手番の基準時間(速さで割る)
export const ATK_UP_STEP = 0.2;       // 攻撃アップ1段階
export const ATK_UP_MAX = 3;
export const BURN_PCT = 0.06;
export const REGEN_PCT = 0.06;
export const BROKEN_DAMAGE = 1.5;     // ブレイク中の被ダメ倍率
export const FIELD_BONUS = 1.25;      // 場と同属性の技
export const MIST_MULT = 0.7;
export const COVER_MULT = 0.5;        // かばった側の被ダメ倍率
export const EFFECTIVE = 1.5;
export const RESISTED = 0.67;

export const TIMING_MULT: Record<Timing, number> = { perfect: 1.3, good: 1.1, miss: 0.85 };
export const GUARD_MULT: Record<Guard, number> = { perfect: 0, good: 0.5, none: 1 };

/** 1属性どうしの相性倍率 */
export function affinity(atk: Element, def: Element): number {
  if (atk === 'none' || def === 'none') return 1;
  if (BEATS[atk] === def) return EFFECTIVE;
  if (BEATS[def] === atk) return RESISTED;
  return 1;
}

/** 複数属性の技は、相手に最も有利な属性で判定する */
export function bestAffinity(atkEls: Element[], def: Element): number {
  return Math.max(...atkEls.map((e) => affinity(e, def)));
}

/** 手番の遅れ(速さが高いほど短い) */
export function turnDelay(spd: number, weight: number): number {
  return (DELAY_BASE / spd) * weight;
}

/**
 * 基礎ダメージ: 威力 × (攻撃/防御) × 0.5。攻防が同じなら威力の半分。
 * 攻撃/防御の比に比例させる(飽和する式だと能力差や成長が効かず、戦闘が平板になる)。
 * 比は 0.25〜4 に制限して極端な値を防ぐ。
 */
/**
 * レベルによる強さ。HPと与ダメージの両方に掛ける(攻撃/防御の比は変えない)。
 * 同じレベル同士なら戦闘の長さは変わらず、レベル差だけが効く。
 */
export function levelScale(level: number): number {
  return 1 + 0.06 * (Math.max(1, level) - 1);
}

export function baseDamage(power: number, atk: number, def: number): number {
  const ratio = Math.min(4, Math.max(0.25, atk / Math.max(1, def)));
  return power * ratio * 0.5;
}

/* ---------- 決定論的な乱数(mulberry32) ---------- */
export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: next };
}
