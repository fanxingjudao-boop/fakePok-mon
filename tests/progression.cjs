/* ============================================================
 * progression.cjs — 進行フロー(データ層)の統合検証(Node)
 *   世界グラフ・地域ゲート・環核・能力ゲート・3エンディングが
 *   実データ(world-maps.js / story.js / data.js)で整合するか検証する。
 *   ブラウザ操作の headless 検証は tests/ の play スクリプトで別途実施。
 * 実行: node tests/progression.cjs
 * ============================================================ */
const assert = require('node:assert/strict');
global.window = {};
require('../world-maps.js');
require('../data.js');
const GD = global.window.GameData;
const S = require('../story.js');
const MAPS = GD.MAPS;

const party = (spId) => [{ spId }];
const St = (flags = {}, pty = []) => ({ ...S.initialStoryState(), flags, party: pty });

/* 1. 新ワールドが採用されている(旧8都市が無い) */
assert.ok(MAPS.kodachi && MAPS.forest && MAPS.tide && MAPS.ruins && MAPS.flare && MAPS.storm && MAPS.nexus, '新地域マップが存在');
assert.ok(!MAPS.minamo && !MAPS.hometown, '旧都市マップは撤去済み');
console.log('1. 新ワールド採用 OK');

/* 2. 起点ゲート: スターター前は地域へ出られない / 後は出られる */
{
  const forestReq = MAPS.kodachi.edgeExits.left.req;
  assert.equal(GD.meetsRequirements(forestReq, St({})).ok, false, 'starter前は碧樹圏へ出られない');
  assert.equal(GD.meetsRequirements(forestReq, St({ starter: true })).ok, true, 'starter後は出られる');
  console.log('2. 起点ゲート(starter) OK');
}

/* 3. 中央遺構ゲート: 2環核未満は不可 / 2環核で可 */
{
  const ruinsReq = MAPS.kodachi.edgeExits.up.req;
  assert.equal(GD.meetsRequirements(ruinsReq, St({ starter: true, coreForest: true })).ok, false, '1環核では遺構不可');
  assert.equal(GD.meetsRequirements(ruinsReq, St({ coreForest: true, coreTide: true })).ok, true, '2環核で遺構可');
  console.log('3. 中央遺構ゲート(2環核) OK');
}

/* 4. 碧環中枢ゲート: 4環核+renResolved でのみ可(早期侵入防止) */
{
  const nexusReq = MAPS.ruins.edgeExits.up.req;
  const four = { coreForest: true, coreTide: true, coreFlare: true, coreStorm: true };
  assert.equal(GD.meetsRequirements(nexusReq, St({ ...four })).ok, false, 'renResolved無しは中枢不可');
  assert.equal(GD.meetsRequirements(nexusReq, St({ coreForest: true, coreTide: true, coreFlare: true, renResolved: true })).ok, false, '3環核では中枢不可');
  assert.equal(GD.meetsRequirements(nexusReq, St({ ...four, renResolved: true })).ok, true, '4環核+対話で中枢可');
  console.log('4. 碧環中枢ゲート(4環核+renResolved) OK');
}

/* 5. 能力ゲート(タイプ由来・複数解決): 各地域の障害物 req を実タイプで検証 */
{
  const gate = (mapId) => MAPS[mapId].obstacles[0].req;
  // 碧樹の倒木=ほのお / 草では不可
  assert.equal(GD.meetsRequirements(gate('forest'), St({}, party(4))).ok, true, '倒木: ほのおで通過');
  assert.equal(GD.meetsRequirements(gate('forest'), St({}, party(1))).ok, false, '倒木: くさでは不可');
  // 潮環の水門=みず
  assert.equal(GD.meetsRequirements(gate('tide'), St({}, party(7))).ok, true, '水門: みずで通過');
  // 火脈の岩=いわ か みず(複数解決)
  assert.equal(GD.meetsRequirements(gate('flare'), St({}, party(18))).ok, true, '岩: いわで通過');
  assert.equal(GD.meetsRequirements(gate('flare'), St({}, party(7))).ok, true, '岩: みずでも通過');
  assert.equal(GD.meetsRequirements(gate('flare'), St({}, party(4))).ok, false, '岩: ほのおでは不可');
  // 雷霧の崖=ひこう か でんき(複数解決)
  assert.equal(GD.meetsRequirements(gate('storm'), St({}, party(25))).ok, true, '崖: ひこうで通過');
  assert.equal(GD.meetsRequirements(gate('storm'), St({}, party(16))).ok, true, '崖: でんきでも通過');
  console.log('5. 能力ゲート(タイプ由来・複数解決) OK');
}

/* 6. 守護獣試練の定義が4地域そろい、環核と対応する */
{
  const shrines = ['forest_shrine', 'tide_shrine', 'flare_shrine', 'storm_shrine'];
  const cores = shrines.map((s) => MAPS[s].npcs.find((n) => n.role === 'guardian').guardian.core);
  assert.deepEqual([...cores].sort(), [...GD.CORE_FLAGS].sort(), '4試練が4環核に対応');
  console.log('6. 環核試練 4種 OK');
}

/* 7. サブクエストが8件以上、マップ上に配置されている */
{
  const quests = new Set();
  for (const map of Object.values(MAPS))
    for (const n of (map.npcs || [])) if (n.role === 'quest') quests.add(n.quest);
  assert.ok(quests.size >= 8, `サブクエストが8件以上(実際 ${quests.size})`);
  console.log(`7. サブクエスト ${quests.size}件 配置 OK`);
}

/* 8. 3方針エンディングがスコアから導出される */
{
  const mk = (r, n, sh) => ({ scores: { restore: r, nature: n, share: sh } });
  assert.equal(S.resolveEnding(mk(5, 1, 1)).id, 'restore');
  assert.equal(S.resolveEnding(mk(1, 5, 1)).id, 'nature');
  assert.equal(S.resolveEnding(mk(2, 2, 0)).id, 'share');
  console.log('8. 3方針エンディング OK');
}

console.log('\n進行フロー統合検証: すべて通過');
