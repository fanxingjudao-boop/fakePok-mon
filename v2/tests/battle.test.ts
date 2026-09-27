import { describe, it, expect } from 'vitest';
import {
  createBattle, startTurn, performAction, performEnemy, previewTimeline, unit, canPacify,
  skillOptions, activeEnemies, planIntent, intentForecast,
} from '../src/core/battle.ts';
import { simulate, chooseAllyAction } from '../src/core/ai.ts';
import { affinity, baseDamage, FIELD_PERIOD, turnDelay } from '../src/core/rules.ts';
import type { BattleState, BattleEvent } from '../src/core/types.ts';

/** テスト用: 指定ユニットの手番にする */
function actAs(b: BattleState, uid: string) {
  const u = unit(b, uid);
  b.actor = uid;
  b.time = u.ct;
}
const hits = (ev: BattleEvent[]) => ev.filter((e) => e.t === 'hit') as Extract<BattleEvent, { t: 'hit' }>[];

describe('ルールの基本', () => {
  it('属性の巡り: 火→森→雷→潮→火', () => {
    expect(affinity('fire', 'wood')).toBe(1.5);
    expect(affinity('wood', 'thunder')).toBe(1.5);
    expect(affinity('thunder', 'water')).toBe(1.5);
    expect(affinity('water', 'fire')).toBe(1.5);
    expect(affinity('wood', 'fire')).toBeLessThan(1);
    expect(affinity('none', 'fire')).toBe(1);
  });
  it('ダメージは攻撃/防御の比に比例する(飽和しない)', () => {
    expect(baseDamage(100, 50, 50)).toBe(50);
    expect(baseDamage(100, 100, 50)).toBe(100);
    expect(baseDamage(100, 100, 50) / baseDamage(100, 50, 50)).toBe(2);
  });
  it('速いほど手番が早く来る。重い技ほど遅れる', () => {
    expect(turnDelay(100, 1)).toBeLessThan(turnDelay(50, 1));
    expect(turnDelay(60, 1.4)).toBeGreaterThan(turnDelay(60, 0.8));
  });
});

describe('決定論', () => {
  it('同じ seed と同じ入力なら、毎回まったく同じ結果になる', () => {
    const a = simulate('guardian', 42);
    const b = simulate('guardian', 42);
    expect(a).toEqual(b);
    const c = simulate('guardian', 43);
    expect(c.turns === a.turns && c.stats.damageDealt === a.stats.damageDealt).toBe(false);
  });
});

describe('タイムライン', () => {
  it('予告表示: 技選択中は、重い技ほど自分の次の番が後ろにずれる', () => {
    const b = createBattle('wild', 1);
    const t = startTurn(b);
    const fast = previewTimeline(b, 20, 0.6).findIndex((x) => x.uid === t.actor.uid);
    const slow = previewTimeline(b, 20, 1.4).findIndex((x) => x.uid === t.actor.uid);
    expect(slow).toBeGreaterThan(fast);
  });
  it('開幕はこちらの先制: 味方3体と巡環士が全員動くまで敵は動かない', () => {
    for (const enc of ['wild', 'ashstar', 'guardian']) {
      const b = createBattle(enc, 7);
      const first4 = [0, 1, 2, 3].map(() => {
        const t = startTurn(b);
        const side = t.actor.side;
        if (!t.skip) {
          if (side === 'enemy') performEnemy(b, 'good');
          else performAction(b, chooseAllyAction(b), 'good');
        }
        return side;
      });
      expect(first4.filter((s) => s === 'enemy')).toEqual([]);
    }
  });
  it('開始時、行動できる敵は全員が予告を持つ', () => {
    const b = createBattle('ashstar', 3);
    for (const e of activeEnemies(b)) expect(b.intents[e.uid]).toBeTruthy();
  });
});

