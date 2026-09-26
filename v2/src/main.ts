/* ============================================================
 * 起動と画面遷移(タイトル → 戦闘 → 結果)、レイアウト、設定
 * ============================================================ */
import './ui/style.css';
import Phaser from 'phaser';
import { BattleScene, type BattleHost, type BattleResult } from './scenes/BattleScene.ts';
import { AudioEngine } from './audio/engine.ts';
import { Dock } from './ui/dock.ts';
import { InputHub } from './input.ts';
import { loadSettings, saveSettings } from './settings.ts';
import { ENCOUNTERS, ENCOUNTER_ORDER } from './data/encounters.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const settings = loadSettings();
const audio = new AudioEngine();
audio.setVolume(settings.volume);
audio.setMuted(settings.muted);
const input = new InputHub();
const dock = new Dock($('dock'), input);
const cleared = new Set<string>();
let game: Phaser.Game | null = null;
let current = ENCOUNTER_ORDER[0];
let lastResult: BattleResult | null = null;

/* ---------------- トースト・初回ヒント ---------------- */
const escHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const inBattle = () => screens.every((s) => $(`screen-${s}`).hidden);

function toast(text: string, kind: 'tip' | 'info' | 'warn' = 'info', html = false): void {
  // 戦闘中は記録帳のメモ欄に出す(戦場の上に重ねない)
  if (inBattle()) { dock.memo(html ? text : escHtml(text), kind); return; }
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  if (html) el.innerHTML = text; else el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild?.remove();
  setTimeout(() => el.remove(), kind === 'tip' ? 6500 : 3600);
}
function tip(id: string, html: string): void {
  if (settings.seenTips.includes(id)) return;
  settings.seenTips.push(id);
  saveSettings(settings);
  toast(html, 'tip', true);
}

/* ---------------- 画面の切り替え ---------------- */
type ScreenId = 'title' | 'result' | 'help' | 'settings';
const screens: ScreenId[] = ['title', 'result', 'help', 'settings'];
let overlayUnlisten: (() => void) | null = null;
let returnTo: ScreenId | null = null;

function show(id: ScreenId | null): void {
  for (const s of screens) $(`screen-${s}`).hidden = s !== id;
  overlayUnlisten?.();
  overlayUnlisten = null;
  if (id) {
    const root = $(`screen-${id}`);
    overlayUnlisten = input.on((cmd) => {
      const focusables = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input'));
      const i = focusables.indexOf(document.activeElement as HTMLElement);
      if (cmd === 'down' || cmd === 'right') focusables[(i + 1 + focusables.length) % focusables.length]?.focus();
      else if (cmd === 'up' || cmd === 'left') focusables[(i - 1 + focusables.length) % focusables.length]?.focus();
      else if (cmd === 'confirm') (document.activeElement && root.contains(document.activeElement) ? document.activeElement as HTMLElement : focusables[0])?.click();
      else if (cmd === 'back' && (id === 'help' || id === 'settings')) closeOverlay();
    });
    (root.querySelector<HTMLElement>('.enc, .btn.primary, button') ?? root).focus({ preventScroll: true });
  }
}

function openOverlay(id: 'help' | 'settings'): void {
  const visible = screens.find((s) => !$(`screen-${s}`).hidden) ?? null;
  returnTo = visible;
  if (!visible && game?.scene.isActive('battle')) game.scene.pause('battle');
  show(id);
}
function closeOverlay(): void {
  const back = returnTo;
  returnTo = null;
  show(back);
  if (!back && game?.scene.isPaused('battle')) game.scene.resume('battle');
}

/* ---------------- レイアウト(戦場を最大にする配置を選ぶ)---------------- */
function layout(): void {
  const app = $('app');
  // 背の低い画面(スマホ横向きなど)は「詰め」表示: 余白を減らし、記録帳を1画面に収める
  const short = window.innerHeight < 560;
  const w = window.innerWidth - (short ? 16 : 32);
  const h = window.innerHeight - (short ? 8 : 16);
  const sideDock = short
    ? Math.round(Math.min(360, Math.max(280, w * 0.36)))
    : Math.round(Math.min(420, Math.max(320, w * 0.32)));
  const gap = short ? 8 : 10;
  const sideScale = Math.min((w - sideDock - gap) / 1280, h / 720);
  // 下置きは記録帳に最低 320px の高さを確保できるときだけ(技の一覧をスクロールなしで見せたい)
  const bottomScale = Math.min(w / 1280, (h - 320) / 720);
  const side = sideScale > bottomScale;
  const dockH = side ? h : h - Math.min(w * 9 / 16, 720 * bottomScale) - gap;
  const compact = short || dockH < 540;
  app.className = `${side ? 'layout-side' : 'layout-bottom'}${compact ? ' compact' : ''}${short ? ' short' : ''}`;
  // 横向きの詰め表示では、戦場の下の空きにメモ(ヒント)を出して記録帳を技の一覧に使う
  dock.setCompact(compact, short && side ? $('memo-out') : null);
  app.style.setProperty('--dock-w', `${sideDock}px`);
  app.style.setProperty('--stage-max-h', `${Math.max(140, Math.round(720 * Math.max(bottomScale, 0.2)))}px`);
  game?.scale.refresh();
}

