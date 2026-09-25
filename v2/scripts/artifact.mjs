/* ============================================================
 * claude.ai アーティファクト用に単一HTMLを整形する
 *   - アーティファクトは <!doctype>/<html>/<head>/<body> を自動で付けるので外す
 *   - Phaser は許可された CDN(jsdelivr)から読み込む(vite --mode artifact で外出し済み)
 * 入力: dist-artifact/index.html → 出力: dist-artifact/hekikan-battle.html
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/phaser/package.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'dist-artifact/index.html'), 'utf8');

const pick = (re) => { const m = html.match(re); return m ? m[0] : ''; };
const title = pick(/<title>[\s\S]*?<\/title>/);
const styles = html.match(/<style[\s\S]*?<\/style>/g) ?? [];
const scripts = html.match(/<script[\s\S]*?<\/script>/g) ?? [];
const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) ?? [, ''])[1]
  .replace(/<script[\s\S]*?<\/script>/g, '');
const cdn = `<script src="https://cdn.jsdelivr.net/npm/phaser@${pkg.version}/dist/phaser.min.js"></script>`;

const out = [title, ...styles, body.trim(), cdn, ...scripts].join('\n');
const dest = path.join(root, 'dist-artifact/hekikan-battle.html');
fs.writeFileSync(dest, out);
console.log(`artifact: ${path.relative(root, dest)} (${(out.length / 1024).toFixed(0)} KB, Phaser ${pkg.version} via jsdelivr)`);