describe('ダメージと入力', () => {
  const dmgWith = (timing: 'perfect' | 'good' | 'miss') => {
    const b = createBattle('wild', 5);
    actAs(b, 'a0');
    return hits(performAction(b, { skillId: 'f_scratch', target: 'e0' }, timing))[0].amount;
  };
  it('タイミング: Perfect > Good > Miss', () => {
    expect(dmgWith('perfect')).toBeGreaterThan(dmgWith('good'));
    expect(dmgWith('good')).toBeGreaterThan(dmgWith('miss'));
  });
  it('弱点属性は等倍より大きい', () => {
    const b1 = createBattle('wild', 9); actAs(b1, 'a0');
    const weak = hits(performAction(b1, { skillId: 'f_ember', target: 'e0' }))[0]; // 火→森(ハナモチ)
    expect(weak.weak).toBe(true);
    const b2 = createBattle('wild', 9); actAs(b2, 'a2');
    const neutral = hits(performAction(b2, { skillId: 'o_rune', target: 'e0' }))[0]; // 雷→森 は不利
    expect(neutral.resist).toBe(true);
  });
  it('パリィ(Perfectガード)は被ダメ0、共鳴ゲージ+1', () => {
    const b = createBattle('wild', 11);
    const e = unit(b, 'e0');
    b.intents[e.uid] = { skillId: 'e_tackle', targets: ['a0'] };
    actAs(b, 'e0');
    const rp = b.rp;
    const ev = performEnemy(b, 'perfect');
    expect(hits(ev)[0].amount).toBe(0);
    expect(b.rp).toBe(rp + 1);
  });
  it('かばう: 守られた仲間の代わりに守り手が半減で受ける', () => {
    const b = createBattle('wild', 13);
    actAs(b, 'a1');
    performAction(b, { skillId: 'w_cover', target: 'a0' });
    b.intents.e0 = { skillId: 'e_tackle', targets: ['a0'] };
    actAs(b, 'e0');
    const h = hits(performEnemy(b, 'none'))[0];
    expect(h.dst).toBe('a1');
    expect(h.covered).toBe(true);
    expect(unit(b, 'a0').hp).toBe(unit(b, 'a0').maxHp);
  });
});

describe('ブレイク', () => {
  it('弱点ヒットで盾が減り、0でブレイク。予告は取り消され、次の手番は立て直しに使われる', () => {
    const b = createBattle('wild', 17);
    const e = unit(b, 'e0'); // ハナモチ 盾3 弱点[火,無]
    expect(b.intents.e0).toBeTruthy();
    actAs(b, 'a0');
    b.rp = 10;
    const ev = performAction(b, { skillId: 'f_flurry', target: 'e0' }); // 火×3
    expect(ev.some((x) => x.t === 'break')).toBe(true);
    expect(e.broken).toBe(true);
    expect(b.intents.e0).toBeUndefined();
    expect(e.revealed).toContain('fire');
    // 立て直しの手番まで進める
    e.ct = -1;
    const t = startTurn(b);
    expect(t.actor.uid).toBe('e0');
    expect(t.skip).toBe(true);
    expect(e.broken).toBe(false);
    expect(e.shield).toBe(e.shieldMax);
    expect(b.intents.e0).toBeTruthy();
  });
  it('溜め中にブレイクすると大技を阻止できる', () => {
    const b = createBattle('guardian', 19);
    const g = unit(b, 'e0');
    g.charging = 'g_roar';
    planIntent(b, g);
    expect(b.intents.e0.skillId).toBe('g_roar');
    g.shield = 1;
    actAs(b, 'a0');
    const ev = performAction(b, { skillId: 'f_ember', target: 'e0' });
    expect(ev.some((x) => x.t === 'break')).toBe(true);
    expect(g.charging).toBeNull();
  });
});

