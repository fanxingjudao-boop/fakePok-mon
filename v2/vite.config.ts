import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// 通常ビルド: Phaser を同梱した 完全オフラインの単一HTML(dist/index.html)
// artifact ビルド: Phaser を CDN(jsdelivr)のグローバルから読む版(dist-artifact/)
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    base: './',
    plugins: [viteSingleFile()],
    resolve: artifact
      ? { alias: { phaser: fileURLToPath(new URL('./src/lib/phaser-global.ts', import.meta.url)) } }
      : {},
    build: {
      outDir: artifact ? 'dist-artifact' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 4000,
    },
  };
});
