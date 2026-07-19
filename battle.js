/* ============================================================
 * battle.js — バトルエンジン
 * ポケモン式ターン制バトル: わざ/PP/タイプ相性/急所/状態異常/
 * 能力ランク/捕獲/けいけんち/レベルアップ/わざ習得/しんか予約
 * UI プリミティブ(say/menu/sleep/partyPick/bagPick)は game.js の UI を利用。
 * ============================================================ */
(() => {
  const GD = () => window.GameData;
  const UI = () => window.UI;
  const $ = (id) => document.getElementById(id);

  let uidCounter = 1;

  /* ---------------- モンスター生成・成長 ---------------- */
  const expForLevel = (lv) => lv * lv * lv;

  function calcStats(spId, lv) {
    const b = GD().speciesById(spId).base;
    return {
      maxHp: Math.floor(b.hp * 2 * lv / 100) + lv + 10,
      atk: Math.floor(b.atk * 2 * lv / 100) + 5,
      def: Math.floor(b.def * 2 * lv / 100) + 5,
      spd: Math.floor(b.spd * 2 * lv / 100) + 5
    };
  }

  function movesAtLevel(spId, lv) {
    const sp = GD().speciesById(spId);
    const ids = [];
    for (const [l, m] of sp.learn) if (l <= lv && !ids.includes(m)) ids.push(m);
    return ids.slice(-4);
  }

  function makeMon(spId, lv) {
    const stats = calcStats(spId, lv);
    return {
      uid: uidCounter++,
      spId, lv,
      exp: expForLevel(lv),
      hp: stats.maxHp,
      status: null, sleepTurns: 0,
      moves: movesAtLevel(spId, lv).map((id) => ({ id, pp: GD().MOVES[id].pp }))
    };
  }

  const monName = (m) => GD().speciesById(m.spId).name;
  const monStats = (m) => calcStats(m.spId, m.lv);

  /* ---------------- 表示ヘルパ ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const STATUS_LABEL = { psn: 'どく', par: 'まひ', brn: 'やけど', slp: 'ねむり' };

  function drawMonTo(canvasId, spId, back) {
    const cv = $(canvasId);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(window.Sprites.monCanvas(spId, back), 0, 0, cv.width, cv.height);
  }

  function setHpBar(el, pct) {
    pct = Math.max(0, Math.min(1, pct));
    el.style.width = `${pct * 100}%`;
    el.className = 'hp-fill' + (pct <= 0.2 ? ' hp-red' : pct <= 0.5 ? ' hp-yellow' : '');
  }

  function statusChip(el, m) {
    el.textContent = m && m.status ? STATUS_LABEL[m.status] : '';
    el.dataset.st = m && m.status ? m.status : '';
  }

  /* ---------------- バトル本体 ---------------- */
  const B = {}; // 現在のバトル状態

  function newSide(mon) {
    return { mon, stages: { atk: 0, def: 0, spd: 0 } };
  }

  const stageMult = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));

  function effAtk(side) {
    let v = monStats(side.mon).atk * stageMult(side.stages.atk);
    if (side.mon.status === 'brn') v *= 0.5;
    return v;
  }
  const effDef = (side) => monStats(side.mon).def * stageMult(side.stages.def);
  function effSpd(side) {
    let v = monStats(side.mon).spd * stageMult(side.stages.spd);
    if (side.mon.status === 'par') v *= 0.25;
    return v;
  }

  function refreshEnemyUI(animate = true) {
    const m = B.enemy.mon;
    $('e-name').textContent = monName(m);
    $('e-lv').textContent = `Lv${m.lv}`;
    setHpBar($('e-hp'), m.hp / monStats(m).maxHp);
    statusChip($('e-status'), m);
  }

  function refreshPlayerUI() {
    const m = B.player.mon;
    const st = monStats(m);
    $('p-name').textContent = monName(m);
    $('p-lv').textContent = `Lv${m.lv}`;
    setHpBar($('p-hp'), m.hp / st.maxHp);
    $('p-hpnum').textContent = `${m.hp}/ ${st.maxHp}`;
    statusChip($('p-status'), m);
    const cur = expForLevel(m.lv), next = expForLevel(m.lv + 1);
    $('p-exp').style.width = `${Math.max(0, Math.min(1, (m.exp - cur) / (next - cur))) * 100}%`;
  }

  async function showBattleScreen(env) {
    $('battle-bg').dataset.env = env || 'grass';
    $('battle').classList.remove('hidden');
    $('enemy-stage').classList.add('slide-in-r');
    $('player-stage').classList.add('slide-in-l');
    await sleep(400);
    $('enemy-stage').classList.remove('slide-in-r');
    $('player-stage').classList.remove('slide-in-l');
  }

  function hideBattleScreen() {
    $('battle').classList.add('hidden');
    $('enemy-stage').className = '';
    $('player-stage').className = '';
  }

  async function lungeAnim(isPlayerAttacking) {
    const stage = $(isPlayerAttacking ? 'player-stage' : 'enemy-stage');
    stage.classList.add(isPlayerAttacking ? 'lunge-p' : 'lunge-e');
    await sleep(260);
    stage.classList.remove('lunge-p', 'lunge-e');
  }

  function burstFx(targetIsEnemy, color) {
    const b = document.createElement('div');
    b.className = 'fx-burst';
    b.style.color = color || '#f8f0d0';
    if (targetIsEnemy) { b.style.left = '344px'; b.style.top = '70px'; }
    else { b.style.left = '114px'; b.style.top = '178px'; }
    $('battle').appendChild(b);
    setTimeout(() => b.remove(), 500);
  }

  async function animateHit(targetIsEnemy, mult, color) {
    const stage = $(targetIsEnemy ? 'enemy-stage' : 'player-stage');
    window.AudioSys.sfx(mult > 1 ? 'hitSuper' : mult < 1 ? 'hitWeak' : 'hit');
    burstFx(targetIsEnemy, color);
    if (mult > 1) {
      $('battle').classList.add('shake-hard');
      setTimeout(() => $('battle').classList.remove('shake-hard'), 450);
    }
    stage.classList.add('blink-hit');
    await sleep(360);
    stage.classList.remove('blink-hit');
  }

  async function faintAnim(targetIsEnemy) {
    window.AudioSys.sfx('faint');
    const stage = $(targetIsEnemy ? 'enemy-stage' : 'player-stage');
    stage.classList.add('faint');
    await sleep(500);
    stage.classList.remove('faint');
  }

  const say = (t, o) => UI().say(t, o);
  const bsay = (t) => UI().say(t, { auto: 1200 });

  /* ---- ダメージ計算 ---- */
  function calcDamage(attacker, defender, move) {
    const sp = GD().speciesById(attacker.mon.spId);
    const dsp = GD().speciesById(defender.mon.spId);
    const mult = GD().typeMult(move.type, dsp.types);
    if (mult === 0) return { dmg: 0, mult: 0, crit: false };
    const stab = sp.types.includes(move.type) ? 1.5 : 1;
    const critChance = move.highCrit ? 0.25 : 0.0625;
    const crit = Math.random() < critChance;
    let dmg = (((2 * attacker.mon.lv / 5 + 2) * move.pow * effAtk(attacker) / Math.max(1, effDef(defender))) / 50 + 2);
    dmg *= stab * mult * (crit ? 1.5 : 1) * (0.85 + Math.random() * 0.15);
    return { dmg: Math.max(1, Math.floor(dmg)), mult, crit };
  }

  async function applyStat(side, isPlayer, stat, delta) {
    const cur = side.stages[stat];
    const next = Math.max(-6, Math.min(6, cur + delta));
    const label = { atk: 'こうげき', def: 'ぼうぎょ', spd: 'すばやさ' }[stat];
    const who = monName(side.mon);
    if (next === cur) { await bsay(`${who}の ${label}は これいじょう かわらない！`); return; }
    side.stages[stat] = next;
    window.AudioSys.sfx(delta > 0 ? 'statUp' : 'statDn');
    await bsay(`${who}の ${label}が ${delta > 0 ? (delta > 1 ? 'ぐーんと あがった！' : 'あがった！') : 'さがった！'}`);
  }

  async function applyStatus(target, isPlayerTarget, status) {
    const m = target.mon;
    if (m.status) { await bsay(`しかし ${monName(m)}には こうかが なかった！`); return; }
    m.status = status;
    if (status === 'slp') m.sleepTurns = 1 + Math.floor(Math.random() * 3);
    const stage = $(target === B.enemy ? 'enemy-stage' : 'player-stage');
    stage.classList.add('status-pulse');
    setTimeout(() => stage.classList.remove('status-pulse'), 650);
    const text = { psn: 'どくを あびた！', par: 'からだが まひして わざが でにくくなった！', brn: 'やけどを おった！', slp: 'ねむってしまった！' }[status];
    await bsay(`${monName(m)}は ${text}`);
    refreshEnemyUI(); refreshPlayerUI();
  }

  /* ---- わざ実行 ---- */
  async function useMove(attacker, defender, moveSlot, isPlayerAttacking) {
    const m = attacker.mon;
    const move = GD().MOVES[moveSlot.id];

    // ねむり
    if (m.status === 'slp') {
      if (m.sleepTurns > 0) {
        m.sleepTurns--;
        await bsay(`${monName(m)}は ぐうぐう ねむっている…`);
        return;
      }
      m.status = null;
      refreshEnemyUI(); refreshPlayerUI();
      await bsay(`${monName(m)}は めを さました！`);
    }
    // まひ
    if (m.status === 'par' && Math.random() < 0.25) {
      await bsay(`${monName(m)}は からだが しびれて うごけない！`);
      return;
    }

    moveSlot.pp = Math.max(0, moveSlot.pp - 1);
    await bsay(`${monName(m)}の ${move.name}！`);

    // 命中判定 (acc:999 は必中扱い)
    if (move.acc <= 100 && Math.random() * 100 >= move.acc) {
      await bsay('しかし うまく きまらなかった！');
      return;
    }

    if (move.cat === 'phys') {
      const { dmg, mult, crit } = calcDamage(attacker, defender, move);
      if (mult === 0) { await bsay(`${monName(defender.mon)}には こうかが ない みたいだ…`); return; }
      await lungeAnim(isPlayerAttacking);
      await animateHit(isPlayerAttacking, mult, GD().TYPES[move.type].color);
      defender.mon.hp = Math.max(0, defender.mon.hp - dmg);
      refreshEnemyUI(); refreshPlayerUI();
      await sleep(350);
      if (crit) await bsay('きゅうしょに あたった！');
      if (mult > 1) await bsay('こうかは ばつぐんだ！');
      else if (mult < 1) await bsay('こうかは いまひとつの ようだ…');
      // 追加効果
      if (move.fx && defender.mon.hp > 0) {
        const fx = move.fx;
        if (fx.status && Math.random() < (fx.chance ?? 1)) await applyStatus(defender, !isPlayerAttacking, fx.status);
        if (fx.stat && Math.random() < (fx.chance ?? 1)) {
          const target = fx.target === 'self' ? attacker : defender;
          await applyStat(target, target === B.player, fx.stat, fx.delta);
        }
      }
      if (move.fx?.drain && dmg > 0) {
        const heal = Math.max(1, Math.floor(dmg * move.fx.drain));
        const st = monStats(m);
        m.hp = Math.min(st.maxHp, m.hp + heal);
        refreshEnemyUI(); refreshPlayerUI();
        await bsay(`${monName(defender.mon)}から たいりょくを すいとった！`);
      }
    } else {
      const fx = move.fx || {};
      if (fx.heal) {
        const st = monStats(m);
        if (m.hp >= st.maxHp) { await bsay('しかし こうかが なかった！'); return; }
        m.hp = Math.min(st.maxHp, m.hp + Math.floor(st.maxHp * fx.heal));
        refreshEnemyUI(); refreshPlayerUI();
        await bsay(`${monName(m)}は たいりょくを かいふくした！`);
      } else if (fx.status) {
        const dsp = GD().speciesById(defender.mon.spId);
        if (fx.status === 'brn' && GD().typeMult('F', dsp.types) === 0) { await bsay('こうかが ない みたいだ…'); return; }
        await applyStatus(defender, !isPlayerAttacking, fx.status);
      } else if (fx.stat) {
        const target = fx.target === 'self' ? attacker : defender;
        await applyStat(target, target === B.player, fx.stat, fx.delta);
      }
    }
  }

  async function endOfTurn(side) {
    const m = side.mon;
    if (m.hp <= 0) return;
    if (m.status === 'psn' || m.status === 'brn') {
      const st = monStats(m);
      const dmg = Math.max(1, Math.floor(st.maxHp / (m.status === 'psn' ? 8 : 16)));
      m.hp = Math.max(0, m.hp - dmg);
      refreshEnemyUI(); refreshPlayerUI();
      await bsay(`${monName(m)}は ${m.status === 'psn' ? 'どく' : 'やけど'}の ダメージを うけている！`);
    }
  }

  /* ---- 経験値 ---- */
  async function gainExp(mon, defeated, isTrainer) {
    const sp = GD().speciesById(defeated.spId);
    const gain = Math.max(1, Math.floor(sp.baseExp * defeated.lv / 7 * (isTrainer ? 1.5 : 1)));
    await bsay(`${monName(mon)}は ${gain}の けいけんちを もらった！`);
    mon.exp += gain;
    while (mon.lv < 100 && mon.exp >= expForLevel(mon.lv + 1)) {
      const before = monStats(mon);
      mon.lv++;
      const after = monStats(mon);
      mon.hp = Math.min(after.maxHp, mon.hp + (after.maxHp - before.maxHp));
      window.AudioSys.jingle('levelup');
      refreshPlayerUI();
      await say(`${monName(mon)}は レベル${mon.lv}に あがった！`);
      // わざ習得
      const spec = GD().speciesById(mon.spId);
      for (const [l, mid] of spec.learn) {
        if (l !== mon.lv || mon.moves.some((s) => s.id === mid)) continue;
        await learnMove(mon, mid);
      }
      // しんか予約
      if (spec.evo && mon.lv >= spec.evo.lv) window.Game.queueEvolution(mon);
    }
    refreshPlayerUI();
  }

  async function learnMove(mon, moveId) {
    const mv = GD().MOVES[moveId];
    if (mon.moves.length < 4) {
      mon.moves.push({ id: moveId, pp: mv.pp });
      window.AudioSys.sfx('confirm');
      await say(`${monName(mon)}は ${mv.name}を おぼえた！`);
      return;
    }
    await say(`${monName(mon)}は あたらしく ${mv.name}を おぼえたい…\nしかし わざは 4つまでしか おぼえられない！`);
    const items = mon.moves.map((s) => `${GD().MOVES[s.id].name}`).concat(['あきらめる']);
    const pick = await UI().menu(items, { title: 'どの わざを わすれる？', cancelable: true });
    if (pick < 0 || pick === 4) {
      await say(`${monName(mon)}は ${mv.name}を おぼえるのを あきらめた！`);
      return;
    }
    const old = GD().MOVES[mon.moves[pick].id].name;
    mon.moves[pick] = { id: moveId, pp: mv.pp };
    await say(`${monName(mon)}は ${old}を わすれて ${mv.name}を おぼえた！`);
  }

  /* ---- 捕獲 ---- */
  async function tryCapture(ballKey) {
    const item = GD().ITEMS[ballKey];
    const m = B.enemy.mon;
    const sp = GD().speciesById(m.spId);
    const st = monStats(m);
    window.AudioSys.sfx('ballThrow');
    const ball = $('ball-toss');
    ball.classList.remove('hidden');
    ball.classList.add('toss');
    await sleep(500);
    $('enemy-stage').classList.add('captured');
    await sleep(300);

    const statusBonus = m.status === 'slp' ? 2 : m.status ? 1.5 : 1;
    const f = Math.max(1, ((3 * st.maxHp - 2 * m.hp) * sp.catchRate * item.rate * statusBonus) / (3 * st.maxHp));
    const prob = Math.min(1, f / 255);
    const success = Math.random() < prob;
    const shakes = success ? 3 : Math.min(2, Math.floor(prob * 4));

    for (let i = 0; i < shakes; i++) {
      window.AudioSys.sfx('ballShake');
      ball.classList.add('shake');
      await sleep(420);
      ball.classList.remove('shake');
      await sleep(240);
    }

    if (success) {
      window.AudioSys.jingle('caught', null);
      await say(`やったー！ ${monName(m)}を つかまえたぞ！`);
      const G = window.Game.state();
      G.dex.caught[m.spId] = true;
      m.status = null;
      if (G.party.length < 6) {
        G.party.push(m);
        await say(`${monName(m)}は てもちに くわわった！`);
      } else {
        G.box.push(m);
        await say(`てもちが いっぱいだ！\n${monName(m)}は ボックスに てんそうされた！`);
      }
      ball.className = 'hidden';
      $('enemy-stage').classList.remove('captured');
      return true;
    }
    window.AudioSys.sfx('ballBreak');
    ball.className = 'hidden';
    $('enemy-stage').classList.remove('captured');
    await bsay(`ああっ！ ${monName(m)}は ボールから でてきてしまった！`);
    return false;
  }

  /* ---- 行動選択 ---- */
  async function chooseAction() {
    while (true) {
      const act = await UI().menu(['たたかう', 'バッグ', 'モンスター', 'にげる'], { grid: true, title: `${monName(B.player.mon)}は どうする？` });
      if (act === 0) {
        const mvItems = B.player.mon.moves.map((s) => {
          const mv = GD().MOVES[s.id];
          return { label: mv.name, sub: `${GD().TYPES[mv.type].name}  PP ${s.pp}/${mv.pp}` };
        });
        const mi = await UI().menu(mvItems, { grid: true, cancelable: true, title: 'どの わざを つかう？' });
        if (mi < 0) continue;
        if (B.player.mon.moves[mi].pp <= 0) { await bsay('わざの PPが なくなった！'); continue; }
        return { type: 'fight', move: mi };
      }
      if (act === 1) {
        const used = await UI().bagPick({ inBattle: true, wild: !B.trainer });
        if (!used) continue;
        return { type: 'item', ...used };
      }
      if (act === 2) {
        const idx = await UI().partyPick({ forSwitch: true, currentUid: B.player.mon.uid });
        if (idx < 0) continue;
        return { type: 'switch', index: idx };
      }
      if (act === 3) {
        if (B.trainer) { await bsay('ダメだ！ しょうぶの さいちゅうだ！'); continue; }
        return { type: 'run' };
      }
    }
  }

  function enemyPickMove() {
    const side = B.enemy;
    const usable = side.mon.moves.filter((s) => s.pp > 0);
    if (!usable.length) return null;
    // ダメージ期待値で重み付け
    let best = null, bestScore = -1;
    for (const s of usable) {
      const mv = GD().MOVES[s.id];
      let score;
      if (mv.cat === 'phys') {
        const dsp = GD().speciesById(B.player.mon.spId);
        score = mv.pow * GD().typeMult(mv.type, dsp.types) * (mv.acc <= 100 ? mv.acc / 100 : 1);
      } else {
        score = B.player.mon.status || Math.random() > 0.35 ? 8 : 55;
      }
      score *= 0.7 + Math.random() * 0.6;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  async function sendPlayerMon(mon, first) {
    B.player = newSide(mon);
    drawMonTo('p-sprite', mon.spId, true);
    refreshPlayerUI();
    $('player-stage').classList.add('slide-in-l');
    window.AudioSys.sfx('cry', mon.spId * 53);
    await say(`ゆけっ！ ${monName(mon)}！`, { auto: 900 });
    $('player-stage').classList.remove('slide-in-l');
  }

  async function playerFaintFlow() {
    await faintAnim(false);
    await say(`${monName(B.player.mon)}は たおれた！`);
    const G = window.Game.state();
    const alive = G.party.filter((m) => m.hp > 0);
    if (!alive.length) return false;
    const idx = await UI().partyPick({ forSwitch: true, mustPick: true, currentUid: B.player.mon.uid });
    await sendPlayerMon(G.party[idx >= 0 ? idx : G.party.indexOf(alive[0])], false);
    return true;
  }

  async function enemyFaintFlow() {
    await faintAnim(true);
    await say(`${B.trainer ? `${B.trainer.name}の ` : 'やせいの '}${monName(B.enemy.mon)}は たおれた！`);
    await gainExp(B.player.mon, B.enemy.mon, !!B.trainer);
    if (B.trainer) {
      B.trainerIdx++;
      if (B.trainerIdx < B.trainerTeam.length) {
        const next = B.trainerTeam[B.trainerIdx];
        B.enemy = newSide(next);
        window.Game.state().dex.seen[next.spId] = true;
        drawMonTo('e-sprite', next.spId, false);
        window.AudioSys.sfx('cry', next.spId * 53);
        refreshEnemyUI();
        $('enemy-stage').classList.add('slide-in-r');
        await say(`${B.trainer.name}は ${monName(next)}を くりだした！`);
        $('enemy-stage').classList.remove('slide-in-r');
        return true; // 戦闘続行
      }
    }
    return false;
  }

  /* ---- メインループ ---- */
  async function battleLoop() {
    const G = window.Game.state();
    while (true) {
      const action = await chooseAction();
      let playerMoveSlot = null;
      let playerActs = true;

      if (action.type === 'run') {
        const mySpd = effSpd(B.player), foeSpd = effSpd(B.enemy);
        B.runAttempts++;
        const ok = mySpd >= foeSpd || Math.random() < 0.5 + B.runAttempts * 0.15;
        if (ok) { window.AudioSys.sfx('confirm'); await say('うまく にげきれた！'); return 'run'; }
        await bsay('にげられない！');
        playerActs = false;
      } else if (action.type === 'switch') {
        await say(`もどれ！ ${monName(B.player.mon)}！`, { auto: 800 });
        await sendPlayerMon(G.party[action.index], false);
        playerActs = false;
      } else if (action.type === 'item') {
        if (action.kind === 'ball') {
          const caught = await tryCapture(action.itemKey);
          if (caught) return 'caught';
          playerActs = false;
        } else {
          playerActs = false; // 回復等は bagPick 内で適用済み
          refreshPlayerUI();
        }
      } else {
        playerMoveSlot = B.player.mon.moves[action.move];
      }

      // 行動順
      const enemySlot = enemyPickMove();
      const order = [];
      if (playerActs && playerMoveSlot) order.push('player');
      if (enemySlot) order.push('enemy');
      if (order.length === 2) {
        const pm = GD().MOVES[playerMoveSlot.id], em = GD().MOVES[enemySlot.id];
        const pPri = pm.priority || 0, ePri = em.priority || 0;
        let playerFirst;
        if (pPri !== ePri) playerFirst = pPri > ePri;
        else {
          const ps = effSpd(B.player), es = effSpd(B.enemy);
          playerFirst = ps === es ? Math.random() < 0.5 : ps > es;
        }
        if (!playerFirst) order.reverse();
      }

      for (const who of order) {
        if (who === 'player') {
          if (B.player.mon.hp <= 0) continue;
          await useMove(B.player, B.enemy, playerMoveSlot, true);
          if (B.enemy.mon.hp <= 0) {
            const cont = await enemyFaintFlow();
            if (!cont && B.trainer) return 'win';
            if (!cont && !B.trainer) return 'win';
            break;
          }
        } else {
          if (B.enemy.mon.hp <= 0) continue;
          await useMove(B.enemy, B.player, enemySlot, false);
          refreshPlayerUI();
          if (B.player.mon.hp <= 0) {
            const ok = await playerFaintFlow();
            if (!ok) return 'lose';
            break;
          }
        }
      }

      // ターン終了時の毒・やけど
      if (B.enemy.mon.hp > 0 && B.player.mon.hp > 0) {
        await endOfTurn(B.player);
        if (B.player.mon.hp <= 0) { const ok = await playerFaintFlow(); if (!ok) return 'lose'; continue; }
        await endOfTurn(B.enemy);
        if (B.enemy.mon.hp <= 0) {
          const cont = await enemyFaintFlow();
          if (!cont) return 'win';
        }
      }
    }
  }

  function firstAliveMon() {
    return window.Game.state().party.find((m) => m.hp > 0);
  }

  /* ---- 公開API ---- */
  async function startWild(spId, lv, env) {
    const G = window.Game.state();
    const wild = makeMon(spId, lv);
    G.dex.seen[spId] = true;
    B.trainer = null; B.trainerTeam = null; B.trainerIdx = 0; B.runAttempts = 0;
    B.enemy = newSide(wild);
    window.AudioSys.play('battleWild');
    drawMonTo('e-sprite', spId, false);
    refreshEnemyUI();
    await showBattleScreen(env);
    window.AudioSys.sfx('cry', spId * 53);
    await say(`あっ！ やせいの ${monName(wild)}が とびだしてきた！`);
    await sendPlayerMon(firstAliveMon(), true);
    const result = await battleLoop();
    await finishBattle(result);
    return result;
  }

  async function startTrainer(def, env) {
    const G = window.Game.state();
    const teamDef = typeof def.team === 'string' ? GD().RIVAL_TEAMS[def.team](G.starterId) : def.team;
    B.trainer = def;
    B.trainerTeam = teamDef.map(([sp, lv]) => makeMon(sp, lv));
    B.trainerIdx = 0; B.runAttempts = 0;
    B.enemy = newSide(B.trainerTeam[0]);
    G.dex.seen[B.trainerTeam[0].spId] = true;
    window.AudioSys.play(def.champion ? 'battleChampion' : 'battleTrainer');
    drawMonTo('e-sprite', B.enemy.mon.spId, false);
    refreshEnemyUI();
    await showBattleScreen(env);
    await say(`${def.name}が しょうぶを しかけてきた！`);
    window.AudioSys.sfx('cry', B.enemy.mon.spId * 53);
    await say(`${def.name}は ${monName(B.enemy.mon)}を くりだした！`);
    await sendPlayerMon(firstAliveMon(), true);
    const result = await battleLoop();
    if (result === 'win') {
      window.AudioSys.play('victory');
      await say(`${def.name}との しょうぶに かった！`);
      if (def.lose) for (const t of def.lose) await say(`${def.name}\n「${t}」`);
      if (def.money) {
        window.Game.state().money += def.money;
        window.AudioSys.sfx('money');
        await say(`しょうきんとして ${def.money}円 てにいれた！`);
      }
    }
    await finishBattle(result);
    return result;
  }

  async function finishBattle(result) {
    if (result === 'win' && !B.trainer) {
      window.AudioSys.play('victory');
      await sleep(300);
    }
    hideBattleScreen();
    // バトル終了後にしんか処理 (勝利・捕獲時のみ)
    if (result === 'win' || result === 'caught') {
      await window.Game.runEvolutions();
    } else {
      window.Game.clearEvolutions();
    }
  }

  window.Battle = { startWild, startTrainer, makeMon, calcStats, movesAtLevel, expForLevel, monName, monStats };
})();
