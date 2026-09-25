/* ============================================================
 * 入力の統合: キーボード・ゲームパッド・タップ/クリックを同じ命令に変換する
 * ============================================================ */
export type Cmd = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'timing';
type Listener = (cmd: Cmd, ev?: Event) => void;

const KEYS: Record<string, Cmd> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  z: 'confirm', Z: 'confirm', Enter: 'confirm', ' ': 'confirm',
  x: 'back', X: 'back', Escape: 'back', Backspace: 'back',
};

export class InputHub {
  private listeners: Listener[] = [];
  private padPrev: boolean[] = [];
  private raf = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat && (KEYS[e.key] === 'confirm' || KEYS[e.key] === 'back')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const cmd = KEYS[e.key];
      if (!cmd) return;
      this.emit(cmd, e);
      // Space/Enter/矢印でページがスクロールしたり、フォーカス中のボタンが二重に押されるのを防ぐ
      if (cmd !== 'back' || e.key !== 'Backspace') e.preventDefault();
    });
    this.pollPad();
  }

  /** 命令を受け取る。戻り値で解除 */
  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((x) => x !== fn); };
  }

  emit(cmd: Cmd, ev?: Event): void {
    // 後から登録したもの(より手前のUI)を優先。1つだけに届ける
    const l = this.listeners[this.listeners.length - 1];
    if (l) l(cmd, ev);
  }

  private pollPad = () => {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && Array.from(pads).find((x) => x && x.connected);
    if (p) {
      const map: [number, Cmd][] = [[0, 'confirm'], [1, 'back'], [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']];
      const now: boolean[] = [];
      for (const [i, cmd] of map) {
        const pressed = !!p.buttons[i]?.pressed;
        now[i] = pressed;
        if (pressed && !this.padPrev[i]) this.emit(cmd);
      }
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      const dirs: [boolean, number, Cmd][] = [[ay < -0.6, 20, 'up'], [ay > 0.6, 21, 'down'], [ax < -0.6, 22, 'left'], [ax > 0.6, 23, 'right']];
      for (const [on, i, cmd] of dirs) { now[i] = on; if (on && !this.padPrev[i]) this.emit(cmd); }
      this.padPrev = now;
    }
    this.raf = requestAnimationFrame(this.pollPad);
  };

  destroy(): void { cancelAnimationFrame(this.raf); this.listeners = []; }
}
