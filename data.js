/* ============================================================
 * data.js — ゲームデータ層
 * タイプ相性 / わざ / モンスター図鑑 / どうぐ / マップ / トレーナー
 * モンスターはすべてオリジナル。
 * ============================================================ */
(() => {
  /* ---------------- タイプ ---------------- */
  const TYPES = {
    N:  { name: 'ノーマル', color: '#A8A878' },
    F:  { name: 'ほのお',   color: '#F08030' },
    W:  { name: 'みず',     color: '#6890F0' },
    G:  { name: 'くさ',     color: '#78C850' },
    E:  { name: 'でんき',   color: '#E8C020' },
    FL: { name: 'ひこう',   color: '#A890F0' },
    R:  { name: 'いわ',     color: '#B8A038' },
    GH: { name: 'ゴースト', color: '#705898' }
  };

  const TYPE_CHART = {
    N:  { R: 0.5, GH: 0 },
    F:  { G: 2, W: 0.5, F: 0.5, R: 0.5 },
    W:  { F: 2, R: 2, W: 0.5, G: 0.5 },
    G:  { W: 2, R: 2, F: 0.5, G: 0.5, FL: 0.5 },
    E:  { W: 2, FL: 2, G: 0.5, E: 0.5 },
    FL: { G: 2, E: 0.5, R: 0.5 },
    R:  { F: 2, FL: 2 },
    GH: { GH: 2, N: 0 }
  };
  const typeMult = (atk, defTypes) =>
    defTypes.reduce((m, t) => m * (TYPE_CHART[atk]?.[t] ?? 1), 1);

  /* ---------------- わざ ----------------
   * cat: 'phys'(攻撃) | 'status'(変化)
   * fx: {status,chance} / {stat,delta,target,chance} / {heal} / {drain} / {recoilStat}
   */
  const MOVES = {
    tackle:      { name: 'たいあたり',     type: 'N',  cat: 'phys', pow: 40,  acc: 100, pp: 35 },
    quick:       { name: 'でんこうせっか', type: 'N',  cat: 'phys', pow: 40,  acc: 100, pp: 30, priority: 1 },
    slam:        { name: 'のしかかり',     type: 'N',  cat: 'phys', pow: 85,  acc: 100, pp: 15, fx: { status: 'par', chance: 0.3 } },
    slash:       { name: 'きりさく',       type: 'N',  cat: 'phys', pow: 70,  acc: 100, pp: 20, highCrit: true },
    hyperfang:   { name: 'ひっさつまえば', type: 'N',  cat: 'phys', pow: 80,  acc: 90,  pp: 15 },
    growl:       { name: 'なきごえ',       type: 'N',  cat: 'status', acc: 100, pp: 40, fx: { stat: 'atk', delta: -1, target: 'foe' } },
    leer:        { name: 'にらみつける',   type: 'N',  cat: 'status', acc: 100, pp: 30, fx: { stat: 'def', delta: -1, target: 'foe' } },
    harden:      { name: 'かたくなる',     type: 'N',  cat: 'status', acc: 999, pp: 30, fx: { stat: 'def', delta: 1, target: 'self' } },
    agility:     { name: 'こうそくいどう', type: 'N',  cat: 'status', acc: 999, pp: 30, fx: { stat: 'spd', delta: 2, target: 'self' } },
    recover:     { name: 'じこさいせい',   type: 'N',  cat: 'status', acc: 999, pp: 10, fx: { heal: 0.5 } },
    ember:       { name: 'ひのこ',         type: 'F',  cat: 'phys', pow: 40,  acc: 100, pp: 25, fx: { status: 'brn', chance: 0.1 } },
    flamewheel:  { name: 'かえんぐるま',   type: 'F',  cat: 'phys', pow: 60,  acc: 100, pp: 25, fx: { status: 'brn', chance: 0.1 } },
    flamethrower:{ name: 'かえんほうしゃ', type: 'F',  cat: 'phys', pow: 90,  acc: 100, pp: 15, fx: { status: 'brn', chance: 0.1 } },
    fireblast:   { name: 'だいもんじ',     type: 'F',  cat: 'phys', pow: 110, acc: 85,  pp: 5,  fx: { status: 'brn', chance: 0.1 } },
    willowisp:   { name: 'おにび',         type: 'F',  cat: 'status', acc: 85, pp: 15, fx: { status: 'brn', chance: 1 } },
    watergun:    { name: 'みずでっぽう',   type: 'W',  cat: 'phys', pow: 40,  acc: 100, pp: 25 },
    bubblebeam:  { name: 'バブルこうせん', type: 'W',  cat: 'phys', pow: 65,  acc: 100, pp: 20, fx: { stat: 'spd', delta: -1, target: 'foe', chance: 0.1 } },
    surf:        { name: 'なみのり',       type: 'W',  cat: 'phys', pow: 90,  acc: 100, pp: 15 },
    hydropump:   { name: 'ハイドロポンプ', type: 'W',  cat: 'phys', pow: 110, acc: 80,  pp: 5 },
    vinewhip:    { name: 'つるのムチ',     type: 'G',  cat: 'phys', pow: 45,  acc: 100, pp: 25 },
    razorleaf:   { name: 'はっぱカッター', type: 'G',  cat: 'phys', pow: 55,  acc: 95,  pp: 25, highCrit: true },
    gigadrain:   { name: 'ギガドレイン',   type: 'G',  cat: 'phys', pow: 75,  acc: 100, pp: 10, fx: { drain: 0.5 } },
    leafstorm:   { name: 'リーフストーム', type: 'G',  cat: 'phys', pow: 110, acc: 90,  pp: 5,  fx: { stat: 'atk', delta: -1, target: 'self', chance: 1 } },
    sleeppowder: { name: 'ねむりごな',     type: 'G',  cat: 'status', acc: 75, pp: 15, fx: { status: 'slp', chance: 1 } },
    poisonpowder:{ name: 'どくのこな',     type: 'G',  cat: 'status', acc: 75, pp: 35, fx: { status: 'psn', chance: 1 } },
    thundershock:{ name: 'でんきショック', type: 'E',  cat: 'phys', pow: 40,  acc: 100, pp: 30, fx: { status: 'par', chance: 0.1 } },
    thunderbolt: { name: '10まんボルト',   type: 'E',  cat: 'phys', pow: 90,  acc: 100, pp: 15, fx: { status: 'par', chance: 0.1 } },
    thunder:     { name: 'かみなり',       type: 'E',  cat: 'phys', pow: 110, acc: 70,  pp: 10, fx: { status: 'par', chance: 0.3 } },
    thunderwave: { name: 'でんじは',       type: 'E',  cat: 'status', acc: 90, pp: 20, fx: { status: 'par', chance: 1 } },
    peck:        { name: 'つつく',         type: 'FL', cat: 'phys', pow: 35,  acc: 100, pp: 35 },
    wingattack:  { name: 'つばさでうつ',   type: 'FL', cat: 'phys', pow: 60,  acc: 100, pp: 35 },
    airslash:    { name: 'エアスラッシュ', type: 'FL', cat: 'phys', pow: 75,  acc: 95,  pp: 15 },
    rockthrow:   { name: 'いわおとし',     type: 'R',  cat: 'phys', pow: 50,  acc: 90,  pp: 15 },
    rocktomb:    { name: 'がんせきふうじ', type: 'R',  cat: 'phys', pow: 60,  acc: 95,  pp: 15, fx: { stat: 'spd', delta: -1, target: 'foe', chance: 1 } },
    rockslide:   { name: 'いわなだれ',     type: 'R',  cat: 'phys', pow: 75,  acc: 90,  pp: 10 },
    lick:        { name: 'したでなめる',   type: 'GH', cat: 'phys', pow: 30,  acc: 100, pp: 30, fx: { status: 'par', chance: 0.3 } },
    shadowball:  { name: 'シャドーボール', type: 'GH', cat: 'phys', pow: 80,  acc: 100, pp: 15 }
  };

  /* ---------------- モンスター図鑑 ---------------- */
  const S = (id, name, types, base, cr, size, learn, evo, dex) =>
    ({ id, name, types, base, catchRate: cr, size, learn, evo,
       dex, baseExp: Math.floor((base.hp + base.atk + base.def + base.spd) * 0.45) });

  const SPECIES = [
    S(1, 'モリッコ', ['G'], { hp: 45, atk: 49, def: 49, spd: 45 }, 190, 1,
      [[1,'tackle'],[1,'growl'],[5,'vinewhip'],[9,'razorleaf'],[13,'sleeppowder'],[18,'gigadrain'],[26,'leafstorm']],
      { lv: 16, to: 2 }, 'せなかの わかばで こうごうせいを する。ひなたぼっこが だいすき。'),
    S(2, 'モリガルダ', ['G'], { hp: 60, atk: 62, def: 63, spd: 60 }, 120, 2,
      [[1,'tackle'],[1,'growl'],[5,'vinewhip'],[9,'razorleaf'],[13,'sleeppowder'],[18,'gigadrain'],[26,'leafstorm']],
      { lv: 32, to: 3 }, 'はやしの ぬしとして なかまを まもる。ツルの ムチは おとなも たおす。'),
    S(3, 'モリドラード', ['G','FL'], { hp: 80, atk: 84, def: 80, spd: 80 }, 45, 3,
      [[1,'tackle'],[1,'growl'],[5,'vinewhip'],[9,'razorleaf'],[13,'sleeppowder'],[18,'gigadrain'],[26,'leafstorm'],[36,'airslash']],
      null, 'もりの みどりを つばさに かえて おおぞらを かける でんせつの もりりゅう。'),
    S(4, 'ヒバニャ', ['F'], { hp: 39, atk: 52, def: 43, spd: 65 }, 190, 1,
      [[1,'tackle'],[1,'leer'],[6,'ember'],[11,'quick'],[16,'flamewheel'],[24,'flamethrower'],[32,'fireblast']],
      { lv: 16, to: 5 }, 'しっぽの ひだねは きぶんで いろが かわる。おこると まっかに もえる。'),
    S(5, 'ヒバウルフ', ['F'], { hp: 58, atk: 66, def: 55, spd: 80 }, 120, 2,
      [[1,'tackle'],[1,'leer'],[6,'ember'],[11,'quick'],[16,'flamewheel'],[24,'flamethrower'],[32,'fireblast']],
      { lv: 32, to: 6 }, 'むれの せんとうで ほのおを ふきあげ なかまに あいずを おくる。'),
    S(6, 'ゴウカオン', ['F','R'], { hp: 78, atk: 88, def: 72, spd: 95 }, 45, 3,
      [[1,'tackle'],[1,'leer'],[6,'ember'],[11,'quick'],[16,'flamewheel'],[24,'flamethrower'],[32,'fireblast'],[34,'rockslide']],
      null, 'かざんの ちていで きたえた たてがみは ようがんよりも あつい。'),
    S(7, 'ミズモグ', ['W'], { hp: 44, atk: 48, def: 65, spd: 43 }, 190, 1,
      [[1,'tackle'],[1,'growl'],[6,'watergun'],[12,'bubblebeam'],[17,'harden'],[24,'surf'],[32,'hydropump']],
      { lv: 16, to: 8 }, 'あたまの みずぶくろに きれいな みずを たくわえて たびを する。'),
    S(8, 'ミズガメル', ['W'], { hp: 59, atk: 63, def: 80, spd: 58 }, 120, 2,
      [[1,'tackle'],[1,'growl'],[6,'watergun'],[12,'bubblebeam'],[17,'harden'],[24,'surf'],[32,'hydropump']],
      { lv: 32, to: 9 }, 'こうらの みぞを ながれる みずが やじりのように てきを つらぬく。'),
    S(9, 'カイリュウガ', ['W'], { hp: 79, atk: 85, def: 100, spd: 73 }, 45, 3,
      [[1,'tackle'],[1,'growl'],[6,'watergun'],[12,'bubblebeam'],[17,'harden'],[24,'surf'],[32,'hydropump'],[36,'recover']],
      null, 'うみの そこから おおなみを よぶ。せなかの ほうだいは ぜったいの まもり。'),
    S(10, 'コネズミ', ['N'], { hp: 30, atk: 45, def: 35, spd: 60 }, 255, 1,
      [[1,'tackle'],[4,'quick'],[10,'hyperfang'],[16,'slam']],
      { lv: 18, to: 11 }, 'どこにでも あらわれる こねずみ。まえばは いっしょう のびつづける。'),
    S(11, 'オオネズミ', ['N'], { hp: 55, atk: 71, def: 60, spd: 90 }, 127, 2,
      [[1,'tackle'],[4,'quick'],[10,'hyperfang'],[16,'slam'],[24,'slash']],
      null, 'ひっさつまえばは てつの かんづめも かみくだく するどさ。'),
    S(12, 'コバト', ['N','FL'], { hp: 40, atk: 42, def: 35, spd: 56 }, 255, 1,
      [[1,'peck'],[3,'growl'],[9,'quick'],[15,'wingattack'],[27,'airslash']],
      { lv: 20, to: 13 }, 'おとなしい せいかく。すなあびで からだを きれいに たもつ。'),
    S(13, 'アオバズマ', ['N','FL'], { hp: 63, atk: 70, def: 55, spd: 86 }, 120, 2,
      [[1,'peck'],[3,'growl'],[9,'quick'],[15,'wingattack'],[27,'airslash']],
      null, 'あおい かぜを まとい おんそくで きゅうこうか する。'),
    S(14, 'ハナモチ', ['G'], { hp: 45, atk: 42, def: 50, spd: 40 }, 235, 1,
      [[1,'vinewhip'],[8,'sleeppowder'],[12,'poisonpowder'],[20,'gigadrain'],[28,'leafstorm']],
      { lv: 24, to: 15 }, 'あたまの はなから あまい かおりの こなを まきちらす。'),
    S(15, 'ハナカグラ', ['G'], { hp: 65, atk: 68, def: 72, spd: 55 }, 120, 2,
      [[1,'vinewhip'],[8,'sleeppowder'],[12,'poisonpowder'],[20,'gigadrain'],[28,'leafstorm']],
      null, 'まいおどるように はなびらを ちらし みるものを ねむりに さそう。'),
    S(16, 'ビリムシ', ['E'], { hp: 35, atk: 42, def: 45, spd: 40 }, 235, 1,
      [[1,'thundershock'],[8,'harden'],[12,'thunderwave'],[22,'thunderbolt']],
      { lv: 22, to: 17 }, 'おなかの はつでんきかんで しずでんきを ためる。さわると ビリッとくる。'),
    S(17, 'ビリガブト', ['E'], { hp: 60, atk: 75, def: 68, spd: 70 }, 120, 2,
      [[1,'thundershock'],[8,'harden'],[12,'thunderwave'],[22,'thunderbolt'],[35,'thunder']],
      null, 'カブトの つのから 10まんボルトの いなずまを はなつ。'),
    S(18, 'イワコロ', ['R'], { hp: 50, atk: 48, def: 75, spd: 25 }, 220, 1,
      [[1,'tackle'],[6,'rockthrow'],[12,'harden'],[16,'rocktomb'],[24,'rockslide']],
      { lv: 25, to: 19 }, 'まるい いわに てあしが はえたような モンスター。ころがって いどうする。'),
    S(19, 'ガンゴツオ', ['R'], { hp: 75, atk: 85, def: 110, spd: 40 }, 90, 3,
      [[1,'tackle'],[6,'rockthrow'],[12,'harden'],[16,'rocktomb'],[24,'rockslide'],[34,'slam']],
      null, 'やまの ぬし。だいばくはつのような いわなだれを おこす。'),
    S(20, 'ユラビ', ['GH','F'], { hp: 30, atk: 50, def: 32, spd: 70 }, 200, 1,
      [[1,'lick'],[8,'ember'],[14,'willowisp'],[24,'shadowball']],
      { lv: 28, to: 21 }, 'ゆらゆら ゆれる ひとだま。よみちで であうと ついてくる。'),
    S(21, 'ヨミビト', ['GH','F'], { hp: 55, atk: 80, def: 55, spd: 95 }, 90, 2,
      [[1,'lick'],[8,'ember'],[14,'willowisp'],[24,'shadowball'],[32,'flamethrower']],
      null, 'あおじろい ほのおの ころもを まとう。たましいを みちびくと いわれる。'),
    S(22, 'ミズウオ', ['W'], { hp: 40, atk: 46, def: 40, spd: 52 }, 235, 1,
      [[1,'watergun'],[10,'quick'],[14,'bubblebeam'],[20,'agility'],[26,'surf']],
      { lv: 26, to: 23 }, 'きれいな みずべにしか すめない。うろこは ほうせきのように ひかる。'),
    S(23, 'オオミズチ', ['W'], { hp: 70, atk: 80, def: 68, spd: 72 }, 90, 3,
      [[1,'watergun'],[10,'quick'],[14,'bubblebeam'],[20,'agility'],[26,'surf'],[34,'hydropump']],
      null, 'あめを よぶ みずへび。かんばつの むらを すくった でんせつが のこる。'),
    S(24, 'デンネコ', ['E'], { hp: 45, atk: 58, def: 42, spd: 72 }, 180, 1,
      [[1,'thundershock'],[6,'quick'],[13,'thunderwave'],[26,'thunderbolt']],
      null, 'ひげの さきから でんきを ながす。きまぐれで いたずらずき。'),
    S(25, 'カザリス', ['FL'], { hp: 42, atk: 58, def: 42, spd: 78 }, 180, 1,
      [[1,'peck'],[7,'quick'],[13,'wingattack'],[25,'airslash'],[30,'agility']],
      null, 'かぜの ながれを よんで まいあがる トカゲどり。'),
    S(26, 'アワガニ', ['W'], { hp: 42, atk: 50, def: 68, spd: 35 }, 210, 1,
      [[1,'tackle'],[6,'harden'],[9,'watergun'],[15,'bubblebeam'],[24,'surf']],
      null, 'あわを ふいて てきの めを くらます。ハサミの ちからは いっちょまえ。'),
    S(27, 'ヒノコマ', ['F'], { hp: 48, atk: 60, def: 42, spd: 70 }, 170, 1,
      [[1,'tackle'],[7,'ember'],[11,'quick'],[17,'flamewheel'],[28,'flamethrower']],
      null, 'たてがみの ほのおは しんらいの あかし。みとめた ひとしか のせない。'),
    S(28, 'ライメイチョウ', ['E','FL'], { hp: 90, atk: 98, def: 85, spd: 112 }, 15, 3,
      [[1,'peck'],[1,'thundershock'],[20,'airslash'],[30,'thunderbolt'],[40,'agility'],[50,'thunder']],
      null, 'らいうんとともに あらわれる でんせつの らいちょう。ひとばんで そらを ひとまわりする。')
  ];
  const speciesById = (id) => SPECIES.find((s) => s.id === id);

  /* ---------------- どうぐ ---------------- */
  const ITEMS = {
    ball:        { name: 'モンスターボール', price: 200,  kind: 'ball', rate: 1 },
    superball:   { name: 'スーパーボール',   price: 600,  kind: 'ball', rate: 1.5 },
    potion:      { name: 'キズぐすり',       price: 300,  kind: 'heal', amount: 20 },
    superpotion: { name: 'いいキズぐすり',   price: 700,  kind: 'heal', amount: 50 },
    hyperpotion: { name: 'すごいキズぐすり', price: 1500, kind: 'heal', amount: 120 },
    antidote:    { name: 'どくけし',         price: 100,  kind: 'cure', cures: 'psn' },
    parlyzheal:  { name: 'まひなおし',       price: 200,  kind: 'cure', cures: 'par' },
    awakening:   { name: 'ねむけざまし',     price: 250,  kind: 'cure', cures: 'slp' },
    burnheal:    { name: 'やけどなおし',     price: 250,  kind: 'cure', cures: 'brn' },
    fullheal:    { name: 'なんでもなおし',   price: 600,  kind: 'cure', cures: 'all' },
    revive:      { name: 'げんきのかけら',   price: 1500, kind: 'revive' }
  };
  const MART_STOCK = {
    minamo:    ['ball', 'potion', 'antidote', 'parlyzheal'],
    hanazono:  ['ball', 'potion', 'antidote', 'awakening', 'parlyzheal'],
    hibana:    ['ball', 'potion', 'superpotion', 'awakening', 'burnheal', 'parlyzheal'],
    kazemine:  ['ball', 'superball', 'superpotion', 'fullheal', 'parlyzheal'],
    raiden:    ['ball', 'superball', 'superpotion', 'fullheal', 'parlyzheal'],
    yomigaoka: ['superball', 'superpotion', 'fullheal', 'burnheal', 'revive'],
    iwado:     ['superball', 'superpotion', 'hyperpotion', 'fullheal', 'revive'],
    tsukimi:   ['superball', 'hyperpotion', 'fullheal', 'revive']
  };

  /* ---------------- バッジ (8個) ---------------- */
  const BADGES = [
    { id: 'badge1', name: 'しずくバッジ',   color: '#48a8e8' },
    { id: 'badge2', name: 'リーフバッジ',   color: '#58b048' },
    { id: 'badge3', name: 'ひだねバッジ',   color: '#e86840' },
    { id: 'badge4', name: 'つばさバッジ',   color: '#a890f0' },
    { id: 'badge5', name: 'いかずちバッジ', color: '#e8c020' },
    { id: 'badge6', name: 'たそがれバッジ', color: '#705898' },
    { id: 'badge7', name: 'がんせきバッジ', color: '#a89058' },
    { id: 'badge8', name: 'みかづきバッジ', color: '#c0c0d0' }
  ];

  /* ---------------- マップ ---------------- */
  const norm = (rows) => {
    const w = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => r.padEnd(w, r[0] === '#' ? '#' : r[0] === '^' ? '^' : 'T'));
  };

  const CITY_ROWS = norm([
    'TTTTTTTTTT..TTTTTTTTTT',
    'T,,,,,,,,,..,,,,,,,,,T',
    'T..RRRR....RRRR..RRRRT',
    'T..RRRR....RRRR..RRRRT',
    'T..BDBB....BBDB..BDBBT',
    'T....................T',
    'T,,,,,,....,,,,,,,,,,T',
    'T..S...RRRRRR......,,T',
    'T......RRRRRR........T',
    '.......BBBDBB.........',
    'T....................T',
    'T,,,,....WWW......,,,T',
    'T,,,,....WWW......,,,T',
    'T....................T',
    'TTTTTTTTTT..TTTTTTTTTT'
  ]);

  const HOMETOWN_ROWS = norm([
    'TTTTTTTTT..TTTTTTTTT',
    'T,,,,,,,,..,,,,,,,,T',
    'T..RRRR......RRRR..T',
    'T..RRRR......RRRR..T',
    'T..BDBB......BDBB..T',
    'T..................T',
    'T,,,..RRRRRR....,,,T',
    'T,,...RRRRRR.....,,T',
    'T.....BBBDBB.......T',
    'T..S...............T',
    'T,,,,....,,,,....,,T',
    'T....WWW.........,,T',
    'T....WWW...........T',
    'T..................T',
    'TTTTTTTTTTTTTTTTTTTT'
  ]);

  const ROUTE1_ROWS = norm([
    'TTTTTTTTT..TTTTTTTTT',
    'T,,,%%%,,..,,,,,,,,T',
    'T,,,%%%,..%%%,,,,,,T',
    'T,,,%%%,..%%%,,S,,,T',
    'T,,,,,,,..%%%,,,,,,T',
    'T,,TT,,,..,,,,,TT,,T',
    'T,,TT,,...,,,,,TT,,T',
    'T,,,,,..,,,,,,,,,,,T',
    'T,%%%,..%%%%,,,,,,,T',
    'T,%%%,..%%%%,,,,,,,T',
    'T,%%%,..%%%%,,TT,,,T',
    'T,,,,,..,,,,,,TT,,,T',
    'T,,,,,..,,,,,,,,,,,T',
    'T,,,,,...,,,,,,,,,,T',
    'T,,%%%,..%%%,,,,,,,T',
    'T,,%%%,..%%%,,,,,,,T',
    'T,,,,,,..,,,,,,,,,,T',
    'TTTTTTTTT..TTTTTTTTT'
  ]);

  const ROUTE2_ROWS = norm([
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'T,,,%%%,,,,,,,,,,,,,%%%%,,,,,T',
    'T,,,%%%,,TT,,,,,,,,,%%%%,,,,,T',
    'T,,,,,,,,TT,,,,S,,,,,,,,,,,,,T',
    'T,,,,,,,,,,,,,,,,,,,,,,TT,,,,T',
    'T,%%%,,,,,,,,,,,,,,,,,,TT,,,,T',
    '..............................',
    'T,%%%,,,,WWWW,,,,,,,,,,,,,,,,T',
    'T,,,,,,,,WWWW,,,,%%%,,,,,,,,,T',
    'T,,,,,,,,,,,,,,,,%%%,,,,,,,,,T',
    'T,,,%%%,,,,,,,,,,%%%,,,,,,,,,T',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT'
  ]);

  const ROUTE3_ROWS = norm([
    '^^^^^^^^^^^^^^^^^^^^^^^^',
    '^ccccxx^^^ccccxxxc^^ccc^',
    '^ccccxx^^ccccccxxxc^ccc^',
    '^cccccc^^cccccccccc^ccc^',
    '^cc^^ccccccxxcc^^cccccc^',
    '^cc^^ccccccxxcc^^cccccc^',
    '^cccccccccccccccccccccc^',
    'cccccccccccccccccccccccc',
    '^cccccccccccccccccccccc^',
    '^ccxxxcc^^^cccxxcc^^ccc^',
    '^ccxxxcc^^^cccxxcc^^ccc^',
    '^cccccc^^^^cccccccccccc^',
    '^^^^^^^^^^^^^^^^^^^^^^^^'
  ]);

  const ROUTE4_ROWS = norm([
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'T,,,%%%%,,,,,,,,,%%%%,,,,,,T',
    'T,,,%%%%,,TT,,,,,%%%%,,TT,,T',
    'T,,,,,,,,,TT,,,,,,,,,,,TT,,T',
    'T,,S,,,,,,,,,,,,,,,,,,,,,,,T',
    'T,,,,,,,,,,,,,,,,,,,,,,,,,,T',
    '............................',
    'T,,,,,,,WWWW,,,,,,,,,,,,,,,T',
    'T,%%%,,,WWWW,,,,%%%%,,,,,,,T',
    'T,%%%,,,,,,,,,,,%%%%,,,,,,,T',
    'T,,,,,,,,,,,,,,,,,,,,,,,,,,T',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTT'
  ]);

  const VICTORY_ROWS = norm([
    '^^^^^^^^^cc^^^^^^^^^',
    '^cccccccccccccccccc^',
    '^ccxxcc^^^^^ccxxxcc^',
    '^ccxxcc^^^^^ccxxxcc^',
    '^cccccc^^^^^ccccccc^',
    '^^^^ccc^^^^^ccc^^^^^',
    '^cccccccccccccccccc^',
    '^ccxxxcccccccxxxxcc^',
    '^cccccccccccccccccc^',
    '^^^^^^^cc^^^^^^^^^^^',
    '^cccccccccccccccccc^',
    '^ccxxcc^^^^ccxxxccc^',
    '^ccxxcc^^^^ccxxxccc^',
    '^cccccccccccccccccc^',
    '^^^^^ccc^^^^^ccc^^^^',
    '^cccccccccccccccccc^',
    '^cccccccccccccccccc^',
    '^^^^^^^^^cc^^^^^^^^^'
  ]);

  const HOUSE_ROWS = norm([
    '##########',
    '#________#',
    '#_##__##_#',
    '#________#',
    '#________#',
    '#________#',
    '####MM####'
  ]);

  const LAB_ROWS = norm([
    '############',
    '#_########_#',
    '#__________#',
    '#__________#',
    '#___###____#',
    '#__________#',
    '#__________#',
    '#__________#',
    '#####MM#####'
  ]);

  const CENTER_ROWS = norm([
    '############',
    '#_########_#',
    '#__________#',
    '#__######__#',
    '#__________#',
    '#__________#',
    '#__________#',
    '#####MM#####'
  ]);

  const GYM_ROWS = norm([
    '############',
    '#____gg____#',
    '#__________#',
    '#_g______g_#',
    '#__________#',
    '#__________#',
    '#_g______g_#',
    '#__________#',
    '#__________#',
    '#__________#',
    '#__________#',
    '#####MM#####'
  ]);

  const LEAGUE_ROWS = norm([
    '############',
    '#____##____#',
    '#__________#',
    '#__________#',
    '#____==____#',
    '#____==____#',
    '#____==____#',
    '#____==____#',
    '#____==____#',
    '#____==____#',
    '#____==____#',
    '#____==____#',
    '#____==____#',
    '#####MM#####'
  ]);

  /* トレーナー定義ヘルパ */
  const TR = (id, o) => ({ id, kind: 'trainer', sight: 3, ...o });

  const MAPS = {};

  MAPS.hometown = {
    id: 'hometown', name: 'コダチタウン', rows: HOMETOWN_ROWS, outdoor: true, music: 'town',
    roofColor: '#c85040',
    warps: [
      { x: 4, y: 4, to: 'home', tx: 4, ty: 5 },
      { x: 14, y: 4, to: 'friendhouse', tx: 4, ty: 5 },
      { x: 9, y: 8, to: 'lab', tx: 5, ty: 7 }
    ],
    edgeExits: { up: { tiles: [[9, 0], [10, 0]], to: 'route1', tx: 9, ty: 16 } },
    signs: { '3,9': 'コダチタウン\n「みどりの かぜが ふきぬける まち」' },
    npcs: [
      { id: 'ht_boy', kind: 'npc', skin: 'boy2', x: 12, y: 10, dir: 'down',
        text: ['となりまち へは きたの ルート1を ぬけるんだ。', 'こうげきタイプの あいしょうって しってる？ みずは ほのおに つよいんだよ。'] },
      { id: 'ht_old', kind: 'npc', skin: 'man', x: 16, y: 12, dir: 'left',
        text: ['カエデはかせは モンスターの けんきゅうで ゆうめいじゃ。', 'くさむらには やせいの モンスターが ひそんでおる。きをつけなされ。'] }
    ],
    trainers: []
  };

  MAPS.route1 = {
    id: 'route1', name: 'ルート1', rows: ROUTE1_ROWS, outdoor: true, music: 'route',
    encounters: { rate: 0.14, list: [[10, 2, 4, 40], [12, 2, 4, 40], [14, 3, 5, 20]] },
    warps: [],
    edgeExits: {
      up: { tiles: [[9, 0], [10, 0]], to: 'minamo', tx: 10, ty: 13 },
      down: { tiles: [[9, 17], [10, 17]], to: 'hometown', tx: 9, ty: 1 }
    },
    signs: { '15,3': 'ルート1\nコダチタウン ⇔ ミナモシティ' },
    npcs: [],
    trainers: [
      TR('r1_boy', { name: 'たんパンこぞうの コウタ', skin: 'boy2', x: 14, y: 6, dir: 'left',
        team: [[10, 3], [12, 4]], money: 120,
        pre: ['おっ！ トレーナーだね？\nしょうぶ しようぜ！'], lose: ['つよいなあ〜！'],
        after: ['ジムリーダーの マリナさんは みずタイプの つかいてだよ。'] }),
      TR('r1_girl', { name: 'ミニスカートの ユミ', skin: 'girl', x: 4, y: 12, dir: 'right',
        team: [[14, 5]], money: 150,
        pre: ['わたしの ハナモチ かわいいでしょ？\nでも つよいんだから！'], lose: ['きゃー まけちゃった！'],
        after: ['くさむらを さければ モンスターは でてこないわ。'] })
    ]
  };

  const cityBase = (id, name, roofColor) => ({
    id, name, rows: CITY_ROWS, outdoor: true, music: 'town', roofColor,
    warps: [
      { x: 4, y: 4, to: `center_${id}`, tx: 5, ty: 6 },
      { x: 13, y: 4, to: `mart_${id}`, tx: 5, ty: 6 },
      { x: 10, y: 9, to: `gym_${id}`, tx: 5, ty: 10 }
    ],
    lockedDoors: [{ x: 18, y: 4 }]
  });

  MAPS.minamo = {
    ...cityBase('minamo', 'ミナモシティ', '#4878c8'),
    edgeExits: {
      down: { tiles: [[10, 14], [11, 14]], to: 'route1', tx: 9, ty: 1 },
      right: { tiles: [[21, 9]], to: 'route2', tx: 1, ty: 6 }
    },
    signs: { '3,7': 'ミナモシティ\n「しずくが かがやく みずの みやこ」' },
    npcs: [
      { id: 'mn_guide', kind: 'npc', skin: 'man', x: 19, y: 9, dir: 'left', blockIf: '!badge1',
        text: ['この さきは ルート2。\nジムバッジを もってないと あぶないから とおせないよ！\nまずは この まちの ジムに ちょうせん しな！'],
        unlockText: ['その しずくバッジ…！ やるねえ。\nルート2を とおって いいよ！'] },
      { id: 'mn_girl', kind: 'npc', skin: 'girl', x: 16, y: 11, dir: 'down',
        text: ['モンスターセンターでは むりょうで かいふく してくれるの。', 'あかい やねが センター、あおい やねが おみせよ。'] }
    ],
    trainers: []
  };

  MAPS.route2 = {
    id: 'route2', name: 'ルート2', rows: ROUTE2_ROWS, outdoor: true, music: 'route',
    encounters: { rate: 0.13, list: [[12, 8, 11, 35], [14, 8, 11, 30], [22, 9, 12, 25], [20, 10, 10, 10]] },
    warps: [],
    edgeExits: {
      left: { tiles: [[0, 6]], to: 'minamo', tx: 20, ty: 9 },
      right: { tiles: [[29, 6]], to: 'hanazono', tx: 1, ty: 9 }
    },
    signs: { '15,3': 'ルート2\nミナモシティ ⇔ ハナゾノシティ' },
    npcs: [
      { id: 'r2_kid', kind: 'npc', skin: 'boy2', x: 14, y: 6, dir: 'down', role: 'gruntsKid',
        text: ['ダークスターだんの ヤツらが ぼくの デンネコを うばおうと したんだ…！'] }
    ],
    trainers: [
      TR('r2_rival', { rival: true, name: 'ライバルの レン', skin: 'rival', x: 20, y: 6, dir: 'left', sight: 4,
        hideIf: 'rival2', flagOnWin: 'rival2',
        pre: ['よう ユウ！ もう バッジを とったのか？\nオレの あたらしい チームを みせてやるよ！'],
        lose: ['チッ… そだてかたが ちがうな…'],
        team: 'RIVAL2', money: 800,
        afterScript: ['つぎは まけないからな！ オレは さきに いくぜ！'] }),
      TR('r2_grunt1', { name: 'ダークスターだんの したっぱ', skin: 'grunt', x: 11, y: 6, dir: 'left', sight: 3,
        hideIf: 'grunts', flagOnWin: 'g1',
        pre: ['ジャマするな ガキ！\nダークスターだんは モンスターを いただいて いくのさ！'],
        lose: ['な なんだと〜！？'],
        team: [[20, 9], [10, 9]], money: 300,
        after: ['ダークスターだんは でんせつの ライメイチョウを ねらって いるのさ…' ] }),
      TR('r2_grunt2', { name: 'ダークスターだんの したっぱ', skin: 'grunt', x: 16, y: 6, dir: 'left', sight: 3,
        hideIf: 'grunts', flagOnWin: 'g2',
        pre: ['へへっ この さきは とおさねえよ！'],
        lose: ['おぼえてろ〜！'],
        team: [[10, 10], [20, 9]], money: 300,
        after: ['ボスは ヴィクトリーロードで けいかくを すすめている…しまった しゃべりすぎた！'] }),
      TR('r2_boy', { name: 'むしとりしょうねんの シュン', skin: 'boy2', x: 25, y: 6, dir: 'left',
        team: [[16, 9], [16, 10]], money: 200,
        pre: ['ビリムシは でんきを ためるんだぜ！'], lose: ['ビリビリ〜…'],
        after: ['ヒバナシティの ジムは ほのおタイプ。みずタイプが いると らくだよ。'] })
    ]
  };

  MAPS.hanazono = {
    ...cityBase('hanazono', 'ハナゾノシティ', '#58a848'),
    edgeExits: {
      left: { tiles: [[0, 9]], to: 'route2', tx: 28, ty: 6 },
      right: { tiles: [[21, 9]], to: 'route5', tx: 1, ty: 6 }
    },
    signs: { '3,7': 'ハナゾノシティ\n「はなの かおりに つつまれた まち」' },
    npcs: [
      { id: 'hz_girl', kind: 'npc', skin: 'girl', x: 16, y: 11, dir: 'down',
        text: ['ジムリーダーの ボタンさんは くさタイプの めいじんよ。', 'ほのおタイプか ひこうタイプが いると らくに たたかえるわ。'] },
      { id: 'hz_man', kind: 'npc', skin: 'man', x: 6, y: 6, dir: 'down',
        text: ['ひがしの ルート5を ぬけると ヒバナシティだ。'] }
    ],
    trainers: []
  };

  MAPS.route5 = {
    id: 'route5', name: 'ルート5', rows: ROUTE2_ROWS, outdoor: true, music: 'route',
    encounters: { rate: 0.13, list: [[14, 12, 15, 30], [12, 12, 15, 30], [20, 13, 16, 20], [10, 12, 14, 20]] },
    warps: [],
    edgeExits: {
      left: { tiles: [[0, 6]], to: 'hanazono', tx: 20, ty: 9 },
      right: { tiles: [[29, 6]], to: 'hibana', tx: 1, ty: 9 }
    },
    signs: { '15,3': 'ルート5\nハナゾノシティ ⇔ ヒバナシティ' },
    npcs: [],
    trainers: [
      TR('r5_girl', { name: 'ミニスカートの アオイ', skin: 'girl', x: 11, y: 6, dir: 'left',
        team: [[14, 13], [12, 14]], money: 300,
        pre: ['おはなに かこまれて しょうぶ しましょ！'], lose: ['はなびらが ちっちゃう〜！'],
        after: ['ねむりごなを うけたら ねむけざましが たよりになるわ。'] }),
      TR('r5_boy', { name: 'むしとりしょうねんの マコト', skin: 'boy2', x: 22, y: 6, dir: 'left',
        team: [[16, 14], [16, 15]], money: 280,
        pre: ['ビリムシ 2ひきの でんげきコンボだ！'], lose: ['ショートしちゃった…'],
        after: ['ヒバナシティの ジムは ほのおタイプ。みずが あると あんしんだよ。'] })
    ]
  };

  MAPS.hibana = {
    ...cityBase('hibana', 'ヒバナシティ', '#c86028'),
    edgeExits: {
      left: { tiles: [[0, 9]], to: 'route5', tx: 28, ty: 6 },
      right: { tiles: [[21, 9]], to: 'route6', tx: 1, ty: 6 }
    },
    signs: { '3,7': 'ヒバナシティ\n「ひだねが ともる かじの まち」' },
    npcs: [
      { id: 'hb_man', kind: 'npc', skin: 'man', x: 16, y: 11, dir: 'down',
        text: ['ひがしの ルート6の さきは かぜのまち カゼミネシティだ。', 'そらを とぶ モンスターが おおい みちだぞ。'] },
      { id: 'hb_girl', kind: 'npc', skin: 'girl', x: 6, y: 6, dir: 'down',
        text: ['やけどには やけどなおし！ おみせで うってるわ。'] }
    ],
    trainers: []
  };

  MAPS.route6 = {
    id: 'route6', name: 'ルート6', rows: ROUTE4_ROWS, outdoor: true, music: 'route',
    encounters: { rate: 0.13, list: [[25, 17, 20, 30], [12, 17, 19, 25], [27, 18, 21, 25], [24, 17, 20, 20]] },
    warps: [],
    edgeExits: {
      left: { tiles: [[0, 6]], to: 'hibana', tx: 20, ty: 9 },
      right: { tiles: [[27, 6]], to: 'kazemine', tx: 1, ty: 9 }
    },
    signs: { '3,4': 'ルート6\nヒバナシティ ⇔ カゼミネシティ' },
    npcs: [],
    trainers: [
      TR('r6_bird', { name: 'とりつかいの ハヤテ', skin: 'man', x: 14, y: 6, dir: 'left',
        team: [[12, 18], [25, 19]], money: 450,
        pre: ['かぜを よむのは とくいなんだ！ いくぞ！'], lose: ['かぜむきが かわったか…'],
        after: ['カゼミネジムの カザミさんは ひこうタイプの つかいてだ。'] }),
      TR('r6_kid', { name: 'エリートこぞうの ジュン', skin: 'boy2', x: 22, y: 8, dir: 'left',
        team: [[27, 19], [10, 18]], money: 420,
        pre: ['ヒノコマの スピードに ついてこれるかな！'], lose: ['はやさだけじゃ ダメか…'],
        after: ['でんきわざは ひこうタイプに ばつぐんだよ。'] })
    ]
  };

  MAPS.kazemine = {
    ...cityBase('kazemine', 'カゼミネシティ', '#8878d8'),
    edgeExits: {
      left: { tiles: [[0, 9]], to: 'route6', tx: 26, ty: 6 },
      right: { tiles: [[21, 9]], to: 'route3', tx: 1, ty: 7 }
    },
    signs: { '3,7': 'カゼミネシティ\n「たかなる かぜの ふく おか」' },
    npcs: [
      { id: 'kz_man', kind: 'npc', skin: 'man', x: 16, y: 11, dir: 'down',
        text: ['ひがしの ビリビリどうくつを ぬけると ライデンシティだ。', 'どうくつには でんきモンスターが おおいぞ。'] },
      { id: 'kz_girl', kind: 'npc', skin: 'girl', x: 6, y: 6, dir: 'down',
        text: ['ひこうタイプは いわと でんきが にがて。おぼえておいてね。'] }
    ],
    trainers: []
  };

  MAPS.route3 = {
    id: 'route3', name: 'ビリビリどうくつ', rows: ROUTE3_ROWS, outdoor: false, cave: true, music: 'cave',
    encounters: { rate: 0.16, list: [[16, 20, 23, 40], [18, 20, 23, 35], [20, 21, 24, 25]] },
    warps: [],
    edgeExits: {
      left: { tiles: [[0, 7]], to: 'kazemine', tx: 20, ty: 9 },
      right: { tiles: [[23, 7]], to: 'raiden', tx: 1, ty: 9 }
    },
    signs: {},
    npcs: [],
    trainers: [
      TR('r3_hiker', { name: 'やまおとこの ゴロウ', skin: 'man', x: 6, y: 6, dir: 'right',
        team: [[18, 22], [16, 21]], money: 700,
        pre: ['ガハハ！ どうくつで きたえた イワコロを みせてやろう！'], lose: ['ガハハ！ まいった まいった！'],
        after: ['いわタイプは でんきに つよいが みずと くさには よわいのだ。'] }),
      TR('r3_sci', { name: 'けんきゅういんの ミドリ', skin: 'girl', x: 16, y: 8, dir: 'left',
        team: [[16, 23]], money: 750,
        pre: ['この どうくつの せいでんきを けんきゅう しています。\nデータ しゅうしゅうに ごきょうりょく ください！'],
        lose: ['きちょうな データが とれました…'],
        after: ['ビリムシは Lv22で ビリガブトに しんかします。'] })
    ]
  };

  MAPS.raiden = {
    ...cityBase('raiden', 'ライデンシティ', '#c8a020'),
    edgeExits: {
      left: { tiles: [[0, 9]], to: 'route3', tx: 22, ty: 7 },
      right: { tiles: [[21, 9]], to: 'route7', tx: 1, ty: 6 }
    },
    signs: { '3,7': 'ライデンシティ\n「いかずちに まもられし まち」' },
    npcs: [
      { id: 'rd_man', kind: 'npc', skin: 'man', x: 16, y: 11, dir: 'down',
        text: ['ライゾウさんの でんげきは ほんものだぜ。まひに きをつけな。'] },
      { id: 'rd_girl', kind: 'npc', skin: 'girl', x: 6, y: 6, dir: 'down',
        text: ['ダークスターだんって しってる？ モンスターを うばう わるい ヤツらよ。'] }
    ],
    trainers: []
  };

  MAPS.route7 = {
    id: 'route7', name: 'ルート7', rows: ROUTE2_ROWS, outdoor: true, music: 'route',
    encounters: { rate: 0.13, list: [[24, 24, 27, 30], [25, 24, 27, 25], [15, 25, 27, 20], [11, 24, 26, 25]] },
    warps: [],
    edgeExits: {
      left: { tiles: [[0, 6]], to: 'raiden', tx: 20, ty: 9 },
      right: { tiles: [[29, 6]], to: 'yomigaoka', tx: 1, ty: 9 }
    },
    signs: { '15,3': 'ルート7\nライデンシティ ⇔ ヨミガオカシティ' },
    npcs: [],
    trainers: [
      TR('r7_man', { name: 'けんきゅういんの ノボル', skin: 'man', x: 11, y: 6, dir: 'left',
        team: [[17, 25], [16, 24]], money: 600,
        pre: ['しんかの けんきゅうちゅうです。データを とらせてください！'], lose: ['すばらしい サンプルです…'],
        after: ['ヨミガオカシティには ゴーストタイプの ジムが あります。'] }),
      TR('r7_rival', { rival: true, name: 'ライバルの レン', skin: 'rival', x: 20, y: 6, dir: 'left', sight: 4,
        hideIf: 'rival3', flagOnWin: 'rival3',
        pre: ['ユウ！ バッジは いくつ あつめた？\nオレの チームは もう しあがってきたぜ！'],
        lose: ['また まけた…！？ なんでだよ！'],
        team: 'RIVAL3', money: 1500,
        afterScript: ['……つよくなったな。でも チャンピオンに なるのは オレだ！\nじゃあな！'] })
    ]
  };

  MAPS.yomigaoka = {
    ...cityBase('yomigaoka', 'ヨミガオカシティ', '#584878'),
    edgeExits: {
      left: { tiles: [[0, 9]], to: 'route7', tx: 28, ty: 6 },
      right: { tiles: [[21, 9]], to: 'route4', tx: 1, ty: 6 }
    },
    signs: { '3,7': 'ヨミガオカシティ\n「たそがれどきに ひが ともる まち」' },
    npcs: [
      { id: 'ym_girl', kind: 'npc', skin: 'girl', x: 16, y: 11, dir: 'down',
        text: ['ゴーストタイプに ノーマルわざは あたらないの。しってた？', 'シノブさんの ヨミビトは とっても はやいわよ。'] },
      { id: 'ym_man', kind: 'npc', skin: 'man', x: 6, y: 6, dir: 'down',
        text: ['よみちで ユラビに であったら ついてこられるぞ…ひひひ。'] }
    ],
    trainers: []
  };

  MAPS.route4 = {
    id: 'route4', name: 'ルート4', rows: ROUTE4_ROWS, outdoor: true, music: 'route',
    encounters: { rate: 0.13, list: [[24, 28, 31, 30], [25, 28, 31, 25], [15, 29, 32, 20], [11, 28, 31, 25]] },
    warps: [],
    edgeExits: {
      left: { tiles: [[0, 6]], to: 'yomigaoka', tx: 20, ty: 9 },
      right: { tiles: [[27, 6]], to: 'iwado', tx: 1, ty: 9 }
    },
    signs: { '3,4': 'ルート4\nヨミガオカシティ ⇔ イワドシティ' },
    npcs: [],
    trainers: [
      TR('r4_boy', { name: 'エリートこぞうの タクマ', skin: 'boy2', x: 14, y: 6, dir: 'left',
        team: [[11, 29]], money: 800,
        pre: ['ここまで これたなら なかなかの うでまえ…だが オレには かてない！'], lose: ['ぐぬぬ…'],
        after: ['イワドシティの ガンテツさんは この ちほう さいこうの いわつかいだ。'] }),
      TR('r4_bird', { name: 'とりつかいの ワタル', skin: 'man', x: 22, y: 8, dir: 'left',
        team: [[13, 30], [25, 29]], money: 850,
        pre: ['そらを まう つばさの うつくしさ みせてやろう！'], lose: ['はばたきが たりなかったか…'],
        after: ['ひこうタイプは でんきと いわが にがてなんだ。'] })
    ]
  };

  MAPS.iwado = {
    ...cityBase('iwado', 'イワドシティ', '#907850'),
    edgeExits: {
      left: { tiles: [[0, 9]], to: 'route4', tx: 26, ty: 6 },
      right: { tiles: [[21, 9]], to: 'route8', tx: 1, ty: 6 }
    },
    signs: { '3,7': 'イワドシティ\n「いわはだに きざまれし れきし」' },
    npcs: [
      { id: 'iw_girl', kind: 'npc', skin: 'girl', x: 16, y: 11, dir: 'down',
        text: ['ひがしの ルート8の さきは ツキミシティ。さいごの ジムが あるわ。', 'その きたには ヴィクトリーロードと モンスターリーグ…！'] },
      { id: 'iw_man', kind: 'npc', skin: 'man', x: 6, y: 6, dir: 'down',
        text: ['ガンテツさんの ガンゴツオは この ちほう いちの かたさだ。'] }
    ],
    trainers: []
  };

  MAPS.route8 = {
    id: 'route8', name: 'ルート8', rows: ROUTE4_ROWS, outdoor: true, music: 'route',
    encounters: { rate: 0.13, list: [[11, 31, 34, 30], [13, 31, 34, 25], [21, 32, 35, 20], [17, 31, 34, 25]] },
    warps: [],
    edgeExits: {
      left: { tiles: [[0, 6]], to: 'iwado', tx: 20, ty: 9 },
      right: { tiles: [[27, 6]], to: 'tsukimi', tx: 1, ty: 9 }
    },
    signs: { '3,4': 'ルート8\nイワドシティ ⇔ ツキミシティ' },
    npcs: [],
    trainers: [
      TR('r8_vet', { name: 'ベテラントレーナーの ジンペイ', skin: 'man', x: 14, y: 6, dir: 'left',
        team: [[19, 33], [23, 33]], money: 1100,
        pre: ['リーグを めざす わかものよ！ この ジンペイが ためして やろう！'], lose: ['うむ…みごとな うでまえ！'],
        after: ['ツキミシティの ゲッコウさんは ノーマルタイプの めいじんだ。'] }),
      TR('r8_girl', { name: 'おとなの おねえさんの ルリ', skin: 'girl', x: 22, y: 8, dir: 'left',
        team: [[15, 33], [13, 34]], money: 1000,
        pre: ['つきよの しょうぶって ロマンチックでしょ？'], lose: ['まけちゃった…でも いいしょうぶ だったわ。'],
        after: ['げんきのかけらは もった？ この さきは ながい みちのりよ。'] })
    ]
  };

  MAPS.tsukimi = {
    ...cityBase('tsukimi', 'ツキミシティ', '#8890b8'),
    edgeExits: {
      left: { tiles: [[0, 9]], to: 'route8', tx: 26, ty: 6 },
      up: { tiles: [[10, 0], [11, 0]], to: 'victory', tx: 9, ty: 16 }
    },
    signs: { '3,7': 'ツキミシティ\n「つきかげ やどる さいはての まち」' },
    npcs: [
      { id: 'tk_guard', kind: 'npc', skin: 'man', x: 9, y: 1, dir: 'down', blockIf: '!badge8',
        text: ['この さきは ヴィクトリーロード。\nリーグに いどむには 8つの バッジが ひつようだ！'] },
      { id: 'tk_girl', kind: 'npc', skin: 'girl', x: 16, y: 11, dir: 'down',
        text: ['ヴィクトリーロードの おくに モンスターリーグが あるのよ。', 'チャンピオンは まだ わかいのに とても つよいんだって。'] }
    ],
    trainers: []
  };

  MAPS.victory = {
    id: 'victory', name: 'ヴィクトリーロード', rows: VICTORY_ROWS, outdoor: false, cave: true, music: 'cave',
    encounters: { rate: 0.15, list: [[18, 34, 38, 30], [17, 34, 38, 30], [21, 35, 39, 20], [19, 35, 38, 20]] },
    warps: [],
    edgeExits: {
      down: { tiles: [[9, 17], [10, 17]], to: 'tsukimi', tx: 10, ty: 1 },
      up: { tiles: [[9, 0], [10, 0]], to: 'league', tx: 5, ty: 12 }
    },
    signs: {},
    npcs: [],
    trainers: [
      TR('vc_t1', { name: 'ベテラントレーナーの レイジ', skin: 'man', x: 4, y: 7, dir: 'right',
        team: [[19, 36], [17, 37]], money: 1400,
        pre: ['リーグに いどむものよ！ この レイジが ためして やろう！'], lose: ['みごとな たたかい だった！'],
        after: ['チャンピオンは でんせつの モンスターを つれて いると いう うわさだ…'] }),
      TR('vc_boss', { name: 'ダークスターだんボス ゲンバ', skin: 'boss', x: 7, y: 10, dir: 'down', sight: 3,
        hideIf: 'boss', flagOnWin: 'boss', boss: true,
        pre: ['…ここまで くるとはな。\nワシは ダークスターだんボス ゲンバ。\nでんせつの ライメイチョウの ちからで せかいを にぎる…！\nジャマを するなら ようしゃは せん！'],
        lose: ['バカな… ワシの やぼうが…！'],
        team: [[21, 39], [19, 40], [17, 40]], money: 5000,
        afterScript: ['…ライメイチョウは ダークスターだんの ワシではなく きみのような トレーナーを えらぶのかも しれんな。\nだんは かいさんだ…' ] }),
      TR('vc_t2', { name: 'ベテラントレーナーの アヤメ', skin: 'girl', x: 15, y: 12, dir: 'left',
        team: [[15, 37], [23, 38]], money: 1450,
        pre: ['さいごの しれんよ！ ぜんりょくで きなさい！'], lose: ['この さきは あなたの ぶたい ね。'],
        after: ['かいふくは じゅうぶんに？ この さきに センターは ないわよ。'] }),
      TR('vc_rival', { rival: true, name: 'ライバルの レン', skin: 'rival', x: 9, y: 1, dir: 'down', sight: 4,
        hideIf: 'rival4', flagOnWin: 'rival4',
        pre: ['ユウ…！ やっぱり ここまで きたか。\nリーグの まえに オレが かつ！'],
        lose: ['くそっ…！ なんで かてないんだ…'],
        team: 'RIVAL4', money: 3000,
        afterScript: ['…みとめるよ。おまえは つよい。\nでも チャンピオンは オレより ずっと つよいぜ。\nおたがい ここまで きたんだ。さいごまで あきらめるなよ！'] })
    ]
  };

  MAPS.league = {
    id: 'league', name: 'モンスターリーグ', rows: LEAGUE_ROWS, outdoor: false, music: 'gym',
    warps: [{ x: 5, y: 13, to: 'victory', tx: 9, ty: 1 }, { x: 6, y: 13, to: 'victory', tx: 9, ty: 1 }],
    edgeExits: {},
    signs: {},
    npcs: [
      { id: 'champion', kind: 'npc', skin: 'rival', x: 5, y: 3, dir: 'down', role: 'champion' }
    ],
    trainers: []
  };

  /* 屋内マップ生成 */
  const inn = (id, rows, backTo, bx, by, extra) => {
    MAPS[id] = {
      id, rows, outdoor: false, indoor: true, music: 'town',
      warps: rowsMats(rows).map(([x, y]) => ({ x, y, to: backTo, tx: bx, ty: by })),
      edgeExits: {}, signs: {}, npcs: [], trainers: [], ...extra
    };
  };
  const rowsMats = (rows) => {
    const out = [];
    rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'M') out.push([x, y]); }));
    return out;
  };

  inn('home', HOUSE_ROWS, 'hometown', 4, 5, {
    name: 'ユウの いえ',
    npcs: [{ id: 'mom', kind: 'npc', skin: 'girl', x: 6, y: 3, dir: 'left', role: 'mom' }]
  });
  inn('friendhouse', HOUSE_ROWS, 'hometown', 14, 5, {
    name: 'レンの いえ',
    npcs: [{ id: 'renmom', kind: 'npc', skin: 'girl', x: 6, y: 3, dir: 'left',
      text: ['あら いらっしゃい。レンは カエデはかせの けんきゅうじょに いるわよ。',
             'あのこ ライバルは ユウくんだって いつも いってるの。ふふ。'] }]
  });
  inn('lab', LAB_ROWS, 'hometown', 9, 9, {
    name: 'カエデ けんきゅうじょ',
    npcs: [{ id: 'prof', kind: 'npc', skin: 'prof', x: 5, y: 3, dir: 'down', role: 'prof' }]
  });

  const GYM_DATA = {
    minamo: {
      leader: { name: 'ジムリーダーの マリナ', skin: 'leader', badge: 'badge1',
        team: [[26, 12], [22, 14]], money: 1500,
        pre: ['ようこそ ミナモジムへ。\nわたしは マリナ。みずの しんぴを あなたに みせるわ！'],
        lose: ['まけたわ…あなたの ちからは ほんもの ね。'],
        award: ['しずくバッジを さずけます。\nルート2の けんもんを とおれるように なるわ。\nつぎは ハナゾノシティの ジムを めざしなさい！'] },
      trainer: TR('gt_minamo', { name: 'かいパンやろうの トオル', skin: 'boy2', x: 3, y: 6, dir: 'right',
        team: [[22, 12]], money: 300,
        pre: ['ジムに ちょうせん するのか？ まずは オレと しょうぶだ！'], lose: ['ザブーン…'],
        after: ['マリナさんの アワガニは まもりが かたいぞ。'] })
    },
    hanazono: {
      leader: { name: 'ジムリーダーの ボタン', skin: 'leader', badge: 'badge2',
        team: [[14, 16], [15, 18]], money: 1800,
        pre: ['ハナゾノジムへ ようこそ。\nわたしは ボタン。はなと みどりの まいを ごらんなさい！'],
        lose: ['はなは ちっても また さくわ。みごとでした。'],
        award: ['リーフバッジを さずけます。\nひがしの ルート5を ぬけて ヒバナシティへ どうぞ！'] },
      trainer: TR('gt_hanazono', { name: 'ミニスカートの スミレ', skin: 'girl', x: 3, y: 6, dir: 'right',
        team: [[14, 15]], money: 350,
        pre: ['おはなの ジムだからって あまく みないでね！'], lose: ['しおれちゃう〜！'],
        after: ['ボタンさんの ハナカグラは ねむりごなを つかうわ。'] })
    },
    hibana: {
      leader: { name: 'ジムリーダーの エンジ', skin: 'leader', badge: 'badge3',
        team: [[20, 20], [27, 22]], money: 2200,
        pre: ['よく きた！ ワシは エンジ。\nほのおの ねっぷうを あじわう がいい！'],
        lose: ['みごとな しょうぶ だった！'],
        award: ['ひだねバッジを さずけよう。\nひがしの ルート6を ぬけて カゼミネシティへ すすむのだ！'] },
      trainer: TR('gt_hibana', { name: 'ひふきやろうの カジ', skin: 'boy2', x: 3, y: 6, dir: 'right',
        team: [[20, 19]], money: 400,
        pre: ['アチチな しょうぶと いこうぜ！'], lose: ['もえつきたぜ…'],
        after: ['エンジさんの ヒノコマは はやくて つよい。まひや ねむりが きくぞ。'] })
    },
    kazemine: {
      leader: { name: 'ジムリーダーの カザミ', skin: 'leader', badge: 'badge4',
        team: [[25, 24], [13, 26]], money: 2500,
        pre: ['カゼミネジムに ようこそ！ わたしは カザミ。\nおおぞらの じゆうを みせてあげる！'],
        lose: ['かぜが やんだ…あなたの かちよ。'],
        award: ['つばさバッジを さずけるわ。\nひがしの ビリビリどうくつを ぬけて ライデンシティへ！'] },
      trainer: TR('gt_kazemine', { name: 'とりつかいの ソラ', skin: 'boy2', x: 3, y: 6, dir: 'right',
        team: [[25, 23]], money: 450,
        pre: ['そらの たかみから しょうぶだ！'], lose: ['ついらく〜！'],
        after: ['カザミさんの アオバズマは おんそくで つっこんでくるぞ。'] })
    },
    raiden: {
      leader: { name: 'ジムリーダーの ライゾウ', skin: 'leader', badge: 'badge5',
        team: [[24, 27], [17, 29]], money: 2800,
        pre: ['オレは ライゾウ！ いなずまの ごとき スピードに ついてこれるか！？'],
        lose: ['シビれる ようなしょうぶ だったぜ！'],
        award: ['いかずちバッジを やろう！\nつぎは ヨミガオカシティ。ゴーストつかいの シノブが まってるぜ！'] },
      trainer: TR('gt_raiden', { name: 'エンジニアの デンタ', skin: 'man', x: 3, y: 6, dir: 'right',
        team: [[16, 26], [24, 27]], money: 500,
        pre: ['でんあつ MAXで いくぜ！'], lose: ['ショート しちまった…'],
        after: ['でんきわざは みずと ひこうに ばつぐんだ。'] })
    },
    yomigaoka: {
      leader: { name: 'ジムリーダーの シノブ', skin: 'leader', badge: 'badge6',
        team: [[20, 30], [21, 32]], money: 3100,
        pre: ['…ようこそ。わたしは シノブ。\nたそがれの むこうがわを のぞかせて あげましょう…'],
        lose: ['…ひかりが やみを はらったの ね。'],
        award: ['たそがれバッジを さずけます…\nにしの ルート4の さき イワドシティへ おゆきなさい…'] },
      trainer: TR('gt_yomigaoka', { name: 'きとうしの レイ', skin: 'girl', x: 3, y: 6, dir: 'right',
        team: [[20, 29]], money: 550,
        pre: ['この ジムに はいった もの…ただでは かえさない…'], lose: ['じょうぶつ できそう…'],
        after: ['ノーマルわざは ゴーストに あたらない。きをつけて…'] })
    },
    iwado: {
      leader: { name: 'ジムリーダーの ガンテツ', skin: 'leader', badge: 'badge7',
        team: [[18, 33], [19, 35]], money: 3400,
        pre: ['ワシが ガンテツ。いわは すべてを うけとめる。\nきみの かくごを ぶつけて みよ！'],
        lose: ['…うむ。りっぱな トレーナーに なったな。'],
        award: ['がんせきバッジだ。もっていけ。\nさいごの ジムは ひがしの ツキミシティ。\nゲッコウさんが きみを まっているぞ！'] },
      trainer: TR('gt_iwado', { name: 'からておうの ゴウ', skin: 'man', x: 3, y: 6, dir: 'right',
        team: [[18, 32]], money: 600,
        pre: ['おす！ きあいだーッ！'], lose: ['おす！ まいりました！'],
        after: ['ガンテツさんの ガンゴツオは ぼうぎょが てつのように かたい。'] })
    },
    tsukimi: {
      leader: { name: 'ジムリーダーの ゲッコウ', skin: 'leader', badge: 'badge8',
        team: [[11, 36], [13, 38]], money: 4000,
        pre: ['ツキミジムへ ようこそ。わたくしが ゲッコウ。\nかざりのない ノーマルタイプこそ しんの つよさ。\nまんげつの よるの ように しずかに まいりましょう。'],
        lose: ['……つきも みちれば かける。おみごとです。'],
        award: ['みかづきバッジを さずけましょう。\n8つの バッジが そろいましたね。\nきたの ヴィクトリーロードを ぬけ リーグへ…！\nあなたの ものがたりの さいしゅうしょうです。'] },
      trainer: TR('gt_tsukimi', { name: 'エリートトレーナーの ミヤビ', skin: 'girl', x: 3, y: 6, dir: 'right',
        team: [[11, 35]], money: 700,
        pre: ['ゲッコウさまに あう まえに わたしを たおして いきなさい！'], lose: ['おみそれ しました…'],
        after: ['ゲッコウさまの アオバズマは ひこうわざも つかうわ。'] })
    }
  };

  for (const cid of ['minamo', 'hanazono', 'hibana', 'kazemine', 'raiden', 'yomigaoka', 'iwado', 'tsukimi']) {
    inn(`center_${cid}`, CENTER_ROWS, cid, 4, 5, {
      name: 'モンスターセンター', music: 'town',
      npcs: [{ id: `nurse_${cid}`, kind: 'npc', skin: 'nurse', x: 5, y: 2, dir: 'down', role: 'nurse' }]
    });
    inn(`mart_${cid}`, CENTER_ROWS, cid, 13, 5, {
      name: 'モンスターマート', music: 'town',
      npcs: [{ id: `clerk_${cid}`, kind: 'npc', skin: 'clerk', x: 5, y: 2, dir: 'down', role: 'clerk', stock: MART_STOCK[cid] }]
    });
    const gd = GYM_DATA[cid];
    inn(`gym_${cid}`, GYM_ROWS, cid, 10, 10, {
      name: `${MAPS[cid].name.replace('シティ', '')}ジム`, music: 'gym',
      npcs: [{ id: `leader_${cid}`, kind: 'npc', skin: gd.leader.skin, x: 5, y: 2, dir: 'down', role: 'leader', leader: gd.leader }],
      trainers: [gd.trainer]
    });
  }

  /* ライバルの手持ち (スターター相性: プレイヤーが選んだ ID に対抗) */
  const rivalStarter = (playerStarterId) =>
    playerStarterId === 1 ? 4 : playerStarterId === 4 ? 7 : 1; // 草→炎, 炎→水, 水→草
  const RIVAL_TEAMS = {
    RIVAL1: (st) => [[rivalStarter(st), 5]],
    RIVAL2: (st) => [[12, 11], [rivalStarter(st), 13]],
    RIVAL3: (st) => [[13, 30], [24, 31], [speciesById(rivalStarter(st)).evo.to, 32]],
    RIVAL4: (st) => {
      const mid = speciesById(rivalStarter(st)).evo.to;
      const final = speciesById(mid).evo.to;
      return [[13, 38], [24, 38], [19, 39], [final, 40]];
    },
    CHAMPION: (st) => {
      const mid = speciesById(rivalStarter(st)).evo.to;
      const final = speciesById(mid).evo.to;
      return [[13, 45], [24, 44], [19, 46], [28, 49], [final, 47]];
    }
  };

  const STARTERS = [1, 4, 7];

  const solidChars = new Set(['T', 'W', 'R', 'B', 'S', 'F', '^', '#', 'g']);
  const isSolidTile = (c) => solidChars.has(c);
  const isEncounterTile = (c) => c === '%' || c === 'x';

  const hasAllBadges = (flags) => BADGES.every((b) => flags && flags[b.id]);
  const badgeCount = (flags) => BADGES.reduce((n, b) => n + (flags && flags[b.id] ? 1 : 0), 0);

  /* ---- 環核(碧環の4つのコア)。地域試練クリアで得るストーリーフラグ ---- */
  const CORE_FLAGS = ['coreForest', 'coreTide', 'coreFlare', 'coreStorm'];
  const coreCount = (flags) => CORE_FLAGS.reduce((n, f) => n + (flags && flags[f] ? 1 : 0), 0);

  /* ---- フィールド能力(=地形の鍵)。特定種族を強制せず「タイプ」で判定する。
   * 複数タイプが同じ能力を満たせる場合もある(複数解決手段)。 ---- */
  const ABILITY_TYPES = {
    clearLog:   { types: ['F'],       label: '倒木を 焼きはらう', by: 'ほのお' },
    lowerWater: { types: ['W'],       label: '水位を さげる',     by: 'みず' },
    breakRock:  { types: ['R', 'W'],  label: '岩を くだく/冷ます', by: 'いわ・みず' },
    glide:      { types: ['FL'],      label: '崖を こえる',       by: 'ひこう' },
    charge:     { types: ['E'],       label: 'そうちに つうでんする', by: 'でんき' }
  };
  // 手持ちが持つフィールド能力の集合(種族タイプから導出)
  function abilitiesOfParty(party) {
    const set = new Set();
    for (const m of (party || [])) {
      const sp = speciesById(m && m.spId);
      if (!sp) continue;
      for (const [ab, def] of Object.entries(ABILITY_TYPES))
        if (def.types.some((t) => sp.types.includes(t))) set.add(ab);
    }
    return set;
  }
  const abilityLabel = (ab) => (ABILITY_TYPES[ab] ? `${ABILITY_TYPES[ab].label}(${ABILITY_TYPES[ab].by}タイプ)` : ab);

  /* 通行条件の共通判定。data側に requirements を持たせ、意味とエラー文をデータで定義する。
   * requirements: {
   *   allFlags:[...], anyFlags:[...], allBadges:true, minCores:N, minPartyLevel:N,
   *   anyAbilities:[...], allAbilities:[...], text:'…'
   * }
   * ctx: { flags, party } を渡す。 戻り値 { ok, text }
   */
  function meetsRequirements(req, ctx) {
    if (!req) return { ok: true };
    const flags = (ctx && ctx.flags) || {};
    const party = (ctx && ctx.party) || [];
    if (req.allBadges && !hasAllBadges(flags))
      return { ok: false, text: req.text || `8つの ジムバッジが ひつようだ！(いま ${badgeCount(flags)}こ)` };
    if (req.minCores && coreCount(flags) < req.minCores)
      return { ok: false, text: req.text || `${req.minCores}つの かんかくが ひつようだ(いま ${coreCount(flags)}つ)。` };
    if (req.allFlags && !req.allFlags.every((f) => flags[f]))
      return { ok: false, text: req.text || 'まだ ここは とおれないようだ。' };
    if (req.anyFlags && !req.anyFlags.some((f) => flags[f]))
      return { ok: false, text: req.text || 'まだ ここは とおれないようだ。' };
    if (req.anyAbilities || req.allAbilities) {
      const have = abilitiesOfParty(party);
      if (req.anyAbilities && !req.anyAbilities.some((a) => have.has(a)))
        return { ok: false, text: req.text || `${req.anyAbilities.map(abilityLabel).join(' か ')}の ちからが ひつよう。` };
      if (req.allAbilities && !req.allAbilities.every((a) => have.has(a)))
        return { ok: false, text: req.text || `${req.allAbilities.map(abilityLabel).join(' と ')}の ちからが ひつよう。` };
    }
    if (req.minPartyLevel) {
      const maxLv = party.reduce((mx, m) => Math.max(mx, m.lv || 0), 0);
      if (maxLv < req.minPartyLevel)
        return { ok: false, text: req.text || `つよさが たりない(Lv${req.minPartyLevel}いじょう ひつよう)。` };
    }
    return { ok: true };
  }

  // 新ワールド(world-maps.js)があればそれを採用。無ければ旧マップ(後方互換)。
  const ACTIVE_MAPS = (typeof window !== 'undefined' && window.WorldMaps) ? window.WorldMaps : MAPS;

  window.GameData = {
    TYPES, TYPE_CHART, typeMult, MOVES, SPECIES, speciesById,
    ITEMS, MART_STOCK, BADGES, MAPS: ACTIVE_MAPS, RIVAL_TEAMS, STARTERS,
    isSolidTile, isEncounterTile, hasAllBadges, badgeCount, meetsRequirements,
    CORE_FLAGS, coreCount, ABILITY_TYPES, abilitiesOfParty, abilityLabel
  };
})();
