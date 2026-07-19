/* ============================================================
 * story.js — 「碧環の旅」世界グラフ・ストーリーフラグ設計(DOM非依存)
 *
 * CLAUDE_RENEWAL_BRIEF.md のStage2-3。地域マップ実装はこの設計に差し込む。
 *   - REGIONS / REGION_EDGES : 中央拠点から分岐する非線形の世界グラフ
 *   - FLAGS                    : 進行フラグの定義(意味と分類)
 *   - 地域解放は GameData.meetsRequirements() で判定(早期侵入を防止)
 *   - scaledLevel()            : 進行順が変わっても地域進行度で敵Lvを調整
 *   - ENDINGS / resolveEnding(): 行動履歴(スコア)から3方針の結末を導出
 * Node / ブラウザ両対応。GameData は遅延参照(読み込み順に依存しない)。
 * ============================================================ */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.StoryData = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GD = () => (typeof window !== 'undefined' ? window.GameData : (typeof global !== 'undefined' ? global.window.GameData : null));

  /* ---- 世界グラフ(実マップ world-maps.js と一致) ----
   * kodachi(拠点)を forest/tide/ruins のハブに、ruins(中央遺構)を flare/storm/nexus の
   * ハブにした ハブ&スポーク構造。2環核で ruins、4環核+レン決着で nexus が開く。
   * forest<->tide, flare<->storm は横移動(循環)。
   * unlock は「その地域へ入る」条件。final は最終地域。
   * band は基準の敵レベル帯。core は試練クリアで立つ環核フラグ。
   */
  const REGIONS = {
    kodachi: { id: 'kodachi', name: 'コダチ拠点', hub: true, band: [3, 5],
      desc: '巡環士たちの集う起点。全地域はここから選べる。', unlock: {} },
    forest:  { id: 'forest', name: '碧樹圏', core: 'coreForest', band: [6, 10],
      desc: '樹上集落ハナゾノと苔むす獣道。倒木や花粉の湿地を炎の力で切り開く。',
      unlock: { allFlags: ['starter'] },
      trial: { id: 'trialForest', name: '碧樹の環核試練', rule: '光の差す順に樹路を開く' } },
    tide:    { id: 'tide', name: '潮環圏', core: 'coreTide', band: [7, 11],
      desc: '水路都市ミナモ。干潮の浅瀬と水門を、水の力で水位操作して進む。',
      unlock: { allFlags: ['starter'] },
      trial: { id: 'trialTide', name: '潮環の環核試練', rule: '水位を3段階で切り替え経路を作る' } },
    ruins:   { id: 'ruins', name: '中央遺構', band: [14, 16],
      desc: '碧環の心臓部へ続く古代遺構。2つの環核で扉が開く。',
      unlock: { minCores: 2, text: 'ふたつの かんかくを もって いないと\n中央遺構の とびらは ひらかない。' } },
    flare:   { id: 'flare', name: '火脈圏', core: 'coreFlare', band: [16, 20],
      desc: '鍛冶都市ヒバナと廃炉坑道。岩を砕くか水で冷ますか、攻略ルートを選ぶ。',
      unlock: { minCores: 2 },
      trial: { id: 'trialFlare', name: '火脈の環核試練', rule: '熱量を管理しながら冷却路を確保する' } },
    storm:   { id: 'storm', name: '雷霧圏', core: 'coreStorm', band: [16, 20],
      desc: '高地都市ライデンと雲上観測塔。飛行で崖を越え、電気で装置を復旧する。',
      unlock: { minCores: 2 },
      trial: { id: 'trialStorm', name: '雷霧の環核試練', rule: '送電経路を組み替えて観測塔を起動する' } },
    nexus:   { id: 'nexus', name: '碧環中枢', band: [24, 28], final: true,
      desc: '4つの環核とレンとの対話を経て至る最終地。世界の行方をここで選ぶ。',
      unlock: { minCores: 4, allFlags: ['renResolved'],
        text: '4つの かんかくと レンとの けりを つけないと\n碧環中枢へは 進めない。' } }
  };

  // 移動可能な接続(双方向)。ゲートは各 REGION.unlock で判定。
  // 実マップ(world-maps.js の edgeExits)と一致させる。
  // 中央拠点コダチが forest/tide/ruins のハブ、中央遺構ruinsが flare/storm/nexus のハブ。
  // forest<->tide, flare<->storm は横断路(循環)。
  const REGION_EDGES = [
    ['kodachi', 'forest'], ['kodachi', 'tide'], ['kodachi', 'ruins'],
    ['forest', 'tide'],
    ['ruins', 'flare'], ['ruins', 'storm'], ['ruins', 'nexus'],
    ['flare', 'storm']
  ];

  /* ---- ストーリーフラグの定義(分類つき・可読性のため) ---- */
  const FLAGS = {
    progression: {
      starter:     '相棒を選び旅立った',
      coreForest:  '碧樹の環核を再接続した',
      coreTide:    '潮環の環核を再接続した',
      coreFlare:   '火脈の環核を再接続した',
      coreStorm:   '雷霧の環核を再接続した',
      renResolved: 'レンとの最終問答に決着をつけた'
    },
    // 敵対組織「灰星局」——災害を止めるため碧環を強制起動する復旧技術者集団
    ashStar: {
      ashStarSeen:     '灰星局と初めて接触した',
      ashStarTide:     '潮環圏での灰星局の暴走を止めた',
      ashStarTide:     '潮環圏での灰星局の暴走を止めた',
      ashStarRescued:  '崩落現場で灰星局員を救助した'
    },
    // サブクエスト(最低8件)。追跡/選択/収集/救助/環境変化を混ぜる。
    subquests: {
      sqTrail:    '迷い獣の追跡を解決した',
      sqChoice:   '水門を開くか閉じるかの選択を下した',
      sqCollect:  '花粉標本を集めて研究者に届けた',
      sqRescue:   '坑道に取り残された子を救助した',
      sqRelay:    '送電中継の部品を修理して回った',
      sqBeast:    '守護獣の怒りを鎮めた',
      sqMarket:   '灰の段丘の行商を護衛した',
      sqObserve:  '観測塔の記録を復旧した'
    }
  };
  const ALL_FLAG_KEYS = Object.values(FLAGS).flatMap((g) => Object.keys(g));

  // 新規セーブに載せる進行状態の初期形(save v2 と互換。game.js の newGame から利用可)。
  const initialStoryState = () => ({
    flags: {},                                   // 上記フラグの真偽
    scores: { restore: 0, nature: 0, share: 0 }, // 結末を決める行動履歴
    regionCleared: {}                            // regionId → true(試練クリア)
  });

  /* ---- 地域の解放・到達 ---- */
  function regionUnlocked(regionId, state) {
    const r = REGIONS[regionId];
    if (!r) return { ok: false, text: 'ふめいな ちいき' };
    const gd = GD();
    if (!gd) return { ok: !!r.hub };
    return gd.meetsRequirements(r.unlock, { flags: state.flags || {}, party: state.party || [] });
  }
  const availableRegions = (state) => Object.keys(REGIONS).filter((id) => regionUnlocked(id, state).ok);

  // 進行度(取得済み環核数)に応じた敵レベル帯。順序が変わっても難度を保つ。
  function scaledLevel(regionId, state) {
    const r = REGIONS[regionId];
    if (!r || !r.band) return [5, 5];
    const gd = GD();
    const cores = gd ? gd.coreCount(state.flags || {}) : 0;
    const baseCores = (r.unlock && r.unlock.minCores) || 0;
    const bump = r.final ? 0 : Math.max(0, cores - baseCores) * 2;
    return [r.band[0] + bump, r.band[1] + bump];
  }

  /* ---- 分岐エンディング(3方針) ----
   * scores は各地の選択・救助・サブクエ結果で加算する。
   * 拮抗時は「人とモンスターの分散管理(share)」を中庸解として選ぶ。
   */
  const ENDINGS = {
    restore: { id: 'restore', name: '完全復旧', desc: '碧環を人の手で完全に制御し、災害を封じる。安定と引き換えに自然の自律は失われる。' },
    nature:  { id: 'nature',  name: '自然循環', desc: '装置を手放し、生態系の循環に世界を委ねる。痛みを伴うが、環は自ら巡り始める。' },
    share:   { id: 'share',   name: '分散管理', desc: '人とモンスターが環を分かち合って管理する。最も手間がかかるが、誰も切り捨てない道。' }
  };
  function resolveEnding(state) {
    const s = (state && state.scores) || { restore: 0, nature: 0, share: 0 };
    const e = [['restore', s.restore || 0], ['nature', s.nature || 0], ['share', s.share || 0]];
    e.sort((a, b) => b[1] - a[1]);
    if (e[0][1] === e[1][1]) return ENDINGS.share; // 拮抗→分散管理
    return ENDINGS[e[0][0]];
  }
  // 選択を記録するヘルパ(game.js から呼ぶ想定)
  function recordChoice(state, kind, weight = 1) {
    if (!state.scores) state.scores = { restore: 0, nature: 0, share: 0 };
    if (kind in state.scores) state.scores[kind] += weight;
    return state.scores;
  }

  return {
    REGIONS, REGION_EDGES, FLAGS, ALL_FLAG_KEYS, ENDINGS,
    initialStoryState, regionUnlocked, availableRegions,
    scaledLevel, resolveEnding, recordChoice
  };
});
