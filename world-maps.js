/* ============================================================
 * world-maps.js — 「碧環の旅」固有マップ定義(全マップ一意)
 *
 * story.js の REGIONS に対応: コダチ拠点→碧樹圏/潮環圏→中央遺構→火脈圏/雷霧圏→碧環中枢。
 *   - すべての map.rows は一意(map-validate が rows 共有を失敗にする)
 *   - edgeExits[dir].req に requirements(GameData.meetsRequirements で判定)
 *   - obstacles[] は「A で入る 能力ゲート扉」。req を満たすと leadsTo へワープ(openFlag で永続記録)
 *   - 各屋外地域に 分岐 / 任意エリア(能力ゲートの奥) / 守護獣試練 を配置
 *
 * タイル: , 草 . 道 % 草むら(遭遇) T 木 W 水 R 屋根 B 壁 S 切株 F 柵
 *         ^ 岩壁 c 洞床 x 洞窟(遭遇) _ 屋内床 # 屋内壁 M マット(出入口) = 絨毯 g 石像
 * ============================================================ */
(function () {
  'use strict';
  const M = {};

  /* ===== 自宅 (9x7) ===== */
  M.home = {
    id: 'home', name: 'じぶんの いえ', indoor: true, music: 'town',
    rows: [
      '#########',
      '#_______#',
      '#_#___#_#',
      '#_______#',
      '#__===__#',
      '#_______#',
      '####MM###'
    ],
    warps: [{ x: 4, y: 6, to: 'kodachi', tx: 3, ty: 4 }, { x: 5, y: 6, to: 'kodachi', tx: 3, ty: 4 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [{ id: 'mom', kind: 'npc', skin: 'girl', x: 2, y: 1, dir: 'down', role: 'mom' }], trainers: []
  };

  /* ===== コダチ拠点 (16x14) ===== */
  M.kodachi = {
    id: 'kodachi', name: 'コダチ拠点', outdoor: true, music: 'town', roofColor: '#5a8a4a',
    rows: [
      'TTTTTTT..TTTTTTT',
      'T,,,,,,,,,,,,,,T',
      'T,RRR,,,,,RRR,,T',
      'T,B.B,,,,,B.B,,T',
      'T,,,,,,,,,,,,,,T',
      'T,,,,,,gg,,,,,,T',
      'T,,,,,,,,,,,,,,T',
      '.,,,,,,,,,,,,,,.',
      'T,,,,,,,,,,,,,,T',
      'T,,,,,RRRR,,,,,T',
      'T,,,,,B..B,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'TTTTTTTTTTTTTTTT'
    ],
    warps: [
      { x: 3, y: 3, to: 'home', tx: 4, ty: 5 },
      { x: 11, y: 3, to: 'lab', tx: 5, ty: 5 },
      { x: 7, y: 10, to: 'center', tx: 5, ty: 5 }, { x: 8, y: 10, to: 'center', tx: 5, ty: 5 }
    ],
    edgeExits: {
      left:  { tiles: [[0, 7]], to: 'forest', tx: 14, ty: 7, req: { allFlags: ['starter'] } },
      right: { tiles: [[15, 7]], to: 'tide', tx: 1, ty: 7, req: { allFlags: ['starter'] } },
      up:    { tiles: [[7, 0], [8, 0]], to: 'ruins', tx: 7, ty: 8,
        req: { minCores: 2, text: 'せきばん「ふたつの かんかくを もつ 巡環士のみ\n中央遺構へ すすめる」' } }
    },
    signs: { '6,6': 'コダチ拠点\n西は 碧樹圏、東は 潮環圏。北は 中央遺構。', '9,6': '碧環が よわり、四方で いへんが おきている……' },
    obstacles: [],
    npcs: [
      { id: 'ko_elder', kind: 'npc', skin: 'man', x: 4, y: 8, dir: 'right',
        text: ['巡環士は モンスターを したがえるのではない。', 'しんらいを むすび、よわった 碧環の かんかくを つなぎなおすのじゃ。'] },
      { id: 'ko_kid', kind: 'npc', skin: 'boy2', x: 10, y: 11, dir: 'left', role: 'quest', quest: 'sqTrail' }
    ], trainers: []
  };

  /* ===== カエデ研究所 (11x7) ===== */
  M.lab = {
    id: 'lab', name: 'カエデ研究所', indoor: true, music: 'town',
    rows: [
      '###########',
      '#_#_____#_#',
      '#__=====__#',
      '#__=====__#',
      '#_________#',
      '#_________#',
      '#####MM####'
    ],
    warps: [{ x: 5, y: 6, to: 'kodachi', tx: 11, ty: 4 }, { x: 6, y: 6, to: 'kodachi', tx: 11, ty: 4 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [{ id: 'prof', kind: 'npc', skin: 'prof', x: 5, y: 2, dir: 'down', role: 'prof' }], trainers: []
  };

  /* ===== 巡環センター (11x7) ===== */
  M.center = {
    id: 'center', name: '巡環センター', indoor: true, music: 'town',
    rows: [
      '###########',
      '#_#_____#_#',
      '#_________#',
      '#__#####__#',
      '#_________#',
      '#_________#',
      '#####MM####'
    ],
    warps: [{ x: 5, y: 6, to: 'kodachi', tx: 7, ty: 11 }, { x: 6, y: 6, to: 'kodachi', tx: 7, ty: 11 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [{ id: 'nurse', kind: 'npc', skin: 'nurse', x: 5, y: 2, dir: 'down', role: 'nurse' }], trainers: []
  };

  /* ===== 碧樹圏 (16x14) ===== */
  M.forest = {
    id: 'forest', name: '碧樹圏', outdoor: true, music: 'route', roofColor: '#7a5a30',
    encounters: { rate: 0.14, list: [[1, 5, 8, 40], [14, 5, 8, 30], [10, 4, 7, 20], [12, 5, 8, 10]] },
    rows: [
      'TTTTTTTTTTTTTTTT',
      'T,,,,,,,,,,,,,,T',
      'T,%%,,,,,,,,%%,T',
      'T,%%,,,,,,,,%%,T',
      'T,,,,,SS,,,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'TT,,,,,gg,,,S,TT',
      '.,,,,,,,,,,,,,,T',
      'T,,,,%%,,,,%%,,T',
      'T,,,,%%,,,,%%,,T',
      'T,RRR,,,,,,,,,,T',
      'T,B.B,,,,,,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'TTTTTTTT.TTTTTTT'
    ],
    warps: [{ x: 3, y: 11, to: 'forest_shrine', tx: 4, ty: 5 }],
    edgeExits: {
      left: { tiles: [[0, 7]], to: 'kodachi', tx: 1, ty: 7 },
      // 横断路(南の峠): 碧樹圏 ⇔ 潮環圏(story グラフの forest↔tide)
      down: { tiles: [[8, 13]], to: 'tide', tx: 8, ty: 1, req: { allFlags: ['starter'] } }
    },
    signs: { '7,5': '碧樹圏\n倒木の 奥に 花粉の 湿地が あるという。' },
    obstacles: [{ x: 12, y: 6, kind: 'log', req: { anyAbilities: ['clearLog'] }, openFlag: 'forestLogCleared',
      text: 'おおきな 倒木が 道を ふさいでいる。\n(ほのおタイプの なかまが いれば 焼けそうだ)', doneText: '焼けた 倒木を のりこえた。',
      leadsTo: { to: 'forest_marsh', tx: 4, ty: 5 } }],
    npcs: [
      { id: 'fo_walker', kind: 'npc', skin: 'girl', x: 6, y: 7, dir: 'down',
        text: ['森殿の 守護獣は、しんらいを 見せた者にだけ 樹路を あける。', '倒木は ほのおの ちからで やけるらしいよ。'] },
      { id: 'fo_quest', kind: 'npc', skin: 'man', x: 10, y: 5, dir: 'left', role: 'quest', quest: 'sqCollect' },
      { id: 'fo_stray', kind: 'npc', skin: 'boy2', x: 5, y: 5, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqTrail', idx: 0, text: '迷い獣を そっと なだめ、むれへ かえした。', lockText: 'ちいさな 迷い獣が おびえている。', doneText: '迷い獣は むれで げんきに している。' } }
    ],
    trainers: [
      { id: 'fo_t1', kind: 'trainer', name: 'たんけんかの ノノ', skin: 'boy2', x: 7, y: 8, dir: 'up', sight: 3,
        team: [[10, 6], [12, 7]], money: 300, pre: ['碧樹圏を しらべてるんだ！ しょうぶ しよう！'], lose: ['まいった！'],
        after: ['倒木の 奥に なにか あるみたいだ。'] }
    ]
  };

  /* 碧樹・花粉の湿地(任意) (9x7) */
  M.forest_marsh = {
    id: 'forest_marsh', name: '花粉の湿地', outdoor: true, music: 'route', roofColor: '#7a5a30',
    encounters: { rate: 0.16, list: [[14, 7, 10, 50], [1, 7, 10, 30], [16, 6, 9, 20]] },
    rows: [
      'TTTTTTTTT',
      'T,,,,,,,T',
      'T,%%%%%,T',
      'T,,,,,,,T',
      'T,%%%%%,T',
      'T,,,,,,,T',
      'TTTTMTTTT'
    ],
    warps: [{ x: 4, y: 6, to: 'forest', tx: 12, ty: 7 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [
      { id: 'ma_quest', kind: 'npc', skin: 'man', x: 4, y: 1, dir: 'down', role: 'quest', quest: 'sqBeast' },
      { id: 'ma_pollen0', kind: 'npc', skin: 'girl', x: 2, y: 1, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqCollect', idx: 0, text: '花粉標本を ひとつ 採取した。', lockText: 'めずらしい 花粉が ゆれている。' } },
      { id: 'ma_pollen1', kind: 'npc', skin: 'girl', x: 6, y: 1, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqCollect', idx: 1, text: '花粉標本を もうひとつ 採取した。', lockText: 'めずらしい 花粉が ゆれている。' } },
      { id: 'ma_shrine', kind: 'npc', skin: 'prof', x: 4, y: 5, dir: 'up', role: 'questTarget',
        qt: { quest: 'sqBeast', idx: 0, text: 'しずめの 祠に ふれ、いのりを ささげた。気配が やわらいだ。', lockText: 'しずめの 祠が しずかに たっている。' } }
    ], trainers: []
  };

  /* 碧樹・森殿(試練→coreForest) (9x7) */
  M.forest_shrine = {
    id: 'forest_shrine', name: '碧樹の森殿', music: 'gym', roofColor: '#3a6a3a', encounters: null,
    rows: [
      'TTTTTTTTT',
      'T,,,,,,,T',
      'T,F,,,F,T',
      'T,,,,,,T'.padEnd(9, 'T'),
      'T,,,,,,,T',
      'T,,,,,,,T',
      'TTTTMTTTT'
    ],
    warps: [{ x: 4, y: 6, to: 'forest', tx: 3, ty: 12 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [
      { id: 'forest_d0', kind: 'npc', skin: 'man', x: 6, y: 3, dir: 'down', role: 'trialDevice', td: { region: 'forest', idx: 0 } },
      { id: 'forest_d1', kind: 'npc', skin: 'man', x: 6, y: 5, dir: 'down', role: 'trialDevice', td: { region: 'forest', idx: 1 } },
      { id: 'forest_d2', kind: 'npc', skin: 'man', x: 2, y: 3, dir: 'down', role: 'trialDevice', td: { region: 'forest', idx: 2 } },
      { id: 'fo_guardian', kind: 'npc', skin: 'leader', x: 4, y: 2, dir: 'down', role: 'guardian',
      guardian: { core: 'coreForest', region: 'forest', name: '森の守護獣モリドラード', species: 3, lv: 12,
        pre: ['森の守護獣が たちはだかる！\n巡環士よ、その しんらいを 見せよ。'], win: ['守護獣は みとめた。碧樹の かんかくが よみがえる！'] } }],
    trainers: []
  };

  /* ===== 潮環圏 (16x14) ===== */
  M.tide = {
    id: 'tide', name: '潮環圏', outdoor: true, music: 'route', roofColor: '#3a6a9a',
    encounters: { rate: 0.14, list: [[7, 6, 9, 40], [22, 6, 9, 30], [26, 5, 8, 20], [12, 6, 9, 10]] },
    rows: [
      'TTTTTTTTTTTTTTTT',
      '.,,,,,,,,RRRR,,T',
      'T,%%,,,,,B..B,,T',
      'T,%%,,,,,,,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'T,,,,,,,gg,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'T,WWWW,,,,,,,,,.',
      'T,WWWW,,,,,%%,,T',
      'T,,,,,,,,,%%,,,T',
      'T,,,,,,,,,,,,,,T',
      'T,,,,,,TT,,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'TTTTTTTT.TTTTTTT'
    ],
    warps: [{ x: 10, y: 2, to: 'tide_pc', tx: 5, ty: 5 }],
    edgeExits: {
      left:  { tiles: [[0, 1]], to: 'kodachi', tx: 14, ty: 7 },
      right: { tiles: [[15, 7]], to: 'tide_shrine', tx: 4, ty: 5 },
      down:  { tiles: [[8, 13]], to: 'forest', tx: 8, ty: 12, req: { allFlags: ['starter'] } }
    },
    signs: { '8,6': '潮環圏\n水門を さげれば、沈んだ 観測所へ おりられる。' },
    obstacles: [{ x: 5, y: 7, kind: 'gate', req: { anyAbilities: ['lowerWater'] }, openFlag: 'tideGateLowered',
      text: '水門が とじている。\n(みずタイプの なかまが いれば 水位を さげられそうだ)', doneText: '水位が さがり、道が あらわれた。',
      leadsTo: { to: 'tide_obs', tx: 4, ty: 3 } }],
    npcs: [
      { id: 'ti_fisher', kind: 'npc', skin: 'man', x: 8, y: 9, dir: 'down',
        text: ['潮の みちひきで とおれる みちが かわる。', 'みずの なかまが いれば 水門を あやつれるぞ。'] },
      { id: 'ti_quest', kind: 'npc', skin: 'girl', x: 11, y: 5, dir: 'down', role: 'quest', quest: 'sqChoice' },
      { id: 'ti_ash', kind: 'npc', skin: 'grunt', x: 9, y: 10, dir: 'down', role: 'ashStar', ashStar: { stage: 'confront' } }
    ],
    trainers: [
      { id: 'ti_t1', kind: 'trainer', name: 'みなとの コウ', skin: 'boy2', x: 6, y: 6, dir: 'right', sight: 3,
        team: [[26, 6], [7, 8]], money: 320, pre: ['潮の ながれは オレの にわだ！'], lose: ['ながされた〜！'],
        after: ['沈んだ 観測所には おたからが ねむってるらしい。'] }
    ]
  };

  /* 潮環センター (11x7) */
  M.tide_pc = {
    id: 'tide_pc', name: '潮環の巡環所', indoor: true, music: 'town',
    rows: [
      '###########',
      '#_______#_#',
      '#_#_______#',
      '#__#####__#',
      '#_________#',
      '#_#_____#_#',
      '#####MM####'
    ],
    warps: [{ x: 5, y: 6, to: 'tide', tx: 10, ty: 3 }, { x: 6, y: 6, to: 'tide', tx: 10, ty: 3 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [{ id: 'nurse2', kind: 'npc', skin: 'nurse', x: 5, y: 2, dir: 'down', role: 'nurse' }], trainers: []
  };

  /* 潮環・沈んだ観測所(任意) (9x8) */
  M.tide_obs = {
    id: 'tide_obs', name: '沈んだ観測所', cave: true, music: 'cave',
    encounters: { rate: 0.15, list: [[22, 8, 11, 50], [26, 7, 10, 30], [7, 8, 11, 20]] },
    rows: [
      '^^^^^^^^^',
      '^ccccccc^',
      '^c^ccc^c^',
      '^ccccccc^',
      '^c^ccc^c^',
      '^ccccccc^',
      '^ccccccc^',
      '^^^^M^^^^'
    ],
    warps: [{ x: 4, y: 7, to: 'tide', tx: 6, ty: 7 }],
    edgeExits: {}, signs: { '4,5': '観測 記録\n碧環の いへんは 四方 同時に はじまった。' }, obstacles: [],
    npcs: [
      { id: 'tc_quest', kind: 'npc', skin: 'man', x: 6, y: 1, dir: 'down', role: 'quest', quest: 'sqObserve' },
      { id: 'tc_term', kind: 'npc', skin: 'prof', x: 2, y: 5, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqObserve', idx: 0, text: '記録端末に ふれると、うしなわれた 観測記録が よみがえった。', lockText: 'ふるい 記録端末が ある。' } }
    ], trainers: []
  };

  /* 潮環・水殿(試練→coreTide) (9x7) */
  M.tide_shrine = {
    id: 'tide_shrine', name: '潮環の水殿', cave: true, music: 'gym', encounters: null,
    rows: [
      '^^^^^^^^^',
      '^ccccccc^',
      '^cWccWc^'.padEnd(9, '^'),
      '^ccccccc^',
      '^ccccccc^',
      '^ccccccc^',
      '^^^^M^^^^'
    ],
    warps: [{ x: 4, y: 6, to: 'tide', tx: 15, ty: 7 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [
      { id: 'tide_d0', kind: 'npc', skin: 'man', x: 2, y: 3, dir: 'down', role: 'trialDevice', td: { region: 'tide', idx: 0 } },
      { id: 'tide_d1', kind: 'npc', skin: 'man', x: 6, y: 3, dir: 'down', role: 'trialDevice', td: { region: 'tide', idx: 1 } },
      { id: 'ti_guardian', kind: 'npc', skin: 'leader', x: 4, y: 2, dir: 'down', role: 'guardian',
      guardian: { core: 'coreTide', region: 'tide', name: '潮の守護獣カイリュウガ', species: 9, lv: 13,
        pre: ['水面が もりあがり、守護獣が あらわれた！'], win: ['潮の かんかくが つながった！'] } }],
    trainers: []
  };

  /* ===== 中央遺構 (16x10) ===== */
  M.ruins = {
    id: 'ruins', name: '中央遺構', cave: true, music: 'cave',
    encounters: { rate: 0.12, list: [[19, 14, 16, 50], [20, 13, 15, 30], [23, 14, 16, 20]] },
    rows: [
      '^^^^^^^..^^^^^^^',
      '^cccccccccccccc^',
      '^c^^^ccccc^^^cc^',
      '.cccccccccccccc.',
      '^cc^cccccccc^cc^',
      '^cccccggccccccc^',
      '^cc^cccccccc^cc^',
      '^cccccccccccccc^',
      '^cccccccccccccc^',
      '^^^^^^^..^^^^^^^'
    ],
    warps: [],
    edgeExits: {
      down:  { tiles: [[7, 9], [8, 9]], to: 'kodachi', tx: 7, ty: 1 },
      left:  { tiles: [[0, 3]], to: 'flare', tx: 1, ty: 1, req: { minCores: 2 } },
      right: { tiles: [[15, 3]], to: 'storm', tx: 1, ty: 1, req: { minCores: 2 } },
      up:    { tiles: [[7, 0], [8, 0]], to: 'nexus', tx: 7, ty: 7,
        req: { minCores: 4, allFlags: ['renResolved'], text: 'とびら「4つの かんかくと、レンとの けりを つけた者のみ\n碧環中枢へ」' } }
    },
    signs: { '5,5': '中央遺構\n西は 火脈圏、東は 雷霧圏。奥は 碧環中枢。' }, obstacles: [],
    npcs: [
      { id: 'ren_ruins', kind: 'npc', skin: 'rival', x: 7, y: 4, dir: 'down', role: 'ren', renStage: 'ruins' },
      { id: 'ruins_ash', kind: 'npc', skin: 'boss', x: 4, y: 5, dir: 'down', role: 'ashStar', ashStar: { stage: 'core' } }
    ], trainers: []
  };

  /* ===== 火脈圏 (16x11) ===== */
  M.flare = {
    id: 'flare', name: '火脈圏', outdoor: true, music: 'route', roofColor: '#a05028',
    encounters: { rate: 0.14, list: [[4, 15, 18, 40], [18, 15, 18, 30], [27, 14, 17, 30]] },
    rows: [
      'TTTTTTTTTTTTTTTT',
      '.,,,,,,,,,,%%,,T',
      'T,%%,,,,,,,%%,,T',
      'T,%%,,^,,,,,,,,T',
      'T,,,,,,,,,,,,,,.',
      'T,,,,,gg,,,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'T,RRR,,,,,,,,,,T',
      'T,B.B,,,,%%,,,,T',
      'T,,,,,,,,%%,,,,T',
      'TTTTTTTT.TTTTTTT'
    ],
    warps: [{ x: 3, y: 8, to: 'flare_pc', tx: 5, ty: 5 }],
    edgeExits: {
      left:  { tiles: [[0, 1]], to: 'ruins', tx: 1, ty: 3 },
      right: { tiles: [[15, 4]], to: 'flare_shrine', tx: 4, ty: 5 },
      // 横断路(火道): 火脈圏 ⇔ 雷霧圏(story グラフの flare↔storm)
      down:  { tiles: [[8, 10]], to: 'storm', tx: 8, ty: 1, req: { minCores: 2 } }
    },
    signs: { '6,4': '火脈圏\n岩が 冷却洞を ふさいでいる。' },
    obstacles: [{ x: 6, y: 3, kind: 'rock', req: { anyAbilities: ['breakRock'] }, openFlag: 'flareRockBroken',
      text: 'ごつごつした 岩が 道を ふさぐ。\n(いわ か みずタイプの なかまが いれば くだけそうだ)', doneText: '岩を くだいた！',
      leadsTo: { to: 'flare_cool', tx: 4, ty: 5 } }],
    npcs: [
      { id: 'fl_smith', kind: 'npc', skin: 'man', x: 9, y: 5, dir: 'down',
        text: ['火脈の 熱を おさえながら 冷却路を たもつ。それが 試練だ。', '岩は いわで くだくも、みずで 冷ますも よし。'] },
      { id: 'fl_quest', kind: 'npc', skin: 'girl', x: 11, y: 8, dir: 'down', role: 'quest', quest: 'sqRescue' },
      { id: 'fl_relay0', kind: 'npc', skin: 'man', x: 4, y: 5, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqMarket', idx: 0, text: 'ひとつめの 中継地を みまわり、安全を 確認した。', lockText: '段丘の 中継地だ。' } },
      { id: 'fl_relay1', kind: 'npc', skin: 'man', x: 11, y: 5, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqMarket', idx: 1, text: 'ふたつめの 中継地も みまわった。行商の 道は 安全だ。', lockText: '段丘の 中継地だ。' } }
    ],
    trainers: [
      { id: 'fl_t1', kind: 'trainer', name: 'かじやの ゴウ', skin: 'man', x: 7, y: 6, dir: 'up', sight: 3,
        team: [[18, 16], [4, 17]], money: 500, pre: ['火脈で きたえた モンスターを みろ！'], lose: ['ひが きえた…'],
        after: ['冷却洞には 岩の おくに おたからが。'] }
    ]
  };

  /* 火脈センター (11x7) */
  M.flare_pc = {
    id: 'flare_pc', name: '火脈の巡環所', indoor: true, music: 'town',
    rows: [
      '###########',
      '#_#___#___#',
      '#_________#',
      '#__#####__#',
      '#_________#',
      '#___#_#___#',
      '#####MM####'
    ],
    warps: [{ x: 5, y: 6, to: 'flare', tx: 2, ty: 9 }, { x: 6, y: 6, to: 'flare', tx: 2, ty: 9 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [{ id: 'nurse3', kind: 'npc', skin: 'nurse', x: 5, y: 2, dir: 'down', role: 'nurse' }], trainers: []
  };

  /* 火脈・冷却洞(任意) (9x7) */
  M.flare_cool = {
    id: 'flare_cool', name: '冷却洞', cave: true, music: 'cave',
    encounters: { rate: 0.15, list: [[18, 16, 19, 50], [26, 15, 18, 30], [4, 16, 19, 20]] },
    rows: [
      '^^^^^^^^^',
      '^ccccccc^',
      '^cc^^^cc^',
      '^ccccccc^',
      '^ccccccc^',
      '^ccccccc^',
      '^^^^M^^^^'
    ],
    warps: [{ x: 4, y: 6, to: 'flare', tx: 6, ty: 4 }],
    edgeExits: {}, signs: { '4,4': '冷えた 石碑\n熱を おさめし者に、火の めぐみを。' }, obstacles: [],
    npcs: [
      { id: 'fc_quest', kind: 'npc', skin: 'man', x: 4, y: 1, dir: 'down', role: 'quest', quest: 'sqMarket' },
      { id: 'fc_child', kind: 'npc', skin: 'boy2', x: 6, y: 4, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqRescue', idx: 0, text: '坑道の おくの こどもを みつけ、そとへ つれだした！', lockText: 'こどもが うずくまっている。' } },
      { id: 'fc_ash', kind: 'npc', skin: 'grunt', x: 2, y: 3, dir: 'down', role: 'ashStar', ashStar: { stage: 'rescue' } }
    ], trainers: []
  };

  /* 火脈・炉殿(試練→coreFlare) (9x7) */
  M.flare_shrine = {
    id: 'flare_shrine', name: '火脈の炉殿', cave: true, music: 'gym', encounters: null,
    rows: [
      '^^^^^^^^^',
      '^ccccccc^',
      '^c^ccc^c^',
      '^ccccccc^',
      '^ccccccc^',
      '^ccccccc^',
      '^^^^M^^^^'
    ],
    warps: [{ x: 4, y: 6, to: 'flare', tx: 15, ty: 4 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [
      { id: 'flare_d0', kind: 'npc', skin: 'man', x: 2, y: 3, dir: 'down', role: 'trialDevice', td: { region: 'flare', idx: 0 } },
      { id: 'flare_d1', kind: 'npc', skin: 'man', x: 6, y: 3, dir: 'down', role: 'trialDevice', td: { region: 'flare', idx: 1 } },
      { id: 'fl_guardian', kind: 'npc', skin: 'leader', x: 4, y: 2, dir: 'down', role: 'guardian',
      guardian: { core: 'coreFlare', region: 'flare', name: '炎の守護獣ゴウカオン', species: 6, lv: 20,
        pre: ['炉の おくから 守護獣が ほえた！'], win: ['火脈の かんかくが よみがえった！'] } }],
    trainers: []
  };

  /* ===== 雷霧圏 (16x11) ===== */
  M.storm = {
    id: 'storm', name: '雷霧圏', outdoor: true, music: 'route', roofColor: '#8878c0',
    encounters: { rate: 0.14, list: [[16, 15, 18, 40], [24, 15, 18, 30], [25, 14, 17, 30]] },
    rows: [
      'TTTTTTTTTTTTTTTT',
      '.,,,,,,,,,,,,,,T',
      'T,%%,,,,,,,,%%,T',
      'T,,,,,,,^,,,,,,.',
      'T,,,,,,,^,,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'T,,%%,,,,,,%%,,T',
      'T,RRR,,,,,,,,,,T',
      'T,B.B,,,,,,,,,,T',
      'T,,,,,,,,,,,,,,T',
      'TTTTTTTT.TTTTTTT'
    ],
    warps: [{ x: 3, y: 8, to: 'storm_pc', tx: 5, ty: 5 }],
    edgeExits: {
      left:  { tiles: [[0, 1]], to: 'ruins', tx: 14, ty: 3 },
      right: { tiles: [[15, 3]], to: 'storm_shrine', tx: 4, ty: 5 },
      down:  { tiles: [[8, 10]], to: 'flare', tx: 8, ty: 9, req: { minCores: 2 } }
    },
    signs: { '5,5': '雷霧圏\n崖の むこうに 雲上観測塔。飛行か でんきで こえられる。' },
    obstacles: [{ x: 8, y: 4, kind: 'cliff', req: { anyAbilities: ['glide', 'charge'] }, openFlag: 'stormCliffCrossed',
      text: '切り立った 崖が 道を へだてる。\n(ひこう か でんきタイプの なかまが いれば こえられそうだ)', doneText: '崖を こえた！',
      leadsTo: { to: 'storm_tower', tx: 4, ty: 5 } }],
    npcs: [
      { id: 'st_watch', kind: 'npc', skin: 'man', x: 10, y: 6, dir: 'down',
        text: ['送電経路を くみかえて 観測塔を おこす。それが 試練だ。', 'ひこうで 崖を こえるか、でんきで 装置を うごかすか。'] },
      { id: 'st_quest', kind: 'npc', skin: 'girl', x: 11, y: 8, dir: 'down', role: 'quest', quest: 'sqRelay' },
      { id: 'st_relay0', kind: 'npc', skin: 'man', x: 4, y: 5, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqRelay', idx: 0, text: 'ひとつめの 送電中継を 修理した。あかりが ともる。', lockText: 'こしょうした 送電中継だ。' } },
      { id: 'st_relay1', kind: 'npc', skin: 'man', x: 11, y: 5, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqRelay', idx: 1, text: 'ふたつめの 送電中継も 修理した。雷霧に あかりが もどる。', lockText: 'こしょうした 送電中継だ。' } }
    ],
    trainers: [
      { id: 'st_t1', kind: 'trainer', name: 'とりつかいの ソラ', skin: 'boy2', x: 7, y: 6, dir: 'up', sight: 3,
        team: [[25, 16], [16, 17]], money: 500, pre: ['そらと いかずちは オレの ものだ！'], lose: ['おちた…'],
        after: ['観測塔の きろくが きえかけている。'] }
    ]
  };

  /* 雷霧センター (11x7) */
  M.storm_pc = {
    id: 'storm_pc', name: '雷霧の巡環所', indoor: true, music: 'town',
    rows: [
      '###########',
      '#___#_#___#',
      '#_________#',
      '#__#####__#',
      '#_________#',
      '#_#_____#_#',
      '#####MM####'
    ],
    warps: [{ x: 5, y: 6, to: 'storm', tx: 2, ty: 9 }, { x: 6, y: 6, to: 'storm', tx: 2, ty: 9 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [{ id: 'nurse4', kind: 'npc', skin: 'nurse', x: 5, y: 2, dir: 'down', role: 'nurse' }], trainers: []
  };

  /* 雷霧・雲上観測塔(任意) (9x7) */
  M.storm_tower = {
    id: 'storm_tower', name: '雲上観測塔', cave: true, music: 'cave',
    encounters: { rate: 0.15, list: [[16, 16, 19, 50], [24, 15, 18, 30], [25, 16, 19, 20]] },
    rows: [
      '^^^^^^^^^',
      '^ccccccc^',
      '^c^^^^^c^',
      '^ccccccc^',
      '^ccccccc^',
      '^ccccccc^',
      '^^^^M^^^^'
    ],
    warps: [{ x: 4, y: 6, to: 'storm', tx: 8, ty: 5 }],
    edgeExits: {}, signs: { '4,4': '塔の 記録\n雷霧は 碧環の みだれの あかし。' }, obstacles: [],
    npcs: [
      { id: 'sw_quest', kind: 'npc', skin: 'girl', x: 4, y: 1, dir: 'down', role: 'quest', quest: 'sqObserve2' },
      { id: 'sw_rec', kind: 'npc', skin: 'prof', x: 2, y: 4, dir: 'down', role: 'questTarget',
        qt: { quest: 'sqObserve2', idx: 0, text: 'きえかけた 記録に ふれ、雷霧の 観測を つなぎとめた。', lockText: 'きえかけた 観測記録が ある。' } }
    ], trainers: []
  };

  /* 雷霧・雷殿(試練→coreStorm) (9x7) */
  M.storm_shrine = {
    id: 'storm_shrine', name: '雷霧の雷殿', cave: true, music: 'gym', encounters: null,
    rows: [
      '^^^^^^^^^',
      '^ccccccc^',
      '^cc^c^cc^',
      '^ccccccc^',
      '^ccccccc^',
      '^ccccccc^',
      '^^^^M^^^^'
    ],
    warps: [{ x: 4, y: 6, to: 'storm', tx: 15, ty: 3 }],
    edgeExits: {}, signs: {}, obstacles: [],
    npcs: [
      { id: 'storm_d0', kind: 'npc', skin: 'man', x: 2, y: 3, dir: 'down', role: 'trialDevice', td: { region: 'storm', idx: 0 } },
      { id: 'storm_d1', kind: 'npc', skin: 'man', x: 6, y: 3, dir: 'down', role: 'trialDevice', td: { region: 'storm', idx: 1 } },
      { id: 'storm_d2', kind: 'npc', skin: 'man', x: 2, y: 5, dir: 'down', role: 'trialDevice', td: { region: 'storm', idx: 2 } },
      { id: 'st_guardian', kind: 'npc', skin: 'leader', x: 4, y: 2, dir: 'down', role: 'guardian',
      guardian: { core: 'coreStorm', region: 'storm', name: '雷の守護獣ライメイチョウ', species: 28, lv: 22,
        pre: ['いかずちと ともに 守護獣が 舞いおりた！'], win: ['雷霧の かんかくが つながった！ これで 4つ すべて…！'] } }],
    trainers: []
  };

  /* ===== 碧環中枢(最終・分岐エンディング) (15x9) ===== */
  M.nexus = {
    id: 'nexus', name: '碧環中枢', cave: true, music: 'ending', encounters: null,
    rows: [
      '^^^^^^^^^^^^^^^',
      '^ccccccccccccc^',
      '^cc^^^ccc^^^cc^',
      '^ccccccccccccc^',
      '^cccc^^^^^cccc^',
      '^cccccgggccccc^',
      '^ccccccccccccc^',
      '^ccccccccccccc^',
      '^^^^^^^.^^^^^^^'
    ],
    warps: [], edgeExits: { down: { tiles: [[7, 8]], to: 'ruins', tx: 7, ty: 1 } },
    signs: { '6,3': '碧環中枢\n世界の ゆくえは、ここで 決まる。' }, obstacles: [],
    npcs: [
      { id: 'ren_nexus', kind: 'npc', skin: 'rival', x: 5, y: 3, dir: 'down', role: 'ren', renStage: 'nexus' },
      { id: 'nexus_core', kind: 'npc', skin: 'prof', x: 9, y: 3, dir: 'down', role: 'nexusCore' }
    ], trainers: []
  };

  window.WorldMaps = M;
})();
