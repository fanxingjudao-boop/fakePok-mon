/* ============================================================
 * Vite プラグイン: .ink を読み込むと、ビルド時にコンパイルした JSON 文字列になる。
 *   import story from './chapter1.ink';   // → ink の JSON(文字列)
 *   INCLUDE は同じフォルダからの相対パスで解決する。エラーはビルドを止める。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { Compiler, CompilerOptions } from 'inkjs/full';
import type { Plugin } from 'vite';

export function compileInk(file: string): { json: string; files: string[]; warnings: string[] } {
  const dir = path.dirname(file);
  const files: string[] = [file];
  const handler = {
    ResolveInkFilename: (name: string) => path.resolve(dir, name),
    LoadInkFileContents: (name: string) => {
      const p = path.resolve(dir, name);
      files.push(p);
      return fs.readFileSync(p, 'utf8');
    },
  };
  const errors: string[] = [];
  const opts = new CompilerOptions(file, [], false, (msg: string) => { errors.push(msg); }, handler);
  const c = new Compiler(fs.readFileSync(file, 'utf8'), opts);
  const story = c.Compile();
  const all = [...errors, ...c.errors];
  if (all.length || !story) throw new Error(`ink のコンパイルに失敗: ${path.basename(file)}\n${all.join('\n')}`);
  return { json: story.ToJson() ?? '', files, warnings: c.warnings };
}

export function inkPlugin(): Plugin {
  return {
    name: 'hekikan-ink',
    transform(_code, id) {
      if (!id.endsWith('.ink')) return null;
      const { json, files, warnings } = compileInk(id);
      for (const f of files) this.addWatchFile(f);
      for (const w of warnings) this.warn(w);
      return { code: `export default ${JSON.stringify(json)};`, map: null };
    },
  };
}
