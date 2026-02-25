const { useMemo, useState, useEffect } = React;

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

const RIVALS = [
  { id: 'r1', name: 'カイン', style: '剣士', lvBoost: 2 },
  { id: 'r2', name: 'ミレイ', style: '魔導士', lvBoost: 4 },
  { id: 'r3', name: 'ガルド', style: '闘士', lvBoost: 6 },
  { id: 'r4', name: 'セレナ', style: '王国騎士', lvBoost: 8 }
];

const INTRO_EVENTS = [
  '王都を離れ、君の冒険が始まる。',
  '最初の仲間を選び、4つの町を巡ろう。',
  '港町では海賊にさらわれた娘を助ける依頼が待っている。',
  '宝箱と隠しダンジョンを見つけ、最強の冒険者を目指せ！'
];

const STORY_EVENTS = [
  { id: 'pirate_start', title: '港町の依頼', text: '海賊に娘がさらわれた。東のアジトへ向かえ！' },
  { id: 'pirate_clear', title: '救出完了', text: '娘を救出！ 港町へ戻って報告しよう。' },
  { id: 'ship_get', title: '船を入手', text: 'お礼として船を獲得。海を移動可能になった。' },
  { id: 'dragon', title: '終焉の真龍', text: '世界の深部で真龍Lv1000が目覚める。' }
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

const buildMonsterCatalog = () => {
  const arr = [];
  for (let i = 1; i <= 200; i++) {
    const type = i % 3 === 0 ? 'fire' : i % 3 === 1 ? 'water' : 'grass';
    arr.push({
      id: i,
      name: `モンスター${i}`,
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

function App() {
  const [screen, setScreen] = useState('title');
  const [introIdx, setIntroIdx] = useState(0);
  const [hero, setHero] = useState({ name: 'リンク', lv: 1, exp: 0, expToNext: 100, hpNow: 180, maxHp: 180, atk: 28, def: 16, mp: 30, weaponLv: 1 });
  const [party, setParty] = useState([]);
  const [guild, setGuild] = useState([]);
  const [activeMon, setActiveMon] = useState(0);
  const [enemy, setEnemy] = useState(null);
  const [battleBiome, setBattleBiome] = useState('field');
  const [battleMode, setBattleMode] = useState('wild');
  const [pos, setPos] = useState({ x: 14, y: 29 });
  const [facing, setFacing] = useState('down');
  const [walking, setWalking] = useState(false);
  const [stepA, setStepA] = useState(false);
  const [turn, setTurn] = useState('hero');
  const [encounterSteps, setEncounterSteps] = useState(8);
  const [gil, setGil] = useState(900);
  const [inventory, setInventory] = useState({ potion: 3, ball: 10, iron: 2 });
  const [logs, setLogs] = useState(['王都より南、冒険が始まる。']);
  const [eventsDone, setEventsDone] = useState([]);
  const [boatOwned, setBoatOwned] = useState(false);
  const [pirateQuest, setPirateQuest] = useState({ accepted: false, rescued: false, complete: false });
  const [foundDungeons, setFoundDungeons] = useState({});
  const [collectedTreasure, setCollectedTreasure] = useState({});
  const [showBag, setShowBag] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [townId, setTownId] = useState(null);
  const [dungeonState, setDungeonState] = useState(null);

  const currentMon = party[activeMon];
  const pendingEvents = useMemo(() => QUEST_EVENTS.filter((e) => !eventsDone.includes(e.id)).slice(0, 20), [eventsDone]);
  const treasureCount = Object.keys(collectedTreasure).length;

  const view = useMemo(() => {
    const rows = [];
    const rx = Math.floor(VIEW_W / 2), ry = Math.floor(VIEW_H / 2);
    for (let y = pos.y - ry; y <= pos.y + ry; y++) {
      const row = [];
      for (let x = pos.x - rx; x <= pos.x + rx; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) row.push({ t: 'void', x, y });
        else row.push({
          t: WORLD.map[y][x],
          x, y,
          treasure: !!WORLD.treasures[`${x},${y}`] && !collectedTreasure[`${x},${y}`],
          npc: x === WORLD.pirateNpc.x && y === WORLD.pirateNpc.y,
          dragon: x === WORLD.dragonLair.x && y === WORLD.dragonLair.y
        });
      }
      rows.push(row);
    }
    return rows;
  }, [pos, collectedTreasure]);

  const saveData = (next = {}) => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      hero, party, guild, activeMon, pos, facing, encounterSteps, gil, inventory,
      eventsDone, boatOwned, pirateQuest, foundDungeons, collectedTreasure,
      dungeonState, ...next
    }));
  };

  const loadData = () => {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return;
    try {
      const d = JSON.parse(s);
      if (d.party?.length) {
        setHero(d.hero || hero);
        setParty(d.party);
        setGuild(d.guild || []);
        setActiveMon(d.activeMon || 0);
        setPos(d.pos || { x: 14, y: 29 });
        setFacing(d.facing || 'down');
        setEncounterSteps(d.encounterSteps || 8);
        setGil(d.gil || 900);
        setInventory(d.inventory || { potion: 3, ball: 10, iron: 2 });
        setEventsDone(d.eventsDone || []);
        setBoatOwned(!!d.boatOwned);
        setPirateQuest(d.pirateQuest || { accepted: false, rescued: false, complete: false });
        setFoundDungeons(d.foundDungeons || {});
        setCollectedTreasure(d.collectedTreasure || {});
        setDungeonState(d.dungeonState || null);
        setScreen('world');
      }
    } catch (e) { console.error(e); }
  };

  useEffect(loadData, []);

  useEffect(() => {
    if (screen !== 'battle' || turn !== 'enemy' || !enemy || !currentMon) return;
    const t = setTimeout(() => {
      const targetHero = hero.hpNow > 0 && (currentMon.hpNow <= 0 || Math.random() < 0.55);
      if (targetHero) {
        const d = Math.max(6, Math.floor(enemy.atkNow - hero.def * 0.55 + Math.random() * 8));
        setHero((h) => ({ ...h, hpNow: Math.max(0, h.hpNow - d) }));
        setLogs((l) => [`${enemy.name}の攻撃！ リンクに${d}ダメージ`, ...l].slice(0, 12));
      } else {
        const mult = TYPE_MULT[enemy.type]?.[currentMon.type] || 1;
        const d = Math.max(6, Math.floor((enemy.atkNow * mult) - currentMon.defNow * 0.55 + Math.random() * 8));
        const np = [...party];
        np[activeMon] = { ...currentMon, hpNow: Math.max(0, currentMon.hpNow - d) };
        setParty(np);
        setLogs((l) => [`${enemy.name}の攻撃！ ${currentMon.name}に${d}ダメージ`, ...l].slice(0, 12));
      }
      setTurn('hero');
    }, 450);
    return () => clearTimeout(t);
  }, [screen, turn, enemy, hero, currentMon, party, activeMon]);

  useEffect(() => {
    if (screen !== 'battle' || !enemy || !currentMon || enemy.hpNow > 0) return;
    const gain = battleMode === 'boss' ? 3000 : battleMode === 'rival' ? 500 : 140;
    const newHeroExp = hero.exp + gain;
    let newHero = { ...hero, exp: newHeroExp };
    if (newHero.exp >= newHero.expToNext) {
      newHero = {
        ...newHero,
        lv: newHero.lv + 1,
        exp: newHero.exp - newHero.expToNext,
        expToNext: Math.floor(newHero.expToNext * 1.2),
        maxHp: newHero.maxHp + 14,
        hpNow: newHero.hpNow + 14,
        atk: newHero.atk + 2,
        def: newHero.def + 1
      };
    }

    const np = [...party];
    const m = np[activeMon];
    const monExp = m.exp + gain;
    np[activeMon] = {
      ...m,
      exp: monExp >= m.expToNext ? monExp - m.expToNext : monExp,
      lv: monExp >= m.expToNext ? m.lv + 1 : m.lv,
      expToNext: monExp >= m.expToNext ? Math.floor(m.expToNext * 1.18) : m.expToNext,
      maxHp: monExp >= m.expToNext ? m.maxHp + 10 : m.maxHp,
      hpNow: monExp >= m.expToNext ? Math.min(m.maxHp + 10, m.hpNow + 10) : m.hpNow,
      atkNow: monExp >= m.expToNext ? m.atkNow + 2 : m.atkNow,
      defNow: monExp >= m.expToNext ? m.defNow + 1.5 : m.defNow
    };

    const addGil = battleMode === 'boss' ? 10000 : battleMode === 'rival' ? 1000 : gain;
    setHero(newHero); setParty(np); setGil((g) => g + addGil);
    if (screen === 'battle') setScreen(dungeonState ? 'dungeon' : 'world');
    setLogs((l) => [`${enemy.name}を倒した！ ヒーロー/仲間に${gain}EXP`, ...l].slice(0, 12));

    if (dungeonState && dungeonState.floor % 5 === 0) {
      setDungeonState((d) => ({ ...d, clearedBossFloors: { ...(d.clearedBossFloors || {}), [d.floor]: true } }));
    }
    saveData({ hero: newHero, party: np });
  }, [enemy, screen]);

  const startGame = (starter) => {
    const m = makeMonster({ ...starter, sp: sprite(starter.id) }, 1);
    setHero({ name: 'リンク', lv: 1, exp: 0, expToNext: 100, hpNow: 180, maxHp: 180, atk: 28, def: 16, mp: 30, weaponLv: 1 });
    setParty([m]);
    setGuild([]);
    setActiveMon(0);
    setScreen('intro');
    setIntroIdx(0);
    setPos({ x: 14, y: 29 });
    setEncounterSteps(8);
    setGil(900);
    setInventory({ potion: 3, ball: 10, iron: 2 });
    setEventsDone([]);
    setBoatOwned(false);
    setPirateQuest({ accepted: false, rescued: false, complete: false });
    setFoundDungeons({});
    setCollectedTreasure({});
    setDungeonState(null);
  };

  const makeEnemy = (levelBase, forced) => {
    if (forced) return forced;
    const base = MONSTER_CATALOG[Math.floor(Math.random() * MONSTER_CATALOG.length)];
    return makeMonster(base, Math.max(2, levelBase + Math.floor(Math.random() * 3) - 1));
  };

  const triggerEncounter = (forcedEnemy = null, mode = 'wild', forcedBiome = null) => {
    const tile = WORLD.map[pos.y][pos.x];
    const levelBase = dungeonState ? dungeonState.entryLv + Math.floor((dungeonState.floor - 1) / 2) : currentMon.lv;
    const e = makeEnemy(levelBase, forcedEnemy);
    setBattleBiome(forcedBiome || biomeFromTile(tile));
    setBattleMode(mode);
    setEnemy(e);
    setTurn('hero');
    setScreen('battle');
    setLogs((l) => [`エンカウント！ ${e.name} が現れた`, ...l].slice(0, 12));
  };

  const checkDiscover = (x, y) => {
    const key = `${x},${y}`;
    if (WORLD.treasures[key] && !collectedTreasure[key]) {
      const next = { ...collectedTreasure, [key]: true };
      const gain = 25 + (Object.keys(next).length % 7) * 6;
      setCollectedTreasure(next);
      setGil((g) => g + gain);
      setLogs((l) => [`宝箱を開けた！ ${gain}ギル獲得（${Object.keys(next).length}/200）`, ...l].slice(0, 12));
    }
    for (const d of WORLD.dungeons) {
      if (d.x === x && d.y === y && !foundDungeons[d.id]) {
        const fd = { ...foundDungeons, [d.id]: true };
        setFoundDungeons(fd);
        setLogs((l) => [`隠しダンジョン発見: ${d.name}（${Object.keys(fd).length}/5）`, ...l].slice(0, 12));
      }
    }
    if (pirateQuest.accepted && !pirateQuest.rescued && x === WORLD.pirateBase.x && y === WORLD.pirateBase.y) {
      const q = { ...pirateQuest, rescued: true };
      setPirateQuest(q);
      setLogs((l) => ['海賊アジトを制圧！ 娘を救出した。港町へ戻ろう。', ...l].slice(0, 12));
    }
  };

  const move = (dx, dy, dir) => {
    if (walking || screen !== 'world' || !currentMon) return;
    setFacing(dir);
    const nx = Math.max(0, Math.min(W - 1, pos.x + dx));
    const ny = Math.max(0, Math.min(H - 1, pos.y + dy));
    const tile = WORLD.map[ny][nx];
    if (!canWalk(tile, boatOwned)) {
      setLogs((l) => [tile === 'w' ? '海だ。船が必要だ。' : 'その先は進めない。', ...l].slice(0, 12));
      return;
    }

    setWalking(true);
    setStepA((s) => !s);
    setPos({ x: nx, y: ny });
    checkDiscover(nx, ny);

    const t = townByCell(nx, ny);
    if (t) {
      setTownId(t.id);
      setScreen('town');
      setLogs((l) => [`${t.name}に入った。`, ...l].slice(0, 12));
      setTimeout(() => setWalking(false), 120);
      return;
    }

    if (tile === 's') {
      const dungeon = WORLD.dungeons.find((d) => d.x === nx && d.y === ny);
      if (dungeon) {
        setDungeonState({ dungeonId: dungeon.id, name: dungeon.name, floor: 5, entryLv: Math.max(hero.lv, currentMon.lv), clearedBossFloors: {} });
        setScreen('dungeon');
        setLogs((l) => [`${dungeon.name}に突入！ 地下5Fから開始`, ...l].slice(0, 12));
        setTimeout(() => setWalking(false), 120);
        return;
      }
    }

    if (tile === 'B') {
      const dragon = makeMonster({ id: 149, name: '真龍', type: 'fire', hp: 2200, atk: 380, def: 260, sp: sprite(149) }, 1000);
      triggerEncounter(dragon, 'boss', 'mountain');
      setTimeout(() => setWalking(false), 120);
      return;
    }

    if (Math.random() < 0.06) {
      const idx = Math.floor(Math.random() * RIVALS.length);
      const rival = RIVALS[idx];
      const rivalEnemy = makeMonster({ id: 26 + idx, name: `ライバル${rival.name}`, type: ['fire', 'water', 'grass', 'fire'][idx], hp: 180, atk: 35, def: 24, sp: sprite(25 + idx) }, hero.lv + rival.lvBoost);
      setLogs((l) => [`ライバル ${rival.name} (${rival.style}) が勝負を挑んできた！`, ...l].slice(0, 12));
      triggerEncounter(rivalEnemy, 'rival');
      setTimeout(() => setWalking(false), 120);
      return;
    }

    const left = encounterSteps - 1;
    if (left <= 0) {
      setEncounterSteps(5 + Math.floor(Math.random() * 7));
      setTimeout(() => triggerEncounter(), 120);
    } else {
      setEncounterSteps(left);
    }

    saveData({ pos: { x: nx, y: ny }, encounterSteps: Math.max(1, left), facing: dir });
    setTimeout(() => setWalking(false), 120);
  };

  const talk = () => {
    if (Math.abs(pos.x - WORLD.pirateNpc.x) + Math.abs(pos.y - WORLD.pirateNpc.y) <= 1) {
      if (!pirateQuest.accepted) {
        const q = { accepted: true, rescued: false, complete: false };
        setPirateQuest(q);
        setLogs((l) => [STORY_EVENTS[0].text, ...l].slice(0, 12));
      } else if (pirateQuest.rescued && !pirateQuest.complete) {
        const q = { ...pirateQuest, complete: true };
        setPirateQuest(q);
        setBoatOwned(true);
        setLogs((l) => [STORY_EVENTS[2].text, ...l].slice(0, 12));
      } else {
        setLogs((l) => ['この船で世界の海を巡るといい。', ...l].slice(0, 12));
      }
      return;
    }
    setLogs((l) => ['誰もいないようだ。', ...l].slice(0, 12));
  };

  const investigate = () => {
    const tile = WORLD.map[pos.y][pos.x];
    const msg = tile === 's' ? '階段の先に気配がある。' : tile === 'h' ? '海賊の印を見つけた。' : tile === 'd' ? '熱い砂が広がっている。' : tile === 'b' ? '波打ち際に足跡が残る。' : tile === 'G' ? '背の高い草むらだ。' : tile === 'B' ? '真龍の咆哮が聞こえる…' : '周囲を調べたが特に何もない。';
    setLogs((l) => [msg, ...l].slice(0, 12));
  };

  const capture = () => {
    if (turn !== 'hero' || !enemy || inventory.ball <= 0 || battleMode !== 'wild') return;
    const inv = { ...inventory, ball: inventory.ball - 1 };
    setInventory(inv);
    const rate = Math.max(0.1, 0.72 - (enemy.hpNow / enemy.maxHp));
    if (Math.random() < rate) {
      const caught = { ...enemy, exp: 0, expToNext: 100 };
      if (party.length < 3) {
        const np = [...party, caught];
        setParty(np);
        setLogs((l) => [`${enemy.name}を捕まえた！ 手持ち(${np.length}/3)`, ...l].slice(0, 12));
      } else {
        const ng = [...guild, caught];
        setGuild(ng);
        setLogs((l) => [`${enemy.name}を捕まえた！ ギルドに送られた（${ng.length}）`, ...l].slice(0, 12));
      }
      setScreen(dungeonState ? 'dungeon' : 'world');
    } else {
      setLogs((l) => ['捕獲失敗！', ...l].slice(0, 12));
      setTurn('monster');
    }
  };

  const heroAttack = () => {
    if (turn !== 'hero' || !enemy) return;
    const d = Math.max(8, Math.floor((hero.atk + hero.weaponLv * 3) - enemy.defNow * 0.45 + Math.random() * 10));
    setEnemy({ ...enemy, hpNow: Math.max(0, enemy.hpNow - d) });
    setLogs((l) => [`リンクの剣撃！ ${d}ダメージ`, ...l].slice(0, 12));
    setTurn(currentMon?.hpNow > 0 ? 'monster' : 'enemy');
  };

  const heroSkill = () => {
    if (turn !== 'hero' || hero.mp < 8 || !enemy) return;
    const d = Math.max(14, Math.floor((hero.atk + hero.weaponLv * 2) * 1.35 - enemy.defNow * 0.35 + Math.random() * 8));
    setHero({ ...hero, mp: hero.mp - 8 });
    setEnemy({ ...enemy, hpNow: Math.max(0, enemy.hpNow - d) });
    setLogs((l) => [`リンクの回転斬り！ ${d}ダメージ`, ...l].slice(0, 12));
    setTurn(currentMon?.hpNow > 0 ? 'monster' : 'enemy');
  };

  const usePotion = () => {
    if (turn !== 'hero' || inventory.potion <= 0) return;
    setHero((h) => ({ ...h, hpNow: Math.min(h.maxHp, h.hpNow + 65) }));
    setInventory((i) => ({ ...i, potion: i.potion - 1 }));
    setLogs((l) => ['ポーションでリンクが回復！', ...l].slice(0, 12));
    setTurn(currentMon?.hpNow > 0 ? 'monster' : 'enemy');
  };

  const monAttack = () => {
    if (turn !== 'monster' || !enemy || !currentMon) return;
    const m = TYPE_MULT[currentMon.type]?.[enemy.type] || 1;
    const d = Math.max(7, Math.floor(currentMon.atkNow * m - enemy.defNow * 0.45 + Math.random() * 10));
    setEnemy({ ...enemy, hpNow: Math.max(0, enemy.hpNow - d) });
    setLogs((l) => [`${currentMon.name}のアタック！ ${d}ダメージ`, ...l].slice(0, 12));
    setTurn('enemy');
  };

  const innRest = () => {
    setHero((h) => ({ ...h, hpNow: h.maxHp, mp: 30 }));
    setParty((p) => p.map((m) => ({ ...m, hpNow: m.maxHp })));
    setLogs((l) => ['宿屋に休んだ。体力が回復した！', ...l].slice(0, 12));
  };

  const forgeWeapon = () => {
    const cost = smithCost(hero.weaponLv);
    if (gil < cost || inventory.iron <= 0) {
      setLogs((l) => [`素材またはギル不足（必要: ${cost}ギル + 鉄1）`, ...l].slice(0, 12));
      return;
    }
    setGil((g) => g - cost);
    setInventory((i) => ({ ...i, iron: i.iron - 1 }));
    setHero((h) => ({ ...h, weaponLv: h.weaponLv + 1, atk: h.atk + 2 }));
    setLogs((l) => [`鍛冶屋で武器を強化！ 次回費用 ${smithCost(hero.weaponLv + 1)}ギル`, ...l].slice(0, 12));
  };

  const buyItem = (key, price) => {
    if (gil < price) {
      setLogs((l) => ['ギルが足りない。', ...l].slice(0, 12));
      return;
    }
    if (totalItemCount(inventory) + 1 > ITEM_CAPACITY) {
      setLogs((l) => ['持ち物がいっぱいだ。', ...l].slice(0, 12));
      return;
    }
    setGil((g) => g - price);
    setInventory((i) => ({ ...i, [key]: (i[key] || 0) + 1 }));
    setLogs((l) => [`${key === 'ball' ? 'ボール' : 'ポーション'}を購入した（-${price}ギル）`, ...l].slice(0, 12));
  };

  const swapPartyGuild = (pi, gi) => {
    const np = [...party];
    const ng = [...guild];
    const tmp = np[pi];
    np[pi] = ng[gi];
    ng[gi] = tmp;
    setParty(np);
    setGuild(ng);
    if (activeMon === pi) setActiveMon(pi);
  };

  const addQuestReward = (ev) => {
    if (eventsDone.includes(ev.id)) return;
    const done = [...eventsDone, ev.id];
    setEventsDone(done);
    setGil((g) => g + ev.rewardGil);
    setLogs((l) => [`${ev.title}達成！ ${ev.rewardGil}ギル獲得`, ...l].slice(0, 12));
  };

  const dungeonStep = () => {
    if (!dungeonState || !currentMon) return;
    const encounterRate = 0.55;
    if (Math.random() < encounterRate) {
      const lv = dungeonState.entryLv + Math.floor(dungeonState.floor / 2);
      const bossFloor = dungeonState.floor % 5 === 0;
      const bossDone = dungeonState.clearedBossFloors?.[dungeonState.floor];
      if (bossFloor && !bossDone) {
        const boss = makeMonster({ id: 248, name: `${dungeonState.floor}Fボス`, type: 'fire', hp: 260 + dungeonState.floor * 6, atk: 48 + dungeonState.floor, def: 30 + dungeonState.floor * 0.8, sp: sprite(248) }, lv + 3);
        triggerEncounter(boss, 'boss', 'dungeon');
      } else {
        triggerEncounter(makeEnemy(lv), 'wild', 'dungeon');
      }
    } else {
      setLogs((l) => [`地下${dungeonState.floor}Fを探索中...`, ...l].slice(0, 12));
    }
  };

  const dungeonMove = (delta) => {
    if (!dungeonState) return;
    const nf = Math.max(5, Math.min(50, dungeonState.floor + delta));
    setDungeonState((d) => ({ ...d, floor: nf }));
    setLogs((l) => [`${dungeonState.name} 地下${nf}Fへ`, ...l].slice(0, 12));
  };

  const renderTileIcon = (cell) => {
    if (cell.npc) return '👧';
    if (cell.dragon) return '🐉';
    const map = { t: '🏘️', r: '·', w: '🌊', m: '⛰️', F: '🌲', G: '🌾', h: '🏴‍☠️', d: '🏜️', b: '🏖️', p: '🌸', s: '🕍', B: '🐉' };
    return map[cell.t] || '';
  };

  return (
    <div className="app"><div className="phone-shell zelda-skin">
      <header className="header"><strong>Pocket Legend</strong><span className="badge">ギル {gil}</span></header>

      {screen === 'title' && <div className="screen-scroll center-col">
        <div className="panel title-panel"><h1>ポケット冒険ワールド</h1><p>固定画面・探索・ターンバトル</p></div>
        <button className="btn" onClick={() => setScreen('starter')}>冒険開始</button>
      </div>}

      {screen === 'starter' && <div className="screen-scroll">
        <div className="panel"><strong>最初の仲間を選ぶ（火・水・草）</strong></div>
        <div className="grid">{STARTERS.map((s) => (
          <div key={s.id} className="starter-card">
            <img src={sprite(s.id)} className="monster-art" alt={s.name} />
            <div className="grow"><strong>{s.name}</strong><div>{s.type.toUpperCase()}</div></div>
            <button className="btn" onClick={() => startGame(s)}>選択</button>
          </div>
        ))}</div>
      </div>}

      {screen === 'intro' && <div className="screen-scroll center-col">
        <div className="panel"><strong>始まりのイベント</strong><p>{INTRO_EVENTS[introIdx]}</p></div>
        <div className="footer-actions">
          <button className="btn" onClick={() => setIntroIdx((i) => Math.max(0, i - 1))} disabled={introIdx === 0}>戻る</button>
          <button className="btn" onClick={() => introIdx < INTRO_EVENTS.length - 1 ? setIntroIdx((i) => i + 1) : (setScreen('world'), saveData())}>{introIdx < INTRO_EVENTS.length - 1 ? '次へ' : '出発'}</button>
        </div>
      </div>}

      {screen === 'world' && currentMon && <div className="screen-scroll dq-world-layout">
        <div className="panel party-panel">
          <div className="ally-box"><span className="heart">❤</span>リンク Lv.{hero.lv} HP {hero.hpNow}/{hero.maxHp} MP:{hero.mp} 武器+{hero.weaponLv - 1}</div>
          <div className="ally-box"><img src={currentMon.sp} className="monster-art tiny"/> {currentMon.name} Lv.{currentMon.lv} HP {currentMon.hpNow}/{currentMon.maxHp}</div>
          <div className="badge">遭遇 {encounterSteps}歩 / 宝 {treasureCount}/200 / 隠しD {Object.keys(foundDungeons).length}/5 / 手持ち {party.length}/3 / ギルド {guild.length}</div>
        </div>

        <div className="world dq-world">
          {view.flat().map((cell, i) => <div key={i} className={`tile ${cell.t}`}>{renderTileIcon(cell)}{cell.treasure ? '📦' : ''}</div>)}
          <div className={`hero-walker ${facing} ${walking ? 'walk' : ''} ${stepA ? 'step-a' : 'step-b'}`}>
            {boatOwned && WORLD.map[pos.y][pos.x] === 'w' ? <span>⛵</span> : <div className="hero-avatar"><i className="hair"/><i className="face"/><i className="tunic"/><i className="sword"/></div>}
          </div>
        </div>

        <div className="panel dq-message">{logs[0]}</div>

        <div className="panel map-legend"><strong>地形ガイド</strong>
          <div>🌿平原 / 🌾草むら / 🌲深林 / ⛰️山(通行不可) / 🌊海(船で通行) / 🏘️町 / 🕍隠しダンジョン / 📦宝箱 / 🐉真龍</div>
        </div>

        <div className="dq-controls">
          <div className="panel dq-command-grid">
            <button className="btn mini" onClick={talk}>はなす</button>
            <button className="btn mini" onClick={investigate}>しらべる</button>
            <button className="btn mini" onClick={() => setShowBag(true)}>もちもの</button>
            <button className="btn mini" onClick={() => setShowStatus(true)}>ステータス</button>
            <button className="btn mini" onClick={triggerEncounter}>たたかう</button>
            <button className="btn mini" onClick={() => setScreen('town')}>町にもどる</button>
          </div>
          <div className="dpad dq-dpad">
            <div /> <button className="btn" onClick={() => move(0, -1, 'up')}>▲</button> <div />
            <button className="btn" onClick={() => move(-1, 0, 'left')}>◀</button> <div /> <button className="btn" onClick={() => move(1, 0, 'right')}>▶</button>
            <div /> <button className="btn" onClick={() => move(0, 1, 'down')}>▼</button> <div />
          </div>
        </div>

        <div className="panel event-panel"><strong>イベント（見やすい一覧）</strong>
          <div className="event-list">
            {STORY_EVENTS.map((e) => <div key={e.id} className="event-item"><strong>{e.title}</strong><div>{e.text}</div></div>)}
            {pendingEvents.map((ev) => <div key={ev.id} className="event-item"><strong>{ev.title}</strong><div>{ev.text}</div><button className="btn mini" onClick={() => addQuestReward(ev)}>達成</button></div>)}
          </div>
        </div>
      </div>}

      {screen === 'town' && <div className="screen-scroll">
        <div className="panel"><strong>{TOWNS.find(t => t.id===townId)?.name || '町'}</strong><p>{TOWN_DETAILS[townId]?.motif || '町の施設を利用しよう。'}</p></div>
        <div className={`town-map town-${townId || 'start'}`}>
          <button className="panel town-tile" onClick={innRest}>🏨 宿屋<br/><small>休んで回復</small></button>
          <button className="panel town-tile" onClick={forgeWeapon}>⚒️ 鍛冶屋<br/><small>鍛錬費 {smithCost(hero.weaponLv)}G</small></button>
          <button className="panel town-tile" onClick={() => saveData()}>⛪ 教会<br/><small>セーブ</small></button>
          <button className="panel town-tile" onClick={() => loadData()}>📜 教会<br/><small>ロード</small></button>
          <button className="panel town-tile" onClick={() => buyItem('ball', BALL_PRICE)}>🏪 商会<br/><small>ボール {BALL_PRICE}G ({inventory.ball})</small></button>
          <button className="panel town-tile" onClick={() => buyItem('potion', POTION_PRICE)}>🧪 商会<br/><small>ポーション {POTION_PRICE}G ({inventory.potion})</small></button>
        </div>
        <button className="btn" onClick={() => setScreen('world')}>ワールドへ戻る</button>
      </div>}

      {screen === 'dungeon' && dungeonState && <div className="screen-scroll">
        <div className="panel"><strong>{dungeonState.name}</strong><p>地下{dungeonState.floor}F / 入場時基準Lv {dungeonState.entryLv} / 5Fごとにボス</p></div>
        <div className="panel dungeon-ops">
          <button className="btn" onClick={() => dungeonMove(-1)}>上階へ</button>
          <button className="btn" onClick={dungeonStep}>探索する</button>
          <button className="btn" onClick={() => dungeonMove(1)}>下階へ</button>
        </div>
        <div className="panel">最奥は地下50F。各5F(5,10,...,50)の最奥にボスが待つ。</div>
        <button className="btn" onClick={() => { setDungeonState(null); setScreen('world'); }}>脱出する</button>
      </div>}

      {screen === 'battle' && currentMon && enemy && <div className="screen-scroll battle-layout ff7-panel">
        <div className={`battle-scene panel biome-${battleBiome}`}>
          <div className="combatant enemy"><img src={enemy.sp} className="monster-art" /><div>{enemy.name} Lv.{enemy.lv} HP {enemy.hpNow}/{enemy.maxHp}</div></div>
          <div className="combat-row">
            <div className="combatant hero"><div className="hero-sprite">🗡️</div><div>リンク Lv.{hero.lv} HP {hero.hpNow}/{hero.maxHp} MP {hero.mp}</div></div>
            <div className="combatant ally"><img src={currentMon.sp} className="monster-art tiny" /><div>{currentMon.name} Lv.{currentMon.lv} HP {currentMon.hpNow}/{currentMon.maxHp}</div></div>
          </div>
        </div>

        <div className="panel atb-box">
          <div>現在のターン: <strong>{turn === 'hero' ? 'リンク' : turn === 'monster' ? currentMon.name : enemy.name}</strong></div>
          <div className="turn-guide">行動順: リンク → 仲間 → 敵</div>
        </div>

        <div className="log">{logs.map((l, i) => <div key={i}>{l}</div>)}</div>

        <div className="grid battle-actions">
          <button className="btn" onClick={heroAttack} disabled={turn !== 'hero'}>リンク攻撃</button>
          <button className="btn" onClick={heroSkill} disabled={turn !== 'hero' || hero.mp < 8}>回転斬り</button>
          <button className="btn" onClick={usePotion} disabled={turn !== 'hero' || inventory.potion <= 0}>ポーション({inventory.potion})</button>
          <button className="btn" onClick={capture} disabled={turn !== 'hero' || inventory.ball <= 0 || battleMode !== 'wild'}>捕獲({inventory.ball})</button>
          <button className="btn" onClick={monAttack} disabled={turn !== 'monster'}>{currentMon.name}攻撃</button>
          <button className="btn" onClick={() => setScreen(dungeonState ? 'dungeon' : 'world')}>にげる</button>
        </div>
      </div>}

      {showBag && <div className="overlay" onClick={() => setShowBag(false)}>
        <div className="panel bag" onClick={(e) => e.stopPropagation()}>
          <h3>もちもの ({totalItemCount(inventory)}/{ITEM_CAPACITY})</h3>
          {Object.entries(inventory).map(([k, v]) => <div key={k} className="bag-row"><span>{k}</span><strong>{v}</strong></div>)}
          <button className="btn" onClick={() => setShowBag(false)}>閉じる</button>
        </div>
      </div>}

      {showStatus && <div className="overlay" onClick={() => setShowStatus(false)}>
        <div className="panel status" onClick={(e) => e.stopPropagation()}>
          <h3>ステータス</h3>
          <div>リンク Lv.{hero.lv} HP {hero.hpNow}/{hero.maxHp} MP {hero.mp} 攻撃 {hero.atk} 防御 {hero.def}</div>
          <div>装備: ソード+{hero.weaponLv - 1}</div>
          <hr/>
          <strong>手持ち(3枠)</strong>
          {party.map((m, i) => <div key={`${m.name}-${i}`} className="bag-row"><button className="btn mini" onClick={() => setActiveMon(i)}>{i === activeMon ? '出撃中' : '先頭にする'}</button><span>{m.name} Lv.{m.lv}</span></div>)}
          <strong>ギルド保管</strong>
          {guild.length === 0 && <div>保管中なし</div>}
          {guild.map((m, gi) => <div key={`${m.name}-g-${gi}`} className="bag-row"><span>{m.name} Lv.{m.lv}</span><div>{party.map((_, pi) => <button key={pi} className="btn mini" onClick={() => swapPartyGuild(pi, gi)}>枠{pi + 1}と交換</button>)}</div></div>)}
          <button className="btn" onClick={() => setShowStatus(false)}>閉じる</button>
        </div>
      </div>}
    </div></div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
