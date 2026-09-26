/* ============================================================
 * 素材の一覧画像(背景除去の仕上がり確認用)
 *   暗い背景に並べるので、透過の抜け残りや欠けが見つけやすい。
 *   実行: npm run art:sheet  → test-results/art-sheet.jpg
 * ============================================================ */
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path';
const [dir = "src/assets/cutout", out = "test-results/art-sheet.jpg", W = 170, H = 240] = process.argv.slice(2).map((v, i) => (i >= 2 ? +v : v));
fs.mkdirSync(path.dirname(out), { recursive: true });
const files = fs.readdirSync(dir).filter(f => /\.(png|webp)$/.test(f)).sort();
const cols = 9, comps = [];
for (const [i, f] of files.entries()) {
  const buf = await sharp(path.join(dir, f)).resize(W - 8, H - 26, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  comps.push({ input: buf, left: (i % cols) * W + 4, top: Math.floor(i / cols) * H + 4 });
  comps.push({ input: Buffer.from(`<svg width="${W}" height="20"><text x="5" y="15" font-size="13" fill="#cfe" font-family="sans-serif">${f.replace('.webp','')}</text></svg>`), left: (i % cols) * W, top: Math.floor(i / cols) * H + H - 21 });
}
await sharp({ create: { width: cols * W, height: Math.ceil(files.length / cols) * H, channels: 3, background: '#1d3a2e' } }).composite(comps).jpeg({ quality: 85 }).toFile(out);
