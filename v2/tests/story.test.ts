/* ============================================================
 * 物語スクリプト(ink)の回帰テスト — 第1章「碧樹圏」
 *   1. 警告・エラーなしでコンパイルできる
 *   2. ゲームが呼ぶ入口 knot がすべてある
 *   3. 入口ごとに、進み具合を変えて選択肢と戦闘結果を総当たりし、
 *      出てくる行がすべて lines.ts の書式に合い、長すぎないことを確かめる
 * ============================================================ */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Compiler, Story } from 'inkjs/full';
import { parseLine, type Line } from '../src/story/lines.ts';

const INK_PATH = new URL('../src/story/chapter1.ink', import.meta.url);

const ENTRY_KNOTS = [
  'prologue', 'kaede',
  'villager_a', 'villager_b', 'villager_c', 'villager_d',
  'sign_village', 'sign_trail', 'sign_road', 'sign_marsh',
  'trail_enter', 'trail_ren', 'grove_journal',
  'road_ashstar', 'ashstar_worker', 'marsh_enter',
  'shrine_enter', 'epilogue', 'defeat',
] as const;

/** 各入口で、戦闘の後に試す結果 */
const BATTLE_RESULTS = ['win', 'pacified', 'lose'] as const;

/** マップごとの物体と地点(walk / hide / show / camera / warp の引数検査用) */
const MAPS: Record<string, { objects: string[]; points: string[] }> = {
  hanazono: { objects: ['kaede', 'villager_a', 'villager_b', 'villager_c', 'villager_d'], points: ['lab', 'spring', 'east_gate', 'south_gate'] },
  trail: { objects: ['ren_trail', 'grove_journal'], points: ['fork', 'east_exit', 'south_exit'] },
  road: { objects: ['ashstar_worker', 'ashstar_device'], points: ['camp', 'north_exit'] },
  marsh: { objects: [], points: ['west_exit', 'east_exit'] },
  shrine: { objects: ['ren_shrine', 'moridorado'], points: ['entrance', 'altar', 'ren_exit'] },
};
const ALL_OBJECTS = new Set(Object.values(MAPS).flatMap((m) => m.objects));
const ALL_POINTS = new Set(Object.values(MAPS).flatMap((m) => m.points));
const BGM = new Set(['village', 'forest', 'road', 'marsh', 'shrine', 'title', 'wild', 'ashstar', 'guardian', 'none']);
const SFX = new Set(['confirm', 'notice', 'item_get', 'burn', 'water', 'grow', 'resonance', 'break', 'pacify', 'heal', 'save', 'door']);
const ITEMS = new Set(['potion', 'revive', 'herb']);
const ENCOUNTERS = new Set(['ashstar', 'guardian']);
const BANNED = ['ポケモン', 'トレーナー', 'ジム', 'バッジ', 'モンスターボール', '捕まえる', 'ゲットだぜ', '博士に選ばれ'];

/** ゲームが書きこむ VAR と、物語の進み具合 */
type Vars = Record<string, string | number | boolean>;
const GAME_DEFAULTS: Vars = {
  battle_result: '', pacified_count: 0, defeated_count: 0, burned_log: false, marsh_cleared: false, took_journal: false,
};
const PROGRESS: Record<string, Vars> = {
  fresh: {},
  met_ren: { objective: '南の旧街道で、灰星局の中継器を調べる', met_ren: true, pacified_count: 1 },
  stopped_listen: {
    objective: '花粉の湿地を越えて、森殿へ', met_ren: true, device_stopped: true, ashstar_choice: 'listen',
    pacified_count: 3, defeated_count: 1, burned_log: true, took_journal: true, journal_read: true,
  },
  stopped_report: {
    objective: '花粉の湿地を越えて、森殿へ', met_ren: true, device_stopped: true, ashstar_choice: 'report',
    pacified_count: 0, defeated_count: 4, marsh_cleared: true,
  },
  shrine_trust: {
    objective: 'ハナゾノへ戻り、カエデに報告する', met_ren: true, device_stopped: true, ashstar_choice: 'leave',
    ren_stance: 'trust', shrine_done: true, pacified_count: 6, marsh_cleared: true, burned_log: true, took_journal: true,
  },
  shrine_oppose_skipped_camp: {
    objective: 'ハナゾノへ戻り、カエデに報告する', met_ren: true, ren_stance: 'oppose', shrine_done: true,
    pacified_count: 2, defeated_count: 2,
  },
  shrine_report: {
    objective: 'ハナゾノへ戻り、カエデに報告する', met_ren: true, device_stopped: true, ashstar_choice: 'report',
    ren_stance: 'oppose', shrine_done: true,
  },
  chapter_done: {
    objective: '次の環核の手がかりを探す', met_ren: true, device_stopped: true, ashstar_choice: 'listen',
    ren_stance: 'trust', shrine_done: true, chapter_done: true, pacified_count: 8,
  },
};

