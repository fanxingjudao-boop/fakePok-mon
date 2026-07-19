/* ============================================================
 * ui-tap-targets.mjs — スマホUIの実ブラウザ検証(Playwright)
 *   静的検査(ui-tap-targets.cjs)を補完し、実際の計算後サイズ・
 *   重なり・横スクロール・iPhone横画面までを自動検証する。
 *   依頼書 UI要件: 操作ボタンの最小タップ領域 44px 以上。
 *
 * 前提: playwright と Chromium。実行:
 *   PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *   node tests/ui-tap-targets.mjs [file:///abs/path/index.html]
 *   (URL 省略時は リポジトリの index.html を file:// で開く)
 * ============================================================ */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const exe = process.env.PW_CHROMIUM || undefined; // 省略時は playwright 既定
const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || 'file://' + path.join(here, '..', 'index.html');

const MIN = 44;
const SELECTORS = ['.pad-btn.up', '.pad-btn.down', '.pad-btn.left', '.pad-btn.right',
  '.ab-btn.a', '.ab-btn.b', '[data-key=start]', '#mute-btn'];
const VIEWPORTS = [
  { name: 'iPhoneSE-portrait', w: 375, h: 667 },
  { name: 'small-320', w: 320, h: 640 },
  { name: 'pixel-portrait', w: 393, h: 851 },
  { name: 'iPhone-landscape', w: 844, h: 390 },
  { name: 'desktop', w: 1280, h: 800 },
];

const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const b = await chromium.launch(exe ? { executablePath: exe } : {});
let failures = 0;
for (const v of VIEWPORTS) {
  const p = await b.newPage();
  await p.setViewportSize({ width: v.w, height: v.h });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(target);
  await p.waitForTimeout(700);
  const r = await p.evaluate((sels) => {
    const rects = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) { rects[s] = null; continue; }
      const rc = el.getBoundingClientRect();
      rects[s] = { x: rc.x, y: rc.y, w: rc.width, h: rc.height };
    }
    return {
      rects,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      vw: window.innerWidth, vh: window.innerHeight,
    };
  }, SELECTORS);

  const problems = [];
  // 1) 計算後サイズが 44px 以上
  for (const s of SELECTORS) {
    const rc = r.rects[s];
    if (!rc) { problems.push(`${s} が見つからない`); continue; }
    const side = Math.min(Math.round(rc.w), Math.round(rc.h));
    if (side < MIN) problems.push(`${s} が ${side}px (<${MIN})`);
  }
  // 2) 横スクロールが出ない
  if (r.overflowX) problems.push('横スクロールが発生');
  // 3) ボタン同士が重ならない
  const list = SELECTORS.map((s) => r.rects[s]).filter(Boolean);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (overlaps(list[i], list[j])) problems.push(`ボタンが重なる (${SELECTORS[i]} x ${SELECTORS[j]})`);
  // 4) JSエラーが無い
  if (errs.length) problems.push('JSエラー: ' + errs.join(' / '));

  const minSide = Math.min(...list.map((rc) => Math.min(Math.round(rc.w), Math.round(rc.h))));
  if (problems.length) { failures++; console.log(`✗ [${v.name} ${v.w}x${v.h}] minSide=${minSide}\n   - ${problems.join('\n   - ')}`); }
  else console.log(`✓ [${v.name} ${v.w}x${v.h}] minSide=${minSide}px 重なり無し 横スクロール無し JSエラー無し`);
  await p.close();
}
await b.close();

assert.equal(failures, 0, `${failures} 個のビューポートで タップ領域/重なり/オーバーフローの問題`);
console.log('\nスマホUIタップ領域(実ブラウザ・44px/重なり/横画面)検証: すべて通過');
