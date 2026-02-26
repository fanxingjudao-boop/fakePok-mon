const VIEW_W = 9;
const VIEW_H = 11;
const W = 61;
const H = 61;
const SAVE_KEY = 'mq_save_v9';
const ITEM_CAPACITY = 99;
const BALL_PRICE = 200;
const POTION_PRICE = 100;

const STARTERS = [
  { id: 4, name: 'ブレイズ', type: 'fire', hp: 120, atk: 26, def: 14 },
  { id: 7, name: 'アクア', type: 'water', hp: 130, atk: 23, def: 16 },
  { id: 1, name: 'リーファ', type: 'grass', hp: 125, atk: 24, def: 15 }
];

const TYPE_MULT = {
  fire: { grass: 1.3, water: 0.75, fire: 1 },
  water: { fire: 1.3, grass: 0.75, water: 1 },
  grass: { water: 1.3, fire: 0.75, grass: 1 }
};

const TOWNS = [
  { id: 'start', name: 'はじまりの町', x: 13, y: 28 },
  { id: 'port', name: 'ミナトの町', x: 41, y: 28 },
  { id: 'north', name: 'キタの町', x: 25, y: 13 },
  { id: 'south', name: 'ミナミの町', x: 26, y: 44 }
];

const TOWN_DETAILS = {
  start: { motif: '草原の交易町' },
  port: { motif: '潮風の港町' },
  north: { motif: '高地の学術都市' },
  south: { motif: '花香る巡礼の町' }
};

const RIVALS = Array.from({ length: 40 }, (_, i) => ({
  id: `r${i + 1}`,
  name: `ライバル${i + 1}`,
  style: ['剣士', '魔導士', '闘士', '王国騎士'][i % 4],
  lvBoost: 2 + (i % 10)
}));

const INTRO_EVENTS = [
  '王都を離れ、君の冒険が始まる。',
  '最初の仲間を選び、4つの町を巡ろう。',
  '港町では海賊にさらわれた娘を助ける依頼が待っている。',
  '宝箱と隠しダンジョンを見つけ、最強の冒険者を目指せ！',
  '王宮で授かった地図には、古代遺跡と真龍の印が刻まれている。',
  '40人のライバルと競い、英雄として名を上げよう。',
  '各地の町で50人の住民が君の活躍を待っている。',
  'エンディング後も、限界突破でLv1000を目指せる。'
];

const WONDER_RANKS = ['旅立ち', '冒険者', '英雄候補', '王国の希望', '伝説', 'マーベラス'];


const RIVAL_LINES = ['ここからが本気だ！', 'まだ旅は終わらない！', '勝負の熱が上がってきた！', '君なら超えてくると思った！'];
const DRAGON_LINES = ['真龍の炎を受けてみよ。', '世界の理を示そう。', 'よくここまで来たな、人の子よ。'];
const NPC_LINES = ['旅人さん、東の森には宝箱が多いよ。', '町の鍛冶屋で装備を強くできるって。', '海へ出るなら船が必要だね。', 'ライバルは強いけど経験値が多いよ。', '教会では記録を残せるんだ。'];
const AREA_LEVELS = { field: 8, forest: 14, coast: 18, desert: 24, mountain: 30, sea: 36, town: 10 };


const STORY_EVENTS = [
  { id: 'pirate_start', title: '港町の依頼', text: '海賊に娘がさらわれた。東のアジトへ向かえ！' },
  { id: 'pirate_clear', title: '救出完了', text: '娘を救出！ 港町へ戻って報告しよう。' },
  { id: 'ship_get', title: '船を入手', text: 'お礼として船を獲得。海を移動可能になった。' },
  { id: 'dragon', title: '終焉の真龍', text: '世界の深部で真龍Lv100が目覚める。' }
];

const QUEST_EVENTS = Array.from({ length: 200 }, (_, i) => ({
  id: `q${i + 1}`,
  title: `サブ依頼 ${i + 1}`,
  text: `地方の依頼 ${i + 1} を達成して報酬を得る。`,
  rewardGil: 40 + (i % 15) * 18
}));

