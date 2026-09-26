/* ============================================================
 * 人物の絵(ユーザー素材の切り抜き)。会話の立ち絵とフィールドの姿に使う。
 * 村人4人は素材がないので、フィールドの絵(src/art/field.ts)で描いたものを使う。
 * ============================================================ */
import yuu from '../assets/cutout/char_yuu.webp';
import kaede from '../assets/cutout/char_kaede.webp';
import ren from '../assets/cutout/char_ren.webp';
import gendou from '../assets/cutout/char_gendou.webp';
import ashstar from '../assets/cutout/char_ashstar.webp';

export const PEOPLE: Record<'yuu' | 'kaede' | 'ren' | 'gendou' | 'ashstar', string> = { yuu, kaede, ren, gendou, ashstar };

/** 会話の名前の色 */
export const SPEAKER_COLOR: Record<string, string> = {
  yuu: '#ffc76a', kaede: '#ff9d6b', ren: '#8fb8ff', gendou: '#c9c3b8', ashstar: '#ffb27a',
  hinoko: '#ff9a5c', shizuku: '#6fd6ea', konoha: '#9bd67e', moridorado: '#7fe0a0',
  villager_a: '#cfe3de', villager_b: '#cfe3de', villager_c: '#cfe3de', villager_d: '#cfe3de', unknown: '#b9c7c4',
};
