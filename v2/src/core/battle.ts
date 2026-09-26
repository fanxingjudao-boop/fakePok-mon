/* ============================================================
 * 共鳴バトル — 戦闘エンジン(描画非依存・決定論的)
 *
 * 1手の流れ:
 *   const t = startTurn(b)            // 手番の決定・燃焼/再生・ブレイク回復
 *   if (t.skip) → 次の startTurn へ
 *   味方/巡環士: performAction(b, {skillId, target}, timing)
 *   敵:         performEnemy(b, guard)   // 予告(intent)どおりに行動
 * 各関数はアニメーション用の BattleEvent[] を返す。
 * ============================================================ */
import type {
  Action, BattleEvent, BattleState, Element, FieldElement, Guard, Intent, Skill, Timing, Unit,
} from './types.ts';
import {
  ATK_UP_MAX, ATK_UP_STEP, BROKEN_DAMAGE, BURN_PCT, COVER_MULT, FIELD_BONUS, FIELD_PERIOD,
  GUARD_MULT, MIST_MULT, REGEN_PCT, RP_MAX, TIMING_MULT, baseDamage, bestAffinity, nextRandom, turnDelay,
} from './rules.ts';
import { skill } from '../data/skills.ts';
import { PARTY, PLAYER, unitDef } from '../data/units.ts';
import { ENCOUNTERS } from '../data/encounters.ts';

/* ---------------- 生成 ---------------- */
function makeUnit(defId: string, uid: string, slot: number): Unit {
  const d = unitDef(defId);
  return {
    uid, defId, name: d.name, side: d.side, element: d.element,
    maxHp: d.hp, hp: d.hp, atk: d.atk, def: d.def, spd: d.spd,
    shieldMax: d.shield, shield: d.shield, weaknesses: [...d.weaknesses], revealed: [],
    broken: false, ct: 0,
    status: { burn: 0, regen: 0, mist: 0, atkUp: 0, coveredBy: null },
    gone: null, slot, charging: null, patternIdx: 0, phase: 1,
  };
}

export function createBattle(encounterId: string, seed = 1): BattleState {
  const enc = ENCOUNTERS[encounterId];
  if (!enc) throw new Error(`unknown encounter: ${encounterId}`);
  const units: Unit[] = [];
  PARTY.forEach((id, i) => units.push(makeUnit(id, `a${i}`, i)));
  units.push(makeUnit(PLAYER, 'p', 0));
  enc.enemies.forEach((id, i) => units.push(makeUnit(id, `e${i}`, i)));
  // 初期の手番: 開幕はこちらの先制。味方と巡環士が全員1回ずつ動いてから敵が動く
  // (開幕にいきなり殴られるのは不快、という試遊の声への対応)。並び順の差で同時刻を避ける
  const allySide = units.filter((u) => u.side !== 'enemy');
  const openingEnd = Math.max(...allySide.map((u) => turnDelay(u.spd, 1) * 0.3));
  units.forEach((u, i) => {
    u.ct = u.side === 'enemy'
      ? openingEnd + 1 + turnDelay(u.spd, 1) * 0.5 + i * 0.01
      : turnDelay(u.spd, 1) * 0.3 + i * 0.01;
  });
  const [first, ...rest] = enc.fieldCycle;
  const b: BattleState = {
    encounterId, units, time: 0, actor: null, intents: {},
    field: first, fieldQueue: [...rest], fieldTimer: FIELD_PERIOD,
    rp: 2, items: { potion: 3, revive: 1 },
    rng: (seed >>> 0) || 1, outcome: null, turn: 0,
    stats: { actions: 0, perfects: 0, parries: 0, breaks: 0, pacified: 0, defeated: 0, damageDealt: 0, maxHit: 0, resonances: 0, allyKOs: 0 },
  };
  for (const e of activeEnemies(b)) planIntent(b, e);
  return b;
}