/* ---------------- 全画面(対応ブラウザのみ。横向きに固定できれば固定する)---------------- */
const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape').catch(() => undefined);
  } catch { /* 全画面が許可されていない環境(埋め込み表示など)では何もしない */ }
}
document.addEventListener('fullscreenchange', () => setTimeout(layout, 100));
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 150));

/* ---------------- 戦闘の開始と終了 ---------------- */
const host: BattleHost = {
  settings, audio, dock, input, toast, tip,
  onEnd(r) {
    lastResult = r;
    if (r.outcome === 'win') cleared.add(r.encounterId);
    renderResult(r);
    show('result');
    audio.playBgm('title');
    audio.setIntensity(0);
  },
};
BattleScene.host = host;

async function startBattle(id: string): Promise<void> {
  current = id;
  dock.clearMemo();
  await audio.unlock();
  show(null);
  layout();
  const data = { encounterId: id, seed: (Date.now() & 0x7fffffff) || 1 };
  if (!game) {
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'stage',
      width: 1280,
      height: 720,
      backgroundColor: '#0b171b',
      banner: false,
      audio: { noAudio: true },
      input: { gamepad: false },
      render: { antialias: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    });
    game.scene.add('battle', BattleScene, true, data);
  } else {
    game.scene.stop('battle');
    game.scene.start('battle', data);
  }
  if (window.matchMedia('(pointer: coarse)').matches && window.innerHeight > window.innerWidth) {
    tip('rotate', 'スマホは<b>横向き</b>にすると戦場が大きく表示されます(縦向きのままでも遊べます)。');
  }
}