const seeded = (seed) => {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
};

const sprite = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

const NAME_PREFIX = ['フレア', 'アクア', 'リーフ', 'シャドウ', 'ライト', 'ストーン', 'スカイ', 'サンダー', 'ミスト', 'ブレイズ', 'ルナ', 'ソル', 'アイアン', 'クリムゾン', 'シルバー', 'ゴールド', 'ウィンド', 'ストーム', 'サクラ', 'ネビュラ'];
const NAME_SUFFIX = ['ウルフ', 'ドラ', 'バード', 'リザード', 'フェアリ', 'タイガ', 'フォックス', 'ゴーレム', 'スライム', 'ナイト'];

const buildMonsterCatalog = () => {
  const arr = [];
  for (let i = 1; i <= 200; i++) {
    const type = i % 3 === 0 ? 'fire' : i % 3 === 1 ? 'water' : 'grass';
    const name = `${NAME_PREFIX[Math.floor((i - 1) / 10)]}${NAME_SUFFIX[(i - 1) % 10]}`;
    arr.push({
      id: i,
      name,
      type,
      hp: 90 + (i % 35),
      atk: 18 + (i % 20),
      def: 12 + (i % 18),
      sp: sprite(i)
    });
  }
  return arr;
};

const MONSTER_CATALOG = buildMonsterCatalog();

const makeMonster = (base, lv = 1) => ({
  id: base.id,
  name: base.name,
  type: base.type,
  sp: base.sp,
  lv,
  exp: 0,
  expToNext: 80 + lv * 20,
  hpNow: base.hp + lv * 8,
  maxHp: base.hp + lv * 8,
  atkNow: base.atk + lv * 2,
  defNow: base.def + lv * 1.5
});

function buildWorld() {
  const map = Array.from({ length: H }, () => Array.from({ length: W }, () => 'w'));
  for (let y = 3; y < 58; y++) {
    for (let x = 3; x < 58; x++) {
      const cx = (x - 30) / 26;
      const cy = (y - 30) / 23;
      const wave = Math.sin(x * 0.18) * 0.08 + Math.cos(y * 0.15) * 0.08;
      if ((cx * cx + cy * cy + wave) < 1.05) map[y][x] = 'f';
    }
  }
  for (let y = 24; y <= 35; y++) for (let x = 39; x <= 57; x++) map[y][x] = 'f';
  for (let y = 28; y <= 31; y++) for (let x = 33; x <= 39; x++) map[y][x] = 'f';
  for (let y = 9; y < 20; y++) for (let x = 9; x < 22; x++) if (map[y][x] === 'f') map[y][x] = 'G';
  for (let y = 39; y < 52; y++) for (let x = 26; x < 39; x++) if (map[y][x] === 'f') map[y][x] = 'G';
  for (let y = 33; y < 49; y++) for (let x = 7; x < 24; x++) if (map[y][x] !== 'w') map[y][x] = 'm';
  for (let y = 14; y < 24; y++) for (let x = 43; x < 57; x++) if (map[y][x] !== 'w') map[y][x] = 'm';
  for (let y = 46; y < 58; y++) for (let x = 43; x < 58; x++) if (map[y][x] !== 'w') map[y][x] = 'F';
  for (let y = 25; y <= 35; y++) for (let x = 23; x <= 31; x++) map[y][x] = 'w';
  for (let y = 35; y <= 52; y++) map[y][31] = 'w';
  for (let y = 23; y <= 36; y++) { if (map[y][22] === 'f') map[y][22] = 'b'; if (map[y][32] === 'f') map[y][32] = 'b'; }
  for (let y = 6; y <= 13; y++) for (let x = 25; x <= 37; x++) if (map[y][x] === 'f') map[y][x] = 'd';
  for (let y = 50; y <= 57; y++) for (let x = 29; x <= 46; x++) if (map[y][x] === 'f') map[y][x] = 'p';

  for (const t of TOWNS) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) map[t.y + dy][t.x + dx] = 't';
  }

  const road = (x1, y1, x2, y2) => {
    let x = x1, y = y1;
    while (x !== x2 || y !== y2) {
      if (map[y][x] !== 't') map[y][x] = 'r';
      if (x < x2) x++; else if (x > x2) x--;
      else if (y < y2) y++; else if (y > y2) y--;
    }
  };
  road(14, 29, 42, 29); road(14, 29, 26, 14); road(14, 29, 27, 45);

  const dungeons = [
    { id: 'd1', x: 18, y: 17, name: '古代遺跡' },
    { id: 'd2', x: 15, y: 41, name: '黒鉄洞' },
    { id: 'd3', x: 46, y: 18, name: '天空塔' },
    { id: 'd4', x: 52, y: 33, name: '深海神殿' },
    { id: 'd5', x: 35, y: 49, name: '忘却の祠' }
  ];
  dungeons.forEach((d) => (map[d.y][d.x] = 's'));

  const pirateBase = { x: 56, y: 27 };
  map[pirateBase.y][pirateBase.x] = 'h';
  const pirateNpc = { x: 43, y: 29 };

  const dragonLair = { x: 29, y: 6 };
  map[dragonLair.y][dragonLair.x] = 'B';

  const rng = seeded(7777);
  const treasures = {};
  const candidates = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (['f', 'F', 'r', 'd', 'g', 'b', 'p', 'G'].includes(map[y][x])) candidates.push(`${x},${y}`);
    }
  }
  while (Object.keys(treasures).length < 200 && candidates.length) {
    const i = Math.floor(rng() * candidates.length);
    treasures[candidates.splice(i, 1)[0]] = true;
  }

  return { map, dungeons, pirateBase, pirateNpc, dragonLair, treasures };
}

