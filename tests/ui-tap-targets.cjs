/* ============================================================
 * ui-tap-targets.cjs — スマホUIの静的検証(Node・ブラウザ不要)
 *   依頼書 UI要件: 固定520px画面の単純縮小に依存せず、
 *   操作ボタンの最小タップ領域を 44px 以上 確保する。
 *   - 操作パッド(#controls)が 縮小対象(#console)の外に置かれている
 *   - fitScale が 画面だけを縮小し、パッド高さを確保している
 *   - 各ボタンの CSS が 44px 以上の最小タップ領域を宣言している
 * 実行: node tests/ui-tap-targets.cjs
 * ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const gj = read('game.js');

/* 1. 操作パッドは #console(縮小対象)の外にある = スケールで潰れない */
{
  const consoleClose = html.indexOf('</div>', html.indexOf('id="cine"'));
  const controlsIdx = html.indexOf('id="controls"');
  const padsIdx = html.indexOf('id="pads"');
  assert.ok(controlsIdx > -1, '#controls コンテナが存在する');
  // #controls / #pads は #console を閉じた後に現れる(=スケール外)
  const consoleBlockEnd = html.indexOf('id="controls"');
  assert.ok(padsIdx > consoleBlockEnd - 1, '#pads は #controls 内(スケール外)にある');
  // 旧構造(#console 内に #pads を直接置く)に戻っていない
  const consoleOpen = html.indexOf('id="console"');
  const cineIdx = html.indexOf('id="cine"');
  assert.ok(controlsIdx > cineIdx, '#controls は 画面レイヤ(cine)より後 = #console の外');
  console.log('1. 操作パッドは画面スケールの外(#controls) OK');
}

/* 2. fitScale は 画面だけ縮小し、パッド高さを確保している */
{
  assert.ok(/getElementById\(['"]controls['"]\)|\$\(['"]controls['"]\)/.test(gj), 'fitScale が #controls を参照する');
  assert.ok(/offsetHeight/.test(gj.slice(gj.indexOf('function fitScale'))), 'fitScale が パッド高さ(offsetHeight)を確保');
  assert.ok(/marginBottom/.test(gj.slice(gj.indexOf('function fitScale'))), '縮小ぶんの余白を相殺(marginBottom)');
  console.log('2. fitScale は画面のみ縮小・パッド実寸を確保 OK');
}

/* 3. 各操作ボタンが 44px 以上の最小タップ領域を宣言している */
{
  // 指定セレクタのCSSブロックを取り出し、宣言値(px)を得る
  const block = (sel) => {
    const i = css.indexOf(sel);
    assert.ok(i > -1, `${sel} の定義がある`);
    return css.slice(i, css.indexOf('}', i));
  };
  const px = (b, prop) => {
    const m = b.match(new RegExp(`${prop}\\s*:\\s*(\\d+)px`));
    return m ? Number(m[1]) : null;
  };
  // 十字キー: グリッドセル46px + min 44px
  const dpad = block('#dpad');
  assert.ok(/repeat\(3,\s*46px\)/.test(dpad) || px(dpad, 'grid-template-columns') >= 44, '#dpad セルが44px以上');
  const pad = block('.pad-btn ');
  assert.ok(px(pad, 'min-width') >= 44 && px(pad, 'min-height') >= 44, '.pad-btn の最小タップ領域が44px以上');
  // A/Bボタン: 実寸 + min 44px
  const ab = block('.ab-btn ');
  assert.ok(px(ab, 'width') >= 44 && px(ab, 'height') >= 44, '.ab-btn が44px以上');
  assert.ok(px(ab, 'min-width') >= 44 && px(ab, 'min-height') >= 44, '.ab-btn の最小値が44px以上');
  // START/ミュート: 高さ min 44px
  const sys = block('.sys-btn ');
  assert.ok(px(sys, 'min-height') >= 44, '.sys-btn の最小高さが44px以上');
  console.log('3. 全操作ボタンが最小タップ領域44px以上を宣言 OK');
}

/* 4. せまい画面(<=400px)でも 44px を割らない指定になっている */
{
  const mq = css.slice(css.indexOf('@media (max-width: 400px)'));
  const seg = mq.slice(0, mq.indexOf('}\n}') + 2);
  // 縮んでも 44px(dpad) / 48px(ab) を維持
  assert.ok(/repeat\(3,\s*44px\)/.test(seg), 'せまい画面でも 十字キーは44px');
  const abm = seg.match(/\.ab-btn\s*\{[^}]*width:\s*(\d+)px/);
  assert.ok(abm && Number(abm[1]) >= 44, 'せまい画面でも A/Bは44px以上');
  console.log('4. せまい画面(<=400px)でも44pxを維持 OK');
}

console.log('\nスマホUIタップ領域(44px)検証: すべて通過');