/* ---------------- タイトル ---------------- */
function drawEmblem(): void {
  const cv = $<HTMLCanvasElement>('title-emblem');
  const g = cv.getContext('2d');
  if (!g) return;
  const S = cv.width;
  const cx = S / 2, cy = S / 2, R = S * 0.36;
  g.clearRect(0, 0, S, S);
  // 属性の巡り(火→森→雷→潮)を環として描く = このゲームの基本ルール
  const els: [string, string][] = [['#ff7a3d', '火'], ['#6cc24a', '森'], ['#b98cff', '雷'], ['#35c3dc', '潮']];
  els.forEach(([c, k], i) => {
    const a0 = -Math.PI / 2 + (i * Math.PI) / 2 + 0.14;
    const a1 = a0 + Math.PI / 2 - 0.28;
    g.strokeStyle = c; g.lineWidth = S * 0.075; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    const ax = cx + Math.cos(a1) * R, ay = cy + Math.sin(a1) * R;
    g.fillStyle = c; g.beginPath();
    g.moveTo(ax + Math.cos(a1 + Math.PI / 2) * S * 0.07, ay + Math.sin(a1 + Math.PI / 2) * S * 0.07);
    g.lineTo(ax + Math.cos(a1) * S * 0.06, ay + Math.sin(a1) * S * 0.06);
    g.lineTo(ax - Math.cos(a1) * S * 0.06, ay - Math.sin(a1) * S * 0.06);
    g.fill();
    const mid = (a0 + a1) / 2;
    g.fillStyle = '#e6f2ef'; g.font = `800 ${S * 0.1}px ${getComputedStyle(document.body).fontFamily}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(k, cx + Math.cos(mid) * R * 0.62, cy + Math.sin(mid) * R * 0.62);
  });
  const grd = g.createRadialGradient(cx, cy, 2, cx, cy, S * 0.14);
  grd.addColorStop(0, 'rgba(62,224,200,0.9)'); grd.addColorStop(1, 'rgba(62,224,200,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, S * 0.14, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3ee0c8'; g.lineWidth = S * 0.03; g.beginPath(); g.arc(cx, cy, S * 0.075, 0, Math.PI * 2); g.stroke();
}

const STARS: Record<string, string> = { wild: '★☆☆', ashstar: '★★☆', guardian: '★★★' };
function renderTitle(): void {
  const list = $('enc-list');
  list.innerHTML = ENCOUNTER_ORDER.map((id, i) => {
    const e = ENCOUNTERS[id];
    return `<button class="enc" type="button" data-enc="${id}">
      <span class="no">第${i + 1}戦 ・ 難しさ <span class="stars">${STARS[id] ?? ''}</span></span>
      <span class="t">${e.name}</span>
      <span class="s">${e.subtitle}</span>
      <span class="o">目的: ${e.objective}</span>
      ${cleared.has(id) ? '<span class="done">✓ 突破済み</span>' : ''}
    </button>`;
  }).join('');
}
$('enc-list').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-enc]');
  if (b?.dataset.enc) void startBattle(b.dataset.enc);
});
$('btn-help').addEventListener('click', () => openOverlay('help'));
// 設定 → 遊び方(詰め表示では記録帳の「?」を省くので、ここから開ける)。閉じると設定を開く前の画面に戻る
$('btn-settings-help').addEventListener('click', () => { const back = returnTo; show('help'); returnTo = back; });
$('btn-settings').addEventListener('click', () => openOverlay('settings'));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlay));
dock.onOpenHelp = () => openOverlay('help');
dock.onOpenSettings = () => openOverlay('settings');
dock.canFullscreen = canFullscreen;
dock.onToggleFullscreen = () => { void toggleFullscreen(); };
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-fullscreen]')) {
  b.hidden = !canFullscreen;
  b.addEventListener('click', () => { void toggleFullscreen(); });
}

/* ---------------- 結果 ---------------- */
function renderResult(r: BattleResult): void {
  const e = ENCOUNTERS[r.encounterId];
  const win = r.outcome === 'win';
  const s = r.stats;
  $('result-sub').textContent = `${e.name} ・ ${e.subtitle}`;
  $('result-h').textContent = !win ? '敗北' : r.encounterId === 'guardian' ? '試練 達成' : '勝利';
  $('result-lead').textContent = !win
    ? '予告をよく見て、危ない攻撃は「かばう」や防御タイミングで。弱点は「記録する」で先に調べられます。'
    : s.pacified > 0
      ? `${s.pacified}体の心を鎮めた。力で従わせない巡環士の戦い方だ。`
      : '勝利。次はブレイクした相手を「鎮める」戦い方も試してみよう。';
  const items: [string, string | number][] = [
    ['手数', s.actions], ['Perfect', s.perfects], ['パリィ', s.parries], ['ブレイク', s.breaks],
    ['鎮めた', s.pacified], ['倒した', s.defeated], ['最大ダメージ', s.maxHit], ['共鳴技', s.resonances], ['倒れた仲間', s.allyKOs],
  ];
  $('result-stats').innerHTML = items.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const idx = ENCOUNTER_ORDER.indexOf(r.encounterId);
  const next = ENCOUNTER_ORDER[idx + 1];
  const nb = $<HTMLButtonElement>('btn-next');
  nb.hidden = !win || !next;
  nb.textContent = next ? `次の戦いへ: ${ENCOUNTERS[next].name}` : '次の戦いへ';
}
$('btn-next').addEventListener('click', () => {
  const idx = ENCOUNTER_ORDER.indexOf(current);
  const next = ENCOUNTER_ORDER[idx + 1];
  if (next) void startBattle(next);
});
$('btn-retry').addEventListener('click', () => void startBattle(current));
$('btn-title').addEventListener('click', () => { renderTitle(); show('title'); });

/* ---------------- 設定 ---------------- */
function renderSettings(): void {
  $('opt-timing').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === settings.timing)));
  $('opt-speed').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === settings.speed)));
  $<HTMLInputElement>('opt-volume').value = String(settings.volume);
  $('opt-mute').querySelector('button')?.setAttribute('aria-pressed', String(settings.muted));
}
$('opt-timing').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.v;
  if (v === 'manual' || v === 'auto') { settings.timing = v; saveSettings(settings); renderSettings(); }
});
$('opt-speed').addEventListener('click', (e) => {
  const v = Number((e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.v);
  if (v === 1 || v === 1.5 || v === 2) { settings.speed = v; saveSettings(settings); renderSettings(); }
});
$<HTMLInputElement>('opt-volume').addEventListener('input', (e) => {
  settings.volume = Number((e.target as HTMLInputElement).value);
  audio.setVolume(settings.volume);
  saveSettings(settings);
});
$('opt-mute').addEventListener('click', () => {
  settings.muted = !settings.muted;
  audio.setMuted(settings.muted);
  saveSettings(settings);
  renderSettings();
});

/* ---------------- 起動 ---------------- */
drawEmblem();
renderTitle();
renderSettings();
layout();
show('title');
// タイトル曲は最初の操作で鳴らす(ブラウザは操作前の再生を許さない)
window.addEventListener('pointerdown', () => { void audio.unlock().then(() => audio.playBgm(game ? 'title' : 'title')); }, { once: true });
window.addEventListener('keydown', () => { void audio.unlock().then(() => audio.playBgm('title')); }, { once: true });

/* ---------------- 自動テスト用のフック ---------------- */
declare global {
  interface Window { __hekikan?: unknown }
}
window.__hekikan = {
  start: (id: string) => startBattle(id),
  setAuto: (v: boolean) => { dock.auto = v; },
  setTiming: (v: 'manual' | 'auto') => { settings.timing = v; },
  setSpeed: (v: 1 | 1.5 | 2) => { settings.speed = v; },
  result: () => lastResult,
  screen: () => screens.find((s) => !$(`screen-${s}`).hidden) ?? 'battle',
  timing: () => BattleScene.timingActive,
  fps: () => game?.loop.actualFps ?? 0,
};
