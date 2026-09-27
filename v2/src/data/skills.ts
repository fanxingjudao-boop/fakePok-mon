/* ============================================================
 * 技データ
 * weight: 0.6-0.8=速い / 1.0=普通 / 1.2-1.4=重い(次の手番が遅れる)
 * ============================================================ */
import type { Skill } from '../core/types.ts';

const list: Skill[] = [
  /* ---------- ヒノコ(炎のキツネ)---------- */
  { id: 'f_scratch', name: '爪さばき', elements: ['none'], kind: 'attack', target: 'enemy', power: 40, weight: 0.8, cost: 0, category: 'skill',
    desc: '速い無属性の一撃。次の手番が早く来る。' },
  { id: 'f_ember', name: 'はじけ火', elements: ['fire'], kind: 'attack', target: 'enemy', power: 50, weight: 1.0, cost: 0, category: 'skill',
    effects: { burn: 0.35 }, desc: '火の粉を飛ばす。ときどき燃焼(3ターン)。' },
  { id: 'f_flurry', name: '火連爪', elements: ['fire'], kind: 'attack', target: 'enemy', power: 21, hits: 3, weight: 1.2, cost: 2, category: 'skill',
    desc: '炎の爪で3連撃。弱点なら盾を3つ削る。' },
  { id: 'f_foxfire', name: '狐火の舞', elements: ['fire'], kind: 'attack', target: 'allEnemies', power: 38, weight: 1.4, cost: 3, category: 'skill',
    desc: '敵全体を狐火で包む。重い。' },

  /* ---------- シズク(潮のカワウソ)---------- */
  { id: 'w_jet', name: '水つぶて', elements: ['water'], kind: 'attack', target: 'enemy', power: 46, weight: 0.9, cost: 0, category: 'skill',
    desc: '水を撃ち出す。やや速い。' },
  { id: 'w_cover', name: 'かばう', elements: ['none'], kind: 'cover', target: 'ally', weight: 0.7, cost: 0, category: 'skill',
    desc: '次の自分の番まで、選んだ仲間への攻撃を肩代わり(被ダメ半減)。' },
  { id: 'w_heal', name: 'いやしの潮', elements: ['water'], kind: 'heal', target: 'ally', weight: 1.0, cost: 2, category: 'skill',
    effects: { healPct: 0.38 }, desc: '仲間1体のHPを大きく回復。' },
  { id: 'w_whirl', name: '渦潮', elements: ['water'], kind: 'attack', target: 'enemy', power: 27, hits: 2, weight: 1.1, cost: 2, category: 'skill',
    effects: { delay: 0.45 }, desc: '2連撃し、相手の次の手番を遅らせる。' },

  /* ---------- コノハ(苔の石フクロウ)---------- */
  { id: 'o_peck', name: 'くちばし打ち', elements: ['none'], kind: 'attack', target: 'enemy', power: 38, weight: 0.8, cost: 0, category: 'skill',
    desc: '速い無属性の一撃。' },
  { id: 'o_leaf', name: 'このはがえし', elements: ['wood'], kind: 'attack', target: 'enemy', power: 48, weight: 1.0, cost: 0, category: 'skill',
    desc: '鋭い木の葉を返す。' },
  { id: 'o_rune', name: 'ルーンの閃き', elements: ['thunder'], kind: 'attack', target: 'enemy', power: 46, weight: 1.0, cost: 1, category: 'skill',
    desc: '翼のルーンから雷光を放つ。' },
  { id: 'o_bind', name: '根縛り', elements: ['wood'], kind: 'attack', target: 'enemy', power: 30, weight: 1.1, cost: 2, category: 'skill',
    effects: { delay: 0.7 }, desc: '根で縛り、相手の次の手番を大きく遅らせる。' },
  { id: 'o_bloom', name: '芽吹きの場', elements: ['wood'], kind: 'field', target: 'none', weight: 1.0, cost: 2, category: 'skill',
    effects: { field: 'wood', regen: 3 }, desc: '場を「森」に変え、仲間全員に再生(3ターン)。' },

  /* ---------- 共鳴技(2体以上の組み合わせ)---------- */
  { id: 'r_prairie', name: '燎原の舞', elements: ['fire'], kind: 'attack', target: 'allEnemies', power: 32, hits: 2, weight: 1.2, cost: 5,
    category: 'resonance', partners: ['hinoko', 'konoha'], effects: { field: 'fire' },
    desc: '【ヒノコ+コノハ】敵全体に2連撃し、場を「火」に変える。' },
  { id: 'r_steam', name: '蒸気の帳', elements: ['fire', 'water'], kind: 'attack', target: 'allEnemies', power: 42, weight: 1.2, cost: 5,
    category: 'resonance', partners: ['hinoko', 'shizuku'], effects: { mist: 3 },
    desc: '【ヒノコ+シズク】火と潮の両属性で全体攻撃。敵に霧(与ダメ-30%)。' },
  { id: 'r_rain', name: '芽吹きの雨', elements: ['wood', 'water'], kind: 'heal', target: 'allAllies', weight: 1.1, cost: 5,
    category: 'resonance', partners: ['shizuku', 'konoha'], effects: { healPct: 0.32, regen: 3, field: 'wood' },
    desc: '【シズク+コノハ】仲間全員を回復し再生を付与、場を「森」に。' },
  { id: 'r_hekikan', name: '碧環共鳴', elements: ['fire', 'water', 'wood', 'thunder', 'none'], kind: 'attack', target: 'allEnemies', power: 40, hits: 3, weight: 1.3, cost: 10,
    category: 'resonance', partners: ['hinoko', 'shizuku', 'konoha'],
    desc: '【3体】あらゆる属性として全体に3連撃。すべての弱点を突く。' },

  /* ---------- 巡環士ユウ ---------- */
  { id: 'p_observe', name: '記録する', elements: ['none'], kind: 'observe', target: 'enemy', weight: 0.7, cost: 0, category: 'command',
    desc: '相手を観察して記録し、弱点をすべて明らかにする。' },
  { id: 'p_pacify', name: '鎮める', elements: ['none'], kind: 'pacify', target: 'enemy', weight: 1.0, cost: 0, category: 'command',
    desc: 'ブレイク中の野生モンスターの心を鎮め、戦わずに森へ帰す。' },
  { id: 'p_cheer', name: 'はげます', elements: ['none'], kind: 'cheer', target: 'none', weight: 0.8, cost: 0, category: 'command',
    effects: { rpGain: 2 }, desc: '仲間を励まし、共鳴ゲージを2ためる。' },
  { id: 'p_field_fire', name: '環術・火', elements: ['fire'], kind: 'field', target: 'none', weight: 1.0, cost: 3, category: 'art',
    effects: { field: 'fire' }, desc: '場を「火」に塗り替える。火の技が強まる。' },
  { id: 'p_field_water', name: '環術・潮', elements: ['water'], kind: 'field', target: 'none', weight: 1.0, cost: 3, category: 'art',
    effects: { field: 'water' }, desc: '場を「潮」に塗り替える。潮の技と回復が強まる。' },
  { id: 'p_field_wood', name: '環術・森', elements: ['wood'], kind: 'field', target: 'none', weight: 1.0, cost: 3, category: 'art',
    effects: { field: 'wood' }, desc: '場を「森」に塗り替える。森の技が強まる。' },
  { id: 'p_field_thunder', name: '環術・雷', elements: ['thunder'], kind: 'field', target: 'none', weight: 1.0, cost: 3, category: 'art',
    effects: { field: 'thunder' }, desc: '場を「雷」に塗り替える。雷の技が強まる。' },
  { id: 'p_potion', name: '薬草膏', elements: ['none'], kind: 'item', target: 'ally', weight: 0.8, cost: 0, category: 'item', item: 'potion',
    effects: { healPct: 0.5 }, desc: '仲間1体のHPを半分回復する。' },
  { id: 'p_revive', name: '目覚めの実', elements: ['none'], kind: 'item', target: 'allyKO', weight: 1.0, cost: 0, category: 'item', item: 'revive',
    effects: { revivePct: 0.4 }, desc: '倒れた仲間をHP4割で立ち上がらせる。' },

  /* ---------- 敵: 野生 ---------- */
  { id: 'e_tackle', name: 'ぶちかまし', elements: ['none'], kind: 'attack', target: 'enemy', power: 38, weight: 1.0, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_spore', name: 'まどろみ花粉', elements: ['wood'], kind: 'attack', target: 'enemy', power: 20, weight: 1.0, cost: 0, category: 'enemy',
    effects: { delay: 0.5 }, desc: '眠気で次の手番が遅れる' },
  { id: 'e_sweet', name: '蜜のかおり', elements: ['wood'], kind: 'heal', target: 'ally', weight: 1.0, cost: 0, category: 'enemy',
    effects: { healPct: 0.25 }, desc: '' },
  { id: 'e_shock', name: 'ビリ針', elements: ['thunder'], kind: 'attack', target: 'enemy', power: 46, weight: 1.0, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_discharge', name: '放電', elements: ['thunder'], kind: 'attack', target: 'allEnemies', power: 30, weight: 1.3, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_bite', name: 'かみつき', elements: ['none'], kind: 'attack', target: 'enemy', power: 40, weight: 0.8, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_quick', name: 'かけぬけ', elements: ['none'], kind: 'attack', target: 'enemy', power: 30, weight: 0.6, cost: 0, category: 'enemy', desc: '' },

  { id: 'e_peck', name: 'ついばみ', elements: ['none'], kind: 'attack', target: 'enemy', power: 36, weight: 0.8, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_gust', name: 'はばたき', elements: ['none'], kind: 'attack', target: 'allEnemies', power: 22, weight: 1.2, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_roll', name: 'ころがり', elements: ['none'], kind: 'attack', target: 'enemy', power: 54, weight: 1.3, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_splash', name: '水はじき', elements: ['water'], kind: 'attack', target: 'enemy', power: 40, weight: 0.9, cost: 0, category: 'enemy', desc: '' },

  /* ---------- 敵: 灰星局 ---------- */
  { id: 'd_overdrive', name: '強制出力', elements: ['none'], kind: 'buff', target: 'none', weight: 1.0, cost: 0, category: 'enemy',
    effects: { atkUp: 1, healPct: 0.1 }, desc: '操られた仲間の攻撃を上げ、回復する' },
  { id: 'd_pulse', name: '過負荷パルス', elements: ['thunder'], kind: 'attack', target: 'allEnemies', power: 34, weight: 1.2, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_spark', name: 'スパーク', elements: ['thunder'], kind: 'attack', target: 'enemy', power: 50, weight: 1.0, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_fury', name: 'めった爪', elements: ['none'], kind: 'attack', target: 'enemy', power: 19, hits: 3, weight: 1.1, cost: 0, category: 'enemy', desc: '' },
  { id: 'e_bubble', name: 'あぶく弾', elements: ['water'], kind: 'attack', target: 'enemy', power: 42, weight: 1.0, cost: 0, category: 'enemy',
    effects: { delay: 0.3 }, desc: '' },
  { id: 'e_clamp', name: 'はさみ締め', elements: ['none'], kind: 'attack', target: 'enemy', power: 64, weight: 1.3, cost: 0, category: 'enemy', desc: '' },

  /* ---------- 敵: 森の守護獣 ---------- */
  { id: 'g_lash', name: '樹鞭', elements: ['wood'], kind: 'attack', target: 'enemy', power: 62, weight: 1.0, cost: 0, category: 'enemy', desc: '' },
  { id: 'g_spore', name: '胞子の風', elements: ['wood'], kind: 'attack', target: 'allEnemies', power: 34, weight: 1.1, cost: 0, category: 'enemy',
    effects: { delay: 0.3 }, desc: '' },
  { id: 'g_stance', name: '大地の構え', elements: ['wood'], kind: 'charge', target: 'none', weight: 0.9, cost: 0, category: 'enemy',
    chargeInto: 'g_roar', desc: '次の手番で「大地の咆哮」を放つ。ブレイクで阻止できる' },
  { id: 'g_roar', name: '大地の咆哮', elements: ['wood'], kind: 'attack', target: 'allEnemies', power: 96, weight: 1.3, cost: 0, category: 'enemy', desc: '' },
  { id: 'g_regrow', name: '根の再生', elements: ['wood'], kind: 'heal', target: 'self', weight: 1.0, cost: 0, category: 'enemy',
    effects: { healPct: 0.05, shieldUp: 3 }, desc: '' },
  { id: 'g_dominion', name: '森の支配', elements: ['wood'], kind: 'field', target: 'none', weight: 0.9, cost: 0, category: 'enemy',
    effects: { field: 'wood', atkUp: 1 }, desc: '' },
];

export const SKILLS: Record<string, Skill> = Object.fromEntries(list.map((s) => [s.id, s]));

export function skill(id: string): Skill {
  const s = SKILLS[id];
  if (!s) throw new Error(`unknown skill: ${id}`);
  return s;
}
