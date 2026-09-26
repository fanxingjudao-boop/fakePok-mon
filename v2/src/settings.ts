/* ============================================================
 * 設定(端末ごとに localStorage へ保存。使えない環境でも既定値で動く)
 * ============================================================ */
export type TimingMode = 'manual' | 'auto';

export interface Settings {
  /** manual: リングに合わせて入力 / auto: 入力なし(攻撃Good・防御は7割でGood) */
  timing: TimingMode;
  /** 会話の文字の速さ */
  textSpeed: 'slow' | 'normal' | 'fast' | 'instant';
  /** 演出の速さ */
  speed: 1 | 1.5 | 2;
  volume: number;
  muted: boolean;
  /** 初回ヒントをもう見たか */
  seenTips: string[];
}

const KEY = 'hekikan_v2_settings';
const DEFAULTS: Settings = { timing: 'manual', textSpeed: 'normal', speed: 1, volume: 0.7, muted: false, seenTips: [] };
const TEXT_SPEEDS = ['slow', 'normal', 'fast', 'instant'] as const;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      timing: s.timing === 'auto' ? 'auto' : 'manual',
      textSpeed: TEXT_SPEEDS.includes(s.textSpeed as never) ? (s.textSpeed as Settings['textSpeed']) : 'normal',
      speed: s.speed === 1.5 || s.speed === 2 ? s.speed : 1,
      volume: typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1 ? s.volume : DEFAULTS.volume,
      muted: !!s.muted,
      seenTips: Array.isArray(s.seenTips) ? s.seenTips.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 保存できない環境では無視 */ }
}
