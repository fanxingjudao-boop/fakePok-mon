/* ============================================================
 * E2E(実ブラウザ): ビルド済み dist/index.html を開いて検証する
 *   1. タイトル表示・JSエラーなし
 *   2. 手動操作: 技を選ぶ → 対象を選ぶ → タイミング入力 → 手番が進む
 *   3. 3つの戦闘を「おまかせ」で最後まで遊び、結果画面に到達する
 *   4. スマホ縦/横・PCで操作ボタンが 44px 以上、横スクロールなし
 * 実行: npm run build && PW_CHROMIUM=/path/to/chrome npm run e2e
 *   スクリーンショットは SHOTS(既定: test-results/)に保存
 * ============================================================ */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'file://' + path.join(here, '..', 'dist', 'index.html');
const shots = process.env.SHOTS || path.join(here, '..', 'test-results');
fs.mkdirSync(shots, { recursive: true });
const exe = process.env.PW_CHROMIUM || undefined;

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
});
let failures = 0;
const check = (name, fn) => fn().then(() => console.log(`✓ ${name}`)).catch((e) => { failures++; console.log(`✗ ${name}\n   ${e.message}`); });

async function openPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FILE_NOT_FOUND|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('#screen-title:not([hidden])');
  return { page, errors };
}

await check('タイトル画面が表示され、JSエラーがない', async () => {
  const { page, errors } = await openPage(1280, 800);
  assert.equal(await page.locator('.enc').count(), 3);
  await page.screenshot({ path: path.join(shots, 'title.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

await check('手動操作: 技 → 対象 → タイミング入力で手番が進む', async () => {
  const { page, errors } = await openPage(1280, 800);
  await page.evaluate(() => { window.__hekikan.setSpeed(1); });
  await page.click('.enc[data-enc="wild"]');
  // 味方の番が来るまで待つ(敵が先に動く場合もある: 防御リングは Space で押す)
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await page.locator('.panel .cmd[data-skill]:not([disabled])').count()) break;
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
  }
  const skillBtn = page.locator('.panel .cmd[data-skill]:not([disabled])').first();
  await skillBtn.hover();
  await page.screenshot({ path: path.join(shots, 'choose.png') });
  const before = await page.locator('.log').textContent();
  await skillBtn.click();
  const target = page.locator('.panel .cmd[data-target]:not([disabled])').first();
  if (await target.count()) {
    await page.screenshot({ path: path.join(shots, 'target.png') });
    await target.click();
  }
  // タイミングリング: 出たことを確認し、表示中にスクショしてから押す
  await page.waitForFunction(() => window.__hekikan.timing() === true, null, { timeout: 5000, polling: 20 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(shots, 'timing.png') });
  await page.keyboard.press('Space');
  console.log(`   描画 ${Math.round(await page.evaluate(() => window.__hekikan.fps()))} fps(ヘッドレス)`);
  await page.waitForTimeout(1500);
  const after = await page.locator('.log').textContent();
  assert.notEqual(after, before, '実況(ログ)が更新されない');
  await page.screenshot({ path: path.join(shots, 'after-action.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

for (const enc of ['wild', 'ashstar', 'guardian']) {
  await check(`おまかせで最後まで: ${enc}`, async () => {
    const { page, errors } = await openPage(1280, 800);
    await page.evaluate(() => { window.__hekikan.setAuto(true); window.__hekikan.setSpeed(2); window.__hekikan.setTiming('auto'); });
    await page.click(`.enc[data-enc="${enc}"]`);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(shots, `battle-${enc}.png`) });
    await page.waitForFunction(() => window.__hekikan.screen() === 'result', null, { timeout: 240000, polling: 500 });
    const r = await page.evaluate(() => window.__hekikan.result());
    assert.ok(r && (r.outcome === 'win' || r.outcome === 'lose'));
    console.log(`   結果: ${r.outcome} / 手数 ${r.stats.actions} / ブレイク ${r.stats.breaks} / 鎮め ${r.stats.pacified}`);
    await page.screenshot({ path: path.join(shots, `result-${enc}.png`) });
    assert.deepEqual(errors, []);
    await page.close();
  });
}

for (const [name, w, h] of [['phone-portrait', 390, 844], ['phone-landscape', 844, 390], ['desktop', 1280, 800], ['panel', 700, 900], ['small-landscape', 667, 375]]) {
  await check(`レイアウト ${name}: ボタン44px以上・横スクロールなし`, async () => {
    const { page, errors } = await openPage(w, h);
    await page.evaluate(() => { window.__hekikan.setSpeed(2); });
    await page.click('.enc[data-enc="wild"]');
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await page.locator('.panel .cmd[data-skill]').count()) break;
      await page.keyboard.press('Space');
      await page.waitForTimeout(250);
    }
    const m = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('#dock button'));
      const small = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && (r.width < 44 || r.height < 44)).length;
      const canvas = document.querySelector('#stage canvas')?.getBoundingClientRect();
      // スクロールせずに全体が見えている技ボタンの数
      const dock = document.getElementById('dock').getBoundingClientRect();
      const visible = Array.from(document.querySelectorAll('.panel .cmd')).map((e) => e.getBoundingClientRect())
        .filter((r) => r.top >= dock.top && r.bottom <= dock.bottom).length;
      return { count: els.length, small, visible, overflow: document.documentElement.scrollWidth > window.innerWidth + 1, canvasW: canvas?.width ?? 0, layout: document.getElementById('app').className };
    });
    await page.screenshot({ path: path.join(shots, `layout-${name}.png`) });
    console.log(`   ${m.layout} / canvas幅 ${Math.round(m.canvasW)}px / ボタン ${m.count}個 / スクロールなしで見える技 ${m.visible}個`);
    assert.ok(m.visible >= 3, 'スクロールしないと技が3つも見えない');
    assert.equal(m.small, 0, '44px未満のボタンがある');
    assert.equal(m.overflow, false, '横スクロールが出る');
    assert.ok(m.canvasW > 200, '戦場が小さすぎる');
    assert.deepEqual(errors, []);
    await page.close();
  });
}

await browser.close();
if (failures) { console.log(`\n${failures} 件 失敗`); process.exit(1); }
console.log('\nE2E: すべて通過');