/* ---------------- 参照ヘルパ ---------------- */
export const unit = (b: BattleState, uid: string): Unit => {
  const u = b.units.find((x) => x.uid === uid);
  if (!u) throw new Error(`no unit ${uid}`);
  return u;
};
export const isActive = (u: Unit) => u.gone === null;
export const allies = (b: BattleState) => b.units.filter((u) => u.side === 'ally');
export const activeAllies = (b: BattleState) => allies(b).filter(isActive);
export const enemies = (b: BattleState) => b.units.filter((u) => u.side === 'enemy');
export const activeEnemies = (b: BattleState) => enemies(b).filter(isActive);
export const player = (b: BattleState) => b.units.find((u) => u.side === 'player') as Unit;

function rand(b: BattleState): number {
  const r = nextRandom(b.rng);
  b.rng = r.state;
  return r.value;
}
function pick<T>(b: BattleState, arr: T[]): T {
  return arr[Math.floor(rand(b) * arr.length) % arr.length];
}

/* ---------------- タイムライン ---------------- */
function order(b: BattleState, u: Unit) { return b.units.indexOf(u); }

export function peekNextActor(b: BattleState): Unit {
  let best: Unit | null = null;
  for (const u of b.units) {
    if (!isActive(u)) continue;
    if (!best || u.ct < best.ct - 1e-9 || (Math.abs(u.ct - best.ct) < 1e-9 && order(b, u) < order(b, best))) best = u;
  }
  if (!best) throw new Error('no active units');
  return best;
}

export interface TimelineEntry { uid: string; recover: boolean; charge: boolean }

/**
 * これから手番が来る順(現在の手番は含まない)。
 * actorWeight を渡すと「今の手番でその重さの技を使ったら」の並びを返す(技選択中のプレビュー用)。
 */
export function previewTimeline(b: BattleState, count = 8, actorWeight?: number): TimelineEntry[] {
  const sim = new Map<string, number>();
  const brokenPending = new Set<string>();
  for (const u of b.units) if (isActive(u)) { sim.set(u.uid, u.ct); if (u.broken) brokenPending.add(u.uid); }
  if (b.actor && sim.has(b.actor)) {
    const a = unit(b, b.actor);
    sim.set(a.uid, b.time + turnDelay(a.spd, actorWeight ?? 1));
  }
  const out: TimelineEntry[] = [];
  for (let i = 0; i < count && sim.size; i++) {
    let bestId = ''; let bestCt = Infinity; let bestOrd = Infinity;
    for (const [id, ct] of sim) {
      const ord = order(b, unit(b, id));
      if (ct < bestCt - 1e-9 || (Math.abs(ct - bestCt) < 1e-9 && ord < bestOrd)) { bestId = id; bestCt = ct; bestOrd = ord; }
    }
    const u = unit(b, bestId);
    const recover = brokenPending.has(bestId);
    brokenPending.delete(bestId);
    out.push({ uid: bestId, recover, charge: !recover && !!b.intents[bestId] && skill(b.intents[bestId].skillId).kind === 'charge' });
    sim.set(bestId, bestCt + turnDelay(u.spd, 1));
  }
  return out;
}

/* ---------------- 計算 ---------------- */
const atkOf = (u: Unit) => u.atk * (1 + ATK_UP_STEP * u.status.atkUp);

/** 予告表示・AI用のダメージ見込み(乱数・タイミングなし) */
export function estimateDamage(b: BattleState, src: Unit, dst: Unit, s: Skill): number {
  if (!s.power) return 0;
  const hits = s.hits ?? 1;
  const per = baseDamage(s.power, atkOf(src), dst.def)
    * bestAffinity(s.elements, dst.element)
    * (s.elements.includes(b.field) ? FIELD_BONUS : 1)
    * (dst.broken ? BROKEN_DAMAGE : 1)
    * (src.status.mist > 0 ? MIST_MULT : 1);
  return Math.round(per) * hits;
}

export function canPacify(b: BattleState, t: Unit): boolean {
  if (t.side !== 'enemy' || !isActive(t) || !t.broken) return false;
  const d = unitDef(t.defId);
  if (!d.pacifiable) return false;
  if (d.controlled && activeEnemies(b).some((e) => unitDef(e.defId).controller)) return false;
  if (d.guardian && t.hp > t.maxHp * d.guardian.pacifyAt) return false;
  return true;
}

