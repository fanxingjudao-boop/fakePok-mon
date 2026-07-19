const assert = require('node:assert/strict');

const noop = () => {};
const context = {
  beginPath: noop,
  closePath: noop,
  moveTo: noop,
  lineTo: noop,
  ellipse: noop,
  fill: noop,
  stroke: noop,
  imageSmoothingEnabled: false,
  lineJoin: 'round',
  lineCap: 'round',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1
};

global.window = {
  Sprites: {
    monCanvas: () => ({ width: 16, height: 16 })
  }
};

global.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return {
      width: 0,
      height: 0,
      getContext(type) {
        assert.equal(type, '2d');
        return { ...context };
      }
    };
  }
};

require('../monster-art.js');

assert.equal(window.Sprites.monSpriteSize, 32);
assert.equal(typeof window.Sprites.legacyMonCanvas, 'function');

for (let id = 1; id <= 28; id++) {
  for (const back of [false, true]) {
    const sprite = window.Sprites.monCanvas(id, back);
    assert.equal(sprite.width, 32, `species ${id} width`);
    assert.equal(sprite.height, 32, `species ${id} height`);
    assert.equal(window.Sprites.monCanvas(id, back), sprite, `species ${id} cache`);
  }
}

console.log('monster-art smoke test: 28 front/back sprites rendered');
