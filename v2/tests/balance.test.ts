/* ============================================================
 * バランス回帰テスト
 *   数値をいじって難易度が目標帯から外れたら失敗する。
 *   目標: 野生=導入(ほぼ負けない) / 灰星局=緊張感 / 守護獣=腕前で差が出る
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import { summarize } from '../scripts/sim.ts';

const N = 200;

describe('バランス(AI同士の対戦で勝率が目標帯に入る)', () => {
  it('野生: 導入戦。平均的な人なら 97% 以上勝てる', () => {
    const r = summarize('wild', 'average', N);
    expect(r.winRate).toBeGreaterThanOrEqual(0.97);
    expect(r.stalemates).toBe(0);
  });
  it('灰星局: 平均 90% 以上、不慣れだと 95% 未満(緊張感がある)', () => {
    expect(summarize('ashstar', 'average', N).winRate).toBeGreaterThanOrEqual(0.9);
    expect(summarize('ashstar', 'casual', N).winRate).toBeLessThan(0.95);
  });
  it('守護獣: 腕前で差が出る(不慣れ < 平均 < 上級)', () => {
    const casual = summarize('guardian', 'casual', N).winRate;
    const average = summarize('guardian', 'average', N).winRate;
    const skilled = summarize('guardian', 'skilled', N).winRate;
    expect(average).toBeGreaterThanOrEqual(0.65);
    expect(average).toBeLessThanOrEqual(0.9);
    expect(casual).toBeLessThan(average);
    expect(skilled).toBeGreaterThan(average);
    expect(skilled).toBeGreaterThanOrEqual(0.88);
  });
  it('設定「自動」は平均的な手動入力と大きく差がない(入力を頑張る価値が残る)', () => {
    const avg = summarize('guardian', 'average', N).winRate;
    const auto = summarize('guardian', 'auto', N).winRate;
    expect(Math.abs(avg - auto)).toBeLessThanOrEqual(0.15);
    expect(auto).toBeLessThan(summarize('guardian', 'skilled', N).winRate);
  });
  it('どの戦いも膠着しない(400手以内に決着)', () => {
    for (const enc of ['wild', 'ashstar', 'guardian']) {
      for (const p of ['casual', 'average', 'skilled', 'auto'] as const) {
        expect(summarize(enc, p, 60).stalemates).toBe(0);
      }
    }
  });
});