/** 鎮められない理由(UI表示用) */
export function pacifyBlockReason(b: BattleState, t: Unit): string | null {
  const d = unitDef(t.defId);
  if (!d.pacifiable) return 'この相手は鎮められない';
  if (d.controlled && activeEnemies(b).some((e) => unitDef(e.defId).controller)) return '装置に操られている';
  if (d.guardian && t.hp > t.maxHp * d.guardian.pacifyAt) return 'まだ心を開いていない(HP半分以下)';
  if (!t.broken) return 'ブレイクしていない';
  return null;
}

/* ---------------- 行動の可否 ---------------- */
export interface SkillOption { skill: Skill; usable: boolean; reason?: string }

export function validTargets(b: BattleState, actor: Unit, s: Skill): Unit[] {
  switch (s.target) {
    case 'enemy': {
      const list = activeEnemies(b);
      if (s.kind === 'pacify') return list.filter((t) => canPacify(b, t));
      return list;
    }
    case 'ally': {
      const list = activeAllies(b);
      return s.kind === 'cover' ? list.filter((t) => t.uid !== actor.uid) : list;
    }
    case 'allyKO': return allies(b).filter((u) => u.gone === 'ko');
    default: return [];
  }
}

export function skillOptions(b: BattleState, actor: Unit): SkillOption[] {
  return unitDef(actor.defId).skills.map((id) => {
    const s = skill(id);
    let reason: string | undefined;
    if (s.partners) {
      const ok = s.partners.every((pid) => allies(b).some((a) => a.defId === pid && isActive(a)));
      if (!ok) reason = '仲間がそろっていない';
    }
    if (!reason && b.rp < s.cost) reason = `共鳴ゲージが ${s.cost} 必要`;
    if (!reason && s.item && b.items[s.item] <= 0) reason = 'もう持っていない';
    if (!reason && (s.target === 'enemy' || s.target === 'ally' || s.target === 'allyKO') && validTargets(b, actor, s).length === 0) {
      reason = s.kind === 'pacify' ? '鎮められる相手がいない(ブレイク中に使う)'
        : s.target === 'allyKO' ? '倒れた仲間がいない' : '対象がいない';
    }
    if (!reason && s.kind === 'field' && s.effects?.field === b.field) reason = 'すでにその場になっている';
    return { skill: s, usable: !reason, reason };
  });
}

export const isTimedSkill = (s: Skill) => s.kind === 'attack';

/* ---------------- 手番開始 ---------------- */
export interface TurnStart { actor: Unit; events: BattleEvent[]; skip: boolean }

export function startTurn(b: BattleState): TurnStart {
  if (b.outcome) throw new Error('battle is over');
  const u = peekNextActor(b);
  b.time = u.ct;
  b.actor = u.uid;
  b.turn++;
  const ev: BattleEvent[] = [{ t: 'turn', uid: u.uid }];

  // 「かばう」は、かばった本人の番が来たら解除
  for (const x of b.units) if (x.status.coveredBy === u.uid) x.status.coveredBy = null;

  if (u.side !== 'player') {
    if (u.status.burn > 0) {
      const amt = Math.max(1, Math.round(u.maxHp * BURN_PCT));
      applyDamage(u, amt);
      u.status.burn--;
      ev.push({ t: 'tick', uid: u.uid, kind: 'burn', amount: amt });
      if (u.hp <= 0) { knockOut(b, u, ev); finishTurn(b, u, 1, ev); return { actor: u, events: ev, skip: true }; }
    }
    if (u.status.regen > 0) {
      const amt = heal(u, Math.round(u.maxHp * REGEN_PCT));
      u.status.regen--;
      if (amt > 0) ev.push({ t: 'tick', uid: u.uid, kind: 'regen', amount: amt });
    }
  }

  if (u.broken) {
    u.broken = false;
    u.shield = u.shieldMax;
    ev.push({ t: 'recover', uid: u.uid }, { t: 'shield', uid: u.uid, value: u.shield, max: u.shieldMax });
    finishTurn(b, u, 1, ev);
    return { actor: u, events: ev, skip: true };
  }
  if (u.side === 'enemy' && !b.intents[u.uid]) planIntent(b, u);
  return { actor: u, events: ev, skip: false };
}