const MAX_STATES = 5000;
const MAX_DEPTH = 40;

interface Visited {
  knot: string;
  progress: string;
  line: string;
}

let source = '';
let storyJson = '';
let compileErrors: string[] = [];
let compileWarnings: string[] = [];

function newStory(): Story {
  const s = new Story(storyJson);
  s.onError = (msg: string) => {
    throw new Error(`ink 実行時エラー: ${msg}`);
  };
  return s;
}

function setVars(story: Story, vars: Vars) {
  for (const [k, v] of Object.entries(vars)) story.variablesState.$(k, v);
}

/** 状態の重複判定用の鍵(ターン番号は無視する) */
function stateKey(story: Story): string {
  const j = JSON.parse(story.state.ToJson());
  delete j.turnIdx;
  delete j.turnIndices;
  return JSON.stringify(j);
}

interface Explored {
  lines: Visited[];
  /** 終端(END / 選択肢なし)に到達したときの VAR */
  endings: Vars[];
  battles: string[];
  states: number;
  choiceTexts: string[];
}

function readVars(story: Story, names: string[]): Vars {
  const out: Vars = {};
  for (const n of names) out[n] = story.variablesState.$(n) as string | number | boolean;
  return out;
}

const WATCHED = ['objective', 'met_ren', 'device_stopped', 'ashstar_choice', 'ren_stance', 'shrine_done', 'chapter_done'];

/** 入口 knot から、選択肢と戦闘結果を深さ優先で総当たりする */
function explore(knot: string, progress: string): Explored {
  const story = newStory();
  story.ResetState();
  setVars(story, { ...GAME_DEFAULTS, ...PROGRESS[progress] });
  story.ChoosePathString(knot);

  const out: Explored = { lines: [], endings: [], battles: [], states: 0, choiceTexts: [] };
  const seen = new Set<string>();
  const stack: { json: string; depth: number }[] = [{ json: story.state.ToJson(), depth: 0 }];

  while (stack.length) {
    const { json, depth } = stack.pop()!;
    story.state.LoadJson(json);
    const key = stateKey(story);
    if (seen.has(key)) continue;
    seen.add(key);
    out.states++;
    if (out.states > MAX_STATES) throw new Error(`${knot}/${progress}: 状態が多すぎる(ループの疑い)`);
    if (depth > MAX_DEPTH) throw new Error(`${knot}/${progress}: 深すぎる(ループの疑い)`);

    let branched = false;
    while (story.canContinue) {
      const raw = story.Continue() ?? '';
      const line = raw.trim();
      if (!line) continue;
      out.lines.push({ knot, progress, line });
      const parsed = parseLine(line);
      if (parsed?.kind === 'command' && parsed.name === 'battle') {
        out.battles.push(parsed.args[0]);
        const snap = story.state.ToJson();
        for (const r of BATTLE_RESULTS) {
          story.state.LoadJson(snap);
          story.variablesState.$('battle_result', r);
          stack.push({ json: story.state.ToJson(), depth: depth + 1 });
        }
        branched = true;
        break;
      }
    }
    if (branched) continue;

    const choices = story.currentChoices;
    if (choices.length === 0) {
      out.endings.push(readVars(story, WATCHED));
      continue;
    }
    const snap = story.state.ToJson();
    for (let i = 0; i < choices.length; i++) {
      out.choiceTexts.push(choices[i].text);
      story.state.LoadJson(snap);
      story.ChooseChoiceIndex(i);
      stack.push({ json: story.state.ToJson(), depth: depth + 1 });
    }
  }
  return out;
}

