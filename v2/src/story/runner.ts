/* ============================================================
 * 物語の進行役: ink の Story を包み、1行ずつ「台詞 / 地の文 / 命令 / 選択肢」に分けて渡す。
 * 表示(会話UI)や命令の実行(フィールド)は外から渡す。ink の状態はセーブに丸ごと入る。
 * ============================================================ */
import { Story } from 'inkjs';
import { parseLine, type Line } from './lines.ts';

export type Step =
  | { kind: 'line'; line: Exclude<Line, { kind: 'invalid' }> }
  | { kind: 'choices'; options: string[] }
  | { kind: 'end' };

export class StoryRunner {
  readonly story: Story;

  constructor(json: string, state: string | null = null) {
    this.story = new Story(json);
    if (state) {
      try { this.story.state.LoadJson(state); } catch { /* 壊れた状態は捨てて最初から */ }
    }
    this.story.onError = (msg) => { console.warn('[ink]', msg); };
  }

  has(knot: string): boolean {
    try { return !!this.story.KnotContainerWithName(knot); } catch { return false; }
  }

  /** 宣言済みの変数だけ読める */
  get(name: string): string | number | boolean | undefined {
    const v = this.story.variablesState.$(name);
    return v === null ? undefined : (v as string | number | boolean);
  }

  /** 宣言済みの変数だけ書く(未宣言は無視: 書き手とゲームの取り決めがずれても落ちない) */
  set(name: string, value: string | number | boolean): void {
    if (this.story.variablesState.$(name) === null) return;
    this.story.variablesState.$(name, value);
  }

  start(knot: string): void {
    this.story.ChoosePathString(knot);
  }

  next(): Step {
    while (this.story.canContinue) {
      const raw = this.story.Continue() ?? '';
      const line = parseLine(raw);
      if (!line) continue;
      if (line.kind === 'invalid') { console.warn('[story]', line.reason, line.raw); continue; }
      return { kind: 'line', line };
    }
    if (this.story.currentChoices.length) return { kind: 'choices', options: this.story.currentChoices.map((c) => c.text) };
    return { kind: 'end' };
  }

  choose(i: number): void {
    this.story.ChooseChoiceIndex(i);
  }

  save(): string {
    return this.story.state.ToJson();
  }
}
