/* ============================================================
 * 絵の対応表
 *   file: ユーザーが用意する画像(src/assets/user/ 以下)。置いてビルドすれば優先して使う。
 *         無ければ spec から手続き生成した仮の絵を使う。
 *   画像はすべて「斜め横・左向き」。敵側は左右反転して表示する。
 * ============================================================ */
import type { ArtSpec } from '../art/placeholder.ts';

export interface ArtEntry { file: string; spec?: ArtSpec; scale: number }

export const ART: Record<string, ArtEntry> = {
  fox: { file: 'mon/mon_fire1.png', scale: 1, spec: { archetype: 'fox', primary: '#f07a38', secondary: '#3d6fd6', accent: '#ffb347', ringCore: 'small' } },
  otter: { file: 'mon/mon_water1.png', scale: 1, spec: { archetype: 'otter', primary: '#3aa6b9', secondary: '#f3ead8', accent: '#7fe7ff', ringCore: 'small' } },
  owl: { file: 'mon/mon_forest1.png', scale: 1, spec: { archetype: 'owl', primary: '#8a9a8c', secondary: '#6fbf5a', accent: '#9dff7a', ringCore: 'small' } },
  bud: { file: 'mon/mon_w05.png', scale: 0.95, spec: { archetype: 'bud', primary: '#ffc6d9', secondary: '#ff6fa1', accent: '#fff3a0' } },
  larva: { file: 'mon/mon_w07.png', scale: 0.9, spec: { archetype: 'larva', primary: '#ffd84a', secondary: '#2d2a33', accent: '#fff7b0' } },
  mouse: { file: 'mon/mon_w01.png', scale: 0.85, spec: { archetype: 'mouse', primary: '#e8d6b8', secondary: '#f4a6b4', accent: '#c98b4a' } },
  cat: { file: 'mon/mon_w15.png', scale: 1, spec: { archetype: 'cat', primary: '#ffd23f', secondary: '#2d2a33', accent: '#c9a7ff' } },
  crab: { file: 'mon/mon_w17.png', scale: 1.05, spec: { archetype: 'crab', primary: '#2fb3a6', secondary: '#f4e6c8', accent: '#bff6ff' } },
  device: { file: 'mon/obj_ashstar_device.png', scale: 1.1, spec: { archetype: 'device', primary: '#6b6f78', secondary: '#ff8a2a', accent: '#ff3b5c' } },
  dragon: { file: 'mon/boss_forest.png', scale: 2.3, spec: { archetype: 'dragon', primary: '#2f6b3f', secondary: '#7fae4f', accent: '#b6ff7a', ringCore: 'cracked' } },
  emblem: { file: 'char/char_yuu.png', scale: 1 },
};

export const ELEMENT_COLOR: Record<string, string> = {
  fire: '#ff7a3d', water: '#35c3dc', wood: '#6cc24a', thunder: '#b98cff', none: '#c9d2cf',
};
export const HEKIKAN = '#3ee0c8';
