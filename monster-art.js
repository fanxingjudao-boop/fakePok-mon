/**
 * monster-art.js
 *
 * 28 species previously shared one random, mirrored blob generator.  This
 * module replaces it with deterministic 32x32 illustrations built from
 * species-specific anatomy.  The small canvas keeps the retro character of
 * the game while giving every evolutionary family a readable silhouette.
 */
(() => {
  'use strict';

  const SIZE = 32;
  const cache = new Map();
  const O = '#172033';

  const DESIGNS = {
    1:  { family: 'forest', stage: 1, primary: '#68b84f', secondary: '#b9df62', accent: '#754b2f' },
    2:  { family: 'forest', stage: 2, primary: '#438f4f', secondary: '#9ed457', accent: '#6b472f' },
    3:  { family: 'forest', stage: 3, primary: '#277657', secondary: '#75c95b', accent: '#d5b34b' },
    4:  { family: 'firecat', stage: 1, primary: '#ee7a3f', secondary: '#ffd087', accent: '#b72f2a' },
    5:  { family: 'firecat', stage: 2, primary: '#d65335', secondary: '#ffb85d', accent: '#79283a' },
    6:  { family: 'firecat', stage: 3, primary: '#a93b2f', secondary: '#f39a3e', accent: '#4d3548' },
    7:  { family: 'aquatic', stage: 1, primary: '#55aee5', secondary: '#d8f2ed', accent: '#246f9e' },
    8:  { family: 'aquatic', stage: 2, primary: '#318bc5', secondary: '#bde8df', accent: '#315e8e' },
    9:  { family: 'aquatic', stage: 3, primary: '#246da9', secondary: '#8bd9d2', accent: '#384f81' },
    10: { family: 'mouse', stage: 1, primary: '#c59a72', secondary: '#f0d4ad', accent: '#934f48' },
    11: { family: 'mouse', stage: 2, primary: '#936b5b', secondary: '#d9b68f', accent: '#603c45' },
    12: { family: 'bird', stage: 1, primary: '#7ba8d8', secondary: '#e7edf4', accent: '#d8a94d' },
    13: { family: 'bird', stage: 2, primary: '#466fae', secondary: '#c6d9eb', accent: '#e1b64c' },
    14: { family: 'flower', stage: 1, primary: '#75b95b', secondary: '#f7a8c4', accent: '#f4d45f' },
    15: { family: 'flower', stage: 2, primary: '#39885f', secondary: '#df72af', accent: '#f4d45f' },
    16: { family: 'beetle', stage: 1, primary: '#e1bd3c', secondary: '#4e516f', accent: '#91d6e8' },
    17: { family: 'beetle', stage: 2, primary: '#bd8d2b', secondary: '#303c63', accent: '#6fd3e7' },
    18: { family: 'rock', stage: 1, primary: '#9a8068', secondary: '#c5b19b', accent: '#5d5360' },
    19: { family: 'rock', stage: 3, primary: '#6e625c', secondary: '#ad987a', accent: '#61a879' },
    20: { family: 'ghost', stage: 1, primary: '#7d70bc', secondary: '#9ce5d5', accent: '#e48c61' },
    21: { family: 'ghost', stage: 2, primary: '#4e3d86', secondary: '#77d4c7', accent: '#d3656c' },
    22: { family: 'fish', stage: 1, primary: '#48aeca', secondary: '#d6f0dc', accent: '#f1bb55' },
    23: { family: 'fish', stage: 3, primary: '#277ca7', secondary: '#8fd6d2', accent: '#e3c35a' },
    24: { family: 'sparkcat', stage: 1, primary: '#e8bc38', secondary: '#fff0a5', accent: '#44517c' },
    25: { family: 'windlizard', stage: 1, primary: '#65b9a7', secondary: '#d4efe4', accent: '#5578a5' },
    26: { family: 'crab', stage: 1, primary: '#e36f59', secondary: '#ffd1a3', accent: '#4e8eb2' },
    27: { family: 'firehorse', stage: 1, primary: '#a85542', secondary: '#f3c17b', accent: '#ed5c2e' },
    28: { family: 'thunderbird', stage: 3, primary: '#4f568e', secondary: '#d9e4ef', accent: '#f1c538' }
  };

  const shade = (hex, factor) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255]
      .map((v) => Math.max(0, Math.min(255, Math.round(v * factor))));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };

  function ellipse(ctx, x, y, w, h, fill, stroke = O, line = 1.5) {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.stroke(); }
  }

  function poly(ctx, points, fill, stroke = O, line = 1.5) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.stroke(); }
  }

  function line(ctx, points, color = O, width = 2) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function eyes(ctx, y, wide = 4, color = '#f8faf7') {
    ellipse(ctx, 11 - wide / 2, y, wide, 4.5, color, O, 1);
    ellipse(ctx, 21 - wide / 2, y, wide, 4.5, color, O, 1);
    ellipse(ctx, 11.2, y + 1.4, 1.8, 2.5, '#172033', null);
    ellipse(ctx, 21.2, y + 1.4, 1.8, 2.5, '#172033', null);
  }

  function leaf(ctx, x, y, s, color) {
    poly(ctx, [[x, y + s], [x + s * .35, y], [x + s, y + s * .25], [x + s * .7, y + s]], color);
    line(ctx, [[x + s * .2, y + s * .75], [x + s * .75, y + s * .25]], shade(color, .65), 1);
  }

  function flame(ctx, x, y, s, outer, inner = '#ffd45c') {
    poly(ctx, [[x, y + s], [x + s * .18, y + s * .35], [x + s * .45, y + s * .55],
      [x + s * .68, y], [x + s, y + s * .55], [x + s * .78, y + s]], outer);
    poly(ctx, [[x + s * .3, y + s * .85], [x + s * .48, y + s * .45],
      [x + s * .7, y + s * .85]], inner, null);
  }

  function backMark(ctx, d) {
    poly(ctx, [[16, 11], [20, 16], [16, 22], [12, 16]], d.accent, shade(d.primary, .55), 1);
  }

  function drawForest(ctx, d, back) {
    const s = d.stage;
    if (s === 3) {
      poly(ctx, [[5, 15], [1, 8], [10, 12], [13, 4], [17, 12]], d.secondary);
      poly(ctx, [[27, 15], [31, 8], [22, 12], [19, 4], [15, 12]], d.secondary);
      line(ctx, [[9, 13], [5, 6]], d.accent, 2);
      line(ctx, [[23, 13], [27, 6]], d.accent, 2);
    }
    ellipse(ctx, 7 - s, 11, 18 + s * 2, 15, d.primary);
    ellipse(ctx, 8, 8, 16, 14, d.primary);
    if (s < 3) {
      poly(ctx, [[9, 11], [8, 4], [13, 9]], d.secondary);
      poly(ctx, [[23, 11], [24, 4], [19, 9]], d.secondary);
    }
    leaf(ctx, 13 - s, 1, 8 + s, d.secondary);
    ellipse(ctx, 7, 22, 6, 6, d.accent);
    ellipse(ctx, 19, 22, 6, 6, d.accent);
    if (!back) { eyes(ctx, 13); ellipse(ctx, 14.5, 18, 3, 2, d.accent, null); }
    else backMark(ctx, d);
  }

  function drawFireCat(ctx, d, back) {
    const s = d.stage;
    const mane = s >= 2 ? (s === 3 ? 4 : 2) : 0;
    flame(ctx, 24, 13, 8 + s, d.accent);
    if (mane) poly(ctx, [[7, 19], [3, 15], [7, 12], [5, 7], [11, 8], [16, 4],
      [21, 8], [27, 7], [25, 13], [29, 16], [24, 20]], d.accent);
    ellipse(ctx, 7, 10, 18, 16, d.primary);
    poly(ctx, [[9, 12], [8, 4], [14, 10]], d.primary);
    poly(ctx, [[23, 12], [24, 4], [18, 10]], d.primary);
    poly(ctx, [[10, 10], [9, 6], [13, 10]], d.secondary, null);
    poly(ctx, [[22, 10], [23, 6], [19, 10]], d.secondary, null);
    ellipse(ctx, 8, 22, 6, 6, shade(d.primary, .7));
    ellipse(ctx, 18, 22, 6, 6, shade(d.primary, .7));
    if (s === 3) poly(ctx, [[9, 24], [5, 28], [13, 27]], d.accent);
    if (!back) {
      eyes(ctx, 13, s === 1 ? 4 : 3.5, '#fff1cf');
      poly(ctx, [[16, 17], [14, 19], [18, 19]], shade(d.accent, .75), null);
      line(ctx, [[12, 20], [7, 19]], O, 1); line(ctx, [[20, 20], [25, 19]], O, 1);
    } else backMark(ctx, d);
  }

  function drawAquatic(ctx, d, back) {
    const s = d.stage;
    if (s === 3) {
      line(ctx, [[7, 17], [2, 8], [4, 4]], d.accent, 3);
      line(ctx, [[25, 17], [30, 8], [28, 4]], d.accent, 3);
      poly(ctx, [[13, 9], [16, 2], [19, 9]], d.secondary);
    }
    ellipse(ctx, 6, 11, 20, 15, d.primary);
    ellipse(ctx, 8, 7, 16, 14, d.primary);
    if (s === 1) {
      ellipse(ctx, 6, 11, 5, 9, d.secondary);
      ellipse(ctx, 21, 11, 5, 9, d.secondary);
    } else {
      ellipse(ctx, 9, 13, 14, 12, d.accent);
      line(ctx, [[12, 15], [20, 22]], d.secondary, 1.5);
      line(ctx, [[20, 15], [12, 22]], d.secondary, 1.5);
    }
    poly(ctx, [[7, 23], [2, 26], [8, 28]], d.primary);
    poly(ctx, [[25, 23], [30, 26], [24, 28]], d.primary);
    if (!back) { eyes(ctx, 11); ellipse(ctx, 13, 16, 6, 5, d.secondary); ellipse(ctx, 15, 17, 2, 2, O, null); }
    else backMark(ctx, d);
  }

  function drawMouse(ctx, d, back) {
    const s = d.stage;
    line(ctx, [[24, 21], [29, 18], [30, 11], [27, 8]], d.accent, s === 1 ? 1.5 : 2.5);
    ellipse(ctx, 7 - s, 11, 18 + s * 2, 15, d.primary);
    ellipse(ctx, 9, 7, 14, 13, d.primary);
    ellipse(ctx, 7, 5, 7, 7, d.secondary);
    ellipse(ctx, 18, 5, 7, 7, d.secondary);
    ellipse(ctx, 8, 23, 7, 4, d.secondary);
    ellipse(ctx, 18, 23, 7, 4, d.secondary);
    if (!back) { eyes(ctx, 11, 3.5); poly(ctx, [[16, 17], [14, 19], [18, 19]], d.accent, null); }
    else backMark(ctx, d);
  }

  function drawBird(ctx, d, back, thunder = false) {
    const s = d.stage;
    const wing = thunder ? d.accent : d.primary;
    poly(ctx, [[11, 13], [3, 8], [1, 18], [9, 22], [13, 18]], wing);
    poly(ctx, [[21, 13], [29, 8], [31, 18], [23, 22], [19, 18]], wing);
    ellipse(ctx, 10, 8, 12, 18, d.primary);
    ellipse(ctx, 10, 5, 12, 12, d.secondary);
    if (s >= 2) poly(ctx, [[13, 7], [16, 1], [18, 7]], d.accent);
    poly(ctx, [[14, 14], [18, 14], [16, 18]], d.accent);
    poly(ctx, [[12, 24], [9, 30], [16, 26]], shade(d.primary, .7));
    poly(ctx, [[20, 24], [23, 30], [16, 26]], shade(d.primary, .7));
    if (thunder) {
      poly(ctx, [[4, 9], [9, 11], [6, 15], [12, 16]], d.accent, null);
      poly(ctx, [[28, 9], [23, 11], [26, 15], [20, 16]], d.accent, null);
    }
    if (!back) { eyes(ctx, 9, 3.5); poly(ctx, [[16, 14], [20, 16], [16, 18]], d.accent); }
    else backMark(ctx, d);
  }

  function drawFlower(ctx, d, back) {
    const s = d.stage;
    for (let i = 0; i < (s === 1 ? 5 : 7); i++) {
      const a = i / (s === 1 ? 5 : 7) * Math.PI * 2;
      ellipse(ctx, 12 + Math.cos(a) * 6, 5 + Math.sin(a) * 5, 8, 8, d.secondary);
    }
    ellipse(ctx, 12, 7, 8, 8, d.accent);
    ellipse(ctx, 10, 13, 12, 13, d.primary);
    leaf(ctx, 4, 15, 9, d.primary); leaf(ctx, 20, 15, 9, d.primary);
    if (s === 2) poly(ctx, [[12, 23], [5, 29], [16, 27], [27, 29], [20, 23]], d.secondary);
    if (!back) { eyes(ctx, 14, 3); ellipse(ctx, 15, 20, 2, 1.5, O, null); }
    else backMark(ctx, d);
  }

  function drawBeetle(ctx, d, back) {
    const s = d.stage;
    line(ctx, [[9, 14], [4, 10]], d.secondary, 2); line(ctx, [[23, 14], [28, 10]], d.secondary, 2);
    line(ctx, [[9, 19], [3, 21]], d.secondary, 2); line(ctx, [[23, 19], [29, 21]], d.secondary, 2);
    ellipse(ctx, 8, 8, 16, 19, d.primary);
    line(ctx, [[16, 10], [16, 26]], d.secondary, 1);
    if (s === 1) poly(ctx, [[13, 10], [16, 4], [19, 10]], d.secondary);
    else poly(ctx, [[12, 11], [8, 3], [15, 7], [16, 1], [17, 7], [24, 3], [20, 11]], d.secondary);
    if (!back) { eyes(ctx, 11, 3, '#dff8ff'); }
    else backMark(ctx, d);
  }

  function drawRock(ctx, d, back) {
    const s = d.stage;
    poly(ctx, [[7 - s, 14], [4, 9], [10, 3], [16, 5], [22, 2], [28, 10],
      [26 + s, 20], [22, 27], [10, 27], [4, 21]], d.primary);
    poly(ctx, [[9, 8], [15, 6], [13, 13]], d.secondary, null);
    poly(ctx, [[20, 8], [25, 10], [21, 15]], shade(d.primary, .7), null);
    if (s === 3) { ellipse(ctx, 1, 17, 9, 9, d.primary); ellipse(ctx, 22, 17, 9, 9, d.primary); }
    if (!back) { eyes(ctx, 13, 3.5, '#f6d77a'); line(ctx, [[13, 21], [19, 21]], O, 1.5); }
    else backMark(ctx, d);
  }

  function drawGhost(ctx, d, back) {
    const s = d.stage;
    flame(ctx, 8, 4, 16, d.secondary, d.primary);
    poly(ctx, [[7, 14], [10, 8], [22, 8], [25, 14], [24, 24], [21, 28], [18, 24],
      [15, 29], [12, 24], [8, 27]], d.primary);
    if (s === 2) {
      poly(ctx, [[8, 15], [2, 18], [8, 21]], d.secondary);
      poly(ctx, [[24, 15], [30, 18], [24, 21]], d.secondary);
    }
    if (!back) { eyes(ctx, 13, 4, '#b9fff2'); poly(ctx, [[13, 21], [16, 23], [19, 21]], d.accent, null); }
    else backMark(ctx, d);
  }

  function drawFish(ctx, d, back) {
    const s = d.stage;
    if (s === 3) {
      poly(ctx, [[8, 16], [2, 7], [3, 18], [1, 26], [10, 20]], d.secondary);
      poly(ctx, [[22, 13], [27, 4], [28, 16], [31, 24], [22, 21]], d.secondary);
    } else poly(ctx, [[7, 16], [1, 10], [2, 22]], d.secondary);
    ellipse(ctx, 6, 10, 21, 14, d.primary);
    poly(ctx, [[13, 11], [17, 5], [20, 12]], d.secondary);
    poly(ctx, [[14, 23], [19, 28], [21, 22]], d.secondary);
    if (!back) { ellipse(ctx, 21, 13, 4, 4, '#f8faf7'); ellipse(ctx, 22, 14, 2, 2, O, null); }
    else backMark(ctx, d);
  }

  function drawSparkCat(ctx, d, back) {
    poly(ctx, [[8, 12], [6, 3], [14, 10]], d.primary);
    poly(ctx, [[24, 12], [26, 3], [18, 10]], d.primary);
    ellipse(ctx, 7, 9, 18, 17, d.primary);
    line(ctx, [[24, 21], [29, 17], [26, 13], [31, 9]], d.accent, 3);
    poly(ctx, [[12, 7], [15, 11], [13, 14], [18, 18]], d.accent, null);
    ellipse(ctx, 8, 23, 6, 5, d.secondary); ellipse(ctx, 19, 23, 6, 5, d.secondary);
    if (!back) { eyes(ctx, 12, 3.5); poly(ctx, [[16, 18], [14, 20], [18, 20]], d.accent, null); }
    else backMark(ctx, d);
  }

  function drawWindLizard(ctx, d, back) {
    line(ctx, [[8, 21], [3, 25], [1, 20]], d.accent, 2);
    ellipse(ctx, 7, 10, 19, 14, d.primary);
    ellipse(ctx, 17, 7, 10, 10, d.primary);
    poly(ctx, [[12, 13], [4, 8], [7, 17]], d.secondary);
    poly(ctx, [[17, 13], [13, 5], [21, 10]], d.secondary);
    ellipse(ctx, 9, 21, 6, 5, d.accent); ellipse(ctx, 20, 20, 6, 5, d.accent);
    if (!back) { ellipse(ctx, 22, 10, 3.5, 3.5, '#f8faf7'); ellipse(ctx, 23, 11, 1.5, 2, O, null); }
    else backMark(ctx, d);
  }

  function drawCrab(ctx, d, back) {
    ellipse(ctx, 7, 11, 18, 14, d.primary);
    line(ctx, [[10, 21], [5, 27]], d.accent, 2); line(ctx, [[22, 21], [27, 27]], d.accent, 2);
    line(ctx, [[9, 18], [3, 18]], d.primary, 3); line(ctx, [[23, 18], [29, 18]], d.primary, 3);
    ellipse(ctx, 0, 12, 8, 8, d.primary); ellipse(ctx, 24, 12, 8, 8, d.primary);
    line(ctx, [[4, 12], [1, 8]], O, 1); line(ctx, [[28, 12], [31, 8]], O, 1);
    if (!back) { ellipse(ctx, 10, 8, 5, 6, d.secondary); ellipse(ctx, 17, 8, 5, 6, d.secondary); eyes(ctx, 9, 3); }
    else backMark(ctx, d);
  }

  function drawFireHorse(ctx, d, back) {
    flame(ctx, 4, 4, 12, d.accent);
    flame(ctx, 23, 14, 9, d.accent);
    ellipse(ctx, 7, 11, 19, 13, d.primary);
    ellipse(ctx, 6, 6, 12, 12, d.primary);
    poly(ctx, [[8, 8], [6, 2], [12, 7]], d.primary);
    poly(ctx, [[15, 8], [17, 2], [12, 7]], d.primary);
    line(ctx, [[10, 22], [9, 29]], shade(d.primary, .65), 3);
    line(ctx, [[21, 22], [23, 29]], shade(d.primary, .65), 3);
    if (!back) { ellipse(ctx, 9, 9, 3.5, 3.5, '#f8faf7'); ellipse(ctx, 10, 10, 1.5, 2, O, null); }
    else backMark(ctx, d);
  }

  function renderSpecies(ctx, d, back) {
    switch (d.family) {
      case 'forest': return drawForest(ctx, d, back);
      case 'firecat': return drawFireCat(ctx, d, back);
      case 'aquatic': return drawAquatic(ctx, d, back);
      case 'mouse': return drawMouse(ctx, d, back);
      case 'bird': return drawBird(ctx, d, back, false);
      case 'flower': return drawFlower(ctx, d, back);
      case 'beetle': return drawBeetle(ctx, d, back);
      case 'rock': return drawRock(ctx, d, back);
      case 'ghost': return drawGhost(ctx, d, back);
      case 'fish': return drawFish(ctx, d, back);
      case 'sparkcat': return drawSparkCat(ctx, d, back);
      case 'windlizard': return drawWindLizard(ctx, d, back);
      case 'crab': return drawCrab(ctx, d, back);
      case 'firehorse': return drawFireHorse(ctx, d, back);
      case 'thunderbird': return drawBird(ctx, d, back, true);
      default: return drawForest(ctx, d, back);
    }
  }

  function monCanvas(spId, back = false) {
    const key = `${spId}:${back ? 'back' : 'front'}`;
    if (cache.has(key)) return cache.get(key);
    const cv = document.createElement('canvas');
    cv.width = SIZE;
    cv.height = SIZE;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const d = DESIGNS[spId] || DESIGNS[1];
    renderSpecies(ctx, d, back);
    cache.set(key, cv);
    return cv;
  }

  if (!window.Sprites) throw new Error('monster-art.js must load after sprites.js');
  window.Sprites.legacyMonCanvas = window.Sprites.monCanvas;
  window.Sprites.monCanvas = monCanvas;
  window.Sprites.monSpriteSize = SIZE;
})();
