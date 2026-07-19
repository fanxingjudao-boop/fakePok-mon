/* ============================================================
 * map-validate.cjs — マップ定義の静的検証(Node)
 *   - 出入口(warp / edgeExit)の接続先が存在する
 *   - 往復座標(着地点)と出入口タイルが歩行可能
 *   - 全マップが開始地点 home から到達可能
 *   - 同じ rows 配列を複数マップが共有していないか(=固有化の進捗)
 * problems があれば異常終了。shared rows 等は warnings(段階的に解消)。
 * 実行: node tests/map-validate.cjs
 * ============================================================ */
const assert = require('node:assert/strict');

global.window = {};
require('../world-maps.js');
require('../data.js');
const GD = global.window.GameData;
assert.ok(GD && GD.MAPS, 'GameData.MAPS が読めない');
const MAPS = GD.MAPS;

const problems = [], warnings = [];
const KNOWN_TILES = new Set([',', '.', '%', 'T', 'W', 'R', 'B', 'D', 'S', 'F', '^', 'c', 'x', '_', '#', 'M', '=', 'g']);
const walkable = (map, x, y) => {
  const t = map.rows[y] && map.rows[y][x];
  if (t == null) return false;
  if (GD.isSolidTile(t)) return false;
  if (map.lockedDoors && map.lockedDoors.some((d) => d.x === x && d.y === y)) return false;
  return true;
};

/* 0. 行幅の一致・未定義タイルの検出 */
for (const [id, map] of Object.entries(MAPS)) {
  const w = map.rows[0] ? map.rows[0].length : 0;
  map.rows.forEach((row, y) => {
    if (row.length !== w) problems.push(`${id}: 行幅不一致 y=${y}(${row.length}≠${w})`);
    for (const ch of row) if (!KNOWN_TILES.has(ch)) problems.push(`${id}: 未定義タイル '${ch}' を含む`);
  });
}

/* 1. 出入口の接続先・歩行可能性 */
for (const [id, map] of Object.entries(MAPS)) {
  for (const w of (map.warps || [])) {
    if (!MAPS[w.to]) problems.push(`${id}: warp→存在しないマップ ${w.to}`);
    else if (!walkable(MAPS[w.to], w.tx, w.ty)) problems.push(`${id}: warp着地が壁 ${w.to}(${w.tx},${w.ty})`);
    if (!walkable(map, w.x, w.y)) problems.push(`${id}: warp元が壁 (${w.x},${w.y})`);
  }
  for (const [dir, ee] of Object.entries(map.edgeExits || {})) {
    if (!MAPS[ee.to]) problems.push(`${id}: edge ${dir}→存在しない ${ee.to}`);
    else if (!walkable(MAPS[ee.to], ee.tx, ee.ty)) problems.push(`${id}: edge ${dir}着地が壁 ${ee.to}(${ee.tx},${ee.ty})`);
    for (const [x, y] of (ee.tiles || [])) if (!walkable(map, x, y)) problems.push(`${id}: edge ${dir} タイル(${x},${y})が壁`);
  }
  for (const n of [...(map.npcs || []), ...(map.trainers || [])]) {
    if (!walkable(map, n.x, n.y)) problems.push(`${id}: エンティティ ${n.id || '?'} が壁上 (${n.x},${n.y})`);
  }
  for (const o of (map.obstacles || [])) {
    if (o.leadsTo && !MAPS[o.leadsTo.to]) problems.push(`${id}: obstacle leadsTo→存在しない ${o.leadsTo.to}`);
    // 障害物は「壁・障害タイル」に置く(でないと bump ハンドラが発火せず素通りする)
    const t = map.rows[o.y] && map.rows[o.y][o.x];
    if (t == null) { problems.push(`${id}: obstacle(${o.x},${o.y})がマップ外`); continue; }
    if (!GD.isSolidTile(t)) problems.push(`${id}: obstacle(${o.x},${o.y})が歩行可能タイル '${t}' 上=素通りする`);
    // 隣接に歩行可能タイルが無いと、プレイヤーが接触(bump)できない
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walkable(map, o.x + dx, o.y + dy));
    if (!near) problems.push(`${id}: obstacle(${o.x},${o.y})に 歩行可能な となりが無い=接触できない`);
    if (o.leadsTo && MAPS[o.leadsTo.to] && !walkable(MAPS[o.leadsTo.to], o.leadsTo.tx, o.leadsTo.ty))
      problems.push(`${id}: obstacle 着地が壁 ${o.leadsTo.to}(${o.leadsTo.tx},${o.leadsTo.ty})`);
  }
}

/* 2. home からの到達性(ゲートは無視した接続グラフ) */
const adj = {}; Object.keys(MAPS).forEach((k) => (adj[k] = new Set()));
for (const [id, map] of Object.entries(MAPS)) {
  (map.warps || []).forEach((w) => { if (MAPS[w.to]) adj[id].add(w.to); });
  Object.values(map.edgeExits || {}).forEach((ee) => { if (MAPS[ee.to]) adj[id].add(ee.to); });
  (map.obstacles || []).forEach((o) => { if (o.leadsTo && MAPS[o.leadsTo.to]) adj[id].add(o.leadsTo.to); });
}
const start = MAPS.home ? 'home' : Object.keys(MAPS)[0];
const seen = new Set([start]); const q = [start];
while (q.length) { const n = q.shift(); for (const m of adj[n] || []) if (!seen.has(m)) { seen.add(m); q.push(m); } }
const unreached = Object.keys(MAPS).filter((k) => !seen.has(k));
if (unreached.length) problems.push(`到達不能マップ(${unreached.length}): ${unreached.join(', ')}`);

/* 3. rows 共有の検出(固有化の進捗指標) */
const rowsMap = new Map();
for (const [id, map] of Object.entries(MAPS)) {
  if (!rowsMap.has(map.rows)) rowsMap.set(map.rows, []);
  rowsMap.get(map.rows).push(id);
}
for (const ids of rowsMap.values()) if (ids.length > 1) problems.push(`rows共有(固有化されていない): ${ids.join(', ')}`);

/* 出力 */
console.log(`map-validate: ${Object.keys(MAPS).length} maps / start=${start}`);
console.log(`  problems: ${problems.length}`);
problems.forEach((p) => console.log('   ✗', p));
console.log(`  warnings: ${warnings.length}`);
warnings.forEach((w) => console.log('   !', w));

assert.equal(problems.length, 0, '接続/歩行/到達性エラーがあります');
console.log('OK: 接続・歩行可能性・到達性の検証を通過');
