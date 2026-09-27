/* ============================================================
 * 会話UI(DOM)— 立ち絵・名前・文字送り・選択肢・オート・スキップ・履歴
 *   文字は実寸で描くので、戦場(Canvas)の縮小に関係なく読める。
 *   どこをタップしても送れる。キーボード(Z/Enter/Space)・ゲームパッドにも対応。
 * ============================================================ */
import type { Cmd, InputHub } from '../input.ts';
import type { Face } from '../story/lines.ts';

export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';
const CPS: Record<TextSpeed, number> = { slow: 22, normal: 45, fast: 90, instant: Infinity };

export interface DialogueHooks {
  /** 話者の立ち絵(画像URL)。なければ null */
  portrait(speaker: string): string | null;
  /** 名前の色(味方・仲間・灰星局などで色分け) */
  color(speaker: string): string;
  sfx(id: 'talk' | 'confirm' | 'select'): void;
  speed(): TextSpeed;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export class Dialogue {
  auto = false;
  private skip = false;
  private readonly root: HTMLElement;
  private readonly box: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly choicesEl: HTMLElement;
  private readonly portraitEl: HTMLImageElement;
  private readonly nextEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly history: { name: string; text: string; choice?: boolean }[] = [];
  private advance: (() => void) | null = null;
  private pick: ((i: number) => void) | null = null;
  private unlisten: (() => void) | null = null;
  private typing = false;
  private finishTyping: (() => void) | null = null;
  private autoTimer = 0;

  private readonly input: InputHub;
  private readonly hooks: DialogueHooks;

  constructor(input: InputHub, hooks: DialogueHooks) {
    this.input = input;
    this.hooks = hooks;
    this.root = document.createElement('div');
    this.root.id = 'talk';
    this.root.className = 'talk';
    this.root.hidden = true;
    this.root.innerHTML = `
      <img class="talk-portrait" alt="" hidden>
      <div class="talk-box" role="dialog" aria-live="polite">
        <div class="talk-name"></div>
        <div class="talk-text"></div>
        <div class="talk-choices" role="listbox"></div>
        <div class="talk-next" aria-hidden="true">▼</div>
        <div class="talk-tools">
          <button type="button" data-t="auto" aria-pressed="false">オート</button>
          <button type="button" data-t="skip" aria-pressed="false">スキップ</button>
          <button type="button" data-t="log">履歴</button>
        </div>
      </div>
      <div class="talk-log" hidden role="dialog" aria-label="会話の履歴">
        <div class="talk-log-head"><b>会話の履歴</b><button type="button" data-t="log-close">閉じる</button></div>
        <div class="talk-log-body"></div>
      </div>`;
    document.getElementById('app')?.appendChild(this.root);
    this.box = this.q('.talk-box');
    this.nameEl = this.q('.talk-name');
    this.textEl = this.q('.talk-text');
    this.choicesEl = this.q('.talk-choices');
    this.portraitEl = this.q('.talk-portrait') as HTMLImageElement;
    this.nextEl = this.q('.talk-next');
    this.logEl = this.q('.talk-log');
    this.root.addEventListener('click', (e) => this.onClick(e));
    // この1枚だけ、数字キーで選べる
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || !this.pick) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 9) {
        const b = this.choicesEl.querySelectorAll<HTMLButtonElement>('button')[n - 1];
        if (b) { e.preventDefault(); b.click(); }
      }
    });
  }

  private q(sel: string): HTMLElement { return this.root.querySelector(sel) as HTMLElement; }

  get isOpen(): boolean { return !this.root.hidden; }

  open(): void {
    if (!this.root.hidden) return;
    this.root.hidden = false;
    this.skip = false;
    this.syncTools();
    this.unlisten?.();
    this.unlisten = this.input.on((cmd, ev) => this.onCmd(cmd, ev));
  }

  close(): void {
    this.root.hidden = true;
    this.skip = false;
    this.unlisten?.();
    this.unlisten = null;
    clearTimeout(this.autoTimer);
    this.advance = null;
    this.pick = null;
  }

  /** 台詞(speaker が空なら地の文)。読み終えて送られたら解決 */
  say(speaker: string, name: string, face: Face, text: string): Promise<void> {
    this.open();
    this.history.push({ name, text });
    if (this.history.length > 200) this.history.shift();
    const src = speaker ? this.hooks.portrait(speaker) : null;
    this.box.classList.toggle('narration', !speaker);
    this.box.classList.toggle('with-portrait', !!src);
    this.nameEl.textContent = name;
    this.nameEl.style.color = speaker ? this.hooks.color(speaker) : '';
    this.nameEl.hidden = !speaker;
    if (src) {
      if (this.portraitEl.getAttribute('src') !== src) this.portraitEl.src = src;
      this.portraitEl.hidden = false;
      this.portraitEl.dataset.face = face;
      this.portraitEl.dataset.who = speaker;
      // 表情の動きを毎回やり直す
      this.portraitEl.classList.remove('pop');
      void this.portraitEl.offsetWidth;
      this.portraitEl.classList.add('pop');
    } else {
      this.portraitEl.hidden = true;
    }
    this.choicesEl.innerHTML = '';
    this.nextEl.hidden = true;
    return new Promise<void>((resolve) => {
      const done = () => {
        this.typing = false;
        this.nextEl.hidden = false;
        this.advance = () => { this.advance = null; clearTimeout(this.autoTimer); resolve(); };
        if (this.skip) this.autoTimer = window.setTimeout(() => this.advance?.(), 40);
        else if (this.auto) this.autoTimer = window.setTimeout(() => this.advance?.(), 900 + text.length * 45);
      };
      this.type(text, done);
    });
  }

  private type(text: string, done: () => void): void {
    const cps = this.skip ? Infinity : CPS[this.hooks.speed()];
    const chars = Array.from(text);
    this.textEl.textContent = '';
    if (!Number.isFinite(cps)) { this.textEl.textContent = text; done(); return; }
    this.typing = true;
    let i = 0;
    let last = performance.now();
    let acc = 0;
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      this.finishTyping = null;
      this.textEl.textContent = text;
      done();
    };
    this.finishTyping = end;
    const step = (now: number) => {
      if (finished) return;
      acc += ((now - last) / 1000) * cps;
      last = now;
      const n = Math.floor(acc);
      if (n > 0) {
        acc -= n;
        const before = i;
        i = Math.min(chars.length, i + n);
        this.textEl.textContent = chars.slice(0, i).join('');
        if (Math.floor(before / 3) !== Math.floor(i / 3)) this.hooks.sfx('talk');
      }
      if (i >= chars.length) end();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** 選択肢。選ばれた番号で解決 */
  choose(options: string[]): Promise<number> {
    this.open();
    this.skip = false;
    this.syncTools();
    clearTimeout(this.autoTimer);
    this.nextEl.hidden = true;
    this.choicesEl.innerHTML = options.map((o, i) => `<button type="button" class="talk-choice" data-i="${i}"><kbd>${i + 1}</kbd>${esc(o)}</button>`).join('');
    const first = this.choicesEl.querySelector<HTMLButtonElement>('button');
    first?.focus({ preventScroll: true });
    return new Promise<number>((resolve) => {
      this.pick = (i) => {
        this.pick = null;
        this.history.push({ name: '▶', text: options[i], choice: true });
        this.choicesEl.innerHTML = '';
        this.hooks.sfx('confirm');
        resolve(i);
      };
    });
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (t?.dataset.t === 'auto') { this.auto = !this.auto; this.syncTools(); if (this.auto && !this.typing) this.advance?.(); return; }
    if (t?.dataset.t === 'skip') { this.skip = !this.skip; this.syncTools(); if (this.skip) { this.finishTyping?.(); this.advance?.(); } return; }
    if (t?.dataset.t === 'log') { this.showLog(true); return; }
    if (t?.dataset.t === 'log-close') { this.showLog(false); return; }
    if (t?.dataset.i !== undefined) { this.pick?.(Number(t.dataset.i)); return; }
    if (!this.logEl.hidden) return;
    this.proceed();
  }

  private proceed(): void {
    if (this.typing) { this.finishTyping?.(); return; }
    if (this.advance) { this.hooks.sfx('select'); this.advance(); }
  }

  private onCmd(cmd: Cmd, ev?: Event): void {
    if (!this.logEl.hidden) {
      if (cmd === 'back' || cmd === 'confirm') this.showLog(false);
      else if (cmd === 'up' || cmd === 'down') this.logEl.querySelector('.talk-log-body')?.scrollBy(0, cmd === 'up' ? -80 : 80);
      return;
    }
    if (this.pick) {
      const list = Array.from(this.choicesEl.querySelectorAll<HTMLButtonElement>('button'));
      const cur = list.indexOf(document.activeElement as HTMLButtonElement);
      if (cmd === 'up' || cmd === 'down') {
        const n = cur < 0 ? 0 : (cur + (cmd === 'down' ? 1 : -1) + list.length) % list.length;
        list[n]?.focus();
        this.hooks.sfx('select');
      } else if (cmd === 'confirm') {
        ev?.preventDefault();
        (cur >= 0 ? list[cur] : list[0])?.click();
      }
      return;
    }
    if (cmd === 'confirm' || cmd === 'timing') { ev?.preventDefault(); this.proceed(); }
    else if (cmd === 'back') { this.skip = false; this.syncTools(); }
  }

  private showLog(v: boolean): void {
    this.logEl.hidden = !v;
    if (v) {
      const body = this.logEl.querySelector('.talk-log-body') as HTMLElement;
      body.innerHTML = this.history.map((h) => `<p class="${h.choice ? 'choice' : ''}">${h.name ? `<b>${esc(h.name)}</b>` : ''}${esc(h.text)}</p>`).join('');
      body.scrollTop = body.scrollHeight;
    }
  }

  private syncTools(): void {
    this.root.querySelector('[data-t="auto"]')?.setAttribute('aria-pressed', String(this.auto));
    this.root.querySelector('[data-t="skip"]')?.setAttribute('aria-pressed', String(this.skip));
  }
}
