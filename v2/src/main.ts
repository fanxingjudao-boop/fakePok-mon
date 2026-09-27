/* ============================================================
 * 起動と画面遷移、レイアウト、設定
 *   タイトル → フィールド(物語・探索)⇄ 戦闘 / タイトル → 戦闘の練習 → 結果
 * ============================================================ */
import './ui/style.css';
import Phaser from 'phaser';
import { BattleScene, type BattleHost, type BattleResult } from './scenes/BattleScene.ts';
import { FieldScene, type FieldHost, type BattleOutcome } from './scenes/FieldScene.ts';
import { AudioEngine } from './audio/engine.ts';
import { Dock } from './ui/dock.ts';
import { Dialogue } from './ui/dialogue.ts';
import { InputHub } from './input.ts';
import { loadSettings, saveSettings } from './settings.ts';
import { ENCOUNTERS, ENCOUNTER_ORDER } from './data/encounters.ts';
import { StoryRunner } from './story/runner.ts';
import chapter1 from './story/chapter1.ink';
import { expForLevel, hasSave, loadGame, newGame, saveGame, type FieldItem, type GameState, type PartyId } from './world/logic.ts';
import { MAPS } from './world/maps.ts';
import { PEOPLE, SPEAKER_COLOR } from './data/people.ts';
import { ART } from './data/art.ts';
import { PARTY, unitDef } from './data/units.ts';
import { levelScale } from './core/rules.ts';
import { drawVillager } from './art/field.ts';

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
type Mode = 'title' | 'field' | 'battle';
let mode: Mode = 'title';
const inBattle = () => mode === 'battle' && screens.every((s) => $(`screen-${s}`).hidden);

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
type ScreenId = 'title' | 'result' | 'help' | 'settings' | 'menu' | 'chapter';
const screens: ScreenId[] = ['title', 'result', 'help', 'settings', 'menu', 'chapter'];
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
      else if (cmd === 'back' && id === 'menu') closeMenu();
    });
    (root.querySelector<HTMLElement>('.enc, .btn.primary, button') ?? root).focus({ preventScroll: true });
  }
}

/** 画面を重ねている間は、動いている場面(戦闘・フィールド)を止める */
function pauseScene(): void {
  const key = mode === 'battle' ? 'battle' : mode === 'field' ? 'field' : null;
  if (key && game?.scene.isActive(key)) game.scene.pause(key);
}
function resumeScene(): void {
  const key = mode === 'battle' ? 'battle' : mode === 'field' ? 'field' : null;
  if (key && game?.scene.isPaused(key)) game.scene.resume(key);
}
function openOverlay(id: 'help' | 'settings'): void {
  const visible = screens.find((s) => !$(`screen-${s}`).hidden) ?? null;
  returnTo = visible;
  if (!visible) pauseScene();
  show(id);
}
function closeOverlay(): void {
  const back = returnTo;
  returnTo = null;
  show(back);
  if (!back) resumeScene();
}

