/* ============================================================
 * 絵の対応表
 *   img : ユーザー素材を下ごしらえした絵(src/assets/cutout/*.webp)。あれば優先して使う。
 *         元画像は src/assets/user/ に置き、`npm run art:cutout` で透過・縮小して作る。
 *         使う絵だけを import する(使わない絵まで単一HTMLに入れて重くしないため)。
 *   spec: 無いときに使う、手続き生成の仮の絵。
 *   scale / imgScale: 戦場での大きさ(仮の絵 / ユーザー素材)。
 *   敵側は左右反転して表示する。
 * ============================================================ */
import type { ArtSpec } from '../art/placeholder.ts';
import fire1 from '../assets/cutout/mon_fire1.webp';
import water1 from '../assets/cutout/mon_water1.webp';
import forest1 from '../assets/cutout/mon_forest1.webp';
import w01 from '../assets/cutout/mon_w01.webp';
import w05 from '../assets/cutout/mon_w05.webp';
import w07 from '../assets/cutout/mon_w07.webp';
import w15 from '../assets/cutout/mon_w15.webp';
import w17 from '../assets/cutout/mon_w17.webp';
import bossForest from '../assets/cutout/boss_forest.webp';
import yuu from '../assets/cutout/char_yuu.webp';

export interface ArtEntry { img?: string; spec?: ArtSpec; scale: number; imgScale?: number }

export const ART: Record<string, ArtEntry> = {
  fox: { img: fire1, scale: 1, imgScale: 1.05, spec: { archetype: 'fox', primary: '#f07a38', secondary: '#3d6fd6', accent: '#ffb347', ringCore: 'small' } },
  otter: { img: water1, scale: 1, imgScale: 1.05, spec: { archetype: 'otter', primary: '#3aa6b9', secondary: '#f3ead8', accent: '#7fe7ff', ringCore: 'small' } },
  owl: { img: forest1, scale: 1, imgScale: 1.0, spec: { archetype: 'owl', primary: '#8a9a8c', secondary: '#6fbf5a', accent: '#9dff7a', ringCore: 'small' } },
  bud: { img: w05, scale: 0.95, imgScale: 0.9, spec: { archetype: 'bud', primary: '#ffc6d9', secondary: '#ff6fa1', accent: '#fff3a0' } },
  larva: { img: w07, scale: 0.9, imgScale: 1.0, spec: { archetype: 'larva', primary: '#ffd84a', secondary: '#2d2a33', accent: '#fff7b0' } },
  mouse: { img: w01, scale: 0.85, imgScale: 0.95, spec: { archetype: 'mouse', primary: '#e8d6b8', secondary: '#f4a6b4', accent: '#c98b4a' } },
  cat: { img: w15, scale: 1, imgScale: 1.05, spec: { archetype: 'cat', primary: '#ffd23f', secondary: '#2d2a33', accent: '#c9a7ff' } },
  crab: { img: w17, scale: 1.05, imgScale: 1.1, spec: { archetype: 'crab', primary: '#2fb3a6', secondary: '#f4e6c8', accent: '#bff6ff' } },
  // 強制起動装置はまだ素材なし(仮の絵)
  device: { scale: 1.1, spec: { archetype: 'device', primary: '#6b6f78', secondary: '#ff8a2a', accent: '#ff3b5c' } },
  dragon: { img: bossForest, scale: 2.3, imgScale: 2.85, spec: { archetype: 'dragon', primary: '#2f6b3f', secondary: '#7fae4f', accent: '#b6ff7a', ringCore: 'cracked' } },
  emblem: { img: yuu, scale: 1, imgScale: 1 },
};

export const ELEMENT_COLOR: Record<string, string> = {
  fire: '#ff7a3d', water: '#35c3dc', wood: '#6cc24a', thunder: '#b98cff', none: '#c9d2cf',
};
export const HEKIKAN = '#3ee0c8';
