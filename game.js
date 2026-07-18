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
  const SAVE_KEY = 'fakemon_save_v1';

  /* ================= 状態 ================= */
  let G = null;            // セーブ対象の全状態
  let curMap = null;       // 現在のマップ定義
  let cutscene = false;    // イベント中は移動不可
  let uiDepth = 0;         // モーダルUI深度
  let evoQueue = new Map();
  let exclaim = null;      // {x,y} !マーク表示
  let npcOffsets = {};     // 歩行アニメ用 npcId → {px,py}

  const newGame = () => ({
    v: 1,
    name: 'ユウ', rivalName: 'レン',
    money: 3000,
    bag: { potion: 2 },
    party: [], box: [],
    flags: {},
    dex: { seen: {}, caught: {} },
    starterId: 0,
    mapId: 'home', x: 4, y: 3, dir: 'down',
    healPoint: { mapId: 'home', x: 4, y: 3 },
    playSec: 0
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
    // ゲート判定
    const gate = GATES.find((g) => g.map === curMap.id && g.dir === dir && g.cond());
    if (gate) { cutscene = true; await say(gate.text); cutscene = false; return; }
    cutscene = true;
    await fadeOut();
    loadMap(ee.to, ee.tx, ee.ty, dir);
    await fadeIn();
    cutscene = false;
    afterWarpStep();
  }

  const GATES = [
    { map: 'hometown', dir: 'up', cond: () => !G.flags.starter,
      text: 'カエデはかせが けんきゅうじょで\nまっている みたいだ。' },
    { map: 'tsukimi', dir: 'up', cond: () => !G.flags.badge8,
      text: 'けいびいん「ここから さきは ヴィクトリーロード。\n8つの ジムバッジが ないと とおれません！」' }
  ];

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

  async function runWildEncounter() {
    const list = curMap.encounters.list;
    const total = list.reduce((a, e) => a + e[3], 0);
    let r = Math.random() * total, pick = list[0];
    for (const e of list) { r -= e[3]; if (r <= 0) { pick = e; break; } }
    const [spId, lo, hi] = pick;
    const lv = lo + Math.floor(Math.random() * (hi - lo + 1));
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
    const result = await BT().startTrainer(tr, curMap.cave ? 'cave' : 'grass');
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
      default:
        for (const t of (ent.text || ['……'])) await say(t);
    }
  }

  /* ================= ストーリーロール ================= */
  async function roleProf() {
    if (G.flags.starter) {
      if (!G.flags.champion) {
        await say('カエデはかせ「ずかんは じゅんちょうかな？\nバッジを あつめて リーグを めざすのじゃ！」');
      } else {
        await say('カエデはかせ「チャンピオンに なっても けんきゅうは つづく。\nずかんの かんせいを たのんだぞ！」');
      }
      return;
    }
    await say('カエデはかせ「おお ユウ！ よく きたな！」');
    await say('カエデはかせ「ここは モンスターと ひとが ともに くらす セイリュウちほう。」');
    await say('カエデはかせ「きょうは きみに モンスターずかんの かんせいを たのみたいのじゃ。」');
    await say('カエデはかせ「まずは あいぼうを えらぶがよい！\nテーブルの うえの 3つの ボールから ひとつ じゃ！」');

    let starterId = 0;
    while (!starterId) {
      const opts = GD.STARTERS.map((id) => {
        const sp = GD.speciesById(id);
        return { label: sp.name, sub: GD.TYPES[sp.types[0]].name };
      });
      const i = await menu(opts, { title: 'どの モンスターに する？', cancelable: false });
      const sp = GD.speciesById(GD.STARTERS[i]);
      await say(`${sp.name}\n${sp.dex}`);
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
    await say(`ユウは ${sp.name}を あいぼうに した！`);
    await say('カエデはかせ「よい ちょいすじゃ！ だいじに そだてるのじゃぞ。」');

    // ライバル登場
    await say('レン「まった！」');
    await say('ここで ライバルの レンが かけこんできた！');
    const rsp = GD.speciesById(starterId === 1 ? 4 : starterId === 4 ? 7 : 1);
    await say(`レン「はかせ オレも モンスター もらうぜ！\nユウが ${sp.name}なら…… オレは ${rsp.name}だ！」`);
    await say('レン「へへっ さっそく しょうぶと いこうぜ！\nどっちの あいぼうが つよいか ためして やる！」');
    const rival1 = {
      id: 'rival1', name: 'ライバルの レン', team: 'RIVAL1', money: 500,
      lose: ['なんでだよ！ タイプは オレが ゆうりなのに！']
    };
    const result = await BT().startTrainer(rival1, 'indoor');
    G.flags.rival1 = true;
    if (result === 'lose') {
      G.party.forEach((m) => { m.hp = BT().calcStats(m.spId, m.lv).maxHp; m.status = null; });
      await say('レン「オレの かち！ もっと きたえて こいよな！」');
      await say(`カエデはかせが ${sp.name}を かいふく してくれた。`);
    } else {
      await say('レン「くそー！ つぎは まけないからな！」');
    }
    AU.play(curMap.music);
    await say('レン「オレは ひとあし さきに たびに でるぜ！\nじゃあな ユウ！」');
    G.bag.ball = (G.bag.ball || 0) + 5;
    G.bag.potion = (G.bag.potion || 0) + 2;
    AU.sfx('money');
    await say('カエデはかせ「モンスターボール 5こと キズぐすり 2こを もっていくがよい。」');
    await say('カエデはかせ「くさむらで モンスターを つかまえ ずかんを うめるのじゃ。\nきたの ルート1から ミナモシティへ すすむと よい！」');
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
    await say('「こんにちは！ モンスターセンターへ ようこそ！\nモンスターを おあずかり しますね。」');
    AU.jingle('heal');
    await sleep(1000);
    G.party.forEach((m) => { m.hp = BT().calcStats(m.spId, m.lv).maxHp; m.status = null; m.moves.forEach((s) => s.pp = GD.MOVES[s.id].pp); });
    G.healPoint = { mapId: G.mapId, x: 5, y: 5 };
    await say('「おまたせ しました！\nモンスターは すっかり げんきに なりましたよ！」');
    await say('「またの ごりようを おまちして います！」');
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
    G.money = Math.max(0, Math.floor(G.money / 2));
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
      const i = await menu(['ずかん', 'モンスター', 'バッグ', 'レポート', 'トレーナーカード', 'とじる'], { cancelable: true, title: 'メニュー' });
      if (i < 0 || i === 5) break;
      if (i === 0) await dexScreen();
      else if (i === 1) await partyScreen();
      else if (i === 2) await bagPick({ inBattle: false });
      else if (i === 3) {
        if (await confirm('レポートに ぼうけんを かきのこしますか？')) {
          saveGame();
          AU.sfx('save');
          await say('レポートに しっかり かきのこした！');
        }
      }
      else if (i === 4) await trainerCard();
    }
    cutscene = false;
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
      localStorage.setItem(SAVE_KEY, JSON.stringify(G));
      return true;
    } catch (e) { console.error(e); return false; }
  }
  function loadSave() {
    try {
      const s = localStorage.getItem(SAVE_KEY);
      if (!s) return null;
      const d = JSON.parse(s);
      if (!d || d.v !== 1 || !Array.isArray(d.party)) return null;
      return d;
    } catch (e) { return null; }
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
