// artifact ビルド専用: CDN から読み込んだ window.Phaser を ESM の default として渡す。
import type PhaserType from 'phaser';

const g = globalThis as unknown as { Phaser: typeof PhaserType };
export default g.Phaser;
