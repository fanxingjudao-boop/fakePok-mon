/* ============================================================
 * game.js — ゲーム本体
 * オーバーワールド / 会話・メニューUI / ストーリー進行 /
 * ずかん・バッグ・レポート / しんか演出 / エンディング
 * ============================================================ */
(() => {
  const GD = window.GameData;
  const SP = window.Sprites;
  const AU = window.AudioSys;
  const BT = () => window.Battle;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const TILE = 32;
  const VIEW_W = 15, VIEW_H = 11;
  const SAVE_VERSION = 2;
  const SAVE_KEY = 'fakemon_save_v2';
  const SAVE_KEY_V1 = 'fakemon_save_v1';

  /* ================= 状態 ================= */
  let G = null;            // セーブ対象の全状態
  let curMap = null;       // 現在のマップ定義
  let cutscene = false;    // イベント中は移動不可
  let uiDepth = 0;         // モーダルUI深度
  let evoQueue = new Map();
  let exclaim = null;      // {x,y} !マーク表示
  let npcOffsets = {};     // 歩行アニメ用 npcId → {px,py}

  const newGame = () => ({
    v: SAVE_VERSION,
    name: 'ユウ', rivalName: 'レン',
    money: 3000,
    bag: { potion: 2 },
    party: [], box: [],
    flags: {},
    dex: { seen: {}, caught: {} },
    starterId: 0,
    mapId: 'home', x: 4, y: 3, dir: 'down',
    healPoint: { mapId: 'home', x: 4, y: 3 },
    playSec: 0,
    // 碧環の旅: 行動履歴(結末を決める)と地域試練クリア記録。story.js の設計に対応。
    scores: { restore: 0, nature: 0, share: 0 },
    regionCleared: {}
  });

  /* ================= 入力 ================= */
  const Input = {
    held: new Set(),
    stack: [],
    push(fn) { this.stack.push(fn); },
    pop() { this.stack.pop(); },
    dispatch(key) {
      AU.unlock();
      const h = this.stack[this.stack.length - 1];
      if (h) h(key);
    }
  };
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    z: 'a', Z: 'a', ' ': 'a', x: 'b', X: 'b', Enter: 'start', Escape: 'b'
  };
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.key];
    if (!k) return;
    e.preventDefault();
    if (!e.repeat) Input.dispatch(k);
    Input.held.add(k);
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.key];
    if (k) Input.held.delete(k);
  });
  document.querySelectorAll('[data-key]').forEach((btn) => {
    const k = btn.dataset.key;
    const down = (e) => { e.preventDefault(); Input.dispatch(k); Input.held.add(k); };
    const up = (e) => { e.preventDefault(); Input.held.delete(k); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  $('mute-btn').addEventListener('click', () => {
    AU.unlock();
    const m = !AU.isMuted();
    AU.setMuted(m);
    $('mute-btn').textContent = m ? '♪OFF' : '♪ON';
  });

  /* ================= メッセージ ================= */
  function splitPages(text) {
    const lines = String(text).split('\n');
    const pages = [];
    for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2).join('\n'));
    return pages;
  }

  function say(text, opts = {}) {
    const pages = splitPages(text);
    return new Promise((resolve) => {
      uiDepth++;
      const box = $('msgbox'), tx = $('msgtext'), nx = $('msgnext');
      box.classList.remove('hidden');
      let page = 0, charIdx = 0, timer = null, done = false, autoTimer = null;

      const startPage = () => {
        charIdx = 0; done = false;
        nx.classList.add('hidden');
        tx.textContent = '';
        clearInterval(timer);
        timer = setInterval(() => {
          charIdx++;
          tx.textContent = pages[page].slice(0, charIdx);
          if (charIdx >= pages[page].length) finishPage();
        }, 22);
      };
      const finishPage = () => {
        clearInterval(timer);
        tx.textContent = pages[page];
        done = true;
        nx.classList.remove('hidden');
        if (opts.auto) autoTimer = setTimeout(next, opts.auto);
      };
      const next = () => {
        clearTimeout(autoTimer);
        if (page < pages.length - 1) { page++; startPage(); }
        else close();
      };
      const close = () => {
        clearInterval(timer); clearTimeout(autoTimer);
        box.classList.add('hidden');
        Input.pop();
        uiDepth--;
        resolve();
      };
      Input.push((key) => {
        if (key !== 'a' && key !== 'b') return;
        if (!done) { charIdx = pages[page].length; finishPage(); }
        else { AU.sfx('select'); next(); }
      });
      startPage();
    });
  }

  /* ================= メニュー ================= */
  function menu(items, opts = {}) {
    return new Promise((resolve) => {
      uiDepth++;
      const root = $('menu-root');
      const box = document.createElement('div');
      box.className = 'menu-box' + (opts.grid ? ' menu-grid' : '') + (opts.wide ? ' menu-wide' : '');
      if (opts.title) {
        const t = document.createElement('div');
        t.className = 'menu-title';
        t.textContent = opts.title;
        box.appendChild(t);
      }
      const list = document.createElement('div');
      list.className = opts.grid ? 'menu-items grid2' : 'menu-items';
      const els = items.map((it) => {
        const row = document.createElement('div');
        row.className = 'menu-item';
        const label = typeof it === 'string' ? it : it.label;
        row.innerHTML = `<span class="cursor">▶</span><span class="mi-label"></span>` +
          (typeof it === 'object' && it.sub ? `<span class="mi-sub"></span>` : '');
        row.querySelector('.mi-label').textContent = label;
        if (typeof it === 'object' && it.sub) row.querySelector('.mi-sub').textContent = it.sub;
        list.appendChild(row);
        return row;
      });
      box.appendChild(list);
      root.appendChild(box);
      let idx = Math.max(0, opts.initial || 0);
      const cols = opts.grid ? 2 : 1;
      const paint = () => {
        els.forEach((el, i) => el.classList.toggle('sel', i === idx));
        els[idx]?.scrollIntoView({ block: 'nearest' });
      };
      const close = (val) => {
        root.removeChild(box);
        Input.pop();
        uiDepth--;
        resolve(val);
      };
      Input.push((key) => {
        if (key === 'up' && idx - cols >= 0) { idx -= cols; AU.sfx('select'); }
        else if (key === 'down' && idx + cols < items.length) { idx += cols; AU.sfx('select'); }
        else if (key === 'left' && cols === 2 && idx % 2 === 1) { idx--; AU.sfx('select'); }
        else if (key === 'right' && cols === 2 && idx % 2 === 0 && idx + 1 < items.length) { idx++; AU.sfx('select'); }
        else if (key === 'a') { AU.sfx('confirm'); return close(idx); }
        else if (key === 'b' && opts.cancelable !== false) {
          if (opts.cancelable) { AU.sfx('cancel'); return close(-1); }
        }
        paint();
      });
      paint();
    });
  }

  const confirm = async (title) => (await menu(['はい', 'いいえ'], { title, cancelable: true })) === 0;

  /* ================= モンスター/アイテムUI ================= */
  const monName = (m) => GD.speciesById(m.spId).name;

  function partyPick(opts = {}) {
    return new Promise(async (resolve) => {
      uiDepth++;
      const root = $('menu-root');
      const box = document.createElement('div');
      box.className = 'menu-box party-box';
      const title = document.createElement('div');
      title.className = 'menu-title';
      title.textContent = opts.title || 'モンスターを えらんでください';
      box.appendChild(title);
      const list = document.createElement('div');
      list.className = 'menu-items';
      const rows = G.party.map((m) => {
        const st = BT().calcStats(m.spId, m.lv);
        const row = document.createElement('div');
        row.className = 'menu-item party-row';
        const cv = document.createElement('canvas');
        cv.width = 32; cv.height = 32;
        const c = cv.getContext('2d');
        c.imageSmoothingEnabled = false;
        c.drawImage(SP.monCanvas(m.spId, false), 0, 0, 32, 32);
        row.appendChild(cv);
        const info = document.createElement('div');
        info.className = 'party-info';
        info.innerHTML = `<div class="pr-name"></div>
          <div class="hp-row mini"><span class="hp-tag">HP</span><div class="hp-bar"><div class="hp-fill"></div></div></div>
          <div class="pr-sub"></div>`;
        info.querySelector('.pr-name').textContent = `${monName(m)}  Lv${m.lv}`;
        const pct = m.hp / st.maxHp;
        const fill = info.querySelector('.hp-fill');
        fill.style.width = `${pct * 100}%`;
        fill.className = 'hp-fill' + (pct <= 0.2 ? ' hp-red' : pct <= 0.5 ? ' hp-yellow' : '');
        info.querySelector('.pr-sub').textContent =
          `HP ${m.hp}/${st.maxHp}${m.status ? '  [' + { psn: 'どく', par: 'まひ', brn: 'やけど', slp: 'ねむり' }[m.status] + ']' : ''}${m.hp <= 0 ? '  ひんし' : ''}`;
        row.insertBefore(row.querySelector('canvas'), null);
        const cur = document.createElement('span');
        cur.className = 'cursor'; cur.textContent = '▶';
        row.prepend(cur);
        row.appendChild(info);
        list.appendChild(row);
        return row;
      });
      box.appendChild(list);
      root.appendChild(box);
      let idx = 0;
      const paint = () => rows.forEach((el, i) => el.classList.toggle('sel', i === idx));
      const close = (val) => { root.removeChild(box); Input.pop(); uiDepth--; resolve(val); };
      Input.push(async (key) => {
        if (key === 'up' && idx > 0) { idx--; AU.sfx('select'); }
        else if (key === 'down' && idx < G.party.length - 1) { idx++; AU.sfx('select'); }
        else if (key === 'a') {
          const m = G.party[idx];
          if (opts.forSwitch) {
            if (m.hp <= 0) { AU.sfx('cancel'); title.textContent = `${monName(m)}は たたかえない！`; return; }
            if (m.uid === opts.currentUid) { AU.sfx('cancel'); title.textContent = `${monName(m)}は もう たたかっている！`; return; }
          }
          AU.sfx('confirm');
          return close(idx);
        }
        else if (key === 'b' && !opts.mustPick) { AU.sfx('cancel'); return close(-1); }
        paint();
      });
      paint();
    });
  }

  async function applyItem(itemKey, mon) {
    const it = GD.ITEMS[itemKey];
    const st = BT().calcStats(mon.spId, mon.lv);
    if (it.kind === 'heal') {
      if (mon.hp <= 0) return { ok: false, msg: `ひんしの ${monName(mon)}には つかえない！` };
      if (mon.hp >= st.maxHp) return { ok: false, msg: 'HPは まんたんだ！' };
      const before = mon.hp;
      mon.hp = Math.min(st.maxHp, mon.hp + it.amount);
      return { ok: true, msg: `${monName(mon)}の HPが ${mon.hp - before} かいふくした！` };
    }
    if (it.kind === 'cure') {
      if (mon.hp <= 0) return { ok: false, msg: `ひんしの ${monName(mon)}には つかえない！` };
      if (!mon.status || (it.cures !== 'all' && mon.status !== it.cures)) return { ok: false, msg: 'こうかが ない みたいだ…' };
      mon.status = null;
      return { ok: true, msg: `${monName(mon)}は げんきに なった！` };
    }
    if (it.kind === 'revive') {
      if (mon.hp > 0) return { ok: false, msg: 'こうかが ない みたいだ…' };
      mon.hp = Math.floor(st.maxHp / 2);
      return { ok: true, msg: `${monName(mon)}は めを さました！` };
    }
    return { ok: false, msg: 'つかえない…' };
  }

  async function bagPick(opts = {}) {
    while (true) {
      const keys = Object.keys(G.bag).filter((k) => G.bag[k] > 0);
      if (!keys.length) { await say('バッグは からっぽだ！'); return null; }
      const items = keys.map((k) => ({ label: GD.ITEMS[k].name, sub: `x${G.bag[k]}` }));
      const i = await menu(items, { title: `バッグ  (おかね ${G.money}円)`, cancelable: true, wide: true });
      if (i < 0) return null;
      const key = keys[i];
      const it = GD.ITEMS[key];
      if (it.kind === 'ball') {
        if (!opts.inBattle) { await say('いまは つかうときじゃない！'); continue; }
        if (!opts.wild) { await say('ひとの モンスターに ボールを なげるなんて とんでもない！'); continue; }
        G.bag[key]--;
        return { kind: 'ball', itemKey: key };
      }
      const idx = await partyPick({ title: 'どの モンスターに つかう？' });
      if (idx < 0) continue;
      const res = await applyItem(key, G.party[idx]);
      await say(res.msg);
      if (res.ok) {
        AU.sfx('confirm');
        G.bag[key]--;
        return opts.inBattle ? { kind: 'used' } : null;
      }
    }
  }

  window.UI = { say, menu, partyPick, bagPick, sleep };

  /* ================= フェード/バナー ================= */
  async function fadeOut() {
    const f = $('fader');
    f.classList.remove('hidden');
    f.classList.add('on');
    await sleep(320);
  }
  async function fadeIn() {
    const f = $('fader');
    f.classList.remove('on');
    await sleep(320);
    f.classList.add('hidden');
  }
  function banner(text) {
    let b = document.getElementById('map-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'map-banner';
      $('screen-frame').appendChild(b);
    }
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(banner._t);
    banner._t = setTimeout(() => b.classList.remove('show'), 1800);
  }

  /* ================= オーバーワールド ================= */
  const ctx = $('screen').getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const player = { px: 0, py: 0, moving: false, prog: 0, fromX: 0, fromY: 0, parity: false };

  const tileAt = (map, x, y) => (map.rows[y] && map.rows[y][x]) || null;
  const isSolid = (map, x, y) => {
    const t = tileAt(map, x, y);
    if (t === null) return true;
    if (GD.isSolidTile(t)) return true;
    if (map.lockedDoors && map.lockedDoors.some((d) => d.x === x && d.y === y)) return true;
    return false;
  };

  function npcVisible(n) {
    if (n.hideIf && G.flags[n.hideIf]) return false;
    if (n.blockIf && n.blockIf.startsWith('!') && G.flags[n.blockIf.slice(1)]) return false;
    if (n.kind === 'trainer' && G.flags[`t_${n.id}`] && n.hideIf) return false;
    return true;
  }
  const allEntities = (map) => [...(map.npcs || []), ...(map.trainers || [])].filter(npcVisible);
  const entityAt = (map, x, y) => allEntities(map).find((n) => n.x === x && n.y === y);

  function loadMap(id, x, y, dir) {
    curMap = GD.MAPS[id];
    G.mapId = id; G.x = x; G.y = y;
    if (dir) G.dir = dir;
    player.moving = false; player.prog = 0;
    npcOffsets = {};
    AU.play(curMap.music || 'town');
    banner(curMap.name);
  }

  /* --- 描画 --- */
  function render(time) {
    const map = curMap;
    if (!map) return;
    const animFrame = Math.floor(time / 400) % 2;
    const mw = map.rows[0].length * TILE, mh = map.rows.length * TILE;
    let px = G.x * TILE, py = G.y * TILE;
    if (player.moving) {
      const t = player.prog;
      px = (player.fromX + (G.x - player.fromX) * t) * TILE;
      py = (player.fromY + (G.y - player.fromY) * t) * TILE;
    }
    let camX = px - (VIEW_W / 2 - 0.5) * TILE;
    let camY = py - (VIEW_H / 2 - 0.5) * TILE;
    if (mw <= VIEW_W * TILE) camX = -(VIEW_W * TILE - mw) / 2;
    else camX = Math.max(0, Math.min(mw - VIEW_W * TILE, camX));
    if (mh <= VIEW_H * TILE) camY = -(VIEW_H * TILE - mh) / 2;
    else camY = Math.max(0, Math.min(mh - VIEW_H * TILE, camY));

    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, VIEW_W * TILE, VIEW_H * TILE);

    const x0 = Math.floor(camX / TILE), y0 = Math.floor(camY / TILE);
    for (let ty = y0; ty <= y0 + VIEW_H; ty++) {
      for (let tx = x0; tx <= x0 + VIEW_W; tx++) {
        const t = tileAt(map, tx, ty);
        if (t === null) continue;
        const anim = (t === 'W' || t === '%') ? animFrame : 0;
        const cv = SP.tileCanvas(t, { roofColor: map.roofColor, cave: map.cave }, anim);
        ctx.drawImage(cv, 0, 0, 16, 16, Math.round(tx * TILE - camX), Math.round(ty * TILE - camY), TILE, TILE);
      }
    }

    // エンティティ + プレイヤーを y ソートで描画
    const drawables = allEntities(map).map((n) => {
      const off = npcOffsets[n.id] || { px: n.x * TILE, py: n.y * TILE };
      return { y: off.py, draw: () => drawChar(n.skin, n.dir, 0, off.px - camX, off.py - camY) };
    });
    const pframe = player.moving ? (player.prog < 0.5 ? (player.parity ? 1 : 0) : 0) : 0;
    const pMovingFrame = player.moving && player.prog < 0.6 ? 1 : 0;
    drawables.push({ y: py, draw: () => drawChar('player', G.dir, player.moving ? (player.parity ? pMovingFrame : 0) : 0, px - camX, py - camY) });
    drawables.sort((a, b) => a.y - b.y);
    drawables.forEach((d) => d.draw());

    if (exclaim) {
      const ex = exclaim.x * TILE - camX + 8, ey = exclaim.y * TILE - camY - 22;
      ctx.fillStyle = '#f8f8f0';
      ctx.fillRect(ex, ey, 16, 18);
      ctx.strokeStyle = '#202030';
      ctx.strokeRect(ex + 0.5, ey + 0.5, 15, 17);
      ctx.fillStyle = '#c02020';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('!', ex + 6, ey + 14);
    }
  }

  function drawChar(skin, dir, frame, sx, sy) {
    const cv = SP.charCanvas(skin, dir, frame);
    ctx.drawImage(cv, 0, 0, 16, 16, Math.round(sx), Math.round(sy - 6), TILE, TILE);
  }

  /* --- 移動 --- */
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  let lastBump = 0;

  function tryMove(dir) {
    if (player.moving || cutscene || uiDepth > 0) return;
    G.dir = dir;
    const [dx, dy] = DIRV[dir];
    const nx = G.x + dx, ny = G.y + dy;
    const t = tileAt(curMap, nx, ny);

    if (t === null) { attemptEdgeExit(dir); return; }
    if (isSolid(curMap, nx, ny) || entityAt(curMap, nx, ny)) {
      // 能力ゲート扉(障害物)にぶつかったら、能力を満たせば奥のエリアへ
      const obs = (curMap.obstacles || []).find((o) => o.x === nx && o.y === ny);
      if (obs && !entityAt(curMap, nx, ny)) { handleObstacle(obs); return; }
      const now = performance.now();
      if (now - lastBump > 350) { AU.sfx('bump'); lastBump = now; }
      return;
    }
    player.fromX = G.x; player.fromY = G.y;
    G.x = nx; G.y = ny;
    player.moving = true; player.prog = 0;
    player.parity = !player.parity;
  }

  async function attemptEdgeExit(dir) {
    const ee = curMap.edgeExits && curMap.edgeExits[dir];
    if (!ee || !ee.tiles.some(([x, y]) => x === G.x && y === G.y)) return;
    // 出入口ごとの requirements をデータ側で評価(NPC非依存・迂回不可)
    if (ee.req) {
      const res = GD.meetsRequirements(ee.req, { flags: G.flags, party: G.party });
      if (!res.ok) { cutscene = true; await say(res.text || 'まだ ここは とおれない。'); cutscene = false; return; }
    }
    cutscene = true;
    await fadeOut();
    loadMap(ee.to, ee.tx, ee.ty, dir);
    await fadeIn();
    cutscene = false;
    afterWarpStep();
  }

  // 通行止めは NPC の立ち位置ではなく、出入口ごとの requirements で判定する(迂回不可)。
  const GATES = [
    { map: 'hometown', dir: 'up',
      req: { allFlags: ['starter'], text: 'カエデはかせが けんきゅうじょで\nまっている みたいだ。' } },
    { map: 'minamo', dir: 'right',
      req: { allFlags: ['badge1'], text: 'まもりのもん「ジムバッジが なければ\nこの さきの ルート2へは とおせません！」' } },
    { map: 'tsukimi', dir: 'up',
      req: { allBadges: true,
        text: 'けいびいん「ここから さきは ヴィクトリーロード。\n8つの ジムバッジ すべてが ないと とおれません！」' } }
  ];
  const gateFor = (mapId, dir) => GATES.find((g) => g.map === mapId && g.dir === dir);

  async function afterWarpStep() {
    // ワープ直後のタイルイベント (エンカウント無し)
    await checkTrainerSight();
  }

  async function onStepComplete() {
    const t = tileAt(curMap, G.x, G.y);
    // ワープ (ドア/マット)
    const w = (curMap.warps || []).find((w) => w.x === G.x && w.y === G.y);
    if (w) {
      cutscene = true;
      AU.sfx('door');
      await fadeOut();
      const targetIndoor = GD.MAPS[w.to].indoor;
      loadMap(w.to, w.tx, w.ty, targetIndoor ? 'up' : 'down');
      await fadeIn();
      cutscene = false;
      return;
    }
    // 野生エンカウント
    if (curMap.encounters && GD.isEncounterTile(t) && Math.random() < curMap.encounters.rate && G.party.some((m) => m.hp > 0)) {
      cutscene = true;
      await runWildEncounter();
      cutscene = false;
      return;
    }
    await checkTrainerSight();
  }

  // 進行度(取得済み環核数)に応じた敵レベル補正。攻略順が変わっても難度を保つ。
  const REGION_OF = {
    forest: 'forest', forest_marsh: 'forest', forest_shrine: 'forest',
    tide: 'tide', tide_pc: 'tide', tide_obs: 'tide', tide_shrine: 'tide',
    flare: 'flare', flare_pc: 'flare', flare_cool: 'flare', flare_shrine: 'flare',
    storm: 'storm', storm_pc: 'storm', storm_tower: 'storm', storm_shrine: 'storm',
    ruins: 'ruins', nexus: 'nexus'
  };
  function levelBump() {
    const region = REGION_OF[curMap && curMap.id] || 'kodachi';
    const R = window.StoryData.REGIONS[region];
    const base = (R && R.unlock && R.unlock.minCores) || 0;
    return Math.max(0, GD.coreCount(G.flags) - base) * 2;
  }
  const scaleTeam = (team) => team.map(([sp, lv]) => [sp, lv + levelBump()]);

  async function runWildEncounter() {
    const list = curMap.encounters.list;
    const total = list.reduce((a, e) => a + e[3], 0);
    let r = Math.random() * total, pick = list[0];
    for (const e of list) { r -= e[3]; if (r <= 0) { pick = e; break; } }
    const [spId, lo, hi] = pick;
    const lv = lo + Math.floor(Math.random() * (hi - lo + 1)) + levelBump();
    const result = await BT().startWild(spId, lv, curMap.cave ? 'cave' : 'grass');
    if (result === 'lose') await blackout();
    else AU.play(curMap.music || 'town');
  }

  /* --- トレーナー視線 --- */
  function lineClear(map, x1, y1, x2, y2) {
    const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
    let x = x1 + dx, y = y1 + dy;
    while (x !== x2 || y !== y2) {
      if (isSolid(map, x, y) || entityAt(map, x, y)) return false;
      x += dx; y += dy;
    }
    return true;
  }

  async function checkTrainerSight() {
    if (cutscene) return;
    for (const tr of (curMap.trainers || [])) {
      if (!npcVisible(tr) || G.flags[`t_${tr.id}`]) continue;
      const [dx, dy] = DIRV[tr.dir];
      const aligned = (dx !== 0 && tr.y === G.y && Math.sign(G.x - tr.x) === dx && Math.abs(G.x - tr.x) <= tr.sight) ||
                      (dy !== 0 && tr.x === G.x && Math.sign(G.y - tr.y) === dy && Math.abs(G.y - tr.y) <= tr.sight);
      if (!aligned) continue;
      if (!lineClear(curMap, tr.x, tr.y, G.x, G.y)) continue;
      await engageTrainer(tr, true);
      return;
    }
  }

  async function walkTrainerToPlayer(tr) {
    const [dx, dy] = DIRV[tr.dir];
    while (Math.abs(tr.x - G.x) + Math.abs(tr.y - G.y) > 1) {
      const fx = tr.x + dx, fy = tr.y + dy;
      const from = { x: tr.x, y: tr.y };
      tr.x = fx; tr.y = fy;
      for (let p = 0; p <= 1; p += 0.2) {
        npcOffsets[tr.id] = { px: (from.x + (fx - from.x) * p) * TILE, py: (from.y + (fy - from.y) * p) * TILE };
        await sleep(30);
      }
      npcOffsets[tr.id] = { px: fx * TILE, py: fy * TILE };
    }
  }

  const faceEachOther = (n) => {
    if (n.x < G.x) { n.dir = 'right'; G.dir = 'left'; }
    else if (n.x > G.x) { n.dir = 'left'; G.dir = 'right'; }
    else if (n.y < G.y) { n.dir = 'down'; G.dir = 'up'; }
    else { n.dir = 'up'; G.dir = 'down'; }
  };

  async function engageTrainer(tr, fromSight) {
    cutscene = true;
    if (fromSight) {
      exclaim = { x: tr.x, y: tr.y };
      AU.sfx('exclaim');
      await sleep(650);
      exclaim = null;
      await walkTrainerToPlayer(tr);
    }
    faceEachOther(tr);
    for (const t of tr.pre) await say(t);
    // 進行度に応じてトレーナーの手持ちLvを補正
    const def = Array.isArray(tr.team) ? { ...tr, team: scaleTeam(tr.team) } : tr;
    const result = await BT().startTrainer(def, curMap.cave ? 'cave' : 'grass');
    if (result === 'win') {
      G.flags[`t_${tr.id}`] = true;
      if (tr.flagOnWin) G.flags[tr.flagOnWin] = true;
      if (G.flags.g1 && G.flags.g2 && !G.flags.grunts) {
        G.flags.grunts = true;
      }
      if (tr.afterScript) for (const t of tr.afterScript) await say(`${tr.name}\n「${t}」`);
      AU.play(curMap.music || 'town');
    } else if (result === 'lose') {
      await blackout();
    }
    cutscene = false;
  }

  /* --- しらべる (Aボタン) --- */
  async function interact() {
    if (cutscene || uiDepth > 0 || player.moving) return;
    const [dx, dy] = DIRV[G.dir];
    let fx = G.x + dx, fy = G.y + dy;
    let ent = entityAt(curMap, fx, fy);
    // カウンター越し
    if (!ent && isSolid(curMap, fx, fy) && tileAt(curMap, fx, fy) === '#') {
      ent = entityAt(curMap, fx + dx, fy + dy);
    }
    if (ent) {
      cutscene = true;
      faceEachOther(ent);
      await handleEntity(ent);
      cutscene = false;
      return;
    }
    const sign = curMap.signs && curMap.signs[`${fx},${fy}`];
    if (sign) { cutscene = true; await say(sign); cutscene = false; return; }
    if (curMap.lockedDoors && curMap.lockedDoors.some((d) => d.x === fx && d.y === fy)) {
      cutscene = true; await say('カギが かかっている！'); cutscene = false;
    }
  }

  async function handleEntity(ent) {
    if (ent.kind === 'trainer') {
      if (G.flags[`t_${ent.id}`]) {
        for (const t of (ent.after || ['……つよかったよ。'])) await say(`${ent.name}\n「${t}」`);
      } else {
        await engageTrainer(ent, false);
      }
      return;
    }
    switch (ent.role) {
      case 'prof': return roleProf();
      case 'mom': return roleMom();
      case 'nurse': return roleNurse();
      case 'clerk': return roleClerk(ent);
      case 'leader': return roleLeader(ent);
      case 'champion': return roleChampion(ent);
      case 'gruntsKid': return roleGruntsKid(ent);
      case 'guardian': return roleGuardian(ent);
      case 'ren': return roleRen(ent);
      case 'nexusCore': return roleNexusCore(ent);
      case 'quest': return roleQuest(ent);
      case 'questTarget': return roleQuestTarget(ent);
      case 'trialSwitch': return roleTrialSwitch(ent);
      case 'ashStar': return roleAshStar(ent);
      default:
        for (const t of (ent.text || ['……'])) await say(t);
    }
  }

  /* ================= ストーリーロール(碧環の旅) ================= */
  async function roleProf() {
    if (G.flags.starter) {
      const cores = GD.coreCount(G.flags);
      if (G.flags.gameCleared) { await say('カエデはかせ「碧環は あなたの えらんだ かたちで 巡っている。\nよき 巡環士に なったな。」'); return; }
      await say(`カエデはかせ「碧環の かんかくは いま ${cores}/4。\n守護獣と しんらいを むすび、環を つなぎなおすのじゃ。」`);
      if (cores >= 2 && !G.flags.renResolved) await say('カエデはかせ「北の 中央遺構が ひらいたはず。\n灰星局と レンが 待っておる。」');
      return;
    }
    await say('カエデはかせ「おお、めざめたか。\nここは 自然エネルギーを 循環させる 地方 セイリュウ。」');
    await say('カエデはかせ「その 循環を ささえる 古代装置「碧環(へきかん)」が よわり、\n森の枯死、河の逆流、火山灰、雷霧が 同時に おきておる。」');
    await say('カエデはかせ「きみは 異変を 記録する わかき 巡環士候補。\nモンスターを 支配するのではなく、守護獣と しんらいを むすぶのじゃ。」');
    await say('カエデはかせ「さあ、最初の 相棒を えらびなさい。\n炎の キツネ、水の カワウソ、森の フクロウ——。」');

    let starterId = 0;
    while (!starterId) {
      const opts = GD.STARTERS.map((id) => {
        const sp = GD.speciesById(id);
        return { label: sp.name, sub: GD.TYPES[sp.types[0]].name };
      });
      const i = await menu(opts, { title: 'どの あいぼうに する？', cancelable: false });
      const sp = GD.speciesById(GD.STARTERS[i]);
      await say(`${sp.name}\n${sp.dex || 'しんらいの おける 相棒だ。'}`);
      if (await confirm(`${sp.name}に きめる？`)) starterId = sp.id;
    }
    const sp = GD.speciesById(starterId);
    const mon = BT().makeMon(starterId, 5);
    G.party.push(mon);
    G.starterId = starterId;
    G.flags.starter = true;
    G.dex.seen[starterId] = true;
    G.dex.caught[starterId] = true;
    AU.jingle('caught');
    AU.sfx('cry', starterId * 53);
    await say(`ユウは ${sp.name}を 相棒に むかえた！`);

    // ライバル レン(合理主義者)の初登場——戦闘なしで対立軸を提示
    await say('レン「——それが おまえの えらんだ 相棒か。」');
    await say('レン「オレは レン。装置は 人が 完全に 制御すべきだと 考えている。」');
    await say('レン「生態系に 選択を ゆだねる など 甘い。\nいずれ 中央遺構で 決着を つけよう。」');
    G.flags.metRen = true;

    G.bag.ball = (G.bag.ball || 0) + 8;
    G.bag.potion = (G.bag.potion || 0) + 3;
    AU.sfx('money');
    await say('カエデはかせ「モンスターボール 8こと キズぐすりを もっていきなさい。」');
    await say('カエデはかせ「碧樹圏(西)と 潮環圏(東)、どちらから でも よい。\n2つの 環核を つなげば 中央遺構が ひらく。」');
  }

  /* ---- 地域固有の仕掛け(守護獣戦の前提)。しるべを ととのえると 試練解禁 ---- */
  const TRIAL_HINT = {
    forest: '守護獣「まず 光の しるべ 2つに ひを ともし、樹路を ひらけ。」',
    tide:   '守護獣「まず 水位の しるべ 2つを あわせ、経路を つくれ。」',
    flare:  '守護獣「まず 熱の しるべ 2つを しずめ、冷却路を たもて。」',
    storm:  '守護獣「まず 送電の しるべ 2つを つなぎ、塔を おこせ。」'
  };
  async function roleTrialSwitch(ent) {
    const { region, idx, need, text } = ent.ts;
    const key = `ts_${region}_${idx}`;
    if (G.flags[key]) { await say('(この しるべは もう 起動している)'); return; }
    G.flags[key] = true;
    AU.sfx('confirm');
    await say(text);
    let n = 0; for (let i = 0; i < need; i++) if (G.flags[`ts_${region}_${i}`]) n++;
    if (n >= need) { G.flags[`trial_${region}_ready`] = true; await say('仕掛けが ととのった！\n守護獣の しれんに いどめる。'); }
    else await say(`(しるべ ${n}/${need})`);
  }

  /* ---- 守護獣の環核試練(仕掛けを ととのえてから戦闘) ---- */
  async function roleGuardian(ent) {
    const g = ent.guardian;
    if (G.flags[g.core]) { await say(`${g.name}\n「この地の かんかくは すでに つながっている。」`); return; }
    if (!G.flags[`trial_${g.region}_ready`]) { await say(TRIAL_HINT[g.region] || 'まず この地の 仕掛けを ととのえよ。'); return; }
    for (const t of g.pre) await say(t);
    const def = { id: `guardian_${g.core}`, name: g.name, team: [[g.species, g.lv + levelBump()]], money: 0, boss: true, lose: ['……いまは ここまでか。'] };
    const result = await BT().startTrainer(def, curMap.cave ? 'cave' : 'grass');
    if (result === 'lose') { await blackout(); return; }
    G.flags[g.core] = true;
    G.regionCleared[g.region] = true;
    window.StoryData.recordChoice(G, 'nature', 1); // 守護獣と信頼=自然循環寄り
    AU.jingle('badge', curMap.music);
    for (const t of g.win) await say(t);
    const cores = GD.coreCount(G.flags);
    await say(`かんかく ${cores}/4 が つながった。`);
    if (cores === 2) await say('中央遺構の とびらが ひらいたようだ。\nコダチ拠点の 北へ すすもう。');
    if (cores === 4) await say('4つの かんかくが そろった。\n中央遺構の 奥、碧環中枢へ——。');
    AU.play(curMap.music);
  }

  /* ---- ライバル レンとの対立 ---- */
  async function roleRen(ent) {
    if (ent.renStage === 'ruins') {
      if (!G.flags.renRuins) {
        await say('レン「ユウ。おまえの やりかたは 生ぬるい。」');
        await say('レン「碧環は 人が 完全に 制御すべきだ。ここで はっきり させる！」');
        const r = await BT().startTrainer({ id: 'ren_ruins', name: 'ライバル レン', team: 'RIVAL2', money: 1000, lose: ['……まだ みとめん。'] }, 'cave');
        if (r === 'lose') { await blackout(); return; }
        G.flags.renRuins = true;
        await say('レン「なぜ おまえは モンスターに 選択を ゆだねる？」');
        const c = await menu(['人と共に 分かち合う', '自然の 循環に ゆだねる', '人が 完全に 制御する'], { title: 'あなたの こたえは？', cancelable: false });
        window.StoryData.recordChoice(G, ['share', 'nature', 'restore'][c], 2);
        await say('レン' + '\n「' + ['……分かち合う、か。ふん。', '自然に ゆだねる…… やはり 甘いな。', 'ほう、制御を みとめるか。'][c] + '」');
        await say('レン「4つの かんかくを つないで 中央遺構へ もどれ。\nそこで 決着だ。」');
        AU.play(curMap.music);
      } else if (GD.coreCount(G.flags) >= 4 && !G.flags.renResolved) {
        await say('レン「4つ そろえたか。……みとめよう、ここまでは。」');
        await say('レン「だが 最後に 問う。おまえの しんねんを 力で 示せ！」');
        const r = await BT().startTrainer({ id: 'ren_final', name: 'ライバル レン', team: 'RIVAL3', money: 3000, champion: true, lose: ['……そうか。おまえの 道か。'] }, 'gym');
        if (r === 'lose') { await blackout(); return; }
        G.flags.renResolved = true;
        await say('レン「おまえの 力、たしかに 見た。」');
        await say('レン「奥の 碧環中枢で、おまえの こたえを 世界に 示せ。\nオレも 見とどける。」');
        AU.play(curMap.music);
      } else if (G.flags.renResolved) {
        await say('レン「中枢は 奥だ。おまえの えらぶ 道を 見せてくれ。」');
      } else {
        await say('レン「4つの かんかくを つないで こい。\nはなしは それからだ。」');
      }
    } else { // nexus のレン(見とどけ)
      await say('レン「……ここまで きたな。」');
      await say('レン「おまえの こたえを、しかと 見せてもらう。」');
    }
  }

  /* ---- 碧環中枢: 分岐エンディング ---- */
  async function roleNexusCore() {
    if (G.flags.gameCleared) { await say('碧環は あなたの えらんだ かたちで 巡っている。'); return; }
    await say('碧環の 中枢が しずかに 脈うっている。');
    await say('灰星局の 復旧計画、レンの 合理、守護獣たちの 声——\nすべてが あなたの 手に ゆだねられた。');
    const rec = window.StoryData.resolveEnding(G);
    const c = await menu([
      { label: '碧環を 完全復旧する', sub: '安定・人の制御' },
      { label: '自然循環へ もどす', sub: '生態系にゆだねる' },
      { label: '分散管理へ 移行する', sub: '人とモンスターで分担' }
    ], { title: `世界の ゆくえ (これまでの 傾向: ${rec.name})`, cancelable: false });
    const id = ['restore', 'nature', 'share'][c];
    window.StoryData.recordChoice(G, id, 3);
    G.flags.gameCleared = true;
    G.flags.endingId = id;
    await endingScene(window.StoryData.ENDINGS[id]);
  }

  /* ---- サブクエスト(受注→現地の目標→報告 の多段)。追跡/収集/救助/護衛/選択/観測 ----
   * type: 'reach'(目標地点で1つ)/'collect'/'visit'(need個の目標)/'choice'(その場で決断)
   * 目標地点は role:'questTarget'(qt:{quest,idx,text}) のエンティティとして各マップに配置。
   */
  const QUESTS = {
    sqTrail:   { title: '迷い獣の 追跡', npc: 'コダチの こども', type: 'reach', need: 1, score: 'share', reward: 'potion', rewardN: 2,
      give: ['にげた 迷い獣が いるんだ。碧樹圏の どこかに いるはず。', 'そっと おいかけて、むれに かえして あげて！'],
      objective: '碧樹圏で 迷い獣を みつける', remind: 'まだ 迷い獣を みつけて ないみたい…', complete: '迷い獣を むれに かえした！ こどもは よろこんだ。' },
    sqCollect: { title: '花粉標本 あつめ', npc: 'けんきゅういん', type: 'collect', need: 2, score: 'nature', reward: 'superpotion', rewardN: 1,
      give: ['花粉の 標本を 2つ あつめて ほしい。', '花粉の 湿地(倒木の 奥)に あるはずだ。'],
      objective: '花粉の湿地で 花粉標本を 2つ あつめる', remind: 'まだ 花粉が たりない…', complete: '2つの 花粉標本を とどけた！ 研究が すすむ。' },
    sqBeast:   { title: '守護獣の いかり', npc: 'みこ', type: 'reach', need: 1, score: 'nature', reward: 'superpotion', rewardN: 1,
      give: ['湿地の おくの 気配が 荒れている。', 'しずめの 祠に ふれて、いのりを ささげて ほしい。'],
      objective: '湿地の 祠に ふれて 気配を しずめる', remind: 'まだ 気配が おさまって いないわ…', complete: '祠に いのりを ささげ、湿地が おだやかに なった。' },
    sqChoice:  { title: '水門の 選択', npc: 'みなとの むすめ', type: 'choice', need: 1, q: '水門を どうする？',
      give: ['上流の 村と 下流の 港、どちらかしか 水を まわせないの。', 'あなたなら どうする？'],
      options: [{ label: '両方に 分ける', kind: 'share', w: 2, res: '手間だが 両方を すくう みちを えらんだ。' },
                { label: '自然の 流れに まかせる', kind: 'nature', w: 2, res: '川の ながれの ままに ゆだねた。' },
                { label: '港を 優先し 制御する', kind: 'restore', w: 2, res: '人の くらしを ゆうせんして 水を 制御した。' }] },
    sqObserve: { title: '観測記録の 復元', npc: 'ろうじん', type: 'reach', need: 1, score: 'restore', reward: 'revive', rewardN: 1,
      give: ['沈んだ 観測所の 記録端末を さがして ほしい。', '端末に ふれれば 記録が よみがえる。'],
      objective: '沈んだ観測所の 記録端末に ふれる', remind: 'まだ 端末を みつけて ないな…', complete: '記録を 復元し、碧環の いへんの きろくを ときあかした。' },
    sqRescue:  { title: '坑道の 救助', npc: 'かじやの つま', type: 'reach', need: 1, score: 'share', reward: 'hyperpotion', rewardN: 1,
      give: ['冷却洞の おくに こどもが とりのこされて いるの！', 'たすけに いって あげて！'],
      objective: '冷却洞の おくの こどもを 救助する', remind: 'まだ こどもを たすけて いないの…', complete: '坑道の おくから こどもを ぶじ 救助した！' },
    sqMarket:  { title: '行商の 護衛', npc: 'ぎょうしょうにん', type: 'visit', need: 2, score: 'restore', reward: 'superball', rewardN: 3,
      give: ['火脈圏を こえる みちの 2つの 中継地を みまわって ほしい。', '道が 安全か たしかめて くれ。'],
      objective: '火脈圏の 中継地を 2か所 みまわる', remind: 'まだ みまわりが おわって いないぞ…', complete: '2つの 中継地を まもり、行商は 安心して たびだった。' },
    sqRelay:   { title: '送電中継の 修理', npc: 'ぎしのむすめ', type: 'visit', need: 2, score: 'restore', reward: 'fullheal', rewardN: 2,
      give: ['雷霧圏の 送電中継 2つを なおして まわって ほしいの。', '中継に ふれれば 修理できるわ。'],
      objective: '雷霧圏の 送電中継を 2つ なおす', remind: 'まだ 中継の 修理が のこってるわ…', complete: '中継を 修理し、雷霧に あかりが もどった！' },
    sqObserve2:{ title: '観測塔の 記録', npc: 'とうの けんきゅういん', type: 'reach', need: 1, score: 'nature', reward: 'hyperpotion', rewardN: 1,
      give: ['観測塔の きえかけた 記録に ふれて つなぎとめて。'],
      objective: '観測塔の 記録に ふれる', remind: 'まだ 記録に ふれて いないわ…', complete: '記録を つなぎとめ、雷霧の 変化を 見とおせるように なった。' }
  };
  const qFlags = { accepted: (q) => `qa_${q}`, target: (q, i) => `qo_${q}_${i}`, done: (q) => q };
  function questProgress(q, meta) {
    if (meta.type === 'choice') return G.flags[qFlags.done(q)] ? meta.need : 0;
    let n = 0; for (let i = 0; i < meta.need; i++) if (G.flags[qFlags.target(q, i)]) n++;
    return n;
  }
  async function finishQuest(q, meta) {
    G.flags[qFlags.done(q)] = true;
    if (meta.reward) {
      G.bag[meta.reward] = (G.bag[meta.reward] || 0) + (meta.rewardN || 1);
      AU.sfx('money');
      await say(`おれいに ${GD.ITEMS[meta.reward].name} を ${meta.rewardN || 1}こ もらった！`);
    }
    await say(`(サブクエスト「${meta.title}」を たっせいした！)`);
  }
  async function roleQuest(ent) {
    const q = ent.quest, meta = QUESTS[q];
    if (!meta) { await say('……'); return; }
    if (G.flags[qFlags.done(q)]) { await say(`${meta.npc}\n「たすかったよ。ありがとう！」`); return; }
    // 選択クエストは受注時にその場で決断=完了
    if (meta.type === 'choice') {
      for (const t of meta.give) await say(`${meta.npc}\n「${t}」`);
      const c = await menu(meta.options.map((o) => o.label), { title: meta.q, cancelable: false });
      const opt = meta.options[c];
      window.StoryData.recordChoice(G, opt.kind, opt.w || 1);
      await say(opt.res);
      await finishQuest(q, meta);
      return;
    }
    // 未受注 → 受注
    if (!G.flags[qFlags.accepted(q)]) {
      for (const t of meta.give) await say(`${meta.npc}\n「${t}」`);
      G.flags[qFlags.accepted(q)] = true;
      AU.sfx('confirm');
      await say(`(サブクエスト「${meta.title}」を うけた。\nもくひょう: ${meta.objective})`);
      return;
    }
    // 受注済み → 目標達成度を確認
    const prog = questProgress(q, meta);
    if (prog < meta.need) { await say(`${meta.npc}\n「${meta.remind}」(${prog}/${meta.need})`); return; }
    // 目標達成 → 報告して完了
    await say(meta.complete);
    if (meta.score) window.StoryData.recordChoice(G, meta.score, 1);
    await finishQuest(q, meta);
  }

  /* ---- クエスト目標地点(現地で達成) ---- */
  async function roleQuestTarget(ent) {
    const { quest, idx, text } = ent.qt;
    const meta = QUESTS[quest];
    if (G.flags[qFlags.done(quest)]) { await say(ent.qt.doneText || '……(もう おわった)'); return; }
    if (!G.flags[qFlags.accepted(quest)]) { await say(ent.qt.lockText || '……(いまは とくに 用は なさそうだ)'); return; }
    const key = qFlags.target(quest, idx);
    if (G.flags[key]) { await say(ent.qt.doneText || '……(すでに すませた)'); return; }
    G.flags[key] = true;
    AU.sfx('confirm');
    await say(text);
    const prog = questProgress(quest, meta);
    if (prog >= (meta ? meta.need : 1)) await say(`もくひょう 達成！ ${QUESTS[quest].npc} に ほうこく しよう。`);
    else await say(`(${prog}/${meta.need})`);
  }

  /* ---- 灰星局(復旧技術者集団): 目的は正当だが手段が生態系を破壊する ---- */
  async function roleAshStar(ent) {
    const a = ent.ashStar;
    if (a.stage === 'confront') {
      if (G.flags.ashStarForest) { await say('灰星局員「……もう むりな 強制起動は やめた。」'); return; }
      G.flags.ashStarSeen = true;
      await say('灰星局員「災害を とめるには 碧環を 強制起動する しかない！」');
      await say('灰星局員「生態系？ そんな ことを いっている ばあいか。\nじゃまを するなら 力ずくだ！」');
      const r = await BT().startTrainer({ id: 'ashStar_forest', name: '灰星局員', team: scaleTeam([[13, 10], [11, 11]]), money: 700, lose: ['ぐっ…… だが 災害は とまらんぞ。'] }, curMap.cave ? 'cave' : 'grass');
      if (r === 'lose') { await blackout(); return; }
      G.flags.ashStarForest = true;
      window.StoryData.recordChoice(G, 'nature', 2);
      await say('灰星局員「……この 現場の 強制起動は とりやめる。」');
      await say('灰星局員「だが 本部は まだ あきらめて いない。\nいずれ 中央で 決着が つくだろう……」');
      AU.play(curMap.music || 'town');
    } else { // rescue
      if (G.flags.ashStarRescued) { await say('灰星局員「たすかった…… この おんは わすれない。」'); return; }
      await say('灰星局員「た、たすけて くれ…… 起動実験で とじこめられた……」');
      G.flags.ashStarRescued = true;
      window.StoryData.recordChoice(G, 'share', 2);
      AU.sfx('confirm');
      await say('あなたは 敵である 灰星局員を 救助した。');
      await say('灰星局員「……敵の おれを たすけるとは。\n人も 自然も 切りすてない、そういう 道も あるのか……」');
    }
  }

  /* ---- 障害物(能力ゲート扉)。req を満たすと leadsTo へ。開通は永続記録。 ---- */
  async function handleObstacle(o) {
    cutscene = true;
    const res = GD.meetsRequirements(o.req, { flags: G.flags, party: G.party });
    if (!res.ok) { await say(o.text || res.text); cutscene = false; return; }
    if (!G.flags[o.openFlag]) { G.flags[o.openFlag] = true; if (o.doneText) await say(o.doneText); AU.sfx('confirm'); }
    await fadeOut();
    loadMap(o.leadsTo.to, o.leadsTo.tx, o.leadsTo.ty, G.dir);
    await fadeIn();
    cutscene = false;
  }

  /* ---- エンディング演出 ---- */
  async function endingScene(ending) {
    await fadeOut();
    AU.play('ending');
    const cine = $('cine');
    cine.classList.remove('hidden');
    cine.innerHTML = `<div class="hall-title">碧環の 旅・結末</div><div class="hall-sub" style="font-size:16px;color:#f8e048">${ending.name}</div><div id="hall-row"></div><div class="hall-sub">${ending.desc}</div>`;
    $('fader').classList.add('hidden'); $('fader').classList.remove('on');
    const row = document.getElementById('hall-row');
    for (const m of G.party) {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
      const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
      c.drawImage(SP.monCanvas(m.spId, false), 0, 0, 64, 64);
      row.appendChild(cv); AU.sfx('cry', m.spId * 53); await sleep(500);
    }
    await sleep(1500);
    await say(`ユウの えらんだ 道——「${ending.name}」。\n${ending.desc}`);
    cine.innerHTML = `<div class="credits"><div class="credits-inner">
      <h2>ポケットレジェンド 碧環の旅</h2><p>— 巡環の たび を おえて —</p>
      <p>けっか<br>${ending.name}</p>
      <p>ゲームデザイン / プログラム<br>FAKEPOK PROJECT</p>
      <p>すべての 守護獣と 巡環士に かんしゃを</p>
      <p class="the-end">THE END</p>
      <p class="the-end">……そして 環は 巡りつづける</p>
    </div></div>`;
    await sleep(13000);
    cine.classList.add('hidden'); cine.innerHTML = '';
    G.party.forEach((m) => { m.hp = BT().calcStats(m.spId, m.lv).maxHp; m.status = null; });
    await fadeOut();
    loadMap('kodachi', 7, 8, 'down');
    saveGame(true);
    await fadeIn();
    await say('(碧環の 旅の きろくを レポートに かきのこした！\nクリア後も 世界を 巡れる。)');
  }

  async function roleMom() {
    await say('ママ「あら ユウ。ぼうけんは どう？」');
    AU.jingle('heal');
    await sleep(900);
    G.party.forEach((m) => { m.hp = BT().calcStats(m.spId, m.lv).maxHp; m.status = null; m.moves.forEach((s) => s.pp = GD.MOVES[s.id].pp); });
    G.healPoint = { mapId: 'home', x: 4, y: 4 };
    await say('ママ「モンスターたちも げんきいっぱいよ。\nいってらっしゃい！」');
  }

  async function roleNurse() {
    await say('「こんにちは！ モンスターセンターへ ようこそ！」');
    G.healPoint = { mapId: G.mapId, x: 5, y: 5 };
    while (true) {
      const i = await menu(['かいふく', 'ボックス', 'とじる'], { cancelable: true, title: 'モンスターセンター' });
      if (i < 0 || i === 2) break;
      if (i === 0) {
        AU.jingle('heal');
        await sleep(1000);
        G.party.forEach((m) => { m.hp = BT().calcStats(m.spId, m.lv).maxHp; m.status = null; m.moves.forEach((s) => s.pp = GD.MOVES[s.id].pp); });
        await say('「モンスターは すっかり げんきに なりましたよ！」');
      } else if (i === 1) {
        await boxScreen();
      }
    }
    await say('「またの ごりようを おまちして います！」');
  }

  /* ボックスからの選択(手持ちUIに準じた簡易版) */
  function boxPick(title) {
    if (!G.box.length) return Promise.resolve(-2); // -2: 空
    const items = G.box.map((m) => {
      const st = BT().calcStats(m.spId, m.lv);
      return { label: `${monName(m)}`, sub: `Lv${m.lv}  HP${m.hp}/${st.maxHp}` };
    });
    return menu(items, { title, cancelable: true, wide: true });
  }

  async function boxScreen() {
    while (true) {
      const i = await menu([
        { label: 'あずける', sub: `手持ち ${G.party.length}/6` },
        { label: 'ひきだす', sub: `ボックス ${G.box.length}` },
        { label: 'いちらん', sub: '' },
        { label: 'もどる', sub: '' }
      ], { cancelable: true, wide: true, title: 'ボックスたんまつ' });
      if (i < 0 || i === 3) return;
      if (i === 0) {
        if (G.party.length <= 1) { await say('さいごの 1ぴきは あずけられない！'); continue; }
        const p = await partyPick({ title: 'どれを あずける？' });
        if (p < 0) continue;
        const mon = G.party.splice(p, 1)[0];
        G.box.push(mon);
        AU.sfx('confirm');
        await say(`${monName(mon)}を ボックスに あずけた。`);
      } else if (i === 1) {
        if (G.party.length >= 6) { await say('手持ちが いっぱいだ！'); continue; }
        const b = await boxPick('どれを ひきだす？');
        if (b === -2) { await say('ボックスは からっぽだ。'); continue; }
        if (b < 0) continue;
        const mon = G.box.splice(b, 1)[0];
        G.party.push(mon);
        AU.sfx('confirm');
        await say(`${monName(mon)}を 手持ちに くわえた。`);
      } else if (i === 2) {
        const b = await boxPick(`ボックス (${G.box.length}ひき)`);
        if (b === -2) { await say('ボックスは からっぽだ。'); continue; }
        if (b >= 0) await summaryScreen(G.box[b]);
      }
    }
  }

  async function roleClerk(ent) {
    await say('「いらっしゃいませ！\nなにを おもとめですか？」');
    const stock = ent.stock || ['ball', 'potion'];
    while (true) {
      const items = stock.map((k) => ({ label: GD.ITEMS[k].name, sub: `${GD.ITEMS[k].price}円` }))
        .concat([{ label: 'やめる', sub: '' }]);
      const i = await menu(items, { title: `おかね ${G.money}円`, cancelable: true, wide: true });
      if (i < 0 || i === stock.length) break;
      const key = stock[i];
      const it = GD.ITEMS[key];
      if (G.money < it.price) { await say('おかねが たりません！'); continue; }
      G.money -= it.price;
      G.bag[key] = (G.bag[key] || 0) + 1;
      AU.sfx('money');
      await say(`${it.name}を かった！ (もっているかず ${G.bag[key]})`, { auto: 900 });
    }
    await say('「ありがとう ございました！」');
  }

  async function roleLeader(ent) {
    const L = ent.leader;
    if (G.flags[L.badge]) {
      await say(`${L.name}\n「きみなら リーグでも かつやくできる。がんばれよ！」`);
      return;
    }
    for (const t of L.pre) await say(`${L.name}\n「${t}」`);
    const def = { id: `leader_${curMap.id}`, name: L.name, team: L.team, money: L.money, lose: L.lose };
    const result = await BT().startTrainer(def, 'gym');
    if (result === 'lose') { await blackout(); return; }
    G.flags[L.badge] = true;
    AU.jingle('badge', 'gym');
    const badge = GD.BADGES.find((b) => b.id === L.badge);
    await say(`ユウは ${L.name.replace('ジムリーダーの ', '')}から ${badge.name}を もらった！`);
    for (const t of L.award) await say(`${L.name}\n「${t}」`);
    AU.play(curMap.music);
  }

  async function roleGruntsKid(ent) {
    if (G.flags.grunts && !G.flags.gruntsReward) {
      G.flags.gruntsReward = true;
      await say('しょうねん「ダークスターだんを おいはらって くれたんだね！\nおにいちゃん ありがとう！」');
      G.bag.superball = (G.bag.superball || 0) + 3;
      AU.sfx('money');
      await say('おれいに スーパーボールを 3こ もらった！');
      await say('しょうねん「あいつら 『ボスは ヴィクトリーロードだ』って いってたよ。\nわるだくみ してるのかな…」');
      return;
    }
    if (G.flags.gruntsReward) {
      await say('しょうねん「デンネコと ずっと いっしょに いるんだ！」');
      return;
    }
    for (const t of ent.text) await say(`しょうねん「${t}」`);
  }

  async function roleChampion(ent) {
    if (!G.flags.champion) {
      await say('レン「……きたか ユウ。」');
      await say('レン「おどろいたか？ 8つの ジムバッジを\nさいそくで あつめたのは この オレだ。」');
      await say('レン「いまの オレは チャンピオン。\nそして でんせつの ライメイチョウも オレを みとめた。」');
      await say('レン「さいごの しょうぶだ ユウ！\nこの ぶたいで どっちが さいきょうか きめようぜ！」');
    } else {
      await say('レン「よう ユウ！ また うでだめしか？」');
      if (!(await confirm('チャンピオン レンと たたかう？'))) {
        await say('レン「いつでも まってるぜ！」');
        return;
      }
    }
    const def = {
      id: 'champion', name: 'チャンピオンの レン', team: 'CHAMPION', money: 10000, champion: true,
      lose: ['……まいった。 かんぺきな オレの まけだ。', 'おまえは オレの じまんの ライバルだよ。']
    };
    const result = await BT().startTrainer(def, 'gym');
    if (result === 'lose') { await blackout(); return; }
    if (!G.flags.champion) {
      await runEnding();
    } else {
      await say('レン「なんかいやっても おまえには かなわないな！」');
      AU.play(curMap.music);
    }
  }

  /* ================= エンディング ================= */
  async function runEnding() {
    await say('レン「……ユウ。おまえが あたらしい チャンピオンだ。」');
    await say('カエデはかせが かけつけてきた！');
    await say('カエデはかせ「みごとじゃ ユウ！\nさあ でんどういりの てつづきを しよう！」');
    G.flags.champion = true;
    await fadeOut();
    AU.play('ending');
    const cine = $('cine');
    cine.classList.remove('hidden');
    cine.innerHTML = '<div class="hall-title">でんどういり</div><div id="hall-row"></div><div class="hall-sub"></div>';
    $('fader').classList.add('hidden');
    $('fader').classList.remove('on');
    const row = document.getElementById('hall-row');
    for (const m of G.party) {
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(SP.monCanvas(m.spId, false), 0, 0, 64, 64);
      row.appendChild(cv);
      AU.sfx('cry', m.spId * 53);
      await sleep(700);
    }
    document.querySelector('.hall-sub').textContent = `チャンピオン ユウ と なかまたち`;
    await sleep(1800);
    await say('ユウと なかまたちは でんどういり した！\nおめでとう！');
    // スタッフロール
    cine.innerHTML = `<div class="credits"><div class="credits-inner">
      <h2>ポケットレジェンド 碧の章</h2>
      <p>— STAFF —</p>
      <p>ゲームデザイン<br>FAKEPOK PROJECT</p>
      <p>プログラム<br>CLAUDE CODE</p>
      <p>おんがく<br>CHIPTUNE WORKS</p>
      <p>ドットえ<br>PIXEL FORGE</p>
      <p>スペシャルサンクス<br>すべての トレーナーたち</p>
      <p class="the-end">THE END</p>
      <p class="the-end">…そして ぼうけんは つづく</p>
    </div></div>`;
    await sleep(14000);
    cine.classList.add('hidden');
    cine.innerHTML = '';
    await say('この あとも ぼうけんは つづく！\nチャンピオンの レンとは いつでも さいせんできるぞ。');
    G.party.forEach((m) => { m.hp = BT().calcStats(m.spId, m.lv).maxHp; m.status = null; });
    await fadeOut();
    loadMap('home', 4, 3, 'down');
    saveGame(true);
    await fadeIn();
    await say('(ぼうけんの きろくを レポートに かきのこした！)');
  }

  /* ================= しんか ================= */
  window.Game = {
    state: () => G,
    debugWarp: (id, x, y, dir) => { if (G && GD.MAPS[id]) loadMap(id, x, y, dir || 'down'); },
    queueEvolution: (mon) => evoQueue.set(mon.uid, mon),
    clearEvolutions: () => evoQueue.clear(),
    runEvolutions: async () => {
      for (const mon of evoQueue.values()) {
        const sp = GD.speciesById(mon.spId);
        if (!sp.evo || mon.lv < sp.evo.lv) continue;
        if (!G.party.includes(mon)) continue;
        await evolveScene(mon, sp.evo.to);
      }
      evoQueue.clear();
    }
  };

  async function evolveScene(mon, toId) {
    const fromSp = GD.speciesById(mon.spId);
    const toSp = GD.speciesById(toId);
    cutscene = true;
    AU.play('evolution');
    const cine = $('cine');
    cine.classList.remove('hidden');
    cine.innerHTML = '<canvas id="evo-cv" width="128" height="128"></canvas>';
    const cv = document.getElementById('evo-cv');
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    const draw = (spId, white) => {
      c.clearRect(0, 0, 128, 128);
      c.drawImage(SP.monCanvas(spId, false), 0, 0, 128, 128);
      if (white) { c.globalCompositeOperation = 'source-atop'; c.fillStyle = '#f8f8ff'; c.fillRect(0, 0, 128, 128); c.globalCompositeOperation = 'source-over'; }
    };
    draw(mon.spId, false);
    await say(`おや……！？\n${fromSp.name}の ようすが……！`);
    for (let i = 0; i < 10; i++) {
      draw(i % 2 ? toId : mon.spId, true);
      await sleep(180 + Math.max(0, 5 - i) * 40);
    }
    const oldStats = BT().calcStats(mon.spId, mon.lv);
    mon.spId = toId;
    const newStats = BT().calcStats(mon.spId, mon.lv);
    mon.hp = Math.min(newStats.maxHp, mon.hp + (newStats.maxHp - oldStats.maxHp));
    G.dex.seen[toId] = true;
    G.dex.caught[toId] = true;
    draw(toId, false);
    AU.sfx('cry', toId * 53);
    AU.jingle('caught', null);
    await say(`おめでとう！\n${fromSp.name}は ${toSp.name}に しんかした！`);
    cine.classList.add('hidden');
    cine.innerHTML = '';
    AU.play(curMap.music || 'town');
    cutscene = false;
  }

  /* ================= 全滅 ================= */
  async function blackout() {
    await say('ユウの てもちの モンスターは ぜんめつした！');
    // 所持金半減は過剰なため、固定額(最大500)の見直しに変更
    const penalty = Math.min(G.money, 500);
    G.money = Math.max(0, G.money - penalty);
    await say('ユウは めのまえが まっくらに なった……');
    await fadeOut();
    G.party.forEach((m) => { m.hp = BT().calcStats(m.spId, m.lv).maxHp; m.status = null; m.moves.forEach((s) => s.pp = GD.MOVES[s.id].pp); });
    const hp = G.healPoint;
    loadMap(hp.mapId, hp.x, hp.y, 'down');
    await fadeIn();
    await say('モンスターたちの きずは いえた。\nきを とりなおして しゅっぱつだ！');
  }

  /* ================= ポーズメニュー ================= */
  async function openPauseMenu() {
    if (cutscene || uiDepth > 0) return;
    cutscene = true;
    AU.sfx('confirm');
    while (true) {
      const i = await menu(['ずかん', 'モンスター', 'バッグ', 'たびのきろく', 'レポート', 'トレーナーカード', 'とじる'], { cancelable: true, title: 'メニュー' });
      if (i < 0 || i === 6) break;
      if (i === 0) await dexScreen();
      else if (i === 1) await partyScreen();
      else if (i === 2) await bagPick({ inBattle: false });
      else if (i === 3) await journeyLog();
      else if (i === 4) {
        if (await confirm('レポートに ぼうけんを かきのこしますか？')) {
          saveGame();
          AU.sfx('save');
          await say('レポートに しっかり かきのこした！');
        }
      }
      else if (i === 5) await trainerCard();
    }
    cutscene = false;
  }

  /* ---- 旅記録: 現在の主目標・任意目標(サブクエ進捗)・環核・灰星局 ---- */
  function mainObjective() {
    const cores = GD.coreCount(G.flags);
    if (!G.flags.starter) return '博士から 相棒を もらう';
    if (G.flags.gameCleared) return `クリア済み — 選んだ結末: ${window.StoryData.ENDINGS[G.flags.endingId] ? window.StoryData.ENDINGS[G.flags.endingId].name : '？'}`;
    if (cores < 2) return `碧樹圏・潮環圏で 環核を つなぐ (${cores}/4)`;
    if (!G.flags.renResolved) return `中央遺構でレンと決着し、火脈圏・雷霧圏で4環核をそろえる (${cores}/4)`;
    return '碧環中枢で 世界の ゆくえを えらぶ';
  }
  async function journeyLog() {
    const cores = window.GameData.CORE_FLAGS.filter((f) => G.flags[f]);
    const coreNames = { coreForest: '碧樹', coreTide: '潮環', coreFlare: '火脈', coreStorm: '雷霧' };
    await say(`◆ 主目標\n${mainObjective()}`);
    // 進行中の任意目標(受注済み・未完了)
    const active = Object.keys(QUESTS).filter((q) => G.flags[`qa_${q}`] && !G.flags[q]);
    const done = Object.keys(QUESTS).filter((q) => G.flags[q]);
    if (active.length) {
      for (const q of active) {
        const m = QUESTS[q];
        const prog = m.need ? `(${questProgress(q, m)}/${m.need})` : '';
        await say(`○ ${m.title} ${prog}\n${m.objective || ''}`);
      }
    } else {
      await say(`○ 進行中の 依頼は ない。\n達成した サブクエスト: ${done.length}件`);
    }
    await say(`◆ 環核: ${cores.length ? cores.map((c) => coreNames[c]).join('・') : 'まだ ない'} (${cores.length}/4)`);
    const ash = G.flags.ashStarRescued ? '救助あり' : G.flags.ashStarForest ? '暴走を阻止' : G.flags.ashStarSeen ? '接触した' : '未接触';
    await say(`◆ 灰星局: ${ash}\n◆ サブクエスト達成: ${done.length}/${Object.keys(QUESTS).length}`);
  }

  async function dexScreen() {
    const seen = Object.keys(G.dex.seen).length;
    const caught = Object.keys(G.dex.caught).length;
    while (true) {
      const items = GD.SPECIES.map((sp) => ({
        label: G.dex.seen[sp.id] ? sp.name : '？？？？？',
        sub: `No.${String(sp.id).padStart(3, '0')} ${G.dex.caught[sp.id] ? '●' : G.dex.seen[sp.id] ? '○' : ''}`
      }));
      const i = await menu(items, { title: `モンスターずかん  みつけた ${seen} / つかまえた ${caught}`, cancelable: true, wide: true });
      if (i < 0) return;
      const sp = GD.SPECIES[i];
      if (!G.dex.seen[sp.id]) continue;
      await dexDetail(sp);
    }
  }

  async function dexDetail(sp) {
    const cine = $('cine');
    cine.classList.remove('hidden');
    const types = sp.types.map((t) => GD.TYPES[t].name).join('/');
    cine.innerHTML = `<div class="dex-detail">
      <canvas id="dex-cv" width="96" height="96"></canvas>
      <div class="dex-head">No.${String(sp.id).padStart(3, '0')} ${sp.name}</div>
      <div class="dex-type">${types}タイプ</div>
      <div class="dex-text">${G.dex.caught[sp.id] ? sp.dex : 'つかまえると くわしい きろくが のこる。'}</div>
    </div>`;
    const c = document.getElementById('dex-cv').getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(SP.monCanvas(sp.id, false), 0, 0, 96, 96);
    AU.sfx('cry', sp.id * 53);
    await new Promise((res) => {
      uiDepth++;
      Input.push((key) => {
        if (key === 'a' || key === 'b') { Input.pop(); uiDepth--; res(); }
      });
    });
    cine.classList.add('hidden');
    cine.innerHTML = '';
  }

  async function partyScreen() {
    while (true) {
      const idx = await partyPick({ title: 'てもちの モンスター' });
      if (idx < 0) return;
      const act = await menu(['つよさを みる', 'じゅんばんを かえる', 'もどる'], { cancelable: true });
      if (act === 0) await summaryScreen(G.party[idx]);
      else if (act === 1) {
        const j = await partyPick({ title: 'どれと いれかえる？' });
        if (j >= 0 && j !== idx) {
          [G.party[idx], G.party[j]] = [G.party[j], G.party[idx]];
          AU.sfx('confirm');
        }
      }
    }
  }

  async function summaryScreen(m) {
    const sp = GD.speciesById(m.spId);
    const st = BT().calcStats(m.spId, m.lv);
    const next = BT().expForLevel(m.lv + 1) - m.exp;
    const types = sp.types.map((t) => GD.TYPES[t].name).join('/');
    const moves = m.moves.map((s) => {
      const mv = GD.MOVES[s.id];
      return `${mv.name} (${GD.TYPES[mv.type].name} PP${s.pp}/${mv.pp})`;
    }).join('\n');
    await say(`${sp.name} Lv${m.lv}  ${types}\nHP ${m.hp}/${st.maxHp}  こうげき${st.atk} ぼうぎょ${st.def} すばやさ${st.spd}`);
    await say(`つぎのレベルまで あと${Math.max(0, next)}\n----- わざ -----`);
    await say(moves || 'わざを おぼえていない');
  }

  async function trainerCard() {
    const badges = GD.BADGES.filter((b) => G.flags[b.id]).map((b) => b.name).join('、') || 'まだ ない';
    const h = Math.floor(G.playSec / 3600), mn = Math.floor((G.playSec % 3600) / 60);
    await say(`トレーナー: ユウ\nおかね: ${G.money}円`);
    await say(`バッジ: ${badges}\nプレイじかん: ${h}じかん${mn}ふん  ずかん: ${Object.keys(G.dex.caught).length}ひき`);
  }

  /* ================= セーブ/ロード ================= */
  function saveGame(silent) {
    try {
      G.v = SAVE_VERSION;
      localStorage.setItem(SAVE_KEY, JSON.stringify(G));
      return true;
    } catch (e) { console.error(e); return false; }
  }

  // 旧バージョン/欠損/破損セーブを安全なv2形へ正規化する。
  // 復旧不能な場合のみ null を返し、起動不能にはしない。
  function normalizeSave(d) {
    if (!d || typeof d !== 'object') return null;
    if (!Array.isArray(d.party) || d.party.length === 0) return null; // 進行前は新規扱い
    const def = newGame();
    const out = {
      ...def, ...d,
      v: SAVE_VERSION,
      bag: (d.bag && typeof d.bag === 'object') ? d.bag : { ...def.bag },
      box: Array.isArray(d.box) ? d.box : [],
      flags: (d.flags && typeof d.flags === 'object') ? d.flags : {},
      dex: {
        seen: (d.dex && d.dex.seen && typeof d.dex.seen === 'object') ? d.dex.seen : {},
        caught: (d.dex && d.dex.caught && typeof d.dex.caught === 'object') ? d.dex.caught : {}
      },
      money: Number.isFinite(d.money) ? d.money : def.money,
      playSec: Number.isFinite(d.playSec) ? d.playSec : 0
    };
    // 手持ちの各個体を最低限検証(壊れた個体は除外)
    out.party = out.party.filter((m) => m && GD.speciesById(m.spId) && Number.isFinite(m.lv));
    if (!out.party.length) return null;
    out.box = out.box.filter((m) => m && GD.speciesById(m.spId) && Number.isFinite(m.lv));
    // 現在地マップ/座標の健全化。存在しない・壁内なら回復地点→homeへ退避
    const validPos = (mapId, x, y) => {
      const map = GD.MAPS[mapId];
      if (!map) return false;
      const t = map.rows[y] && map.rows[y][x];
      return t != null && !GD.isSolidTile(t);
    };
    if (!validPos(out.mapId, out.x, out.y)) {
      const hp = out.healPoint && GD.MAPS[out.healPoint.mapId] ? out.healPoint : def.healPoint;
      out.mapId = hp.mapId; out.x = hp.x; out.y = hp.y;
      if (!validPos(out.mapId, out.x, out.y)) { out.mapId = def.mapId; out.x = def.x; out.y = def.y; }
    }
    if (!out.healPoint || !GD.MAPS[out.healPoint.mapId]) out.healPoint = { ...def.healPoint };
    return out;
  }

  function loadSave() {
    // v2 を優先。無ければ v1 を読み、正規化して移行する。
    for (const key of [SAVE_KEY, SAVE_KEY_V1]) {
      let raw;
      try { raw = localStorage.getItem(key); } catch (e) { raw = null; }
      if (!raw) continue;
      let d = null;
      try { d = JSON.parse(raw); } catch (e) { console.warn('壊れたセーブを検出:', key, e); continue; }
      const norm = normalizeSave(d);
      if (norm) {
        if (key === SAVE_KEY_V1) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(norm)); } catch (e) {} }
        return norm;
      }
    }
    return null;
  }

  /* ================= ゲームループ ================= */
  let lastTime = 0;
  function loop(time) {
    requestAnimationFrame(loop);
    if (!G || !curMap) return;
    const dt = Math.min(50, time - lastTime);
    lastTime = time;
    if (player.moving) {
      player.prog += dt / 190;
      if (player.prog >= 1) {
        player.prog = 0;
        player.moving = false;
        onStepComplete();
      }
    } else if (!cutscene && uiDepth === 0) {
      for (const d of ['up', 'down', 'left', 'right']) {
        if (Input.held.has(d)) { tryMove(d); break; }
      }
    }
    render(time);
  }

  // オーバーワールドの A / START
  Input.push((key) => {
    if (key === 'a') interact();
    else if (key === 'start') openPauseMenu();
  });

  /* ================= タイトル/起動 ================= */
  async function titleScreen() {
    const t = $('title-screen');
    t.classList.remove('hidden');
    const cv = $('title-mon');
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    let showId = 28;
    const drawTitleMon = () => {
      c.clearRect(0, 0, 96, 96);
      c.drawImage(SP.monCanvas(showId, false), 0, 0, 96, 96);
    };
    drawTitleMon();
    const cycle = setInterval(() => {
      showId = GD.SPECIES[Math.floor(Math.random() * GD.SPECIES.length)].id;
      drawTitleMon();
    }, 2600);

    await new Promise((res) => {
      const h = (key) => {
        if (key === 'a' || key === 'start') { Input.pop(); res(); }
      };
      Input.push(h);
    });
    AU.play('title');
    AU.sfx('confirm');

    const save = loadSave();
    const opts = save ? ['つづきから', 'さいしょから'] : ['ぼうけんを はじめる'];
    const pick = await menu(opts, { title: '' });
    clearInterval(cycle);

    if (save && pick === 0) {
      G = save;
      t.classList.add('hidden');
      await fadeOut();
      loadMap(G.mapId, G.x, G.y, G.dir);
      await fadeIn();
      await say(`おかえりなさい ユウ！\nぼうけんの つづきを たのしんで！`, { auto: 1500 });
    } else {
      if (save && pick === 1) {
        if (!(await confirm('セーブデータが きえますが いいですか？'))) return titleScreen();
      }
      G = newGame();
      t.classList.add('hidden');
      await newGameIntro();
    }
    startPlayClock();
  }

  async function newGameIntro() {
    const cine = $('cine');
    cine.classList.remove('hidden');
    cine.innerHTML = '<canvas id="intro-cv" width="96" height="96"></canvas>';
    const c = document.getElementById('intro-cv').getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(SP.charCanvas('prof', 'down', 0), 0, 0, 16, 16, 0, 0, 96, 96);
    await say('カエデはかせ「やあ！ ようこそ モンスターの せかいへ！」');
    await say('カエデはかせ「わしは カエデ。モンスターの けんきゅうを しておる。」');
    await say('カエデはかせ「この せかいには ふしぎな いきもの モンスターが\nいたるところに くらしておる。」');
    await say('カエデはかせ「あるものは モンスターと ともに あそび\nあるものは しょうぶに あけくれる…」');
    await say('カエデはかせ「きみの なまえは ユウ じゃったな。」');
    await say('カエデはかせ「じゅんびが できたら わしの けんきゅうじょに くるのじゃ。\nさあ きみの ものがたりの はじまりじゃ！」');
    cine.classList.add('hidden');
    cine.innerHTML = '';
    loadMap('home', 4, 3, 'down');
    await fadeIn();
  }

  function startPlayClock() {
    if (startPlayClock._t) return;
    startPlayClock._t = setInterval(() => { if (G) G.playSec++; }, 1000);
  }

  /* ---- レイアウトスケール ----
   * スマホ等の狭い画面では、コンソール全体(画面+コントローラ)を
   * 縦横どちらにも収まる倍率で縮小し、translateで正確に中央寄せする。
   * (transform-origin: top center + margin:auto だと縮小時に右へズレる)
   */
  function fitScale() {
    const con = $('console');
    con.style.margin = '0';
    con.style.transformOrigin = 'top left';
    con.style.transform = 'none';
    const w = con.offsetWidth || 520;
    const h = con.offsetHeight || 620;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(1, vw / w, vh / h);
    const x = Math.max(0, (vw - w * scale) / 2);
    con.style.transform = `translate(${x}px, 0px) scale(${scale})`;
  }
  window.addEventListener('resize', fitScale);
  window.addEventListener('orientationchange', fitScale);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitScale);

  /* ---- 起動 ---- */
  window.addEventListener('load', () => {
    fitScale();
    requestAnimationFrame(loop);
    titleScreen();
  });
})();