/* ---------------- 味方・巡環士の行動 ---------------- */
export function performAction(b: BattleState, action: Action, timing: Timing = 'good'): BattleEvent[] {
  if (!b.actor) throw new Error('no actor');
  const u = unit(b, b.actor);
  if (u.side === 'enemy') throw new Error('performAction is for allies');
  const s = skill(action.skillId);
  const opt = skillOptions(b, u).find((o) => o.skill.id === s.id);
  if (!opt || !opt.usable) throw new Error(`skill not usable: ${s.id} (${opt?.reason ?? 'not owned'})`);
  const needsTarget = s.target === 'enemy' || s.target === 'ally' || s.target === 'allyKO';
  const target = needsTarget ? unit(b, action.target ?? '') : null;
  if (needsTarget && !validTargets(b, u, s).includes(target as Unit)) throw new Error(`invalid target ${action.target} for ${s.id}`);

  const ev: BattleEvent[] = [];
  const targets = target ? [target] : s.target === 'allEnemies' ? activeEnemies(b) : s.target === 'allAllies' ? activeAllies(b) : [];
  ev.push({ t: 'use', uid: u.uid, skillId: s.id, targets: targets.map((t) => t.uid) });

  if (s.cost > 0) addRp(b, -s.cost, ev);
  if (s.item) b.items[s.item]--;
  if (s.category === 'resonance') {
    b.stats.resonances++;
    for (const pid of s.partners ?? []) {
      const p = allies(b).find((a) => a.defId === pid);
      if (p && p.uid !== u.uid) p.ct += turnDelay(p.spd, 0.5);
    }
  }
  if (timing === 'perfect' && isTimedSkill(s)) { b.stats.perfects++; addRp(b, 1, ev); }

  switch (s.kind) {
    case 'attack': {
      for (const t of targets) {
        let landed = false;
        const hits = s.hits ?? 1;
        for (let h = 0; h < hits && isActive(t); h++) {
          dealHit(b, u, t, s, h, hits, ev, { timing });
          landed = true;
        }
        if (landed && isActive(t)) applyAfterEffects(b, s, t, ev);
      }
      if (s.effects?.field) setField(b, s.effects.field, ev);
      if (s.effects?.mist) for (const t of activeEnemies(b)) {
        t.status.mist = Math.max(t.status.mist, s.effects.mist);
        ev.push({ t: 'status', uid: t.uid, text: '霧' });
      }
      break;
    }
    case 'heal': {
      const bonus = s.elements.includes(b.field) ? FIELD_BONUS : 1;
      for (const t of targets) {
        const amt = heal(t, Math.round(t.maxHp * (s.effects?.healPct ?? 0) * bonus));
        ev.push({ t: 'heal', uid: t.uid, amount: amt });
        if (s.effects?.regen) { t.status.regen = Math.max(t.status.regen, s.effects.regen); ev.push({ t: 'status', uid: t.uid, text: '再生' }); }
      }
      if (s.effects?.field) setField(b, s.effects.field, ev);
      break;
    }
    case 'cover': {
      const t = target as Unit;
      t.status.coveredBy = u.uid;
      ev.push({ t: 'cover', uid: u.uid, target: t.uid });
      break;
    }
    case 'field': {
      if (s.effects?.field) setField(b, s.effects.field, ev);
      if (s.effects?.regen) for (const a of activeAllies(b)) {
        a.status.regen = Math.max(a.status.regen, s.effects.regen);
        ev.push({ t: 'status', uid: a.uid, text: '再生' });
      }
      break;
    }
    case 'observe': {
      const t = target as Unit;
      const fresh = t.weaknesses.filter((w) => !t.revealed.includes(w));
      t.revealed.push(...fresh);
      ev.push({ t: 'reveal', uid: t.uid, elements: [...t.weaknesses] });
      break;
    }
    case 'pacify': {
      const t = target as Unit;
      t.gone = 'pacified';
      delete b.intents[t.uid];
      b.stats.pacified++;
      ev.push({ t: 'pacify', uid: t.uid });
      addRp(b, 1, ev);
      break;
    }
    case 'cheer': {
      addRp(b, s.effects?.rpGain ?? 2, ev);
      break;
    }
    case 'item': {
      const t = target as Unit;
      if (s.effects?.revivePct) {
        t.gone = null;
        t.hp = Math.max(1, Math.round(t.maxHp * s.effects.revivePct));
        t.ct = b.time + turnDelay(t.spd, 0.5);
        ev.push({ t: 'revive', uid: t.uid, amount: t.hp });
      } else {
        const amt = heal(t, Math.round(t.maxHp * (s.effects?.healPct ?? 0)));
        ev.push({ t: 'heal', uid: t.uid, amount: amt });
      }
      break;
    }
    default:
      break;
  }

  // 基本行動(消費0)は共鳴ゲージを1ためる。大技は貯めない=「溜めて使う」判断
  if (s.cost === 0 && s.category !== 'item' && s.kind !== 'cheer') addRp(b, 1, ev);
  b.stats.actions++;
  finishTurn(b, u, s.weight, ev);
  return ev;
}

