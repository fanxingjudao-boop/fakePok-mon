/* ============================================================
 * ワールドの型とタイルの取り決め
 *   マップは文字の配列(1文字 = 1タイル = TILE px)。読みやすく、差分も見やすい。
 *   人・障害物・宝などは objects に座標つきで置く。
 * ============================================================ */

export const TILE = 48;

export type MapId = 'hanazono' | 'trail' | 'road' | 'marsh' | 'shrine';
export type FieldTheme = 'village' | 'forest' | 'road' | 'marsh' | 'shrine';
/** 相棒のフィールド能力(属性で判定。特定の個体を必須にしない) */
export type Ability = 'fire' | 'water' | 'wood';

/**
 * タイルの凡例
 *   歩ける : . 草 / , 花 / " 丈の高い草 / : 土の道 / = 木の床・橋 / s 石畳 / m 苔 / p 泥 / o 浮き葉 / r 葦
 *   通れない: ~ 浅い水 / W 深い水 / T 木 / b 茂み / R 岩 / # 崖 / x 建物などの敷地(上に物を置く)
 */
export const WALKABLE = new Set(['.', ',', '"', ':', '=', 's', 'm', 'p', 'o', 'r']);
export const TILE_CHARS = new Set([...WALKABLE, '~', 'W', 'T', 'b', 'R', '#', 'x']);

/** 条件式: 'var' / '!var' / 'var=値' / 'var!=値' を並べる(すべて満たす)。'|' で区切ると「どれか」 */
export type Cond = string[];

export type PropKind =
  | 'great_tree' | 'house' | 'lab' | 'tent' | 'device' | 'spring' | 'record_stone' | 'sign' | 'lantern'
  | 'beehive' | 'shrine_gate' | 'altar' | 'stump' | 'crate' | 'mushroom' | 'chest';

export type GateKind = 'log' | 'thorns' | 'pollen' | 'vine';

export interface MapObject {
  id: string;
  kind: 'npc' | 'prop' | 'gate' | 'chest' | 'sign' | 'record' | 'spring' | 'guardian';
  /** タイル座標(足元の中心。小数可) */
  x: number;
  y: number;
  /** npc/guardian: 絵(人物は char_*、モンスターは unit の art キー) */
  art?: string;
  /** prop の種類と絵の変種 */
  prop?: PropKind;
  variant?: number;
  /** 話しかけた・調べたときに流す物語(ink の knot) */
  talk?: string;
  /** 表示する条件(満たさなければ存在しない) */
  when?: Cond;
  /** 向き(絵の左右) */
  face?: 'left' | 'right';
  /** 能力で開く障害物。足元のタイル(x,y から w×h)を塞ぎ、開くと通れるようにする */
  gate?: {
    kind: GateKind; w: number; h: number; need: Ability[]; flag: string;
    /** 開けられるようになる条件と、まだ開けられないときの一言 */
    when?: Cond; locked?: string;
  };
  /** 宝(一度だけ) */
  item?: { id: string; n: number; flag: string };
  /** 当たり判定を持つか(既定: npc/prop/guardian は持つ) */
  solid?: boolean;
}

export interface MapExit {
  /** 触れると移動する範囲(タイル) */
  x: number; y: number; w: number; h: number;
  to: MapId;
  point: string;
  when?: Cond;
  /** 条件を満たさないときに出す一言 */
  blocked?: string;
}

/** 入ると物語が始まる範囲 */
export interface MapTrigger {
  id: string;
  x: number; y: number; w: number; h: number;
  knot: string;
  when?: Cond;
  /** 一度きり(状態の flags に id を記録) */
  once?: boolean;
}

/** 見えている野生モンスター(シンボル)の出る範囲 */
export interface SpawnZone {
  x: number; y: number; w: number; h: number;
  /** 出る種類(unit id)。群れは同じ表から最大 group 体 */
  species: string[];
  count: number;
  level: [number, number];
  group: [number, number];
  when?: Cond;
}

export interface MapDef {
  id: MapId;
  name: string;
  theme: FieldTheme;
  bgm: string;
  rows: string[];
  /** 名前つき地点(到着地点・物語の歩き先) */
  points: Record<string, [number, number]>;
  objects: MapObject[];
  exits: MapExit[];
  triggers: MapTrigger[];
  spawns: SpawnZone[];
  /** 入ったときに一度だけ流す物語 */
  enter?: { knot: string; when?: Cond };
}
