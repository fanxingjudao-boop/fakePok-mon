/* ============================================================
 * バランスシミュレーション
 *   各遭遇を N 回ずつ、AI(そこそこ上手い判断)で最後まで戦わせて集計する。
 *   入力の上手さは4種: casual(不慣れ)/ average(平均)/ skilled(上級)/ auto(設定「自動」)
 *   実行: npm run sim            (回数を変えるなら: npm run sim -- 2000)
 * ============================================================ */
import { simulate, PROFILES, type SkillProfile, type SimResult } from '../src/core/ai.ts';
import { ENCOUNTER_ORDER } from '../src/data/encounters.ts';

export type ProfileName = keyof typeof PROFILES;
export interface SimSummary {
  encounter: string; profile: ProfileName; n: number;
  winRate: number; stalemates: number; avgTurns: number; p90Turns: number;
  avgBreaks: number; avgPacified: number; avgAllyKOs: number;
}

export function summarize(encounter: string, profile: ProfileName, n: number): SimSummary {
  const p: SkillProfile = PROFILES[profile];
  const rs: SimResult[] = [];
  for (let i = 1; i <= n; i++) rs.push(simulate(encounter, i * 7919, p));
  const turns = rs.map((r) => r.turns).sort((a, b) => a - b);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
  return {
    encounter, profile, n,
    winRate: rs.filter((r) => r.outcome === 'win').length / n,
    stalemates: rs.filter((r) => r.outcome === 'stalemate').length,
    avgTurns: avg(turns),
    p90Turns: turns[Math.floor(n * 0.9)] ?? 0,
    avgBreaks: avg(rs.map((r) => r.stats.breaks)),
    avgPacified: avg(rs.map((r) => r.stats.pacified)),
    avgAllyKOs: avg(rs.map((r) => r.stats.allyKOs)),
  };
}

const LABEL: Record<ProfileName, string> = { casual: '不慣れ', average: '平均', skilled: '上級', auto: '自動' };

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const n = Number(process.argv[2] ?? 500);
  console.log(`\nバランスシミュレーション (各 ${n} 戦 / 判断はAI・入力の上手さを4段階で変える)\n`);
  console.log('遭遇      | 入力   |  勝率  | 手数平均 | 手数90% | ブレイク | 鎮め | 仲間が倒れた回数');
  console.log('----------|--------|--------|----------|---------|----------|------|----------------');
  for (const enc of ENCOUNTER_ORDER) {
    for (const prof of Object.keys(PROFILES) as ProfileName[]) {
      const r = summarize(enc, prof, n);
      console.log(
        `${enc.padEnd(9)} | ${LABEL[prof].padEnd(4, '　')} | ${(r.winRate * 100).toFixed(1).padStart(5)}% | ${r.avgTurns.toFixed(1).padStart(8)} | ${String(r.p90Turns).padStart(7)} | ${r.avgBreaks.toFixed(1).padStart(8)} | ${r.avgPacified.toFixed(1).padStart(4)} | ${r.avgAllyKOs.toFixed(2).padStart(6)}`
        + (r.stalemates ? `  ⚠膠着 ${r.stalemates}` : ''),
      );
    }
  }
}