/* ---------------- レイアウト(戦場を最大にする配置を選ぶ)---------------- */
function layout(): void {
  const app = $('app');
  app.dataset.mode = mode;
  $('field-hud').hidden = mode !== 'field';
  if (mode === 'field') {
    // フィールドは戦場を画面いっぱいに(記録帳は出さない)
    app.className = `layout-field${window.innerHeight < 560 ? ' short' : ''}`;
    game?.scale.refresh();
    return;
  }
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
/** フィールドから始めた戦闘の戻り先(練習の戦闘では null) */
let battleReturn: ((r: BattleResult) => void) | null = null;

function ensureGame(): Phaser.Game {
  if (game) return game;
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
  game.scene.add('battle', BattleScene, false);
  game.scene.add('field', FieldScene, false);
  return game;
}

function setMode(m: Mode): void {
  mode = m;
  layout();
  // 配置が変わった直後は、描画が落ち着いてから大きさを測り直す(戦闘→フィールドで縮んだままになるのを防ぐ)
  requestAnimationFrame(() => { game?.scale.refresh(); setTimeout(() => game?.scale.refresh(), 120); });
}

const host: BattleHost = {
  settings, audio, dock, input, toast, tip,
  onEnd(r) {
    if (battleReturn) {
      const back = battleReturn;
      battleReturn = null;
      game?.scene.stop('battle');
      setMode('field');
      game?.scene.wake('field');
      back(r);
      return;
    }
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
  const g = ensureGame();
  g.scene.stop('field');
  setMode('battle');
  const data = { encounterId: id, seed: (Date.now() & 0x7fffffff) || 1 };
  g.scene.stop('battle');
  g.scene.start('battle', data);
  if (window.matchMedia('(pointer: coarse)').matches && window.innerHeight > window.innerWidth) {
    tip('rotate', 'スマホは<b>横向き</b>にすると戦場が大きく表示されます(縦向きのままでも遊べます)。');
  }
}

/* ---------------- 物語とフィールド ---------------- */
let gameState: GameState = newGame();
let story = new StoryRunner(chapter1);
const villagerPortraits = new Map<string, string>();
const PARTY_ART: Record<string, string> = { hinoko: 'fox', shizuku: 'otter', konoha: 'owl', moridorado: 'dragon' };

const dialogue = new Dialogue(input, {
  portrait(sp) {
    if (sp in PEOPLE) return PEOPLE[sp as keyof typeof PEOPLE];
    if (PARTY_ART[sp]) return ART[PARTY_ART[sp]]?.img ?? null;
    if (sp.startsWith('villager')) {
      let url = villagerPortraits.get(sp);
      if (!url) {
        try { url = drawVillager(sp as 'villager_a').canvas.toDataURL(); } catch { url = ''; }
        villagerPortraits.set(sp, url ?? '');
      }
      return url || null;
    }
    return null;
  },
  color: (sp) => SPEAKER_COLOR[sp] ?? '#e6f2ef',
  sfx: (id) => audio.sfx(id),
  speed: () => settings.textSpeed,
});

function saveNow(silent = false): void {
  gameState.story = story.save();
  const ok = saveGame(gameState);
  if (!silent) toast(ok ? '旅を記録しました' : 'この環境では保存できませんでした', ok ? 'info' : 'warn');
}

let chapterResolve: (() => void) | null = null;

const fieldHost: FieldHost = {
  settings, audio, input, dialogue,
  get state() { return gameState; },
  get story() { return story; },
  startBattle(encounterId, setup): Promise<BattleOutcome> {
    return new Promise((resolve) => {
      const g = ensureGame();
      battleReturn = (r) => resolve({ outcome: r.outcome, final: r.final });
      dock.clearMemo();
      g.scene.sleep('field');
      setMode('battle');
      g.scene.stop('battle');
      g.scene.start('battle', { encounterId, seed: (Date.now() & 0x7fffffff) || 1, setup });
    });
  },
  openMenu,
  toast: (t, k) => toast(t, k),
  tip,
  hud(mapName, objective) {
    $('hud-map').textContent = mapName;
    $('hud-obj').textContent = objective ? `目的: ${objective}` : '';
  },
  save: saveNow,
  chapterEnd(): Promise<void> {
    renderChapter();
    pauseScene();
    show('chapter');
    audio.jingle('chapter');
    return new Promise((resolve) => { chapterResolve = resolve; });
  },
  paused: () => screens.some((sc) => !$(`screen-${sc}`).hidden) || dialogue.isOpen,
};
FieldScene.host = fieldHost;

async function enterField(state: GameState, fresh: boolean): Promise<void> {
  await audio.unlock();
  gameState = state;
  story = new StoryRunner(chapter1, state.story);
  show(null);
  const g = ensureGame();
  g.scene.stop('battle');
  g.scene.stop('field');
  setMode('field');
  g.scene.start('field');
  if (fresh) {
    // 最初の物語(研究庵の朝)
    const wait = () => new Promise<void>((r) => setTimeout(r, 600));
    await wait();
    const f = g.scene.getScene('field') as FieldScene;
    await f.runKnot('prologue');
    tip('field-move', '<b>移動</b>: 矢印キー/WASD、スマホは画面をなぞる。<b>Shift</b> か大きくなぞるとダッシュ。<b>Z</b>/タップで話す・調べる、<b>X</b> でメニュー。');
  }
}

$('btn-new').addEventListener('click', () => {
  if (hasSave() && !window.confirm('セーブデータがあります。はじめから始めると上書きされます。よろしいですか?')) return;
  void enterField(newGame(), true);
});
$('btn-continue').addEventListener('click', () => {
  const s = loadGame();
  if (s) void enterField(s, false);
});
$('hud-menu').addEventListener('click', () => openMenu());
$('hud-act').addEventListener('click', () => {
  const f = game?.scene.getScene('field') as FieldScene | undefined;
  f?.pressAction();
});

/* ---------------- メニュー(巡環士の記録帳)---------------- */
const ITEM_INFO: Record<FieldItem, { name: string; desc: string }> = {
  potion: { name: '薬草膏', desc: '仲間1体のHPを半分回復' },
  revive: { name: '目覚めの実', desc: '倒れた仲間をHP4割で起こす' },
  herb: { name: '森の香草', desc: '仲間全員のHPを3割回復' },
};

function openMenu(): void {
  if (mode !== 'field' || dialogue.isOpen) return;
  pauseScene();
  renderMenu();
  audio.sfx('menu');
  show('menu');
}
function closeMenu(): void {
  show(null);
  resumeScene();
}

function renderMenu(): void {
  const s = gameState;
  const lv = s.party.level;
  const next = expForLevel(lv + 1);
  const cur = expForLevel(lv);
  $('menu-party').innerHTML = PARTY.map((id) => {
    const d = unitDef(id);
    const max = Math.round(d.hp * levelScale(lv));
    const hp = Math.round(max * s.party.hp[id]);
    const pct = Math.round(s.party.hp[id] * 100);
    const img = ART[PARTY_ART[id]]?.img;
    return `<div class="pm">
      ${img ? `<img src="${img}" alt="">` : ''}
      <div><b>${d.name}</b> <span class="lv">Lv${lv}</span>
        <div class="bar${pct <= 25 ? ' low' : ''}"><i style="width:${pct}%"></i></div>
        <span class="num">${hp}/${max}</span>${hp <= 0 ? ' <span class="ko">倒れている</span>' : ''}
        <div class="ab">${id === 'hinoko' ? '火: 倒木・いばらを焼く' : id === 'shizuku' ? '潮: 花粉を洗い流す' : '森: 蔓を伸ばす'}</div>
      </div></div>`;
  }).join('') + `<p class="exp">次のレベルまで ${Math.max(0, next - s.party.exp)} (経験値 ${s.party.exp - cur}/${next - cur})</p>`;
  $('menu-items').innerHTML = (Object.keys(ITEM_INFO) as FieldItem[]).map((it) => {
    const n = s.items[it];
    const targets = it === 'herb' ? `<button class="btn sm" data-use="herb" ${n ? '' : 'disabled'}>全員に使う</button>`
      : PARTY.map((id) => {
        const ok = n > 0 && (it === 'revive' ? s.party.hp[id] <= 0 : s.party.hp[id] > 0 && s.party.hp[id] < 1);
        return `<button class="btn sm" data-use="${it}" data-who="${id}" ${ok ? '' : 'disabled'}>${unitDef(id).name}</button>`;
      }).join('');
    return `<div class="it"><div><b>${ITEM_INFO[it].name}</b> ×${n}<div class="desc">${ITEM_INFO[it].desc}</div></div><div class="use">${targets}</div></div>`;
  }).join('');
  $('menu-obj').textContent = String(story.get('objective') ?? '') || '—';
  $('menu-notes').innerHTML = s.notes.length ? s.notes.map((n) => `<li>${escHtml(n)}</li>`).join('') : '<li class="empty">まだ何も書いていない</li>';
  const recs = Object.entries(s.records);
  $('menu-records').innerHTML = recs.length ? recs.map(([sp, r]) => {
    const d = unitDef(sp);
    const img = ART[d.art]?.img;
    return `<div class="rec">${img ? `<img src="${img}" alt="">` : ''}<b>${d.name}</b><span>出会った ${r.seen} ・ 鎮めた ${r.pacified} ・ 倒した ${r.defeated}</span></div>`;
  }).join('') : '<p class="empty">まだ誰にも出会っていない</p>';
  const m = MAPS[s.map];
  const t = Math.floor(s.playtime);
  $('menu-info').textContent = `${m.name} ・ 遊んだ時間 ${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

$('menu-items').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-use]');
  if (!b || b.disabled) return;
  const it = b.dataset.use as FieldItem;
  const s = gameState;
  if (s.items[it] <= 0) return;
  if (it === 'herb') for (const id of PARTY) { if (s.party.hp[id] > 0) s.party.hp[id] = Math.min(1, s.party.hp[id] + 0.3); }
  else {
    const who = b.dataset.who as PartyId;
    if (it === 'potion') s.party.hp[who] = Math.min(1, s.party.hp[who] + 0.5);
    else s.party.hp[who] = 0.4;
  }
  s.items[it]--;
  audio.sfx('heal');
  renderMenu();
});
$('menu-close').addEventListener('click', closeMenu);
$('menu-save').addEventListener('click', () => saveNow(false));
$('menu-settings').addEventListener('click', () => openOverlay('settings'));
$('menu-help').addEventListener('click', () => openOverlay('help'));
$('menu-title').addEventListener('click', () => {
  saveNow(true);
  game?.scene.stop('field');
  setMode('title');
  renderTitle();
  show('title');
  audio.playBgm('title');
});

/* ---------------- 章の終わり ---------------- */
function renderChapter(): void {
  const s = gameState;
  const rec = Object.values(s.records);
  const pac = rec.reduce((n, r) => n + r.pacified, 0);
  const def = rec.reduce((n, r) => n + r.defeated, 0);
  const t = Math.floor(s.playtime);
  $('chapter-lead').textContent = pac > def
    ? '力でねじ伏せず、森の声を聞いて進んだ。碧樹の環核は、ふたたび静かに脈打ちはじめた。'
    : '森殿の試練を越え、碧樹の環核はふたたび脈打ちはじめた。';
  const items: [string, string | number][] = [
    ['仲間のレベル', s.party.level], ['鎮めた', pac], ['倒した', def],
    ['遊んだ時間', `${Math.floor(t / 60)}分`], ['出会った種類', Object.keys(s.records).length],
  ];
  $('chapter-stats').innerHTML = items.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const ash = String(story.get('ashstar_choice') ?? '');
  const ren = String(story.get('ren_stance') ?? '');
  const ashText: Record<string, string> = {
    listen: '灰星局の作業員の話を聞き、野営地に残した', report: '森の記録を作業員に託し、本部へ届けさせた', leave: '灰星局の野営地を、何も言わずに立ち去った',
  };
  const renText: Record<string, string> = { trust: 'レンに、共に鎮めようと手を差し出した', oppose: 'レンのやり方に、はっきりと異を唱えた' };
  const lines = [ashText[ash], renText[ren]].filter(Boolean);
  $('chapter-choices').innerHTML = lines.length ? `<h3>あなたの選んだこと</h3><ul>${lines.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul><p class="note">この選択は、次の章で誰かが覚えています。</p>` : '';
}
$('chapter-continue').addEventListener('click', () => {
  show(null);
  resumeScene();
  audio.playBgm(MAPS[gameState.map].bgm as Parameters<typeof audio.playBgm>[0]);
  const r = chapterResolve;
  chapterResolve = null;
  r?.();
});
$('chapter-title').addEventListener('click', () => {
  const r = chapterResolve;
  chapterResolve = null;
  r?.();
  saveNow(true);
  game?.scene.stop('field');
  setMode('title');
  renderTitle();
  show('title');
  audio.playBgm('title');
});

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
  const saved = hasSave() ? loadGame() : null;
  $('btn-continue').hidden = !saved;
  const info = $('save-info');
  info.hidden = !saved;
  if (saved) {
    const d = new Date(saved.savedAt);
    info.textContent = `つづき: ${MAPS[saved.map].name} ・ 仲間 Lv${saved.party.level}${saved.savedAt ? ` ・ ${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : ''}`;
  }
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
$('btn-title').addEventListener('click', () => { game?.scene.stop('battle'); setMode('title'); renderTitle(); show('title'); });

/* ---------------- 設定 ---------------- */
function renderSettings(): void {
  $('opt-timing').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === settings.timing)));
  $('opt-speed').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === settings.speed)));
  $('opt-text').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === settings.textSpeed)));
  $<HTMLInputElement>('opt-volume').value = String(settings.volume);
  $('opt-mute').querySelector('button')?.setAttribute('aria-pressed', String(settings.muted));
}
$('opt-timing').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.v;
  if (v === 'manual' || v === 'auto') { settings.timing = v; saveSettings(settings); renderSettings(); }
});
$('opt-text').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.v;
  if (v === 'slow' || v === 'normal' || v === 'fast' || v === 'instant') { settings.textSpeed = v; saveSettings(settings); renderSettings(); }
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
  newGame: () => enterField(newGame(), false),
  field: () => (game?.scene.isActive('field') || game?.scene.isSleeping('field') ? (game.scene.getScene('field') as FieldScene).debugState() : null),
  warp: (m: string, p: string) => (game?.scene.getScene('field') as FieldScene | undefined)?.debugWarp(m as never, p),
  encounter: () => (game?.scene.getScene('field') as FieldScene | undefined)?.debugEncounter(),
  // 物語は会話を送るまで終わらないので、待たずに返す
  knot: (k: string) => { void (game?.scene.getScene('field') as FieldScene | undefined)?.runKnot(k); },
  talkOpen: () => dialogue.isOpen,
  setVar: (k: string, v: string | number | boolean) => story.set(k, v),
  getVar: (k: string) => story.get(k),
  state: () => gameState,
  mode: () => mode,
};