describe('鎮める', () => {
  it('ブレイク中の野生は鎮められ、戦闘から離れる', () => {
    const b = createBattle('wild', 21);
    const e = unit(b, 'e1');
    expect(canPacify(b, e)).toBe(false);
    e.broken = true;
    expect(canPacify(b, e)).toBe(true);
    actAs(b, 'p');
    const ev = performAction(b, { skillId: 'p_pacify', target: 'e1' });
    expect(ev.some((x) => x.t === 'pacify')).toBe(true);
    expect(e.gone).toBe('pacified');
    expect(b.stats.pacified).toBe(1);
  });
  it('装置が動いている間、操られた個体は鎮められない', () => {
    const b = createBattle('ashstar', 23);
    const cat = unit(b, 'e0');
    cat.broken = true;
    expect(canPacify(b, cat)).toBe(false);
    unit(b, 'e1').gone = 'ko';
    expect(canPacify(b, cat)).toBe(true);
  });
  it('守護獣は倒れず、HP半分以下かつブレイク中にだけ鎮められる', () => {
    const b = createBattle('guardian', 25);
    const g = unit(b, 'e0');
    g.hp = 5;
    actAs(b, 'a0');
    performAction(b, { skillId: 'f_ember', target: 'e0' });
    expect(g.hp).toBe(1);
    expect(g.gone).toBeNull();
    g.broken = true; g.hp = g.maxHp;
    expect(canPacify(b, g)).toBe(false);
    g.hp = Math.floor(g.maxHp * 0.5);
    expect(canPacify(b, g)).toBe(true);
    actAs(b, 'p');
    performAction(b, { skillId: 'p_pacify', target: 'e0' });
    expect(b.outcome).toBe('win');
  });
});

describe('共鳴技・場・行動の可否', () => {
  it('共鳴技はゲージが足りないと使えず、使うと相方の手番が遅れる', () => {
    const b = createBattle('wild', 27);
    actAs(b, 'a0');
    b.rp = 4;
    expect(skillOptions(b, unit(b, 'a0')).find((o) => o.skill.id === 'r_prairie')?.usable).toBe(false);
    b.rp = 5;
    const partnerCt = unit(b, 'a2').ct;
    performAction(b, { skillId: 'r_prairie' });
    expect(unit(b, 'a2').ct).toBeGreaterThan(partnerCt);
    expect(b.field).toBe('fire');
    expect(b.stats.resonances).toBe(1);
  });
  it('相方が倒れていると共鳴技は使えない', () => {
    const b = createBattle('wild', 29);
    b.rp = 10;
    unit(b, 'a2').gone = 'ko';
    const opt = skillOptions(b, unit(b, 'a0')).find((o) => o.skill.id === 'r_prairie');
    expect(opt?.usable).toBe(false);
  });
  it('場は一定手数で次の属性に移る', () => {
    const b = createBattle('wild', 31);
    const first = b.field;
    const next = b.fieldQueue[0];
    for (let i = 0; i < FIELD_PERIOD; i++) {
      const t = startTurn(b);
      if (t.skip) continue;
      if (t.actor.side === 'enemy') performEnemy(b, 'good');
      else performAction(b, chooseAllyAction(b), 'good');
    }
    expect(first).not.toBe(next);
    expect(b.field === next || b.fieldTimer < FIELD_PERIOD).toBe(true);
  });
  it('予告の見込みダメージは表示用に計算できる', () => {
    const b = createBattle('guardian', 33);
    const f = intentForecast(b, unit(b, 'e0'));
    expect(f).not.toBeNull();
    expect(f!.targets.length).toBeGreaterThan(0);
  });
});

describe('勝敗', () => {
  it('敵を全員倒すか鎮めれば勝ち、味方が全員倒れたら負け', () => {
    const w = createBattle('wild', 35);
    for (const e of activeEnemies(w)) e.gone = 'ko';
    actAs(w, 'p');
    performAction(w, { skillId: 'p_cheer' });
    expect(w.outcome).toBe('win');

    const l = createBattle('wild', 37);
    unit(l, 'a0').gone = 'ko'; unit(l, 'a1').gone = 'ko';
    const last = unit(l, 'a2'); last.hp = 1;
    l.intents.e0 = { skillId: 'e_tackle', targets: ['a2'] };
    actAs(l, 'e0');
    performEnemy(l, 'none');
    expect(l.outcome).toBe('lose');
  });
});
