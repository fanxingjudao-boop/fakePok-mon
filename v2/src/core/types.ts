/* ============================================================
 * 共鳴バトル — コアの型定義
 * 描画(Phaser)に一切依存しない。乱数は BattleState 内の状態から引くため、
 * 同じ seed と同じ入力なら必ず同じ結果になる(テスト・シミュレーション用)。
 * ============================================================ */

/** 属性。none は無属性(物理)。場(field)は none 以外の4属性のどれか。 */
export type Element = 'fire' | 'water' | 'wood' | 'thunder' | 'none';
export type FieldElement = Exclude<Element, 'none'>;

export type Side = 'ally' | 'enemy' | 'player';

/** タイミング入力の結果(攻撃時)。自動モードは常に good。 */
export type Timing = 'perfect' | 'good' | 'miss';
/** 防御タイミングの結果(被弾時)。perfect = パリィ(無効化)。 */
export type Guard = 'perfect' | 'good' | 'none';

export type SkillKind =
  | 'attack' | 'heal' | 'cover' | 'field' | 'observe' | 'pacify'
  | 'cheer' | 'item' | 'buff' | 'charge' | 'wait';

export type TargetType = 'enemy' | 'allEnemies' | 'ally' | 'allyKO' | 'allAllies' | 'self' | 'none';

/** メニュー上の分類 */
export type SkillCategory = 'skill' | 'resonance' | 'command' | 'art' | 'item' | 'enemy';

export interface SkillEffects {
  /** 燃焼を付与する確率(0..1)。3ターン、毎ターン最大HPの6% */
  burn?: number;
  /** 対象の次の手番を遅らせる量(対象の1手ぶんに対する割合) */
  delay?: number;
  /** 場をこの属性に塗り替える */
  field?: FieldElement;
  /** 回復(最大HPに対する割合) */
  healPct?: number;
  /** 再生(ターン数)。毎ターン最大HPの6%回復 */
  regen?: number;
  /** 霧(敵側に付与、ターン数)。与ダメージ×0.7 */
  mist?: number;
  /** 攻撃アップ段階を加算(最大3) */
  atkUp?: number;
  /** 蘇生(最大HPに対する割合) */
  revivePct?: number;
  /** シールド回復量 */
  shieldUp?: number;
  /** RP 獲得 */
  rpGain?: number;
}

export interface Skill {
  id: string;
  name: string;
  /** 複数属性の技は、弱点判定で「いずれかの属性」として扱う */
  elements: Element[];
  kind: SkillKind;
  target: TargetType;
  /** 1ヒットあたりの威力 */
  power?: number;
  hits?: number;
  /** 行動の重さ。大きいほど次の手番が遅れる(0.6=速い / 1.0=普通 / 1.4=重い) */
  weight: number;
  /** 共鳴ゲージ(RP)の消費 */
  cost: number;
  category: SkillCategory;
  effects?: SkillEffects;
  /** 共鳴技: 生存している必要がある仲間(定義ID) */
  partners?: string[];
  /** アイテム消費 */
  item?: ItemId;
  /** 溜め技: 次の手番でこの技を放つ */
  chargeInto?: string;
  desc: string;
}

export type ItemId = 'potion' | 'revive';

export interface UnitDef {
  id: string;
  name: string;
  side: Side;
  element: Element;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  /** ブレイクシールドの最大値(0 = ブレイクしない) */
  shield: number;
  /** 弱点属性(シールドを削れる属性) */
  weaknesses: Element[];
  skills: string[];
  /** 野生・守護獣は鎮められる */
  pacifiable?: boolean;
  /** 守護獣: HPが最大値×この割合以下のときだけ鎮められる。倒れない(HP1で止まる) */
  guardian?: { pacifyAt: number };
  /** 他の敵を操る装置(倒すまで被操作個体は鎮められない) */
  controller?: boolean;
  /** 装置に操られている */
  controlled?: boolean;
  /** 敵AIの種類 */
  ai?: 'basic' | 'device' | 'guardian';
  /** 絵の参照キー(src/data/art.ts) */
  art: string;
}