/* ---------------- 敵の行動(予告どおり) ---------------- */
export function performEnemy(b: BattleState, guard: Guard = 'none'): BattleEvent[] {
  if (!b.actor) throw new Error('no actor');
  const u = unit(b, b.actor);
  if (u.side !== 'enemy') throw new Error('performEnemy is for enemies');
  const intent = b.intents[u.uid] ?? planIntent(b, u);
  delete b.intents[u.uid];
  const s = skill(intent.skillId);
  const ev: BattleEvent[] = [];
  if (u.charging === s.id) u.charging = null;

  // 予告の対象が倒れていたら、生きている相手へ向け直す
  let targets: Unit[] = [];
  if (s.target === 'allEnemies') targets = activeAllies(b);
  else if (s.target === 'enemy') {
    const t = unit(b, intent.targets[0] ?? '');
    targets = isActive(t) && t.side === 'ally' ? [t] : activeAllies(b).length ? [pick(b, activeAllies(b))] : [];
  } else if (s.target === 'ally') {
    const t = intent.targets[0] ? unit(b, intent.targets[0]) : u;
    targets = [isActive(t) ? t : u];
  } else if (s.target === 'self') targets = [u];
  ev.push({ t: 'use', uid: u.uid, skillId: s.id, targets: targets.map((t) => t.uid) });

  switch (s.kind) {
    case 'charge': {
      u.charging = s.chargeInto ?? null;
      ev.push({ t: 'charge', uid: u.uid, skillId: s.chargeInto ?? '' });
      break;
    }
    case 'attack': {
      if (guard === 'perfect') b.stats.parries++;
      for (const t0 of targets) {
        // かばう: 守っている仲間が代わりに受ける
        let t = t0; let covered = false;
        const cov = t0.status.coveredBy ? b.units.find((x) => x.uid === t0.status.coveredBy) : undefined;
        if (cov && isActive(cov) && cov.uid !== t0.uid) { t = cov; covered = true; }
        const hits = s.hits ?? 1;
        for (let h = 0; h < hits && isActive(t); h++) dealHit(b, u, t, s, h, hits, ev, { guard, covered });
        if (isActive(t) && s.effects?.delay) { t.ct += turnDelay(t.spd, s.effects.delay); ev.push({ t: 'delay', uid: t.uid }); }
      }
      if (guard === 'perfect' && targets.length) addRp(b, 1, ev);
      break;
    }
    case 'heal': {
      for (const t of targets) {
        const amt = heal(t, Math.round(t.maxHp * (s.effects?.healPct ?? 0)));
        ev.push({ t: 'heal', uid: t.uid, amount: amt });
        if (s.effects?.shieldUp && !t.broken) {
          t.shield = Math.min(t.shieldMax, t.shield + s.effects.shieldUp);
          ev.push({ t: 'shield', uid: t.uid, value: t.shield, max: t.shieldMax });
        }
      }
      break;
    }
    case 'buff': {
      for (const t of activeEnemies(b)) {
        if (t.uid === u.uid) continue;
        if (s.effects?.atkUp) t.status.atkUp = Math.min(ATK_UP_MAX, t.status.atkUp + s.effects.atkUp);
        if (s.effects?.healPct) ev.push({ t: 'heal', uid: t.uid, amount: heal(t, Math.round(t.maxHp * s.effects.healPct)) });
        ev.push({ t: 'status', uid: t.uid, text: `攻撃↑${t.status.atkUp}` });
      }
      break;
    }
    case 'field': {
      if (s.effects?.field) setField(b, s.effects.field, ev);
      if (s.effects?.atkUp) {
        u.status.atkUp = Math.min(ATK_UP_MAX, u.status.atkUp + s.effects.atkUp);
        ev.push({ t: 'status', uid: u.uid, text: `攻撃↑${u.status.atkUp}` });
      }
      break;
    }
    default:
      break;
  }
  if (u.status.mist > 0) u.status.mist--;
  finishTurn(b, u, s.weight, ev);
  return ev;
}

