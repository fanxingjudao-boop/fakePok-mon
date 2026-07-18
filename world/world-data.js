/* ============================================================
 * world-data.js — 非線形ワールドのモデル層(DOM非依存・再利用可)
 *
 * 「キャラの能力で地形が開く」構造を、純粋なデータ+ロジックとして定義する。
 * ブラウザ(window.WorldModel)でもNode(module.exports)でも読める。
 *
 * これがそのまま「現在の一本道マップをこの構造へ変える」中核仕様になる。
 *   - REGIONS : 拠点/ダンジョン/村/港/隠し/最終エリア
 *   - EDGES   : 区間を結ぶ道。gate に必要能力(または物語フラグ)を持つ
 *   - ABILITIES: 3体の相棒が持つフィールド能力(=地形の鍵)
 *   - createState()/gateOk()/reachable()/clearBoss() : 進行ロジック
 * ============================================================ */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.WorldModel = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- 相棒の固有フィールド能力(=鍵) ---- */
  const ABILITIES = {
    fire:  { id: 'fire',  color: '#f0603a', icon: '🔥', name: 'かえん',
             field: 'いばら・暗闇を焼き払う', mon: '炎キツネ「コンビ」', species: 4 },
    water: { id: 'water', color: '#4a9fe8', icon: '🌊', name: 'なみのり',
             field: '川・海の水路を渡る',     mon: '水カワウソ「ラッコル」', species: 7 },
    rock:  { id: 'rock',  color: '#6fae5a', icon: '🪨', name: 'いわくだき',
             field: '落石・谷を突破する',     mon: '石フクロウ「ミミロク」', species: 1 }
  };
  const ABILITY_ORDER = ['fire', 'water', 'rock'];

  /* ---- リージョン(拠点/分岐先/隠し/最終) ----
   * x,y は地図上の配置(0-100%)。 hub:拠点 / boss:ボス在中 / hidden:隠し / story:撃破で変化
   * reward[].gate があれば、その報酬は対応能力がないと入手できない(=再訪の動機)
   */
  const REGIONS = {
    hub:    { id: 'hub', name: 'アルド城下町', kind: '拠点の町', icon: '🏰', x: 50, y: 11, hub: true,
              desc: '物語の起点。ショップ・回復・図鑑がそろう。全ルートはここから伸びる。', reward: [] },
    plaza:  { id: 'plaza', name: '交わりの広場', kind: '分岐点', icon: '⛲', x: 49, y: 33,
              desc: '石像が見下ろす十字路。西の洞窟・東の遺跡と農村・南の港へ、ここで道が分かれる。',
              quest: '石像のなぞ', reward: [] },
    cave:   { id: 'cave', name: 'ゴロ洞窟', kind: 'ダンジョン', icon: '🕳️', x: 22, y: 27, boss: true,
              desc: '西の入口。奥はいばらで塞がれ、炎の力で焼くと隠し部屋へ。',
              reward: [{ icon: '💎', text: '奥の隠し宝箱', gate: 'fire' }] },
    tower:  { id: 'tower', name: 'ムラサキ魔塔', kind: 'ダンジョン', icon: '🔮', x: 13, y: 56, boss: true,
              desc: '洞窟の先。落石で道が塞がれ、岩を砕く力がないと近づけない。塔主を倒すと周囲の毒沼が晴れる。',
              reward: [{ icon: '⚔️', text: '塔主・ムラサキ', gate: 'rock' }] },
    ruins:  { id: 'ruins', name: '風の遺跡', kind: 'ダンジョン', icon: '🏛️', x: 75, y: 29, boss: true,
              desc: '東の古代遺跡。最深部は崩れた谷の先。岩砕き(浮遊)で越えると財宝の間へ。',
              reward: [{ icon: '💎', text: '最深部の宝', gate: 'rock' }] },
    farm:   { id: 'farm', name: 'みのり農村', kind: 'サブの村', icon: '🌾', x: 80, y: 52,
              desc: '風車の村。畑あらしを退治するサブクエストの受注地。遺跡へ抜ける脇道もある。',
              quest: '畑を守れ', reward: [] },
    port:   { id: 'port', name: 'ミナト港町', kind: '港・関門', icon: '⚓', x: 45, y: 63, boss: true,
              desc: '南の港。海賊のボスが居座り、倒すと「封城の鍵」が手に入る。海路はなみのりで開く。',
              reward: [{ icon: '🗝️', text: '海賊船長(鍵を落とす)' }] },
    isle:   { id: 'isle', name: '中洲の宝島', kind: '隠し', icon: '🏝️', x: 63, y: 79, hidden: true,
              desc: '海に浮かぶ小島。港からはなみのり、遺跡側からは谷越え(岩砕き)の2ルートで到達できる。',
              reward: [{ icon: '💎', text: '伝説の宝箱', gate: 'water' }] },
    sealed: { id: 'sealed', name: '封鎖されし城', kind: '最終・変化', icon: '🔒', x: 73, y: 83, story: true,
              desc: '赤い封印に閉ざされた城。港の海賊を倒して鍵を得ると封印が解け、地域の様相が一変する。',
              openIcon: '🏰', openKind: '最終エリア(解放)',
              reward: [{ icon: '👑', text: '最終エリア開放', gate: 'story' }] },
    wchest: { id: 'wchest', name: 'いばらの隠し宝', kind: '隠し', icon: '💎', x: 15, y: 82, hidden: true,
              desc: '洞窟のさらに西、いばらの茂みの奥。序盤に見えても炎の力を得るまで開けられない=再訪の理由。',
              reward: [{ icon: '💎', text: '隠し宝箱', gate: 'fire' }] }
  };

  /* ---- 道(区間) ----  [a, b, gate]   gate: null|'fire'|'water'|'rock'|'story' ---- */
  const EDGES = [
    ['hub', 'plaza', null],
    ['plaza', 'cave', null],
    ['cave', 'tower', 'rock'],
    ['cave', 'wchest', 'fire'],
    ['plaza', 'ruins', null],
    ['plaza', 'farm', null],
    ['farm', 'ruins', null],      // 農村→遺跡の脇道(冗長ルート=非線形性)
    ['plaza', 'port', null],
    ['port', 'isle', 'water'],
    ['ruins', 'isle', 'rock'],    // 中洲へのもう一つのルート
    ['port', 'sealed', 'story']
  ];

  /* ---- 進行状態 ---- */
  function createState() {
    return {
      abilities: { fire: false, water: false, rock: false }, // 習得済みフィールド能力
      flags: { portCleared: false },                          // 物語フラグ(撃破など)
      cleared: {}                                             // ボス撃破記録 regionId→true
    };
  }

  const gateColor = (g) => (g ? (ABILITIES[g] ? ABILITIES[g].color : '#c9903a') : '#e8c24a');

  /* ゲートを通過できるか */
  function gateOk(gate, state) {
    if (!gate) return true;
    if (gate === 'story') return !!state.flags.portCleared;
    return !!state.abilities[gate];
  }

  /* 拠点から到達可能なリージョン集合(BFS) */
  function reachable(state) {
    const adj = {};
    Object.keys(REGIONS).forEach((k) => (adj[k] = []));
    EDGES.forEach(([a, b, g]) => {
      if (gateOk(g, state)) { adj[a].push(b); adj[b].push(a); }
    });
    const seen = new Set(['hub']);
    const q = ['hub'];
    while (q.length) {
      const n = q.shift();
      for (const m of adj[n]) if (!seen.has(m)) { seen.add(m); q.push(m); }
    }
    return seen;
  }

  /* いま実際に入手できる宝箱(💎)の数 = 到達可能 かつ 能力を満たす */
  function collectableChests(state) {
    const reach = reachable(state);
    let n = 0;
    for (const id in REGIONS) {
      if (!reach.has(id)) continue;
      for (const rw of REGIONS[id].reward || []) {
        if (rw.icon === '💎' && (!rw.gate || gateOk(rw.gate, state))) n++;
      }
    }
    return n;
  }

  /* 港ボスを撃破 → 封城の封印が解ける(地域が変化する) */
  function clearBoss(state, regionId) {
    state.cleared[regionId] = true;
    if (regionId === 'port') state.flags.portCleared = true;
    return state;
  }

  /* リージョンへ入るのに不足している鍵(未到達時のヒント) */
  function missingKey(regionId, state) {
    for (const [a, b, g] of EDGES) {
      if ((a === regionId || b === regionId) && g && !gateOk(g, state)) {
        return g === 'story' ? '港のボス撃破(鍵)' : ABILITIES[g].icon + ABILITIES[g].name;
      }
    }
    return '別ルートの開通';
  }

  /* 6つの構造要件のライブ状態(設計の骨格チェック) */
  function structureStatus(state) {
    const branches = EDGES.filter(([a]) => a === 'plaza').length;
    const gates = EDGES.filter((e) => e[2] && e[2] !== 'story');
    const openGates = gates.filter((e) => gateOk(e[2], state)).length;
    const chestRegions = Object.values(REGIONS).filter((r) => (r.reward || []).some((x) => x.icon === '💎')).length;
    const anyAbility = ABILITY_ORDER.some((k) => state.abilities[k]);
    return [
      { n: 1, name: '拠点の町', done: true, detail: '✓ アルド城下町' },
      { n: 2, name: '3つ以上の分岐ルート', done: branches >= 3, detail: `広場から ${branches} 方向へ分岐(洞窟/遺跡/農村/港)` },
      { n: 3, name: '能力で開く場所', done: openGates > 0, detail: `能力ゲート ${openGates}/${gates.length} 開通中` },
      { n: 4, name: 'サブクエスト＆隠し宝', done: true, detail: `隠し宝 ${chestRegions}件・サブクエ2件を配置` },
      { n: 5, name: '倒すと変化する地域', done: !!state.flags.portCleared,
        detail: state.flags.portCleared ? '✓ 港ボス撃破 → 封城が解放された' : '港ボス未撃破(封城は封印中)' },
      { n: 6, name: '戻る理由(再訪)', done: true,
        detail: anyAbility ? '序盤に見えた鍵付き宝を、能力獲得後に回収できる' : '鍵付きの宝が各地に=あとで戻る動機' }
    ];
  }

  return {
    ABILITIES, ABILITY_ORDER, REGIONS, EDGES,
    createState, gateOk, gateColor, reachable,
    collectableChests, clearBoss, missingKey, structureStatus
  };
});
