/* ============================================================
 * sprites.js — ドット絵レイヤ
 * ・キャラクター歩行スプライト(16x16, パレット差し替え)
 * ・モンスタースプライト(シード付き手続き生成 16x16)
 * ・マップタイルテクスチャ
 * すべて Canvas で手続き描画し、外部画像に依存しない。
 * ============================================================ */
(() => {
  const seeded = (seed) => {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  };

  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbStr = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;
  const shade = (hex, f) => rgbStr(hexToRgb(hex).map((v) => Math.max(0, Math.min(255, v * f))));
  const mix = (a, b, t) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbStr(A.map((v, i) => v + (B[i] - v) * t));
  };

  /* ---------------- キャラクター ---------------- */
  // . 透明 / k 黒 / s 肌 / h 帽子・髪 / c 服 / p ズボン / w 白
  const CH = {
    down0: [
      '................',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..kkkkkkkkkkkk..',
      '..kssssssssssk..',
      '..kssksssskssk..',
      '...kssssssssk...',
      '..cccccccccccc..',
      '.sccccccccccccs.',
      '.sccccccccccccs.',
      '..cccccccccccc..',
      '...pppp..pppp...',
      '...pppp..pppp...',
      '...kkkk..kkkk...',
      '................'
    ],
    down1: [
      '................',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..kkkkkkkkkkkk..',
      '..kssssssssssk..',
      '..kssksssskssk..',
      '...kssssssssk...',
      '..cccccccccccc..',
      '.sccccccccccccs.',
      '.sccccccccccccs.',
      '..cccccccccccc..',
      '..pppp....pppp..',
      '...ppp....ppp...',
      '..kkkk.....kkk..',
      '................'
    ],
    up0: [
      '................',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..hhhhhhhhhhhh..',
      '..khhhhhhhhhhk..',
      '..khhhhhhhhhhk..',
      '...khhhhhhhhk...',
      '..cccccccccccc..',
      '.sccccccccccccs.',
      '.sccccccccccccs.',
      '..cccccccccccc..',
      '...pppp..pppp...',
      '...pppp..pppp...',
      '...kkkk..kkkk...',
      '................'
    ],
    up1: [
      '................',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..hhhhhhhhhhhh..',
      '..khhhhhhhhhhk..',
      '..khhhhhhhhhhk..',
      '...khhhhhhhhk...',
      '..cccccccccccc..',
      '.sccccccccccccs.',
      '.sccccccccccccs.',
      '..cccccccccccc..',
      '..pppp....pppp..',
      '...ppp....ppp...',
      '..kkk.....kkkk..',
      '................'
    ],
    left0: [
      '................',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..kkkkkkkkkkkk..',
      '..kssssssshhk...',
      '..kskssssshhk...',
      '...ssssssshk....',
      '...cccccccccc...',
      '..sccccccccccc..',
      '...ccccccccccc..',
      '...cccccccccc...',
      '....pppppppp....',
      '....ppp..ppp....',
      '....kkk..kkk....',
      '................'
    ],
    left1: [
      '................',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..kkkkkkkkkkkk..',
      '..kssssssshhk...',
      '..kskssssshhk...',
      '...ssssssshk....',
      '...cccccccccc...',
      '..sccccccccccc..',
      '...ccccccccccc..',
      '...cccccccccc...',
      '....pppppppp....',
      '...ppp....ppp...',
      '...kkk....kkk...',
      '................'
    ]
  };

  const SKINS = {
    player: { h: '#d83028', c: '#d84040', p: '#3858a8', s: '#f0c8a0', k: '#282828', w: '#f8f8f8' },
    rival:  { h: '#3858c8', c: '#4868c8', p: '#404048', s: '#f0c8a0', k: '#282828', w: '#f8f8f8' },
    prof:   { h: '#a08050', c: '#f0f0e8', p: '#686050', s: '#f0c8a0', k: '#282828', w: '#f8f8f8' },
    boy2:   { h: '#684828', c: '#48a848', p: '#885028', s: '#f0c8a0', k: '#282828', w: '#f8f8f8' },
    girl:   { h: '#b87838', c: '#e87898', p: '#f0e8e0', s: '#f0c8a0', k: '#282828', w: '#f8f8f8' },
    man:    { h: '#484038', c: '#8898a8', p: '#485058', s: '#e8bc90', k: '#282828', w: '#f8f8f8' },
    nurse:  { h: '#e88098', c: '#f8f0f0', p: '#f8d0d8', s: '#f0c8a0', k: '#282828', w: '#f8f8f8' },
    clerk:  { h: '#383838', c: '#4870c8', p: '#384048', s: '#f0c8a0', k: '#282828', w: '#f8f8f8' },
    grunt:  { h: '#282830', c: '#505060', p: '#282830', s: '#d8b090', k: '#181820', w: '#f8f8f8' },
    leader: { h: '#c8a848', c: '#9850c8', p: '#383048', s: '#f0c8a0', k: '#282828', w: '#f8f8f8' },
    boss:   { h: '#887880', c: '#603850', p: '#302838', s: '#d8b090', k: '#181820', w: '#f8f8f8' }
  };

  const charCache = new Map();
  function charCanvas(skin, dir, frame) {
    const key = `${skin}:${dir}:${frame}`;
    if (charCache.has(key)) return charCache.get(key);
    const pal = SKINS[skin] || SKINS.man;
    let grid, flip = false;
    if (dir === 'right') { grid = CH[`left${frame}`]; flip = true; }
    else grid = CH[`${dir}${frame}`] || CH.down0;
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 16;
    const ctx = cv.getContext('2d');
    grid.forEach((row, y) => {
      for (let x = 0; x < 16; x++) {
        const ch = row[x];
        if (ch === '.' || !ch) continue;
        ctx.fillStyle = pal[ch] || '#000';
        ctx.fillRect(flip ? 15 - x : x, y, 1, 1);
      }
    });
    charCache.set(key, cv);
    return cv;
  }

  /* ---------------- モンスター生成 ---------------- */
  const GD = () => window.GameData;

  function genMonGrid(sp) {
    const rng = seeded(sp.id * 2137 + 421);
    const W = 16, H = 16;
    const g = Array.from({ length: H }, () => Array(W).fill(0));
    const size = sp.size || 1;
    const rx = 3.2 + size * 0.9;
    const ry = 3.4 + size * 1.0;
    const cy = 8.6;
    // 左半分だけ作って鏡映
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x <= 7; x++) {
        const dx = (x - 7.5) / rx;
        const dy = (y - cy) / ry;
        const noise = (rng() - 0.5) * 0.55;
        if (dx * dx + dy * dy + noise < 0.95) g[y][x] = 1;
      }
    }
    // 平滑化
    for (let it = 0; it < 2; it++) {
      const ng = g.map((r) => [...r]);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x <= 7; x++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += g[y + dy][x + dx] ? 1 : 0;
          ng[y][x] = n >= 5 ? 1 : n <= 2 ? 0 : g[y][x];
        }
      }
      for (let y = 0; y < H; y++) for (let x = 0; x <= 7; x++) g[y][x] = ng[y][x];
    }
    // 耳・ツノ
    let topY = H;
    for (let y = 0; y < H; y++) if (g[y].slice(0, 8).some(Boolean)) { topY = y; break; }
    if (topY > 1) {
      const earX = 3 + Math.floor(rng() * 3);
      const earLen = 1 + Math.floor(rng() * Math.min(2, topY));
      for (let i = 1; i <= earLen; i++) if (topY - i >= 0) g[topY - i][earX] = 1;
      if (rng() < 0.5 && topY - 1 >= 0) g[topY - 1][Math.min(7, earX + 2)] = 1;
    }
    // 脚
    let botY = 0;
    for (let y = H - 1; y >= 0; y--) if (g[y].slice(0, 8).some(Boolean)) { botY = y; break; }
    if (botY < H - 2) {
      const legX = 4 + Math.floor(rng() * 2);
      g[botY + 1][legX] = 1;
      if (rng() < 0.6 && botY + 2 < H) g[botY + 2][legX] = 1;
    }
    // 鏡映
    for (let y = 0; y < H; y++) for (let x = 0; x < 8; x++) g[y][15 - x] = g[y][x];
    return g;
  }

  function monPalette(sp) {
    const base = GD().TYPES[sp.types[0]].color;
    const accent = sp.types[1] ? GD().TYPES[sp.types[1]].color : shade(base, 1.35);
    const t = (sp.id % 5) * 0.06;
    const body = mix(base, '#ffffff', t);
    return { body, dark: shade(base, 0.55), light: mix(base, '#ffffff', 0.45 + t), accent, outline: '#20202a' };
  }

  const monCache = new Map();
  function monCanvas(spId, back = false) {
    const key = `${spId}:${back ? 'b' : 'f'}`;
    if (monCache.has(key)) return monCache.get(key);
    const sp = GD().speciesById(spId);
    const g = genMonGrid(sp);
    const pal = monPalette(sp);
    const rng = seeded(sp.id * 977 + 5);
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 16;
    const ctx = cv.getContext('2d');

    // 本体
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (!g[y][x]) continue;
        let color = pal.body;
        // 下部・左は陰
        if (y > 11 || (x < 4 && y > 6)) color = pal.dark;
        // 腹は明るく
        if (x > 5 && x < 10 && y > 7 && y < 12) color = pal.light;
        // アクセント模様
        if ((x + y * 3 + sp.id) % 7 === 0 && y < 8) color = pal.accent;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // 輪郭
    ctx.fillStyle = pal.outline;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (g[y][x]) continue;
        const near = (g[y - 1]?.[x]) || (g[y + 1]?.[x]) || (g[y][x - 1]) || (g[y][x + 1]);
        if (near) ctx.fillRect(x, y, 1, 1);
      }
    }
    if (!back) {
      // 目
      let topY = 0;
      for (let y = 0; y < 16; y++) if (g[y].some(Boolean)) { topY = y; break; }
      const eyeY = Math.min(14, topY + 3 + Math.floor(rng() * 2));
      const eyeDx = 2 + Math.floor(rng() * 2);
      for (const ex of [8 - eyeDx, 7 + eyeDx]) {
        if (g[eyeY]?.[ex]) {
          ctx.fillStyle = '#f8f8f8'; ctx.fillRect(ex, eyeY, 1, 1);
          ctx.fillStyle = '#181820'; ctx.fillRect(ex, eyeY + 1, 1, 1);
        }
      }
      // 口
      const mouthY = eyeY + 3;
      if (g[mouthY]?.[7] && g[mouthY]?.[8]) {
        ctx.fillStyle = pal.outline; ctx.fillRect(7, mouthY, 2, 1);
      }
    } else {
      // 後ろ姿: 背中の縞
      ctx.fillStyle = pal.dark;
      for (let y = 4; y < 13; y += 3) {
        for (let x = 5; x < 11; x++) if (g[y][x]) ctx.fillRect(x, y, 1, 1);
      }
    }
    monCache.set(key, cv);
    return cv;
  }

  /* ---------------- タイル ---------------- */
  const tileCache = new Map();
  function tileCanvas(ch, opts = {}, frame = 0) {
    const key = `${ch}:${opts.roofColor || ''}:${opts.cave ? 1 : 0}:${frame}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 16;
    const ctx = cv.getContext('2d');
    const rng = seeded(ch.charCodeAt(0) * 31 + frame * 7 + 3);
    const speckle = (color, n) => {
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) ctx.fillRect((rng() * 16) | 0, (rng() * 16) | 0, 1, 1);
    };
    const fill = (color) => { ctx.fillStyle = color; ctx.fillRect(0, 0, 16, 16); };

    switch (ch) {
      case ',': fill('#78c058'); speckle('#68b048', 14); speckle('#88d068', 8); break;
      case '.': fill('#e0c890'); speckle('#d0b878', 12); speckle('#f0d8a8', 6); break;
      case '%': {
        fill('#78c058');
        ctx.fillStyle = '#3f8838';
        for (let x = 0; x < 16; x += 4) {
          ctx.fillRect(x + (frame ? 1 : 0), 4, 2, 11);
          ctx.fillRect(x + 2, 7, 2, 8);
        }
        ctx.fillStyle = '#59a848';
        for (let x = 1; x < 16; x += 4) ctx.fillRect(x + (frame ? 0 : 1), 6, 1, 9);
        break;
      }
      case 'T': {
        fill('#78c058');
        ctx.fillStyle = '#705030'; ctx.fillRect(6, 10, 4, 5);
        ctx.fillStyle = '#307838';
        ctx.beginPath(); ctx.arc(8, 6, 6.2, 0, 7); ctx.fill();
        ctx.fillStyle = '#409850';
        ctx.beginPath(); ctx.arc(6, 5, 3.4, 0, 7); ctx.fill();
        ctx.fillStyle = '#255c2c';
        ctx.beginPath(); ctx.arc(11, 8, 2.8, 0, 7); ctx.fill();
        break;
      }
      case 'W': {
        fill('#4880d8');
        ctx.fillStyle = '#68a0e8';
        const off = frame ? 2 : 0;
        for (let y = 2; y < 16; y += 5) { ctx.fillRect((y + off) % 10, y, 5, 1); }
        speckle('#3868b8', 6);
        break;
      }
      case 'R': {
        const rc = opts.roofColor || '#c85040';
        fill(rc);
        ctx.fillStyle = shade(rc, 0.72);
        for (let y = 3; y < 16; y += 4) ctx.fillRect(0, y, 16, 1);
        ctx.fillStyle = shade(rc, 1.25);
        for (let y = 1; y < 16; y += 4) ctx.fillRect(0, y, 16, 1);
        break;
      }
      case 'B': {
        fill('#e8e0c8');
        ctx.fillStyle = '#c8bc9c';
        for (let y = 4; y < 16; y += 5) ctx.fillRect(0, y, 16, 1);
        for (let x = 5; x < 16; x += 6) ctx.fillRect(x, 0, 1, 16);
        ctx.fillStyle = '#b0a480'; ctx.fillRect(0, 14, 16, 2);
        break;
      }
      case 'D': {
        fill('#e8e0c8');
        ctx.fillStyle = '#584028'; ctx.fillRect(2, 2, 12, 14);
        ctx.fillStyle = '#785838'; ctx.fillRect(4, 4, 8, 12);
        ctx.fillStyle = '#f0d060'; ctx.fillRect(10, 9, 2, 2);
        break;
      }
      case 'S': {
        fill('#78c058'); speckle('#68b048', 10);
        ctx.fillStyle = '#705030'; ctx.fillRect(7, 8, 2, 7);
        ctx.fillStyle = '#a87848'; ctx.fillRect(2, 2, 12, 7);
        ctx.fillStyle = '#785838'; ctx.fillRect(3, 3, 10, 5);
        break;
      }
      case 'F': {
        fill('#78c058');
        ctx.fillStyle = '#b89868';
        ctx.fillRect(2, 5, 2, 9); ctx.fillRect(12, 5, 2, 9);
        ctx.fillRect(0, 7, 16, 2);
        break;
      }
      case '^': {
        fill(opts.cave ? '#484058' : '#888078');
        speckle('#585068', 20); speckle('#686078', 12);
        ctx.fillStyle = '#302838'; ctx.fillRect(0, 13, 16, 3);
        break;
      }
      case 'c': fill('#706858'); speckle('#605848', 16); speckle('#807868', 8); break;
      case 'x': {
        fill('#706858'); speckle('#605848', 12);
        ctx.fillStyle = '#544c40';
        ctx.fillRect(3, 4 + (frame ? 1 : 0), 3, 3); ctx.fillRect(10, 9, 3, 3); ctx.fillRect(6, 12, 2, 2);
        break;
      }
      case '_': {
        fill('#e8d8b8');
        ctx.fillStyle = '#d0bc98';
        for (let y = 3; y < 16; y += 4) ctx.fillRect(0, y, 16, 1);
        break;
      }
      case '#': {
        fill('#a87848');
        ctx.fillStyle = '#8a5c34'; ctx.fillRect(0, 6, 16, 10);
        ctx.fillStyle = '#c89868'; ctx.fillRect(0, 0, 16, 3);
        break;
      }
      case 'M': {
        fill('#e8d8b8');
        ctx.fillStyle = '#98a8a8'; ctx.fillRect(2, 2, 12, 12);
        ctx.fillStyle = '#b8c8c8'; ctx.fillRect(4, 4, 8, 8);
        break;
      }
      case '=': {
        fill('#c84048');
        ctx.fillStyle = '#e0606a'; ctx.fillRect(2, 0, 12, 16);
        ctx.fillStyle = '#f0d060'; ctx.fillRect(2, 0, 1, 16); ctx.fillRect(13, 0, 1, 16);
        break;
      }
      case 'g': {
        fill('#e8d8b8');
        ctx.fillStyle = '#909890'; ctx.fillRect(4, 2, 8, 12);
        ctx.fillStyle = '#b8c0b8'; ctx.fillRect(5, 3, 4, 6);
        ctx.fillStyle = '#707870'; ctx.fillRect(3, 13, 10, 3);
        break;
      }
      default: fill('#101018');
    }
    tileCache.set(key, cv);
    return cv;
  }

  window.Sprites = { charCanvas, monCanvas, tileCanvas, shade, mix };
})();
