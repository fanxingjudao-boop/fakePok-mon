/// <reference types="vite/client" />

/** .ink はビルド時に ink の JSON(文字列)へコンパイルされる(scripts/ink-plugin.ts) */
declare module '*.ink' {
  const json: string;
  export default json;
}
