/* ============================================================
 * ユニットデータ(味方3体・巡環士・敵)
 * 名前は仮。絵は src/data/art.ts の art キーで引く。
 * ============================================================ */
import type { UnitDef } from '../core/types.ts';

const list: UnitDef[] = [
  /* ---------- 相棒 ---------- */
  { id: 'hinoko', name: 'ヒノコ', side: 'ally', element: 'fire', hp: 128, atk: 60, def: 40, spd: 78, shield: 0, weaknesses: [],
    skills: ['f_scratch', 'f_ember', 'f_flurry', 'f_foxfire', 'r_prairie', 'r_steam', 'r_hekikan'], art: 'fox' },
  { id: 'shizuku', name: 'シズク', side: 'ally', element: 'water', hp: 158, atk: 48, def: 56, spd: 60, shield: 0, weaknesses: [],
    skills: ['w_jet', 'w_cover', 'w_heal', 'w_whirl', 'r_steam', 'r_rain', 'r_hekikan'], art: 'otter' },
  { id: 'konoha', name: 'コノハ', side: 'ally', element: 'wood', hp: 138, atk: 54, def: 48, spd: 66, shield: 0, weaknesses: [],
    skills: ['o_peck', 'o_leaf', 'o_rune', 'o_bind', 'o_bloom', 'r_prairie', 'r_rain', 'r_hekikan'], art: 'owl' },

  /* ---------- 巡環士(プレイヤー自身。狙われない)---------- */
  { id: 'yuu', name: 'ユウ', side: 'player', element: 'none', hp: 1, atk: 0, def: 0, spd: 58, shield: 0, weaknesses: [],
    skills: ['p_observe', 'p_pacify', 'p_cheer', 'p_field_fire', 'p_field_water', 'p_field_wood', 'p_field_thunder', 'p_potion', 'p_revive'],
    art: 'emblem' },

  /* ---------- 野生(碧樹圏)---------- */
  { id: 'hanamochi', name: 'ハナモチ', side: 'enemy', element: 'wood', hp: 155, atk: 86, def: 42, spd: 64, shield: 3,
    weaknesses: ['fire', 'none'], skills: ['e_tackle', 'e_spore', 'e_sweet'], pacifiable: true, ai: 'basic', art: 'bud' },
  { id: 'birimushi', name: 'ビリムシ', side: 'enemy', element: 'thunder', hp: 125, atk: 98, def: 36, spd: 82, shield: 2,
    weaknesses: ['wood', 'fire'], skills: ['e_shock', 'e_discharge'], pacifiable: true, ai: 'basic', art: 'larva' },
  { id: 'konezumi', name: 'コネズミ', side: 'enemy', element: 'none', hp: 115, atk: 90, def: 32, spd: 94, shield: 2,
    weaknesses: ['water', 'thunder'], skills: ['e_bite', 'e_quick'], pacifiable: true, ai: 'basic', art: 'mouse' },

  /* ---------- 灰星局 ---------- */
  { id: 'device', name: '強制起動装置', side: 'enemy', element: 'none', hp: 270, atk: 130, def: 70, spd: 46, shield: 3,
    weaknesses: ['water', 'thunder'], skills: ['d_overdrive', 'd_pulse'], controller: true, ai: 'device', art: 'device' },
  { id: 'denneko', name: 'デンネコ', side: 'enemy', element: 'thunder', hp: 210, atk: 132, def: 40, spd: 80, shield: 3,
    weaknesses: ['wood', 'none'], skills: ['e_spark', 'e_fury'], pacifiable: true, controlled: true, ai: 'basic', art: 'cat' },
  { id: 'awagani', name: 'アワガニ', side: 'enemy', element: 'water', hp: 245, atk: 126, def: 64, spd: 46, shield: 4,
    weaknesses: ['thunder', 'wood'], skills: ['e_bubble', 'e_clamp'], pacifiable: true, controlled: true, ai: 'basic', art: 'crab' },

  /* ---------- 森の守護獣 ---------- */
  { id: 'moridorado', name: 'モリドラード', side: 'enemy', element: 'wood', hp: 1150, atk: 130, def: 56, spd: 118, shield: 8,
    weaknesses: ['fire', 'none'], skills: ['g_lash', 'g_spore', 'g_stance', 'g_roar', 'g_regrow', 'g_dominion'],
    pacifiable: true, guardian: { pacifyAt: 0.5 }, ai: 'guardian', art: 'dragon' },
];

export const UNITS: Record<string, UnitDef> = Object.fromEntries(list.map((u) => [u.id, u]));

export const PARTY = ['hinoko', 'shizuku', 'konoha'] as const;
export const PLAYER = 'yuu';

export function unitDef(id: string): UnitDef {
  const u = UNITS[id];
  if (!u) throw new Error(`unknown unit: ${id}`);
  return u;
}