/* ---------------- 内部処理 ---------------- */
function addRp(b: BattleState, delta: number, ev: BattleEvent[]) {
  const before = b.rp;
  b.rp = Math.max(0, Math.min(RP_MAX, b.rp + delta));
  if (b.rp !== before) ev.push({ t: 'rp', value: b.rp, delta: b.rp - before });
}

function heal(u: Unit, amount: number): number {
  const before = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + Math.max(0, amount));
  return u.hp - before;
}

function applyDamage(u: Unit, amount: number) {
  u.hp -= amount;
  // 守護獣は倒れない(HP1で踏みとどまる)。勝つには鎮める
  if (unitDef(u.defId).guardian && u.hp < 1) u.hp = 1;
  if (u.hp < 0) u.hp = 0;
}

function knockOut(b: BattleState, u: Unit, ev: BattleEvent[]) {
  u.hp = 0;
  u.gone = 'ko';
  u.broken = false;
  u.charging = null;
  u.status.coveredBy = null;
  delete b.intents[u.uid];
  ev.push({ t: 'ko', uid: u.uid });
  if (u.side === 'ally') b.stats.allyKOs++;
  if (u.side === 'enemy') {
    b.stats.defeated++;
    if (unitDef(u.defId).controller) {
      ev.push({ t: 'msg', text: '装置が止まった！ 操られていたモンスターを 鎮められる。' });
      for (const e of activeEnemies(b)) if (unitDef(e.defId).controlled) {
        e.status.atkUp = 0;
        ev.push({ t: 'status', uid: e.uid, text: '制御解除' });
      }
    }
  }
}

function breakUnit(b: BattleState, t: Unit, ev: BattleEvent[]) {
  t.broken = true;
  t.shield = 0;
  b.stats.breaks++;
  ev.push({ t: 'break', uid: t.uid });
  addRp(b, 2, ev);
  if (b.intents[t.uid]) { delete b.intents[t.uid]; ev.push({ t: 'cancel', uid: t.uid }); }
  if (t.charging) { t.charging = null; ev.push({ t: 'msg', text: `${t.name}の 大技を 阻止した！` }); }
  // ブレイク中は次の手番が遅れ、その手番は立て直しに使われる
  t.ct += turnDelay(t.spd, 0.5);
}

interface HitOpts { timing?: Timing; guard?: Guard; covered?: boolean }

