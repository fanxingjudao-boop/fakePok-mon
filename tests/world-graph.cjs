/* ============================================================
 * world-graph.cjs — 世界グラフ/ストーリー設計の検証(Node)
 *   - 起点からは 碧樹圏 / 潮環圏 のみ開放(順不同)
 *   - 環核2つで 中央遺構・火脈圏・雷霧圏 が開放
 *   - 環核4つ未満では 碧環中枢へ入れない(早期侵入防止)
 *   - 環核4つ + renResolved で 碧環中枢 開放
 *   - フィールド能力がタイプで判定される(種族非依存・複数解決)
 *   - 3方針エンディングが行動履歴から導出される
 *   - REGION_EDGES の接続先が REGIONS に存在する
 * 実行: node tests/world-graph.cjs
 * ============================================================ */
const assert = require('node:assert/strict');
global.window = {};
require('../data.js');
const GD = global.window.window ? global.window.window.GameData : global.window.GameData;
const S = require('../story.js');

const St = (flags = {}, party = []) => ({ ...S.initialStoryState(), flags, party });
const cores = (...names) => Object.fromEntries(names.map((n) => [n, true]));

/* 1. 起点開放 */
{
  const st = St({ starter: true });
  const avail = S.availableRegions(st).sort();
  assert.deepEqual(avail.sort(), ['forest', 'kodachi', 'tide'].sort(), '起点では碧樹/潮環/拠点のみ');
  assert.equal(S.regionUnlocked('ruins', st).ok, false, '中央遺構は環核不足で閉');
  assert.equal(S.regionUnlocked('nexus', st).ok, false, '中枢は閉');
  console.log('1. 起点開放:', avail.join(','), 'OK');
}

/* 2. 順不同(潮環を先に取っても碧樹を先に取っても2環核で遺構が開く) */
for (const order of [['coreForest', 'coreTide'], ['coreTide', 'coreForest']]) {
  const st = St({ starter: true, ...cores(...order) });
  assert.equal(S.regionUnlocked('ruins', st).ok, true, `2環核(${order})で遺構開放`);
  assert.equal(S.regionUnlocked('flare', st).ok, true, '火脈開放');
  assert.equal(S.regionUnlocked('storm', st).ok, true, '雷霧開放');
  assert.equal(S.regionUnlocked('nexus', st).ok, false, 'まだ中枢は閉(早期侵入防止)');
}
console.log('2. 順不同2環核→遺構/火脈/雷霧 開放・中枢は閉 OK');

/* 3. 早期侵入防止: 3環核でも中枢は閉 */
{
  const st = St({ starter: true, ...cores('coreForest', 'coreTide', 'coreFlare') });
  assert.equal(S.regionUnlocked('nexus', st).ok, false, '3環核では中枢に入れない');
  // renResolvedがあっても環核4未満なら不可
  const st2 = St({ starter: true, renResolved: true, ...cores('coreForest', 'coreTide', 'coreFlare') });
  assert.equal(S.regionUnlocked('nexus', st2).ok, false, '対話済でも環核不足なら不可');
  console.log('3. 早期侵入防止 OK');
}

/* 4. 中枢開放: 4環核 + renResolved */
{
  const st = St({ starter: true, renResolved: true, ...cores('coreForest', 'coreTide', 'coreFlare', 'coreStorm') });
  assert.equal(S.regionUnlocked('nexus', st).ok, true, '4環核+対話で中枢開放');
  // renResolvedが無いと不可(必要ストーリーフラグ)
  const st2 = St({ starter: true, ...cores('coreForest', 'coreTide', 'coreFlare', 'coreStorm') });
  assert.equal(S.regionUnlocked('nexus', st2).ok, false, '対話未了なら中枢は閉');
  console.log('4. 中枢開放(4環核+対話) OK');
}

/* 5. 進行度スケーリング(順序が変わっても難度が保たれる) */
{
  const early = S.scaledLevel('flare', St({ ...cores('coreForest', 'coreTide') }));
  const late = S.scaledLevel('flare', St({ ...cores('coreForest', 'coreTide', 'coreStorm') }));
  assert.ok(late[0] > early[0], '環核が多い状態で挑むほど敵Lvが上がる');
  console.log('5. スケーリング flare:', early, '→', late, 'OK');
}

/* 6. フィールド能力はタイプで判定(種族非依存・複数解決) */
{
  const fireMon = [{ spId: 4 }];   // ヒバニャ=ほのお
  const waterMon = [{ spId: 7 }];  // ミズモグ=みず
  const rockMon = [{ spId: 18 }];  // イワコロ=いわ
  const fireAb = GD.abilitiesOfParty(fireMon);
  assert.ok(fireAb.has('clearLog'), 'ほのお→倒木処理');
  // 火脈の岩ゲートは「岩 または 水」で解決できる(複数手段)
  const rockGate = { anyAbilities: ['breakRock'] };
  assert.equal(GD.meetsRequirements(rockGate, { party: rockMon }).ok, true, '岩タイプで岩ゲート通過');
  assert.equal(GD.meetsRequirements(rockGate, { party: waterMon }).ok, true, '水タイプでも岩ゲート通過(冷却)');
  assert.equal(GD.meetsRequirements(rockGate, { party: fireMon }).ok, false, 'ほのおでは岩ゲート不可');
  console.log('6. タイプ由来能力/複数解決 OK  (ほのお能力:', [...fireAb].join(','), ')');
}

/* 7. エンディング分岐 */
{
  const mk = (r, n, sh) => ({ scores: { restore: r, nature: n, share: sh } });
  assert.equal(S.resolveEnding(mk(5, 1, 1)).id, 'restore', '復旧優勢→完全復旧');
  assert.equal(S.resolveEnding(mk(1, 5, 1)).id, 'nature', '循環優勢→自然循環');
  assert.equal(S.resolveEnding(mk(3, 3, 0)).id, 'share', '拮抗→分散管理');
  assert.equal(S.resolveEnding(mk(0, 0, 4)).id, 'share', '分散優勢→分散管理');
  console.log('7. 分岐エンディング OK');
}

/* 8. グラフ整合性 */
{
  for (const [a, b] of S.REGION_EDGES) {
    assert.ok(S.REGIONS[a], `edge始点が存在: ${a}`);
    assert.ok(S.REGIONS[b], `edge終点が存在: ${b}`);
  }
  // 全地域が拠点から(ゲート無視で)到達可能
  const adj = {}; Object.keys(S.REGIONS).forEach((k) => (adj[k] = []));
  S.REGION_EDGES.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
  const seen = new Set(['kodachi']); const q = ['kodachi'];
  while (q.length) { const n = q.shift(); for (const m of adj[n]) if (!seen.has(m)) { seen.add(m); q.push(m); } }
  assert.equal(seen.size, Object.keys(S.REGIONS).length, '全地域が拠点から到達可能');
  console.log('8. グラフ整合性/到達性 OK');
}

console.log('\n世界グラフ検証: すべて通過');
