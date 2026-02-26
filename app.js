{
const { useMemo, useState, useEffect } = React;
const GD = window.GameData;

function App() {
  const [screen, setScreen] = useState('title');
  const [introIdx, setIntroIdx] = useState(0);
  const [hero, setHero] = useState({ name: 'ユウ', lv: 1, exp: 0, expToNext: 100, hpNow: 180, maxHp: 180, atk: 28, def: 16, mp: 30, weaponLv: 1 });
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
  const [rivalsDefeated, setRivalsDefeated] = useState(0);
  const [collectedTreasure, setCollectedTreasure] = useState({});
  const [showBag, setShowBag] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [townId, setTownId] = useState(null);
  const [dungeonState, setDungeonState] = useState(null);
  const [endingCleared, setEndingCleared] = useState(false);
  const [claimedIron, setClaimedIron] = useState({});
  const [talkCount, setTalkCount] = useState(0);
  const [captureCount, setCaptureCount] = useState(0);
  const [saveError, setSaveError] = useState('');

  const currentMon = party[activeMon];
  const pendingEvents = useMemo(() => GD.QUEST_EVENTS.filter((e) => !eventsDone.includes(e.id)).slice(0, 20), [eventsDone]);
  const treasureCount = Object.keys(collectedTreasure).length;
  const wonderScore = useMemo(() => (
    treasureCount * 2 +
    Object.keys(foundDungeons).length * 40 +
    rivalsDefeated * 25 +
    (boatOwned ? 30 : 0) +
    (pirateQuest.complete ? 40 : 0) +
    Math.floor(hero.lv * 1.8)
  ), [treasureCount, foundDungeons, rivalsDefeated, boatOwned, pirateQuest, hero.lv]);
  const wonderRank = GD.WONDER_RANKS[Math.min(GD.WONDER_RANKS.length - 1, Math.floor(wonderScore / 160))];

  const getQuestProgress = (q) => {
    if (q.type === 'treasure') return treasureCount;
    if (q.type === 'rival') return rivalsDefeated;
    if (q.type === 'dungeon') return Object.keys(foundDungeons).length;
    if (q.type === 'talk') return talkCount;
    if (q.type === 'capture') return captureCount;
    return 0;
  };
  const readyQuests = useMemo(
    () => GD.QUEST_EVENTS.filter((q) => !eventsDone.includes(q.id) && getQuestProgress(q) >= q.target).slice(0, 12),
    [eventsDone, treasureCount, rivalsDefeated, foundDungeons, talkCount, captureCount]
  );

  const view = useMemo(() => {
    const rows = [];
    const rx = Math.floor(GD.VIEW_W / 2), ry = Math.floor(GD.VIEW_H / 2);
    for (let y = pos.y - ry; y <= pos.y + ry; y++) {
      const row = [];
      for (let x = pos.x - rx; x <= pos.x + rx; x++) {
        if (x < 0 || y < 0 || x >= GD.W || y >= GD.H) row.push({ t: 'void', x, y });
        else row.push({
          t: GD.WORLD.map[y][x],
          x, y,
          treasure: !!GD.WORLD.treasures[`${x},${y}`] && !collectedTreasure[`${x},${y}`],
          npc: x === GD.WORLD.pirateNpc.x && y === GD.WORLD.pirateNpc.y,
          dragon: x === GD.WORLD.dragonLair.x && y === GD.WORLD.dragonLair.y,
          npc: GD.NPCS.find((n) => n.x === x && n.y === y)
        });
      }
      rows.push(row);
    }
    return rows;
  }, [pos, collectedTreasure]);

  const saveData = (next = {}) => {
    try {
      localStorage.setItem(GD.SAVE_KEY, JSON.stringify({
        schemaVersion: GD.SCHEMA_VERSION,
        hero, party, guild, activeMon, pos, facing, encounterSteps, gil, inventory,
        eventsDone, boatOwned, pirateQuest, foundDungeons, collectedTreasure,
        dungeonState, endingCleared, claimedIron, talkCount, captureCount, ...next
      }));
      setSaveError('');
    } catch (e) {
      setSaveError('セーブに失敗しました。ストレージ状態を確認してください。');
      console.error(e);
    }
  };

  const migrateSave = (d) => {
    if (!d || typeof d !== 'object') return null;
    if (!d.schemaVersion) {
      return { ...d, schemaVersion: 1, talkCount: 0, captureCount: 0 };
    }
    return d;
  };

  const loadData = () => {
    const s = localStorage.getItem(GD.SAVE_KEY);
    if (!s) return;
    try {
      const d = migrateSave(JSON.parse(s));
      if (d?.party?.length) {
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
        setEndingCleared(!!d.endingCleared);
        setClaimedIron(d.claimedIron || {});
        setTalkCount(d.talkCount || 0);
        setCaptureCount(d.captureCount || 0);
        setScreen('world');
        setSaveError('');
      }
    } catch (e) {
      console.error(e);
      setSaveError('セーブデータが壊れている可能性があります。新規開始してください。');
    }
  };

  // 一旦、更新時は常に最初から開始（自動ロード無効）
  useEffect(() => {
    setScreen('title');
  }, []);

  useEffect(() => {
    if (screen !== 'battle' || turn !== 'enemy' || !enemy || !currentMon) return;
    const t = setTimeout(() => {
      const targetHero = hero.hpNow > 0 && (currentMon.hpNow <= 0 || Math.random() < 0.55);
      let heroHpAfter = hero.hpNow;
      if (targetHero) {
        const d = Math.max(6, Math.floor(enemy.atkNow - hero.def * 0.55 + Math.random() * 8));
        heroHpAfter = Math.max(0, hero.hpNow - d);
        setHero((h) => ({ ...h, hpNow: Math.max(0, h.hpNow - d) }));
        setLogs((l) => [`${enemy.name}の攻撃！ リンクに${d}ダメージ`, ...l].slice(0, 12));
      } else {
        const mult = GD.TYPE_MULT[enemy.type]?.[currentMon.type] || 1;
        const d = Math.max(6, Math.floor((enemy.atkNow * mult) - currentMon.defNow * 0.55 + Math.random() * 8));
        const np = [...party];
        np[activeMon] = { ...currentMon, hpNow: Math.max(0, currentMon.hpNow - d) };
        setParty(np);
        setLogs((l) => [`${enemy.name}の攻撃！ ${currentMon.name}に${d}ダメージ`, ...l].slice(0, 12));
      }
      setTurn(heroHpAfter <= 0 && currentMon.hpNow > 0 ? 'monster' : 'hero');
    }, 450);
    return () => clearTimeout(t);
  }, [screen, turn, enemy, hero, currentMon, party, activeMon]);


  useEffect(() => {
    if (hero.hpNow > 0) return;
    if (!['world', 'battle', 'dungeon'].includes(screen)) return;
    setTownId('start');
    setScreen('town');
    setHero((h) => ({ ...h, hpNow: 1, mp: Math.max(0, h.mp - 5) }));
    setLogs((l) => ['リンクは倒れた…教会へ直行し、かろうじて意識を取り戻した。', ...l].slice(0, 12));
  }, [hero.hpNow, screen]);

  useEffect(() => {
    if (screen !== 'battle' || !enemy || !currentMon || enemy.hpNow > 0) return;
    const gain = battleMode === 'boss' ? 3000 : battleMode === 'rival' ? 500 : 140;
    const newHeroExp = hero.exp + gain;
    let newHero = { ...hero, exp: newHeroExp };
    const levelCap = endingCleared ? 1000 : 100;
    if (newHero.exp >= newHero.expToNext && newHero.lv < levelCap) {
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
    if (battleMode === 'rival') setRivalsDefeated((v) => v + 1);
    setHero(newHero); setParty(np); setGil((g) => g + addGil);
    if (screen === 'battle') setScreen(dungeonState ? 'dungeon' : 'world');
    if (enemy.name === '真龍' && !endingCleared) {
      setEndingCleared(true);
      setLogs((l) => ['エンディング到達！ ここから限界突破でLv1000まで成長可能だ。', ...l].slice(0, 12));
    }
    setLogs((l) => [`${enemy.name}を倒した！ ヒーロー/仲間に${gain}EXP`, ...l].slice(0, 12));

    if (dungeonState && dungeonState.floor % 5 === 0) {
      setDungeonState((d) => ({ ...d, clearedBossFloors: { ...(d.clearedBossFloors || {}), [d.floor]: true } }));
    }
    saveData({ hero: newHero, party: np });
  }, [enemy, screen]);

  const startGame = (starter) => {
    const m = GD.makeMonster({ ...starter, sp: GD.sprite(starter.id) }, 1);
    setHero({ name: 'ユウ', lv: 1, exp: 0, expToNext: 100, hpNow: 180, maxHp: 180, atk: 28, def: 16, mp: 30, weaponLv: 1 });
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
    setEndingCleared(false);
    setClaimedIron({});
  };

  const makeEnemy = (levelBase, forced) => {
    if (forced) return forced;
    const base = GD.MONSTER_CATALOG[Math.floor(Math.random() * GD.MONSTER_CATALOG.length)];
    return GD.makeMonster(base, Math.max(2, levelBase + Math.floor(Math.random() * 3) - 1));
  };

  const triggerEncounter = (forcedEnemy = null, mode = 'wild', forcedBiome = null) => {
    const tile = GD.WORLD.map[pos.y][pos.x];
    const biome = GD.biomeFromTile(tile);
    const levelBase = dungeonState ? hero.lv + Math.floor((dungeonState.floor - 1) / 2) : (GD.AREA_LEVELS[biome] || currentMon.lv);
    const e = makeEnemy(levelBase, forcedEnemy);
    setBattleBiome(forcedBiome || GD.biomeFromTile(tile));
    setBattleMode(mode);
    setEnemy(e);
    setTurn('hero');
    setScreen('battle');
    const prefix = mode === 'boss' ? '★ボス襲来！' : mode === 'rival' ? '◆ライバル戦！' : '◇エンカウント！';
    setLogs((l) => [`${prefix} ${e.name} が現れた`, ...l].slice(0, 12));
  };

  const checkDiscover = (x, y) => {
    const key = `${x},${y}`;
    if (GD.WORLD.treasures[key] && !collectedTreasure[key]) {
      const next = { ...collectedTreasure, [key]: true };
      const gain = 25 + (Object.keys(next).length % 7) * 6;
      setCollectedTreasure(next);
      setGil((g) => g + gain);
      setLogs((l) => [`宝箱を開けた！ ${gain}ギル獲得（${Object.keys(next).length}/200）`, ...l].slice(0, 12));
    }
    for (const d of GD.WORLD.dungeons) {
      if (d.x === x && d.y === y && !foundDungeons[d.id]) {
        const fd = { ...foundDungeons, [d.id]: true };
        setFoundDungeons(fd);
        setLogs((l) => [`隠しダンジョン発見: ${d.name}（${Object.keys(fd).length}/5）`, ...l].slice(0, 12));
      }
    }
    if (pirateQuest.accepted && !pirateQuest.rescued && x === GD.WORLD.pirateBase.x && y === GD.WORLD.pirateBase.y) {
      const q = { ...pirateQuest, rescued: true };
      setPirateQuest(q);
      setLogs((l) => ['海賊アジトを制圧！ 娘を救出した。港町へ戻ろう。', ...l].slice(0, 12));
    }
  };

  const move = (dx, dy, dir) => {
    if (walking || screen !== 'world' || !currentMon) return;
    setFacing(dir);
    const nx = Math.max(0, Math.min(GD.W - 1, pos.x + dx));
    const ny = Math.max(0, Math.min(GD.H - 1, pos.y + dy));
    const tile = GD.WORLD.map[ny][nx];
    if (!GD.canWalk(tile, boatOwned)) {
      setLogs((l) => [tile === 'w' ? '海だ。船が必要だ。' : 'その先は進めない。', ...l].slice(0, 12));
      return;
    }

    setWalking(true);
    setStepA((s) => !s);
    setPos({ x: nx, y: ny });
    checkDiscover(nx, ny);

    const t = GD.townByCell(nx, ny);
    if (t) {
      setTownId(t.id);
      setScreen('town');
      setLogs((l) => [`${t.name}に入った。`, ...l].slice(0, 12));
      setTimeout(() => setWalking(false), 120);
      return;
    }

    if (tile === 's') {
      const dungeon = GD.WORLD.dungeons.find((d) => d.x === nx && d.y === ny);
      if (dungeon) {
        setDungeonState({ dungeonId: dungeon.id, name: dungeon.name, floor: dungeon.id === 'd1' ? 1 : 5, entryLv: Math.max(hero.lv, currentMon.lv), clearedBossFloors: {} });
        setScreen('dungeon');
        setLogs((l) => [`${dungeon.name}に突入！ 地下${dungeon.id === 'd1' ? 1 : 5}Fから開始`, ...l].slice(0, 12));
        setTimeout(() => setWalking(false), 120);
        return;
      }
    }

    if (tile === 'B') {
      const dragon = GD.makeMonster({ id: 149, name: '真龍', type: 'fire', hp: 1200, atk: 180, def: 130, sp: GD.sprite(149) }, 100);
      setLogs((l) => [`真龍「${GD.DRAGON_LINES[Math.floor(Math.random()*GD.DRAGON_LINES.length)]}」`, ...l].slice(0, 12));
      triggerEncounter(dragon, 'boss', 'mountain');
      setTimeout(() => setWalking(false), 120);
      return;
    }

    if (Math.random() < 0.06) {
      const idx = Math.floor(Math.random() * GD.RIVALS.length);
      const rival = GD.RIVALS[idx];
      const rivalEnemy = GD.makeMonster({ id: 26 + idx, name: `ライバル${rival.name}`, type: ['fire', 'water', 'grass', 'fire'][idx], hp: 180, atk: 35, def: 24, sp: GD.sprite(25 + idx) }, hero.lv + rival.lvBoost);
      setLogs((l) => [`ライバル ${rival.name} (${rival.style}) が勝負を挑んできた！「${GD.RIVAL_LINES[Math.floor(Math.random()*GD.RIVAL_LINES.length)]}」`, ...l].slice(0, 12));
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
    const npc = GD.NPCS.find((n) => Math.abs(pos.x - n.x) + Math.abs(pos.y - n.y) <= 1);
    if (npc) {
      setTalkCount((v) => v + 1);
      setLogs((l) => [`${npc.name}「${npc.line}」`, ...l].slice(0, 12));
      return;
    }
    if (Math.abs(pos.x - GD.WORLD.pirateNpc.x) + Math.abs(pos.y - GD.WORLD.pirateNpc.y) <= 1) {
      if (!pirateQuest.accepted) {
        const q = { accepted: true, rescued: false, complete: false };
        setPirateQuest(q);
        setLogs((l) => [GD.STORY_EVENTS[0].text, ...l].slice(0, 12));
      } else if (pirateQuest.rescued && !pirateQuest.complete) {
        const q = { ...pirateQuest, complete: true };
        setPirateQuest(q);
        setBoatOwned(true);
        setLogs((l) => [GD.STORY_EVENTS[2].text, ...l].slice(0, 12));
      } else {
        setLogs((l) => ['この船で世界の海を巡るといい。', ...l].slice(0, 12));
      }
      return;
    }
    setTalkCount((v) => v + 1);
    setLogs((l) => [`遠くから旅人の声が聞こえる…「${GD.NPC_LINES[Math.floor(Math.random() * GD.NPC_LINES.length)]}」`, ...l].slice(0, 12));
  };

  const investigate = () => {
    const tile = GD.WORLD.map[pos.y][pos.x];
    const key = `${pos.x},${pos.y}`;
    if (GD.IRON_SPOTS[key] && !claimedIron[key]) {
      const next = { ...claimedIron, [key]: true };
      setClaimedIron(next);
      setInventory((i) => ({ ...i, iron: (i.iron || 0) + 1 }));
      setLogs((l) => ['鉱脈を調査し、ironを発見した！', ...l].slice(0, 12));
      return;
    }
    const msg = tile === 's' ? '階段の先に気配がある。' : tile === 'h' ? '海賊の印を見つけた。' : tile === 'd' ? '熱い砂が広がっている。' : tile === 'b' ? '波打ち際に足跡が残る。' : tile === 'G' ? '背の高い草むらだ。' : tile === 'B' ? '真龍の咆哮が聞こえる…' : '周囲を調べたが特に何もない。';
    setLogs((l) => [msg, ...l].slice(0, 12));
  };

  const capture = () => {
    if (turn !== 'hero' || !enemy || inventory.ball <= 0 || battleMode !== 'wild' || hero.hpNow <= 0) return;
    const inv = { ...inventory, ball: inventory.ball - 1 };
    setInventory(inv);
    const rate = Math.max(0.1, 0.72 - (enemy.hpNow / enemy.maxHp));
    if (Math.random() < rate) {
      const caught = { ...enemy, exp: 0, expToNext: 100 };
      setCaptureCount((v) => v + 1);
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
    if (turn !== 'hero' || !enemy || hero.hpNow <= 0) return;
    const crit = Math.random() < 0.16;
    const raw = Math.max(8, Math.floor((hero.atk + hero.weaponLv * 3) - enemy.defNow * 0.45 + Math.random() * 10));
    const d = crit ? Math.floor(raw * 1.7) : raw;
    setEnemy({ ...enemy, hpNow: Math.max(0, enemy.hpNow - d) });
    setLogs((l) => [`リンクの剣撃！ ${d}ダメージ${crit ? '（クリティカル！）' : ''}`, ...l].slice(0, 12));
    setTurn(currentMon?.hpNow > 0 ? 'monster' : 'enemy');
  };

  const heroSkill = () => {
    if (turn !== 'hero' || hero.mp < 8 || !enemy || hero.hpNow <= 0) return;
    const d = Math.max(14, Math.floor((hero.atk + hero.weaponLv * 2) * 1.35 - enemy.defNow * 0.35 + Math.random() * 8));
    setHero({ ...hero, mp: hero.mp - 8 });
    setEnemy({ ...enemy, hpNow: Math.max(0, enemy.hpNow - d) });
    setLogs((l) => [`リンクの回転斬り！ ${d}ダメージ`, ...l].slice(0, 12));
    setTurn(currentMon?.hpNow > 0 ? 'monster' : 'enemy');
  };

  const usePotion = () => {
    if (turn !== 'hero' || inventory.potion <= 0 || hero.hpNow <= 0) return;
    setHero((h) => ({ ...h, hpNow: Math.min(h.maxHp, h.hpNow + 65) }));
    setInventory((i) => ({ ...i, potion: i.potion - 1 }));
    setLogs((l) => ['ポーションでリンクが回復！', ...l].slice(0, 12));
    setTurn(currentMon?.hpNow > 0 ? 'monster' : 'enemy');
  };

  const monAttack = () => {
    if (turn !== 'monster' || !enemy || !currentMon) return;
    const m = GD.TYPE_MULT[currentMon.type]?.[enemy.type] || 1;
    const crit = Math.random() < 0.12;
    const raw = Math.max(7, Math.floor(currentMon.atkNow * m - enemy.defNow * 0.45 + Math.random() * 10));
    const d = crit ? Math.floor(raw * 1.55) : raw;
    setEnemy({ ...enemy, hpNow: Math.max(0, enemy.hpNow - d) });
    setLogs((l) => [`${currentMon.name}のアタック！ ${d}ダメージ${crit ? '（会心！）' : ''}`, ...l].slice(0, 12));
    setTurn('enemy');
  };

  const innRest = () => {
    setHero((h) => ({ ...h, hpNow: h.maxHp, mp: 30 }));
    setParty((p) => p.map((m) => ({ ...m, hpNow: m.maxHp })));
    setLogs((l) => ['宿屋に休んだ。体力が回復した！', ...l].slice(0, 12));
  };

  const forgeWeapon = () => {
    const cost = GD.smithCost(hero.weaponLv);
    if (gil < cost || inventory.iron <= 0) {
      setLogs((l) => [`素材またはギル不足（必要: ${cost}ギル + 鉄1）`, ...l].slice(0, 12));
      return;
    }
    setGil((g) => g - cost);
    setInventory((i) => ({ ...i, iron: i.iron - 1 }));
    setHero((h) => ({ ...h, weaponLv: h.weaponLv + 1, atk: h.atk + 2 }));
    setLogs((l) => [`鍛冶屋で武器を強化！ 次回費用 ${GD.smithCost(hero.weaponLv + 1)}ギル`, ...l].slice(0, 12));
  };

  const buyItem = (key, price) => {
    if (gil < price) {
      setLogs((l) => ['ギルが足りない。', ...l].slice(0, 12));
      return;
    }
    if (GD.totalItemCount(inventory) + 1 > GD.ITEM_CAPACITY) {
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
        const boss = GD.makeMonster({ id: 248, name: `${dungeonState.floor}Fボス`, type: 'fire', hp: 260 + dungeonState.floor * 6, atk: 48 + dungeonState.floor, def: 30 + dungeonState.floor * 0.8, sp: GD.sprite(248) }, lv + 3);
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
    const minFloor = dungeonState.dungeonId === 'd1' ? 1 : 5;
    const nf = Math.max(minFloor, Math.min(50, dungeonState.floor + delta));
    setDungeonState((d) => ({ ...d, floor: nf }));
    setLogs((l) => [`${dungeonState.name} 地下${nf}Fへ`, ...l].slice(0, 12));
    if (delta > 0 && dungeonState.dungeonId === 'd1') {
      const lv = dungeonState.entryLv + Math.floor(nf / 2);
      triggerEncounter(makeEnemy(lv), 'wild', 'dungeon');
    }
  };

  const renderTileIcon = (cell) => {
    if (cell.npc) return '🧑';
    if (cell.dragon) return '🐉';
    const map = { t: '🏘️', r: '·', w: '🌊', m: '⛰️', F: '🌲', G: '🌾', h: '🏴‍☠️', d: '🏜️', b: '🏖️', p: '🌸', s: '🕍', B: '🐉' };
    return map[cell.t] || '';
  };

  return (
    <div className="app"><div className="phone-shell zelda-skin">
      <header className="header"><strong>Pocket Legend ✨</strong><span className="badge">ランク: {wonderRank} / ギル {gil}</span></header>
      {saveError && <div className="panel save-error">{saveError}</div>}

      {screen === 'title' && <div className="screen-scroll center-col">
        <div className="panel title-panel"><h1>ポケット冒険ワールド</h1><p>任天堂級のワクワクを追求した冒険RPG</p><div className="sparkle">✦ ✧ ✦</div></div>
        <button className="btn" onClick={() => setScreen('starter')}>冒険開始</button>
      </div>}

      {screen === 'starter' && <div className="screen-scroll">
        <div className="panel"><strong>最初の仲間を選ぶ（火・水・草）</strong></div>
        <div className="grid">{GD.STARTERS.map((s) => (
          <div key={s.id} className="starter-card">
            <img src={GD.sprite(s.id)} className="monster-art" alt={s.name} />
            <div className="grow"><strong>{s.name}</strong><div>{s.type.toUpperCase()}</div></div>
            <button className="btn" onClick={() => startGame(s)}>選択</button>
          </div>
        ))}</div>
      </div>}

      {screen === 'intro' && <div className="screen-scroll center-col">
        <div className="panel"><strong>始まりのイベント（拡張）</strong><p>{GD.INTRO_EVENTS[introIdx]}</p></div>
        <div className="footer-actions">
          <button className="btn" onClick={() => setIntroIdx((i) => Math.max(0, i - 1))} disabled={introIdx === 0}>戻る</button>
          <button className="btn" onClick={() => introIdx < GD.INTRO_EVENTS.length - 1 ? setIntroIdx((i) => i + 1) : (setScreen('world'), saveData())}>{introIdx < GD.INTRO_EVENTS.length - 1 ? '次へ' : '出発'}</button>
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
            {boatOwned && GD.WORLD.map[pos.y][pos.x] === 'w' ? <span>⛵</span> : <div className="hero-avatar"><i className="hair"/><i className="face"/><i className="tunic"/><i className="sword"/></div>}
          </div>
        </div>

        <div className="panel dq-message">{logs[0]}</div>
        <div className="panel wonder-panel">冒険ワクワク指数: <strong>{wonderScore}</strong> / 現在ランク: <strong>{wonderRank}</strong> / ライバル撃破: {rivalsDefeated}</div>

        <div className="dq-controls">
          <div className="panel dq-command-grid">
            <button className="btn mini" onClick={talk}>はなす</button>
            <button className="btn mini" onClick={investigate}>しらべる</button>
            <button className="btn mini" onClick={() => setShowBag(true)}>もちもの</button>
            <button className="btn mini" onClick={() => setShowStatus(true)}>ステータス</button>
            <button className="btn mini" onClick={() => setShowJournal(true)}>イベントログ</button>
          </div>
          <div className="dpad dq-dpad">
            <div /> <button className="btn" onClick={() => move(0, -1, 'up')}>▲</button> <div />
            <button className="btn" onClick={() => move(-1, 0, 'left')}>◀</button> <div /> <button className="btn" onClick={() => move(1, 0, 'right')}>▶</button>
            <div /> <button className="btn" onClick={() => move(0, 1, 'down')}>▼</button> <div />
          </div>
        </div>

      </div>}

      {screen === 'town' && <div className="screen-scroll">
        <div className="panel"><strong>{GD.TOWNS.find(t => t.id===townId)?.name || '町'}</strong><p>{GD.TOWN_DETAILS[townId]?.motif || '町の施設を利用しよう。'}</p></div>
        <div className={`town-map town-${townId || 'start'}`}>
          <button className="panel town-tile" onClick={innRest}>🏨 宿屋<br/><small>休んで回復</small></button>
          <button className="panel town-tile" onClick={forgeWeapon}>⚒️ 鍛冶屋<br/><small>鍛錬費 {GD.smithCost(hero.weaponLv)}G</small></button>
          <button className="panel town-tile" onClick={() => saveData()}>⛪ 教会<br/><small>セーブ</small></button>
          <button className="panel town-tile" onClick={() => loadData()}>📜 教会<br/><small>ロード</small></button>
          <button className="panel town-tile" onClick={() => buyItem('ball', GD.BALL_PRICE)}>🏪 商会<br/><small>ボール {GD.BALL_PRICE}G ({inventory.ball})</small></button>
          <button className="panel town-tile" onClick={() => buyItem('potion', GD.POTION_PRICE)}>🧪 商会<br/><small>ポーション {GD.POTION_PRICE}G ({inventory.potion})</small></button>
        </div>
        <button className="btn" onClick={() => setScreen('world')}>ワールドへ戻る</button>
      </div>}

      {screen === 'dungeon' && dungeonState && <div className="screen-scroll">
        <div className="panel"><strong>{dungeonState.name}</strong><p>地下{dungeonState.floor}F / 入場時基準Lv {dungeonState.entryLv} / 5Fごとにボス（古代遺跡は1F開始）</p></div>
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
          <button className="btn" onClick={heroAttack} disabled={turn !== 'hero' || hero.hpNow <= 0}>リンク攻撃</button>
          <button className="btn" onClick={heroSkill} disabled={turn !== 'hero' || hero.mp < 8 || hero.hpNow <= 0}>回転斬り</button>
          <button className="btn" onClick={usePotion} disabled={turn !== 'hero' || inventory.potion <= 0 || hero.hpNow <= 0}>ポーション({inventory.potion})</button>
          <button className="btn" onClick={capture} disabled={turn !== 'hero' || inventory.ball <= 0 || battleMode !== 'wild' || hero.hpNow <= 0}>捕獲({inventory.ball})</button>
          <button className="btn" onClick={monAttack} disabled={turn !== 'monster'}>{currentMon.name}攻撃</button>
          <button className="btn" onClick={() => setScreen(dungeonState ? 'dungeon' : 'world')}>にげる</button>
        </div>
      </div>}

      {showBag && <div className="overlay" onClick={() => setShowBag(false)}>
        <div className="panel bag" onClick={(e) => e.stopPropagation()}>
          <h3>もちもの ({GD.totalItemCount(inventory)}/{GD.ITEM_CAPACITY})</h3>
          {Object.entries(inventory).map(([k, v]) => <div key={k} className="bag-row"><span>{k}</span><strong>{v}</strong></div>)}
          <button className="btn" onClick={() => setShowBag(false)}>閉じる</button>
        </div>
      </div>}

      {showJournal && <div className="overlay" onClick={() => setShowJournal(false)}>
        <div className="panel status" onClick={(e) => e.stopPropagation()}>
          <h3>イベントログ</h3><p>エグゼクティブレビュー用: 進行・戦績・達成項目をここで確認できます。</p>
          <div className="log">{logs.map((l, i) => <div key={`jl-${i}`}>{l}</div>)}</div>
          <div className="event-list">
            {GD.STORY_EVENTS.map((e) => <div key={e.id} className="event-item"><strong>{e.title}</strong><div>{e.text}</div></div>)}
            {readyQuests.map((ev) => <div key={ev.id} className="event-item"><strong>{ev.title}</strong><div>{ev.text}</div><small>進捗 {getQuestProgress(ev)}/{ev.target}</small><button className="btn mini" onClick={() => addQuestReward(ev)}>達成</button></div>)}
          </div>
          <button className="btn" onClick={() => setShowJournal(false)}>閉じる</button>
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

}
