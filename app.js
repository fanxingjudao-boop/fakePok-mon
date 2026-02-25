const { useMemo, useState, useEffect } = React;

const STARTERS = [
  { id: 'ember', name: 'ブレイズ', type: 'fire', hp: 120, atk: 26, def: 14, sp: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/4.png' },
  { id: 'aqua', name: 'アクア', type: 'water', hp: 130, atk: 23, def: 16, sp: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/7.png' },
  { id: 'leaf', name: 'リーファ', type: 'grass', hp: 125, atk: 24, def: 15, sp: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png' }
];

const ENEMIES_LAND = [
  { name: 'バンディット', type: 'fire', hp: 98, atk: 22, def: 10, sp: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/37.png' },
  { name: 'ウルフ', type: 'grass', hp: 106, atk: 20, def: 12, sp: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/58.png' },
  { name: 'モス', type: 'grass', hp: 95, atk: 21, def: 12, sp: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/43.png' }
];

const ENEMIES_SEA = [
  { name: 'シーサーペント', type: 'water', hp: 110, atk: 23, def: 13, sp: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/129.png' },
  { name: 'パイレーツ', type: 'fire', hp: 118, atk: 25, def: 14, sp: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/86.png' }
];

const TYPE = { fire: { grass: 1.35, water: 0.75, fire: 1 }, water: { fire: 1.35, grass: 0.75, water: 1 }, grass: { water: 1.35, fire: 0.75, grass: 1 } };

const EVENTS = [
  { id: 'base_1', title: '王都からの依頼', text: '街道沿いの治安を確認した。', reward: { gil: 120 } },
  { id: 'base_2', title: '鍛冶師の頼み', text: '鉱石を届けてお礼をもらった。', reward: { potion: 1 } },
  ...Array.from({ length: 100 }, (_, i) => ({ id: `side_${i + 1}`, title: `探索依頼 ${i + 1}`, text: `地方クエスト ${i + 1} を完了した。`, reward: { gil: 60 + (i % 8) * 25 } }))
];

const VIEW_W = 9;
const VIEW_H = 11;
const W = 61;
const H = 61;

function seeded(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

function buildWorld() {
  const map = Array.from({ length: H }, () => Array.from({ length: W }, () => 'w'));

  // 参照: 初代ポケモン風の島状ワールド（草むら・道路・山・海岸・水路）
  for (let y = 3; y < 58; y++) {
    for (let x = 3; x < 58; x++) {
      const cx = (x - 30) / 26;
      const cy = (y - 30) / 23;
      const wave = Math.sin(x * 0.18) * 0.08 + Math.cos(y * 0.15) * 0.08;
      if ((cx * cx + cy * cy + wave) < 1.05) map[y][x] = 'f';
    }
  }

  // 大陸接続（世界が分断されない）
  for (let y = 24; y <= 35; y++) for (let x = 39; x <= 57; x++) map[y][x] = 'f';
  for (let y = 28; y <= 31; y++) for (let x = 33; x <= 39; x++) map[y][x] = 'f';

  // 草むら（初代ポケモンの背の高い草イメージ）
  for (let y = 9; y < 20; y++) for (let x = 9; x < 22; x++) if (map[y][x] === 'f') map[y][x] = 'G';
  for (let y = 39; y < 52; y++) for (let x = 26; x < 39; x++) if (map[y][x] === 'f') map[y][x] = 'G';

  // 森・山岳
  for (let y = 33; y < 49; y++) for (let x = 7; x < 24; x++) if (map[y][x] !== 'w') map[y][x] = 'm';
  for (let y = 14; y < 24; y++) for (let x = 43; x < 57; x++) if (map[y][x] !== 'w') map[y][x] = 'm';
  for (let y = 46; y < 58; y++) for (let x = 43; x < 58; x++) if (map[y][x] !== 'w') map[y][x] = 'F';

  // 内海と川
  for (let y = 25; y <= 35; y++) for (let x = 23; x <= 31; x++) map[y][x] = 'w';
  for (let y = 35; y <= 52; y++) map[y][31] = 'w';

  // 海岸
  for (let y = 23; y <= 36; y++) {
    if (map[y][22] === 'f') map[y][22] = 'b';
    if (map[y][32] === 'f') map[y][32] = 'b';
  }

  // 砂地・花原
  for (let y = 6; y <= 13; y++) for (let x = 25; x <= 37; x++) if (map[y][x] === 'f') map[y][x] = 'd';
  for (let y = 50; y <= 57; y++) for (let x = 29; x <= 46; x++) if (map[y][x] === 'f') map[y][x] = 'p';

  const towns = [
    { id: 'start', x: 14, y: 29, name: 'はじまりの町' },
    { id: 'port', x: 42, y: 29, name: 'ミナトの町' },
    { id: 'north', x: 26, y: 14, name: 'キタの町' },
    { id: 'south', x: 27, y: 45, name: 'ミナミの町' }
  ];
  towns.forEach((t) => (map[t.y][t.x] = 't'));

  // 道路（街道）
  const road = (x1, y1, x2, y2) => {
    let x = x1, y = y1;
    while (x !== x2 || y !== y2) {
      if (map[y][x] !== 't') map[y][x] = 'r';
      if (x < x2) x++; else if (x > x2) x--;
      else if (y < y2) y++; else if (y > y2) y--;
    }
  };
  road(14, 29, 42, 29);
  road(14, 29, 26, 14);
  road(14, 29, 27, 45);

  const dungeons = [
    { id: 'd1', x: 18, y: 17, name: '古代遺跡' },
    { id: 'd2', x: 15, y: 41, name: '黒鉄洞' },
    { id: 'd3', x: 46, y: 18, name: '天空塔' },
    { id: 'd4', x: 52, y: 33, name: '深海神殿' },
    { id: 'd5', x: 35, y: 49, name: '忘却の祠' }
  ];
  dungeons.forEach(d => map[d.y][d.x] = 's');

  const pirateBase = { x: 56, y: 27, name: '海賊アジト' };
  map[pirateBase.y][pirateBase.x] = 'h';

  const rng = seeded(7777);
  const treasureCandidates = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (['f', 'F', 'r', 'd', 'g', 'b', 'p', 'G'].includes(map[y][x])) treasureCandidates.push(`${x},${y}`);
    }
  }
  const treasures = {};
  while (Object.keys(treasures).length < 200 && treasureCandidates.length) {
    const i = Math.floor(rng() * treasureCandidates.length);
    treasures[treasureCandidates.splice(i, 1)[0]] = true;
  }

  const pirateNpc = { x: 43, y: 29 };

  return { map, towns, dungeons, pirateBase, pirateNpc, treasures };
}

const WORLD = buildWorld();

const makeEnemy = (lv, atSea) => {
  const pool = atSea ? ENEMIES_SEA : ENEMIES_LAND;
  const base = pool[Math.floor(Math.random() * pool.length)];
  return { ...base, lv, hpNow: base.hp + lv * 7, maxHp: base.hp + lv * 7, atkNow: base.atk + lv * 1.7, defNow: base.def + lv * 1.2 };
};

const canWalk = (tile, boatOwned) => {
  if (tile === 'm') return false;
  if (tile === 'w') return boatOwned;
  return true;
};


const biomeFromTile = (tile) => {
  if (tile === 'w') return 'sea';
  if (tile === 'F' || tile === 'g' || tile === 'G') return 'forest';
  if (tile === 'm') return 'mountain';
  if (tile === 'd') return 'desert';
  if (tile === 'b') return 'coast';
  if (tile === 't' || tile === 'c') return 'town';
  return 'field';
};

function App() {
  const [screen, setScreen] = useState('title');
  const [hero, setHero] = useState({ name: 'リンク', lv: 1, hpNow: 180, maxHp: 180, atk: 28, def: 16, mp: 30 });
  const [monster, setMonster] = useState(null);
  const [enemy, setEnemy] = useState(null);
  const [battleBiome, setBattleBiome] = useState('field');
  const [pos, setPos] = useState({ x: 14, y: 29 });
  const [facing, setFacing] = useState('down');
  const [walking, setWalking] = useState(false);
  const [stepA, setStepA] = useState(false);

  const [encounterSteps, setEncounterSteps] = useState(8);
  const [gil, setGil] = useState(900);
  const [inventory, setInventory] = useState({ potion: 3 });
  const [logs, setLogs] = useState(['王都より南、冒険が始まる。']);
  const [eventsDone, setEventsDone] = useState([]);

  const [turn, setTurn] = useState('hero');
  const [boatOwned, setBoatOwned] = useState(false);
  const [pirateQuest, setPirateQuest] = useState({ accepted: false, rescued: false, complete: false });
  const [foundDungeons, setFoundDungeons] = useState({});
  const [collectedTreasure, setCollectedTreasure] = useState({});

  const pendingEvents = useMemo(() => EVENTS.filter((e) => !eventsDone.includes(e.id)).slice(0, 8), [eventsDone]);
  const treasureCount = Object.keys(collectedTreasure).length;

  const view = useMemo(() => {
    const rows = [];
    const rx = Math.floor(VIEW_W / 2), ry = Math.floor(VIEW_H / 2);
    for (let y = pos.y - ry; y <= pos.y + ry; y++) {
      const row = [];
      for (let x = pos.x - rx; x <= pos.x + rx; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) row.push({ t: 'void', x, y });
        else row.push({ t: WORLD.map[y][x], x, y });
      }
      rows.push(row);
    }
    return rows;
  }, [pos]);

  const save = (next = {}) => {
    localStorage.setItem('mq_save_v7', JSON.stringify({ hero, monster, pos, facing, encounterSteps, gil, inventory, eventsDone, boatOwned, pirateQuest, foundDungeons, collectedTreasure, ...next }));
  };

  useEffect(() => {
    const s = localStorage.getItem('mq_save_v7');
    if (!s) return;
    try {
      const d = JSON.parse(s);
      if (d.monster) {
        setHero(d.hero || hero);
        setMonster(d.monster);
        setPos(d.pos || { x: 14, y: 29 });
        setFacing(d.facing || 'down');
        setEncounterSteps(d.encounterSteps || 8);
        setGil(d.gil || 900);
        setInventory(d.inventory || { potion: 3 });
        setEventsDone(d.eventsDone || []);
        setBoatOwned(!!d.boatOwned);
        setPirateQuest(d.pirateQuest || { accepted: false, rescued: false, complete: false });
        setFoundDungeons(d.foundDungeons || {});
        setCollectedTreasure(d.collectedTreasure || {});
        setScreen('world');
      }
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (screen !== 'battle' || turn !== 'enemy' || !enemy) return;
    const t = setTimeout(() => {
      const targetHero = hero.hpNow > 0 && (monster.hpNow <= 0 || Math.random() < 0.55);
      if (targetHero) {
        const d = Math.max(6, Math.floor(enemy.atkNow - hero.def * 0.55 + Math.random() * 8));
        setHero((h) => ({ ...h, hpNow: Math.max(0, h.hpNow - d) }));
        setLogs((l) => [`${enemy.name}の攻撃！ リンクに${d}ダメージ`, ...l].slice(0, 10));
      } else {
        const mult = TYPE[enemy.type]?.[monster.type] || 1;
        const d = Math.max(6, Math.floor((enemy.atkNow * mult) - monster.defNow * 0.55 + Math.random() * 8));
        setMonster((m) => ({ ...m, hpNow: Math.max(0, m.hpNow - d) }));
        setLogs((l) => [`${enemy.name}の攻撃！ ${monster.name}に${d}ダメージ`, ...l].slice(0, 10));
      }
      setTurn('hero');
    }, 500);
    return () => clearTimeout(t);
  }, [screen, turn, enemy, hero, monster]);

  useEffect(() => {
    if (screen !== 'battle' || !enemy) return;
    if (enemy.hpNow <= 0) {
      const g = gil + 140;
      const m = { ...monster, lv: monster.lv + 1, maxHp: monster.maxHp + 10, hpNow: Math.min(monster.maxHp + 10, monster.hpNow + 10), atkNow: monster.atkNow + 2, defNow: monster.defNow + 1.5 };
      setGil(g); setMonster(m); setScreen('world');
      setLogs((l) => [`${enemy.name}を倒した！ 140ギル獲得`, ...l].slice(0, 10));
      save({ gil: g, monster: m });
    }
    if (hero.hpNow <= 0 && monster.hpNow <= 0) {
      localStorage.removeItem('mq_save_v7');
      setScreen('title');
    }
  }, [enemy, hero.hpNow, monster, screen]);

  const startGame = (starter) => {
    const m = { ...starter, lv: 1, hpNow: starter.hp, maxHp: starter.hp, atkNow: starter.atk, defNow: starter.def };
    const h = { name: 'リンク', lv: 1, hpNow: 180, maxHp: 180, atk: 28, def: 16, mp: 30 };
    setHero(h); setMonster(m); setScreen('world');
    setGil(900); setInventory({ potion: 3 }); setEventsDone([]); setEncounterSteps(8);
    setBoatOwned(false); setPirateQuest({ accepted: false, rescued: false, complete: false });
    setFoundDungeons({}); setCollectedTreasure({});
    setPos({ x: 14, y: 29 }); setFacing('down');
    setLogs(['王都より南、冒険が始まる。']);
    save({ hero: h, monster: m, pos: { x: 14, y: 29 }, facing: 'down', encounterSteps: 8, gil: 900, inventory: { potion: 3 }, eventsDone: [], boatOwned: false, pirateQuest: { accepted: false, rescued: false, complete: false }, foundDungeons: {}, collectedTreasure: {} });
  };

  const triggerEncounter = () => {
    const tile = WORLD.map[pos.y][pos.x];
    const atSea = tile === 'w';
    const e = makeEnemy(Math.max(2, monster.lv + Math.floor(Math.random() * 3) - 1), atSea);
    setBattleBiome(biomeFromTile(tile));
    setEnemy(e); setTurn('hero'); setScreen('battle');
    setLogs((l) => [`エンカウント！ ${e.name} が現れた`, ...l].slice(0, 10));
  };

  const checkDiscoveries = (x, y) => {
    const key = `${x},${y}`;
    if (WORLD.treasures[key] && !collectedTreasure[key]) {
      const next = { ...collectedTreasure, [key]: true };
      const gain = 20 + (Object.keys(next).length % 7) * 5;
      const newGil = gil + gain;
      setCollectedTreasure(next);
      setGil(newGil);
      setLogs((l) => [`宝箱を発見！ ${gain}ギル獲得（${Object.keys(next).length}/200）`, ...l].slice(0, 10));
      save({ collectedTreasure: next, gil: newGil });
    }

    for (const d of WORLD.dungeons) {
      if (d.x === x && d.y === y && !foundDungeons[d.id]) {
        const next = { ...foundDungeons, [d.id]: true };
        setFoundDungeons(next);
        setLogs((l) => [`隠しダンジョン発見: ${d.name}（${Object.keys(next).length}/5）`, ...l].slice(0, 10));
        save({ foundDungeons: next });
      }
    }

    if (pirateQuest.accepted && !pirateQuest.rescued && x === WORLD.pirateBase.x && y === WORLD.pirateBase.y) {
      const nextQuest = { ...pirateQuest, rescued: true };
      setPirateQuest(nextQuest);
      setLogs((l) => ['海賊アジトを制圧！ 娘を救出した。港町へ戻ろう。', ...l].slice(0, 10));
      save({ pirateQuest: nextQuest });
    }
  };

  const move = (dx, dy, dir) => {
    if (walking || screen !== 'world') return;
    setFacing(dir);

    const nx = Math.max(0, Math.min(W - 1, pos.x + dx));
    const ny = Math.max(0, Math.min(H - 1, pos.y + dy));
    const tile = WORLD.map[ny][nx];
    if (!canWalk(tile, boatOwned)) {
      setLogs((l) => [tile === 'w' ? '海だ。船が必要だ。' : 'その先は進めない。', ...l].slice(0, 10));
      return;
    }

    setWalking(true);
    setStepA((s) => !s);
    setPos({ x: nx, y: ny });
    checkDiscoveries(nx, ny);

    if (tile !== 't' && tile !== 'c' && tile !== 'n' && tile !== 's') {
      const left = encounterSteps - 1;
      if (left <= 0) {
        const reset = 5 + Math.floor(Math.random() * 7);
        setEncounterSteps(reset);
        setTimeout(() => triggerEncounter(), 120);
      } else {
        setEncounterSteps(left);
      }
    }

    if (tile === 't') {
      const t = WORLD.towns.find((a) => a.x === nx && a.y === ny);
      setLogs((l) => [`${t?.name || '町'}に到着した。`, ...l].slice(0, 10));
    }
    if (tile === 'c') setLogs((l) => ['王城へ到着。厳かな空気が漂う。', ...l].slice(0, 10));

    save({ pos: { x: nx, y: ny }, encounterSteps: Math.max(1, encounterSteps - 1), facing: dir });
    setTimeout(() => setWalking(false), 120);
  };

  const talk = () => {
    if (pos.x === WORLD.pirateNpc.x && pos.y === WORLD.pirateNpc.y) {
      if (!pirateQuest.accepted) {
        const next = { accepted: true, rescued: false, complete: false };
        setPirateQuest(next);
        setLogs((l) => ['海賊に娘がさらわれた！ 東の海賊アジトを探してくれ！', ...l].slice(0, 10));
        save({ pirateQuest: next });
      } else if (pirateQuest.rescued && !pirateQuest.complete) {
        const next = { ...pirateQuest, complete: true };
        setPirateQuest(next);
        setBoatOwned(true);
        setLogs((l) => ['娘を助けてくれてありがとう！ 船を譲ろう。海を渡れるようになった。', ...l].slice(0, 10));
        save({ pirateQuest: next, boatOwned: true });
      } else if (pirateQuest.complete) {
        setLogs((l) => ['この船で世界の海を巡るといい。', ...l].slice(0, 10));
      } else {
        setLogs((l) => ['お願いだ…娘を助けてくれ…。', ...l].slice(0, 10));
      }
      return;
    }

    setLogs((l) => ['誰もいないようだ。', ...l].slice(0, 10));
  };

  const investigate = () => {
    const tile = WORLD.map[pos.y][pos.x];
    if (tile === 's') setLogs((l) => ['祠で祈りを捧げた。', ...l].slice(0, 10));
    else if (tile === 'h') setLogs((l) => ['海賊の印を見つけた。', ...l].slice(0, 10));
    else if (tile === 'd') setLogs((l) => ['熱い砂が広がっている。', ...l].slice(0, 10));
    else if (tile === 'b') setLogs((l) => ['波打ち際に足跡が残る。', ...l].slice(0, 10));
    else if (tile === 'p') setLogs((l) => ['色とりどりの花が咲いている。', ...l].slice(0, 10));
    else setLogs((l) => ['周囲を調べたが特に何もない。', ...l].slice(0, 10));
  };

  const performHeroAttack = () => {
    if (turn !== 'hero') return;
    const d = Math.max(8, Math.floor(hero.atk - enemy.defNow * 0.45 + Math.random() * 10));
    setEnemy({ ...enemy, hpNow: Math.max(0, enemy.hpNow - d) });
    setLogs((l) => [`リンクの剣撃！ ${d}ダメージ`, ...l].slice(0, 10));
    setTurn(monster.hpNow > 0 ? 'monster' : 'enemy');
  };

  const performHeroSkill = () => {
    if (turn !== 'hero' || hero.mp < 8) return;
    const d = Math.max(14, Math.floor(hero.atk * 1.35 - enemy.defNow * 0.35 + Math.random() * 8));
    setHero({ ...hero, mp: hero.mp - 8 });
    setEnemy({ ...enemy, hpNow: Math.max(0, enemy.hpNow - d) });
    setLogs((l) => [`リンクの回転斬り！ ${d}ダメージ`, ...l].slice(0, 10));
    setTurn(monster.hpNow > 0 ? 'monster' : 'enemy');
  };

  const usePotion = () => {
    if (turn !== 'hero' || inventory.potion <= 0) return;
    const h = { ...hero, hpNow: Math.min(hero.maxHp, hero.hpNow + 65) };
    const inv = { ...inventory, potion: inventory.potion - 1 };
    setHero(h); setInventory(inv);
    setLogs((l) => ['ポーションでリンクが回復！', ...l].slice(0, 10));
    setTurn(monster.hpNow > 0 ? 'monster' : 'enemy');
  };

  const performMonsterAttack = () => {
    if (turn !== 'monster') return;
    const m = TYPE[monster.type]?.[enemy.type] || 1;
    const d = Math.max(7, Math.floor(monster.atkNow * m - enemy.defNow * 0.45 + Math.random() * 10));
    setEnemy({ ...enemy, hpNow: Math.max(0, enemy.hpNow - d) });
    setLogs((l) => [`${monster.name}のアタック！ ${d}ダメージ`, ...l].slice(0, 10));
    setTurn('enemy');
  };

  const completeEvent = (ev) => {
    if (eventsDone.includes(ev.id)) return;
    const g = gil + (ev.reward.gil || 0);
    const inv = { ...inventory, potion: inventory.potion + (ev.reward.potion || 0) };
    const done = [...eventsDone, ev.id];
    setGil(g); setInventory(inv); setEventsDone(done);
    save({ gil: g, inventory: inv, eventsDone: done });
  };

  const healAtTown = () => {
    const h = { ...hero, hpNow: hero.maxHp, mp: 30 };
    const m = { ...monster, hpNow: monster.maxHp };
    setHero(h); setMonster(m); save({ hero: h, monster: m });
    setLogs((l) => ['宿で休み、全回復した。', ...l].slice(0, 10));
  };

  return (
    <div className="app"><div className="phone-shell zelda-skin">
      <header className="header"><strong>Pocket Legend</strong><span className="badge">ギル {gil}</span></header>

      {screen === 'title' && <div className="screen-scroll center-col">
        <div className="panel title-panel"><h1>ポケットモンスター風アドベンチャー</h1><p>ゼルダ風UI × ターンバトル × 世界探索</p></div>
        <button className="btn" onClick={() => setScreen('starter')}>冒険開始</button>
        <button className="btn mini" onClick={() => { localStorage.removeItem('mq_save_v7'); window.location.reload(); }}>セーブ削除</button>
      </div>}

      {screen === 'starter' && <div className="screen-scroll">
        <div className="panel"><strong>最初の仲間を選ぶ（火・水・草）</strong></div>
        <div className="grid">{STARTERS.map((s) => (
          <div key={s.id} className="starter-card">
            <img src={s.sp} className="monster-art" alt={s.name} />
            <div className="grow"><strong>{s.name}</strong><div>{s.type.toUpperCase()}</div></div>
            <button className="btn" onClick={() => startGame(s)}>選択</button>
          </div>
        ))}</div>
      </div>}

      {screen === 'world' && monster && <div className="screen-scroll dq-world-layout">
        <div className="panel party-panel">
          <div className="ally-box"><span className="heart">❤</span>リンク {hero.hpNow}/{hero.maxHp} MP:{hero.mp}</div>
          <div className="ally-box"><img src={monster.sp} className="monster-art tiny"/> {monster.name} Lv.{monster.lv} HP {monster.hpNow}/{monster.maxHp}</div>
          <div className="badge">遭遇まで {encounterSteps}歩 / 宝 {treasureCount}/200 / 隠しD {Object.keys(foundDungeons).length}/5</div>
          <div className="badge">船: {boatOwned ? 'あり' : 'なし'} {pirateQuest.complete ? '(海賊イベント完了)' : ''}</div>
        </div>

        <div className="world dq-world">
          {view.flat().map((cell, i) => <div key={i} className={`tile ${cell.t}`}>{cell.t === 't' ? '🏘️' : cell.t === 'c' ? '🏰' : cell.t === 'r' ? '·' : cell.t === 'w' ? '🌊' : cell.t === 'm' ? '⛰️' : cell.t === 'F' ? '🌲' : cell.t === 'G' ? '🌾' : cell.t === 'h' ? '🏴‍☠️' : cell.t === 'd' ? '🏜️' : cell.t === 'g' ? '🌳' : cell.t === 'b' ? '🏖️' : cell.t === 'p' ? '🌸' : cell.t === 'void' ? '' : ''}</div>)}
          <div className={`hero-walker ${facing} ${walking ? 'walk' : ''} ${stepA ? 'step-a' : 'step-b'}`}>
            {boatOwned && WORLD.map[pos.y][pos.x] === 'w' ? <span>⛵</span> : <div className="hero-avatar"><i className="hair"/><i className="face"/><i className="tunic"/><i className="sword"/></div>}
          </div>
        </div>

        <div className="panel dq-message">{logs[0]}</div>

        <div className="dq-controls">
          <div className="panel dq-command-grid">
            <button className="btn mini" onClick={talk}>はなす</button>
            <button className="btn mini" onClick={investigate}>しらべる</button>
            <button className="btn mini" onClick={healAtTown}>やすむ</button>
            <button className="btn mini" onClick={triggerEncounter}>たたかう</button>
          </div>
          <div className="dpad dq-dpad">
            <div /> <button className="btn" onClick={() => move(0, -1, 'up')}>▲</button> <div />
            <button className="btn" onClick={() => move(-1, 0, 'left')}>◀</button> <div /> <button className="btn" onClick={() => move(1, 0, 'right')}>▶</button>
            <div /> <button className="btn" onClick={() => move(0, 1, 'down')}>▼</button> <div />
          </div>
        </div>

        <div className="panel"><strong>クエストイベント（102件）</strong>
          <div className="event-list">{pendingEvents.map((ev) => <div key={ev.id} className="event-item"><strong>{ev.title}</strong><div>{ev.text}</div><button className="btn mini" onClick={() => completeEvent(ev)}>達成</button></div>)}</div>
        </div>
      </div>}

      {screen === 'battle' && monster && enemy && <div className="screen-scroll battle-layout ff7-panel">
        <div className={`battle-scene panel biome-${battleBiome}`}>
          <div className="combatant enemy"><img src={enemy.sp} className="monster-art" /><div>{enemy.name} HP {enemy.hpNow}/{enemy.maxHp}</div></div>
          <div className="combatant hero"><div className="hero-sprite">🗡️</div><div>リンク HP {hero.hpNow}/{hero.maxHp} MP {hero.mp}</div></div>
          <div className="combatant ally"><img src={monster.sp} className="monster-art tiny" /><div>{monster.name} HP {monster.hpNow}/{monster.maxHp}</div></div>
        </div>

        <div className="panel atb-box">
          <div>現在のターン: <strong>{turn === 'hero' ? 'リンク' : turn === 'monster' ? monster.name : enemy.name}</strong></div>
          <div className="turn-guide">行動順: リンク → 仲間 → 敵</div>
        </div>

        <div className="log">{logs.map((l, i) => <div key={i}>{l}</div>)}</div>

        <div className="grid battle-actions">
          <button className="btn" onClick={performHeroAttack} disabled={turn !== 'hero'}>リンク攻撃</button>
          <button className="btn" onClick={performHeroSkill} disabled={turn !== 'hero' || hero.mp < 8}>回転斬り</button>
          <button className="btn" onClick={usePotion} disabled={turn !== 'hero' || inventory.potion <= 0}>ポーション({inventory.potion})</button>
          <button className="btn" onClick={performMonsterAttack} disabled={turn !== 'monster'}>{monster.name}攻撃</button>
        </div>
      </div>}
    </div></div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