function dealHit(b: BattleState, src: Unit, dst: Unit, s: Skill, hitIdx: number, hits: number, ev: BattleEvent[], o: HitOpts) {
  const aff = bestAffinity(s.elements, dst.element);
  let mult = aff
    * (s.elements.includes(b.field) ? FIELD_BONUS : 1)
    * (dst.broken ? BROKEN_DAMAGE : 1)
    * (src.status.mist > 0 ? MIST_MULT : 1);
  if (o.timing) mult *= TIMING_MULT[o.timing];
  if (o.guard) mult *= GUARD_MULT[o.guard];
  if (o.covered) mult *= COVER_MULT;
  const variance = 0.95 + rand(b) * 0.1;
  const raw = baseDamage(s.power ?? 0, atkOf(src), dst.def) * mult * variance;
  const amount = mult === 0 ? 0 : Math.max(1, Math.round(raw));
  applyDamage(dst, amount);
  ev.push({
    t: 'hit', src: src.uid, dst: dst.uid, amount, weak: aff > 1, resist: aff < 1,
    hit: hitIdx, hits, timing: o.timing, guard: o.guard, covered: o.covered,
  });
  if (src.side !== 'enemy') {
    b.stats.damageDealt += amount;
    b.stats.maxHit = Math.max(b.stats.maxHit, amount);
  }
  // ブレイク: 弱点属性のヒットで盾を1つ削る
  if (dst.side === 'enemy' && dst.shieldMax > 0 && !dst.broken) {
    const matched = s.elements.filter((e) => dst.weaknesses.includes(e));
    if (matched.length) {
      const fresh = matched.filter((e) => !dst.revealed.includes(e));
      if (fresh.length) { dst.revealed.push(...fresh); ev.push({ t: 'reveal', uid: dst.uid, elements: fresh }); }
      dst.shield = Math.max(0, dst.shield - 1);
      ev.push({ t: 'shield', uid: dst.uid, value: dst.shield, max: dst.shieldMax });
      if (dst.shield === 0 && dst.hp > 0) breakUnit(b, dst, ev);
    }
  }
  if (dst.hp <= 0) knockOut(b, dst, ev);
}

function applyAfterEffects(b: BattleState, s: Skill, t: Unit, ev: BattleEvent[]) {
  const fx = s.effects;
  if (!fx) return;
  if (fx.burn && t.status.burn === 0 && rand(b) < fx.burn) {
    t.status.burn = 3;
    ev.push({ t: 'status', uid: t.uid, text: '燃焼' });
  }
  if (fx.delay) {
    t.ct += turnDelay(t.spd, fx.delay);
    ev.push({ t: 'delay', uid: t.uid });
  }
}

function setField(b: BattleState, to: FieldElement, ev: BattleEvent[]) {
  if (b.field !== to) {
    ev.push({ t: 'field', from: b.field, to });
    b.field = to;
  }
  b.fieldTimer = FIELD_PERIOD;
}

function finishTurn(b: BattleState, u: Unit, weight: number, ev: BattleEvent[]) {
  if (isActive(u)) u.ct = Math.max(u.ct, b.time + turnDelay(u.spd, weight));
  b.actor = null;

  // 場の巡り
  b.fieldTimer--;
  if (b.fieldTimer <= 0) {
    const next = b.fieldQueue.shift() as FieldElement;
    b.fieldQueue.push(b.field);
    ev.push({ t: 'field', from: b.field, to: next });
    b.field = next;
    b.fieldTimer = FIELD_PERIOD;
  }

  // 守護獣の第2形態
  for (const e of activeEnemies(b)) {
    const g = unitDef(e.defId).guardian;
    if (g && e.phase === 1 && e.hp <= e.maxHp * 0.6) {
      e.phase = 2;
      e.patternIdx = 0;
      ev.push({ t: 'phase', uid: e.uid, text: '守護獣の森が 目を覚ました！' });
      if (!e.charging && !e.broken) planIntent(b, e);
    }
  }

  // 予告の更新: 予告を持たない敵は立てる。対象が倒れた予告は向け直す
  for (const e of activeEnemies(b)) {
    if (e.broken) continue;
    const it = b.intents[e.uid];
    if (!it) { planIntent(b, e); continue; }
    const s = skill(it.skillId);
    if (s.target === 'enemy' && !isActive(unit(b, it.targets[0]))) {
      const alive = activeAllies(b);
      if (alive.length) it.targets = [pick(b, alive).uid];
    } else if (s.target === 'allEnemies') {
      it.targets = activeAllies(b).map((a) => a.uid);
    }
  }

  // 勝敗
  if (!b.outcome) {
    if (activeAllies(b).length === 0) { b.outcome = 'lose'; ev.push({ t: 'outcome', result: 'lose' }); }
    else if (activeEnemies(b).length === 0) { b.outcome = 'win'; ev.push({ t: 'outcome', result: 'win' }); }
  }
}