const WORLD = buildWorld();
const canWalk = (tile, boatOwned) => tile !== 'm' && (tile !== 'w' || boatOwned);

const biomeFromTile = (tile) => {
  if (tile === 'w') return 'sea';
  if (tile === 'F' || tile === 'G') return 'forest';
  if (tile === 'm') return 'mountain';
  if (tile === 'd') return 'desert';
  if (tile === 'b') return 'coast';
  if (tile === 't') return 'town';
  if (tile === 's') return 'dungeon';
  return 'field';
};

const townByCell = (x, y) => TOWNS.find((t) => x >= t.x && x <= t.x + 1 && y >= t.y && y <= t.y + 1);
const totalItemCount = (inv) => Object.values(inv).reduce((a, b) => a + b, 0);
const smithCost = (weaponLv) => 200 + (weaponLv - 1) * 150;

const NPCS = (() => {
  const arr = [];
  const rng = seeded(9321);
  const candidates = [];
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const t = WORLD.map[y][x];
      if (['f', 'r', 'G', 'b', 't'].includes(t)) candidates.push({ x, y });
    }
  }
  while (arr.length < 50 && candidates.length) {
    const i = Math.floor(rng() * candidates.length);
    const p = candidates.splice(i, 1)[0];
    arr.push({ id: `n${arr.length + 1}`, name: `住民${arr.length + 1}`, x: p.x, y: p.y, line: NPC_LINES[arr.length % NPC_LINES.length] });
  }
  return arr;
})();
const IRON_SPOTS = (() => {
  const points = {};
  WORLD.dungeons.forEach((d, i) => { points[`${d.x + 1},${d.y}`] = true; points[`${d.x},${d.y + 1}`] = true; if (i < 3) points[`${d.x - 1},${d.y}`] = true; });
  return points;
})();




window.GameData = {
  VIEW_W, VIEW_H, W, H, SAVE_KEY, ITEM_CAPACITY, BALL_PRICE, POTION_PRICE,
  STARTERS, TYPE_MULT, TOWNS, TOWN_DETAILS, RIVALS, INTRO_EVENTS, WONDER_RANKS,
  RIVAL_LINES, DRAGON_LINES, NPC_LINES, AREA_LEVELS, STORY_EVENTS, QUEST_EVENTS,
  WORLD, NPCS, IRON_SPOTS, sprite, makeMonster, biomeFromTile, townByCell,
  totalItemCount, smithCost, canWalk
};
