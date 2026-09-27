/* ============================================================
 * E2E(実ブラウザ): 第1章を頭から終わりまで通す
 *   はじめから → 序章の会話 → 村を歩く → 獣道で野生と戦う → 灰星局の装置戦 → 選択
 *   → 守護獣の試練 → 村へ戻ってエピローグ → 章のまとめ → つづきから
 *   道中の移動は自動テスト用のフック(__hekikan.warp / knot)で短縮し、
 *   物語・戦闘・選択・セーブは本物を通す。
 * 実行: npm run build && PW_CHROMIUM=/path/to/chrome node tests/e2e-field.mjs
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

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
});
let failures = 0;
const check = (name, fn) => fn().then(() => console.log(`✓ ${name}`)).catch((e) => { failures++; console.log(`✗ ${name}\n   ${e.stack?.split('\n').slice(0, 3).join('\n   ')}`); });

const H = (page, fn, ...args) => page.evaluate(({ fn, args }) => window.__hekikan[fn](...args), { fn, args });

/** 会話を最後まで送る(選択肢は pick 番目を選ぶ)。戦闘が挟まれば、戦闘が終わるまで待つ */
async function talkThrough(page, { pick = 0, max = 600, shot } = {}) {
  let shotTaken = !shot;
  for (let i = 0; i < max; i++) {
    const mode = await H(page, 'mode');
    if (mode === 'battle') { await page.waitForTimeout(400); continue; }
    const chapter = await page.locator('#screen-chapter:not([hidden])').count();
    if (chapter) return 'chapter';
    const open = await H(page, 'talkOpen');
    if (!open) {
      const f = await H(page, 'field');
      if (f && !f.busy) return 'done';
      await page.waitForTimeout(150);
      continue;
    }
    if (!shotTaken) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, shot) }); shotTaken = true; }
    // 送りはキーボード(クリックは描画の安定待ちで遅い)。選択肢は数字キー
    const n = await page.locator('.talk-choice').count();
    if (n) { await page.keyboard.press(String(Math.min(pick, n - 1) + 1)); await page.waitForTimeout(60); continue; }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(25);
  }
  throw new Error('会話が終わらない');
}

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FILE_NOT_FOUND|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('#screen-title:not([hidden])');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('hekikan_v2_settings', JSON.stringify({ timing: 'auto', textSpeed: 'instant', speed: 2, volume: 0.7, muted: true, seenTips: [] }));
  });
  await page.reload();
  await page.waitForSelector('#screen-title:not([hidden])');
  await H(page, 'setAuto', true);
  return { page, errors };
}