/* ---------------- 敵AI: 予告を立てる ---------------- */
const GUARDIAN_P1 = ['g_lash', 'g_spore', 'g_lash', 'g_stance'];
const GUARDIAN_P2 = ['g_dominion', 'g_lash', 'g_stance', 'g_regrow', 'g_spore', 'g_lash', 'g_stance'];
const DEVICE_PATTERN = ['d_overdrive', 'd_pulse', 'd_pulse'];

export function planIntent(b: BattleState, e: Unit): Intent {
  const targetsAll = activeAllies(b).map((a) => a.uid);
  let intent: Intent;
  if (e.charging) {
    intent = { skillId: e.charging, targets: targetsAll };
  } else {
    const d = unitDef(e.defId);
    let id: string;
    if (d.ai === 'guardian') {
      const pat = e.phase === 2 ? GUARDIAN_P2 : GUARDIAN_P1;
      id = pat[e.patternIdx % pat.length];
      e.patternIdx++;
    } else if (d.ai === 'device') {
      const others = activeEnemies(b).filter((x) => x.uid !== e.uid);
      id = DEVICE_PATTERN[e.patternIdx % DEVICE_PATTERN.length];
      e.patternIdx++;
      if (id === 'd_overdrive' && others.length === 0) id = 'd_pulse';
    } else {
      id = chooseBasicSkill(b, e);
    }
    intent = { skillId: id, targets: chooseTargets(b, e, skill(id)) };
  }
  b.intents[e.uid] = intent;
  return intent;
}

function chooseBasicSkill(b: BattleState, e: Unit): string {
  const d = unitDef(e.defId);
  const healId = d.skills.find((id) => skill(id).kind === 'heal');
  if (healId) {
    const hurt = activeEnemies(b).some((x) => x.hp < x.maxHp * 0.55);
    if (hurt && rand(b) < 0.6) return healId;
  }
  const attacks = d.skills.filter((id) => skill(id).kind === 'attack');
  const weights = attacks.map((id) => {
    const s = skill(id);
    if (s.target === 'allEnemies') return activeAllies(b).length >= 2 ? 1.5 : 0.3;
    return s.effects ? 2 : 3;
  });
  const total = weights.reduce((a, w) => a + w, 0);
  let r = rand(b) * total;
  for (let i = 0; i < attacks.length; i++) { r -= weights[i]; if (r <= 0) return attacks[i]; }
  return attacks[attacks.length - 1];
}

function chooseTargets(b: BattleState, e: Unit, s: Skill): string[] {
  const alive = activeAllies(b);
  switch (s.target) {
    case 'allEnemies': return alive.map((a) => a.uid);
    case 'self': return [e.uid];
    case 'ally': {
      const hurt = activeEnemies(b).slice().sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
      return [(hurt ?? e).uid];
    }
    case 'enemy': {
      if (!alive.length) return [];
      const r = rand(b);
      const weak = alive.filter((a) => bestAffinity(s.elements, a.element) > 1);
      if (weak.length && r < 0.55) return [pick(b, weak).uid];
      if (r < 0.8) return [alive.slice().sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0].uid];
      return [pick(b, alive).uid];
    }
    default: return [];
  }
}

/** 敵の予告から、各対象への被ダメ見込み(UI表示用) */
export function intentForecast(b: BattleState, e: Unit): { skill: Skill; targets: { uid: string; dmg: number }[] } | null {
  const it = b.intents[e.uid];
  if (!it) return null;
  const s = skill(it.skillId);
  const targets = it.targets
    .map((id) => unit(b, id))
    .filter(isActive)
    .map((t) => ({ uid: t.uid, dmg: s.target === 'allEnemies' || s.target === 'enemy' ? estimateDamage(b, e, t, s) : 0 }));
  return { skill: s, targets };
}

/** 場の予報(UI表示用) */
export function fieldForecast(b: BattleState): { now: FieldElement; next: FieldElement; inTurns: number } {
  return { now: b.field, next: b.fieldQueue[0], inTurns: b.fieldTimer };
}

export type { Element };
