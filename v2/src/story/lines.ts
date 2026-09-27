/* ============================================================
 * 物語スクリプト(ink)の1行を解釈する — 書き手とゲームの取り決め
 *
 *   @kaede:smile ユウ、起きたかい。   … 話者つきの台詞(表情は省略可)
 *   森が、静かすぎる。                 … 地の文(話者なし)
 *   >> battle ashstar                  … ゲームへの命令(台詞としては表示しない)
 *
 * 命令の一覧は COMMANDS。引数の数と種類はテストで検査する。
 * ============================================================ */

export const SPEAKERS = {
  yuu: 'ユウ',
  kaede: 'カエデ',
  ren: 'レン',
  gendou: 'ゲンドウ',
  ashstar: '灰星局員',
  villager_a: '見張りのモク',
  villager_b: '織り手のスズ',
  villager_c: '子どものアオ',
  villager_d: '蜜蝋屋のハチ',
  hinoko: 'ヒノコ',
  shizuku: 'シズク',
  konoha: 'コノハ',
  moridorado: 'モリドラード',
  unknown: '？？？',
} as const;
export type SpeakerId = keyof typeof SPEAKERS;

export const FACES = ['normal', 'smile', 'angry', 'sad', 'surprised', 'think'] as const;
export type Face = (typeof FACES)[number];

/** 命令: 名前 → 引数の型('s' 文字列 / 'n' 数 / 's?' 省略可) */
export const COMMANDS = {
  /** 戦闘を始める。終わると VAR battle_result に "win" / "pacified" / "lose" が入り、続きから再開 */
  battle: ['s'],
  /** 道具を渡す(potion / revive / herb) */
  give: ['s', 'n'],
  /** 仲間を全回復 */
  heal: [],
  /** 画面を暗転して戻す */
  fade: [],
  /** 待つ(ミリ秒) */
  wait: ['n'],
  /** 画面を揺らす */
  shake: [],
  /** 効果音 / BGM を変える(BGM は none で止める) */
  sfx: ['s'],
  bgm: ['s'],
  /** マップ上の物体(人・障害物)を消す / 出す */
  hide: ['s'],
  show: ['s'],
  /** 物体を、今のマップの名前つき地点へ歩かせる(例: walk ren_trail east_exit) */
  walk: ['s', 's'],
  /** カメラを物体へ向ける / 主人公へ戻す(player) */
  camera: ['s'],
  /** 別のマップの指定地点へ移る */
  warp: ['s', 's'],
  /** 記録帳に書く(目的・出来事) */
  note: ['s'],
  /** 章の終わり(章のまとめ画面を出す) */
  chapter_end: [],
} as const satisfies Record<string, readonly string[]>;
export type CommandName = keyof typeof COMMANDS;

export type Line =
  | { kind: 'say'; speaker: SpeakerId; face: Face; text: string }
  | { kind: 'narration'; text: string }
  | { kind: 'command'; name: CommandName; args: string[] }
  | { kind: 'invalid'; raw: string; reason: string };

const SAY = /^@([a-z_]+)(?::([a-z]+))?\s+(.+)$/;

export function parseLine(raw: string): Line | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('>>')) {
    const [name, ...args] = s.slice(2).trim().split(/\s+/);
    const spec = (COMMANDS as Record<string, readonly string[]>)[name];
    if (!spec) return { kind: 'invalid', raw: s, reason: `未知の命令: ${name}` };
    const need = spec.filter((t) => !t.endsWith('?')).length;
    if (args.length < need || args.length > spec.length) return { kind: 'invalid', raw: s, reason: `${name} の引数の数が違う` };
    for (let i = 0; i < args.length; i++) {
      if (spec[i].startsWith('n') && !Number.isFinite(Number(args[i]))) return { kind: 'invalid', raw: s, reason: `${name} の${i + 1}番目は数` };
    }
    return { kind: 'command', name: name as CommandName, args };
  }
  const m = SAY.exec(s);
  if (m) {
    const [, who, face = 'normal', text] = m;
    if (!(who in SPEAKERS)) return { kind: 'invalid', raw: s, reason: `未知の話者: ${who}` };
    if (!(FACES as readonly string[]).includes(face)) return { kind: 'invalid', raw: s, reason: `未知の表情: ${face}` };
    return { kind: 'say', speaker: who as SpeakerId, face: face as Face, text };
  }
  if (s.startsWith('@')) return { kind: 'invalid', raw: s, reason: '話者の書式が違う(@id:表情 本文)' };
  return { kind: 'narration', text: s };
}