/** 行の本文(話者の接頭辞を除いた部分)の長さ */
function bodyLength(line: string, parsed: Line | null): number {
  if (parsed?.kind === 'say') return [...parsed.text].length;
  return [...line].length;
}

const results: Record<string, Explored> = {};

beforeAll(() => {
  source = readFileSync(INK_PATH, 'utf8');
  const compiler = new Compiler(source);
  try {
    compiler.Compile();
  } catch {
    /* エラーは compiler.errors に入る */
  }
  compileErrors = compiler.errors;
  compileWarnings = compiler.warnings;
  if (compileErrors.length === 0) {
    storyJson = compiler.runtimeStory.ToJson() ?? '';
    for (const knot of ENTRY_KNOTS) {
      for (const progress of Object.keys(PROGRESS)) {
        results[`${knot}/${progress}`] = explore(knot, progress);
      }
    }
  }
});

describe('第1章 ink スクリプト', () => {
  it('警告・エラーなしでコンパイルできる', () => {
    expect(compileErrors).toEqual([]);
    expect(compileWarnings).toEqual([]);
    expect(storyJson.length).toBeGreaterThan(0);
  });

  it('ゲームが呼ぶ入口 knot がすべてある', () => {
    const story = newStory();
    for (const knot of ENTRY_KNOTS) {
      expect(story.mainContentContainer.namedContent.has(knot), knot).toBe(true);
    }
  });

  it('総当たりで全入口・全進行度を最後まで辿れる', () => {
    for (const knot of ENTRY_KNOTS) {
      for (const progress of Object.keys(PROGRESS)) {
        const r = results[`${knot}/${progress}`];
        expect(r, `${knot}/${progress}`).toBeDefined();
        expect(r.endings.length, `${knot}/${progress} に終端がない`).toBeGreaterThan(0);
      }
    }
  });

  it('全ての行が lines.ts の書式に合い、命令の引数も正しい', () => {
    const bad: string[] = [];
    for (const r of Object.values(results)) {
      for (const { knot, progress, line } of r.lines) {
        const p = parseLine(line);
        const where = `[${knot}/${progress}] ${line}`;
        if (!p) continue;
        if (p.kind === 'invalid') {
          bad.push(`${where} — ${p.reason}`);
          continue;
        }
        if (p.kind !== 'command') continue;
        const [a, b] = p.args;
        switch (p.name) {
          case 'battle': if (!ENCOUNTERS.has(a)) bad.push(`${where} — 未知の遭遇`); break;
          case 'give': if (!ITEMS.has(a)) bad.push(`${where} — 未知の道具`); break;
          case 'bgm': if (!BGM.has(a)) bad.push(`${where} — 未知の BGM`); break;
          case 'sfx': if (!SFX.has(a)) bad.push(`${where} — 未知の効果音`); break;
          case 'hide': case 'show': if (!ALL_OBJECTS.has(a)) bad.push(`${where} — 未知の物体`); break;
          case 'camera': if (a !== 'player' && !ALL_OBJECTS.has(a)) bad.push(`${where} — 未知の物体`); break;
          case 'walk': if (!ALL_OBJECTS.has(a) || !ALL_POINTS.has(b)) bad.push(`${where} — 未知の物体か地点`); break;
          case 'warp': if (!MAPS[a]?.points.includes(b)) bad.push(`${where} — 未知のマップか地点`); break;
          default: break;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('1行は60字以内(話者の接頭辞を除く)', () => {
    const long: string[] = [];
    for (const r of Object.values(results)) {
      for (const { knot, line } of r.lines) {
        const n = bodyLength(line, parseLine(line));
        if (n > 60) long.push(`[${knot}] (${n}) ${line}`);
      }
    }
    expect(long).toEqual([]);
  });

  it('選択肢は短く(18字以内)、台詞の書式を含まない', () => {
    const bad: string[] = [];
    for (const r of Object.values(results)) {
      for (const t of r.choiceTexts) {
        if ([...t].length > 18 || t.startsWith('@') || t.startsWith('>>')) bad.push(t);
      }
    }
    expect(bad).toEqual([]);
  });

  it('避けるべき用語を使っていない', () => {
    const hits = BANNED.filter((w) => source.includes(w));
    expect(hits).toEqual([]);
  });

  it('prologue の後は objective が空でない', () => {
    const r = results['prologue/fresh'];
    for (const v of r.endings) expect(String(v.objective).length).toBeGreaterThan(0);
  });

  it('road_ashstar: 戦闘があり、勝てば装置が止まり3択のどれかが記録される', () => {
    const r = results['road_ashstar/met_ren'];
    expect(r.battles).toContain('ashstar');
    const won = r.endings.filter((v) => v.device_stopped);
    expect(new Set(won.map((v) => v.ashstar_choice))).toEqual(new Set(['listen', 'report', 'leave']));
    const lost = r.endings.filter((v) => !v.device_stopped);
    expect(lost.length).toBeGreaterThan(0);
  });

  it('shrine_enter: 鎮めた時だけ森殿が終わり、レンへの態度が記録される', () => {
    const r = results['shrine_enter/stopped_listen'];
    expect(r.battles).toContain('guardian');
    const done = r.endings.filter((v) => v.shrine_done);
    expect(new Set(done.map((v) => v.ren_stance))).toEqual(new Set(['trust', 'oppose']));
    for (const v of done) expect(v.objective).toContain('カエデ');
    expect(r.endings.some((v) => !v.shrine_done)).toBe(true);
  });

  it('epilogue: 章が終わり chapter_end が出る', () => {
    for (const progress of ['shrine_trust', 'shrine_oppose_skipped_camp', 'shrine_report']) {
      const r = results[`epilogue/${progress}`];
      expect(r.lines.some((l) => l.line === '>> chapter_end'), progress).toBe(true);
      for (const v of r.endings) expect(v.chapter_done).toBe(true);
    }
  });

  it('負けたあと同じ knot を呼ぶと、前置きを飛ばしてすぐ戦闘に戻る', () => {
    const cases: [string, string, string][] = [
      ['road_ashstar', 'met_ren', 'ashstar'],
      ['shrine_enter', 'stopped_listen', 'guardian'],
    ];
    for (const [knot, progress, enc] of cases) {
      const story = newStory();
      setVars(story, { ...GAME_DEFAULTS, ...PROGRESS[progress] });
      // 1回目: 最初の選択肢を選び続けて戦闘まで進み、負ける
      story.ChoosePathString(knot);
      let reached = false;
      for (let guard = 0; guard < 500 && !reached; guard++) {
        if (story.canContinue) {
          if (story.Continue()?.trim() === `>> battle ${enc}`) reached = true;
        } else if (story.currentChoices.length) story.ChooseChoiceIndex(0);
        else break;
      }
      expect(reached, `${knot}: 戦闘に着かない`).toBe(true);
      story.variablesState.$('battle_result', 'lose');
      while (story.canContinue) story.Continue();
      expect(story.currentChoices.length).toBe(0);
      // 2回目: 数行で戦闘に戻る
      story.ChoosePathString(knot);
      let count = 0;
      let again = false;
      while (story.canContinue && count < 12) {
        const l = story.Continue()?.trim() ?? '';
        if (!l) continue;
        count++;
        if (l === `>> battle ${enc}`) { again = true; break; }
      }
      expect(again, `${knot}: 再挑戦で戦闘に戻らない(${count}行)`).toBe(true);
      expect(story.currentChoices.length).toBe(0);
    }
  });

  it('本文の行数が目安(250〜500行)に収まる', () => {
    const unique = new Set<string>();
    for (const r of Object.values(results)) {
      for (const { line } of r.lines) if (!line.startsWith('>>')) unique.add(line);
    }
    expect(unique.size).toBeGreaterThanOrEqual(250);
    expect(unique.size).toBeLessThanOrEqual(500);
  });
});