await check('第1章を最後まで通す(PC 1280×720)', async () => {
  const { page, errors } = await open(1280, 720);
  await page.screenshot({ path: path.join(shots, 'f-title.png') });
  await page.click('#btn-new');
  await page.waitForFunction(() => window.__hekikan.talkOpen());
  assert.equal(await talkThrough(page, { shot: 'f-prologue.png' }), 'done');
  const obj = await H(page, 'getVar', 'objective');
  assert.ok(obj && obj.length > 0, '目的が設定されていない');
  assert.ok((await page.locator('#hud-obj').textContent()).includes(obj));
  await page.screenshot({ path: path.join(shots, 'f-village.png') });

  // 歩く(右へ1秒)
  const before = await H(page, 'field');
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(500); await page.keyboard.up('ArrowDown');
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(900); await page.keyboard.up('ArrowRight');
  const after = await H(page, 'field');
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 1.5, `歩けていない ${JSON.stringify([before, after])}`);

  // カエデ博士・村人と話す
  await H(page, 'knot', 'kaede'); await talkThrough(page);
  await H(page, 'knot', 'villager_c'); await talkThrough(page, { shot: 'f-villager.png' });

  // 獣道: 入った時の物語 → 見えている野生と戦う
  await H(page, 'warp', 'trail', 'west');
  await page.waitForTimeout(700);
  await talkThrough(page);
  await page.screenshot({ path: path.join(shots, 'f-trail.png') });
  const t = await H(page, 'field');
  assert.ok(t.wild >= 3, `野生が見えていない: ${t.wild}`);
  const exp0 = (await H(page, 'state')).party.exp;
  await H(page, 'encounter');
  await page.waitForFunction(() => window.__hekikan.mode() === 'battle', null, { timeout: 5000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, 'f-battle.png') });
  await page.waitForFunction(() => window.__hekikan.mode() === 'field', null, { timeout: 120000 });
  await page.waitForTimeout(600);
  const st = await H(page, 'state');
  assert.ok(st.party.exp > exp0, '経験値が入っていない');
  assert.ok(Object.keys(st.records).length > 0, '記録帳に載っていない');

  // レンと出会う
  await H(page, 'knot', 'trail_ren'); await talkThrough(page, { shot: 'f-ren.png' });
  assert.equal(await H(page, 'getVar', 'met_ren'), true);

  // メニュー
  await page.keyboard.press('x');
  await page.waitForSelector('#screen-menu:not([hidden])');
  await page.screenshot({ path: path.join(shots, 'f-menu.png') });
  await page.click('#menu-close');

  // 旧街道: 灰星局の装置戦 → 選択(話を聞く)
  await H(page, 'warp', 'road', 'north');
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__hekikan.state().party.level = 6; });
  await H(page, 'knot', 'road_ashstar');
  await talkThrough(page, { pick: 0, max: 1500 });
  assert.equal(await H(page, 'getVar', 'device_stopped'), true, '装置が止まっていない');
  assert.ok(await H(page, 'getVar', 'ashstar_choice'));

  // 湿地 → 森殿: 守護獣の試練
  await H(page, 'warp', 'marsh', 'west');
  await page.waitForTimeout(600);
  await talkThrough(page);
  await page.screenshot({ path: path.join(shots, 'f-marsh.png') });
  await H(page, 'warp', 'shrine', 'entrance');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shots, 'f-shrine.png') });
  await page.evaluate(() => { window.__hekikan.state().party.level = 12; });
  let tries = 0;
  while (!(await H(page, 'getVar', 'shrine_done')) && tries++ < 4) {
    await H(page, 'knot', 'shrine_enter');
    await talkThrough(page, { pick: 0, max: 2500 });
  }
  assert.equal(await H(page, 'getVar', 'shrine_done'), true, '守護獣の試練を越えられない');

  // 村へ戻るとエピローグ → 章のまとめ
  await H(page, 'warp', 'hanazono', 'east_gate');
  await page.waitForTimeout(600);
  const end = await talkThrough(page, { max: 1500 });
  assert.equal(end, 'chapter', 'エピローグから章のまとめへ進まない');
  await page.screenshot({ path: path.join(shots, 'f-chapter.png') });
  await page.click('#chapter-continue');
  await talkThrough(page);
  assert.equal(await H(page, 'getVar', 'chapter_done'), true);

  // セーブ → つづきから
  await page.keyboard.press('x');
  await page.waitForSelector('#screen-menu:not([hidden])');
  await page.click('#menu-title');
  await page.waitForSelector('#btn-continue:not([hidden])');
  await page.click('#btn-continue');
  await page.waitForFunction(() => window.__hekikan.field() !== null);
  assert.equal(await H(page, 'getVar', 'chapter_done'), true, 'つづきから で物語の状態が戻らない');
  assert.deepEqual(errors, []);
  await page.close();
});

for (const [name, w, h] of [['phone-landscape', 844, 390], ['phone-portrait', 390, 844]]) {
  await check(`スマホ ${name}: 会話が読め、フィールドのボタンが押せる`, async () => {
    const { page, errors } = await open(w, h);
    await page.click('#btn-new');
    await page.waitForFunction(() => window.__hekikan.talkOpen());
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, `f-${name}-talk.png`) });
    const fs = await page.locator('.talk-text').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(fs >= 15, `会話の文字が小さい: ${fs}px`);
    await talkThrough(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, `f-${name}-field.png`) });
    const m = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('#field-hud button')).filter((e) => getComputedStyle(e).display !== 'none');
      return { small: els.map((e) => e.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    assert.equal(m.small, 0);
    assert.equal(m.overflow, false);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

await browser.close();
console.log(failures ? `\n${failures} 件 失敗` : '\nE2E(フィールド): すべて通過');
process.exit(failures ? 1 : 0);
