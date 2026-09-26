/* ============================================================
 * 遭遇データ(プロトタイプの3戦)
 * ============================================================ */
import type { EncounterDef } from '../core/types.ts';

const list: EncounterDef[] = [
  {
    id: 'wild',
    name: '森のざわめき',
    subtitle: '碧樹圏・野生の群れ',
    objective: '敵を倒すか、ブレイクして「鎮める」',
    enemies: ['hanamochi', 'birimushi', 'konezumi'],
    fieldCycle: ['wood', 'thunder', 'water', 'fire'],
    backdrop: 'forest',
    bgm: 'wild',
    intro: ['森の奥で 野生のモンスターたちが 荒れている。', '頭上の「予告」を見て、次の一手を決めよう。'],
  },
  {
    id: 'ashstar',
    name: '灰星局の強制起動',
    subtitle: '碧樹圏・復旧作業現場',
    objective: '装置を止めれば、操られたモンスターを鎮められる',
    enemies: ['denneko', 'device', 'awagani'],
    fieldCycle: ['thunder', 'fire', 'wood', 'water'],
    backdrop: 'ashstar',
    bgm: 'ashstar',
    intro: ['灰星局の装置が モンスターを 無理やり動かしている。', '装置は仲間を強化し続ける。先に止めるか、耐えて攻めるか。'],
  },
  {
    id: 'guardian',
    name: '森の守護獣',
    subtitle: '碧樹の森殿・環核試練',
    objective: 'HPを半分まで削り、ブレイク中に「鎮める」',
    enemies: ['moridorado'],
    fieldCycle: ['wood', 'water', 'fire', 'thunder'],
    backdrop: 'shrine',
    bgm: 'guardian',
    intro: ['森殿の奥で、ひび割れた環核を抱く 守護獣が目を開いた。', '倒すのではない。力を示し、心を鎮めるのだ。'],
  },
];

/** 試遊(タイトルの「戦闘の練習」)に並べる3戦 */
export const ENCOUNTER_ORDER = list.map((e) => e.id);

/* フィールドで見えている野生に触れたときの戦闘(敵の顔ぶれは出会った群れで決まる) */
const field: EncounterDef[] = [
  {
    id: 'field_forest', name: '野生の群れ', subtitle: '碧樹圏・苔むす獣道', objective: '倒すか、ブレイクして「鎮める」',
    enemies: ['konezumi'], fieldCycle: ['wood', 'thunder', 'water', 'fire'], backdrop: 'forest', bgm: 'wild',
    intro: ['野生のモンスターが 行く手をふさいだ。'],
  },
  {
    id: 'field_road', name: '野生の群れ', subtitle: '碧樹圏・倒木の旧街道', objective: '倒すか、ブレイクして「鎮める」',
    enemies: ['konezumi'], fieldCycle: ['fire', 'wood', 'thunder', 'water'], backdrop: 'forest', bgm: 'wild',
    intro: ['乾いた風の中、野生のモンスターが 気を立てている。'],
  },
  {
    id: 'field_marsh', name: '野生の群れ', subtitle: '碧樹圏・花粉の湿地', objective: '倒すか、ブレイクして「鎮める」',
    enemies: ['hanamochi'], fieldCycle: ['water', 'wood', 'fire', 'thunder'], backdrop: 'forest', bgm: 'wild',
    intro: ['花粉に酔った野生のモンスターが 近づいてくる。'],
  },
];

export const ENCOUNTERS: Record<string, EncounterDef> = Object.fromEntries([...list, ...field].map((e) => [e.id, e]));