export interface Status {
  burn: number;      // 残りターン
  regen: number;     // 残りターン
  mist: number;      // 残りターン(与ダメ×0.7)
  atkUp: number;     // 段階(1段階あたり+20%、最大3)
  /** この味方を「かばう」仲間の uid。かばった側の次の手番で解除 */
  coveredBy: string | null;
}

export interface Unit {
  uid: string;
  defId: string;
  name: string;
  side: Side;
  element: Element;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  shieldMax: number;
  shield: number;
  weaknesses: Element[];
  /** 判明している弱点 */
  revealed: Element[];
  broken: boolean;
  /** 次に行動する時刻(小さいほど先) */
  ct: number;
  status: Status;
  /** 戦闘からの離脱理由 */
  gone: 'ko' | 'pacified' | null;
  /** 並び順(描画位置) */
  slot: number;
  /** 溜め中の技(次の手番で放つ) */
  charging: string | null;
  /** AI の行動パターン位置 */
  patternIdx: number;
  /** 守護獣の第2形態 */
  phase: number;
}

export interface Intent {
  skillId: string;
  targets: string[];
}

export interface EncounterDef {
  id: string;
  name: string;
  subtitle: string;
  /** 目的の説明(戦闘画面に表示) */
  objective: string;
  enemies: string[];
  /** 場の巡り(この順に移り変わる) */
  fieldCycle: FieldElement[];
  backdrop: 'forest' | 'ashstar' | 'shrine';
  bgm: 'wild' | 'ashstar' | 'guardian';
  /** 開幕の一言 */
  intro: string[];
}

export type Outcome = 'win' | 'lose' | null;

export interface BattleStats {
  actions: number;
  perfects: number;
  parries: number;
  breaks: number;
  pacified: number;
  defeated: number;
  damageDealt: number;
  maxHit: number;
  resonances: number;
  /** 倒れた仲間の延べ数 */
  allyKOs: number;
}

export interface BattleState {
  encounterId: string;
  units: Unit[];
  /** 現在の時刻 */
  time: number;
  /** 今行動中のユニット */
  actor: string | null;
  intents: Record<string, Intent>;
  field: FieldElement;
  fieldQueue: FieldElement[];
  /** 場が次に移るまでの残り行動数 */
  fieldTimer: number;
  rp: number;
  items: Record<ItemId, number>;
  rng: number;
  outcome: Outcome;
  stats: BattleStats;
  turn: number;
}

/* ---------- 描画側へ渡すイベント(この順にアニメーションする) ---------- */
export type BattleEvent =
  | { t: 'turn'; uid: string }
  | { t: 'use'; uid: string; skillId: string; targets: string[] }
  | {
      t: 'hit'; src: string; dst: string; amount: number;
      weak: boolean; resist: boolean; hit: number; hits: number;
      timing?: Timing; guard?: Guard; covered?: boolean;
    }
  | { t: 'shield'; uid: string; value: number; max: number }
  | { t: 'break'; uid: string }
  | { t: 'recover'; uid: string }
  | { t: 'ko'; uid: string }
  | { t: 'heal'; uid: string; amount: number }
  | { t: 'revive'; uid: string; amount: number }
  | { t: 'status'; uid: string; text: string }
  | { t: 'tick'; uid: string; kind: 'burn' | 'regen'; amount: number }
  | { t: 'delay'; uid: string }
  | { t: 'field'; from: FieldElement; to: FieldElement }
  | { t: 'rp'; value: number; delta: number }
  | { t: 'reveal'; uid: string; elements: Element[] }
  | { t: 'pacify'; uid: string }
  | { t: 'cancel'; uid: string }
  | { t: 'charge'; uid: string; skillId: string }
  | { t: 'cover'; uid: string; target: string }
  | { t: 'phase'; uid: string; text: string }
  | { t: 'msg'; text: string }
  | { t: 'outcome'; result: 'win' | 'lose' };

/** 味方・巡環士の行動入力 */
export interface Action {
  skillId: string;
  target?: string;
}
