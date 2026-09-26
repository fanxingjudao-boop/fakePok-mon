/* ============================================================
 * ユーザー素材の下ごしらえ(背景除去 → 余白の切り詰め → 縮小 → WebP)
 *   入力: src/assets/user/**\/*.png(元画像はそのまま残す)
 *   出力: src/assets/cutout/<名前>.webp(これをコミットし、ビルドに同梱する)
 *   背景除去は AI(@imgly/background-removal-node、モデル同梱・オフライン)。
 *   重い(約760MB)ので依存には入れず、素材を変えたときだけ使う:
 *     npm i --no-save @imgly/background-removal-node@1.4.5
 *     npm run art:cutout            (変更のあった画像だけ処理)
 *     npm run art:cutout -- --all   (すべて作り直す)
 *   画像ごとの方法は src/assets/cutout.config.json で上書きできる(ml / key / vignette)。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src/assets/user');
const outDir = path.join(root, 'src/assets/cutout');
const config = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/cutout.config.json'), 'utf8'));
const all = process.argv.includes('--all');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : /\.(png|jpe?g|webp)$/i.test(e.name) ? [path.join(d, e.name)] : []);
const files = walk(srcDir).filter((f) => !only.length || only.includes(path.basename(f)));
fs.mkdirSync(outDir, { recursive: true });

let removeBackground = null;
async function ml(file) {
  if (!removeBackground) {
    try { ({ removeBackground } = await import('@imgly/background-removal-node')); }
    catch { throw new Error('背景除去ツールが未導入です: npm i --no-save @imgly/background-removal-node@1.4.5'); }
  }
  const blob = await removeBackground('file://' + file, { model: 'medium', output: { format: 'image/png', quality: 1 } });
  return Buffer.from(await blob.arrayBuffer());
}

/** 元の絵を残し、楕円のぼかしマスクで周囲を透明にする(体が背景と一体の絵向け) */
async function vignette(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // RGBA を直接組み立てる(ファイル由来の画像に joinChannel で生の α を足すと、α が黙って落ちるため)
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - w * 0.5) / (w * 0.5), dy = (y - h * 0.52) / (h * 0.5);
    const d = Math.sqrt(dx * dx + dy * dy);
    const a = d < 0.62 ? 1 : d > 1 ? 0 : 1 - (d - 0.62) / 0.38;
    const i = y * w + x;
    rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = Math.round(255 * a * a * (3 - 2 * a));
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * 背景色の塗りつぶし抜き: 画像の外周から背景色(外周の中央値)に近い色を塗りつぶしで広げ、
 * 届いた所だけを透明にする。線画に囲まれた白い体(白い毛並みなど)は残る。
 * AIが白い体を背景と誤認する絵向け。tol は色の近さ(0-441)。
 */
async function key(file, tol = 48) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const med = [0, 1, 2].map((c) => border.map((i) => data[i * 3 + c]).sort((a, b) => a - b)[border.length >> 1]);
  const near = (i) => Math.hypot(data[i * 3] - med[0], data[i * 3 + 1] - med[1], data[i * 3 + 2] - med[2]) < tol;
  const bg = new Uint8Array(w * h);
  const stack = border.filter(near);
  for (const i of stack) bg[i] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !bg[j] && near(j)) { bg[j] = 1; stack.push(j); }
    }
  }
  const mask = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = bg[i] ? 0 : 255;
  // blur は1チャンネル入力でも3チャンネルで返すので、0番だけ取り出す
  const soft = await sharp(mask, { raw: { width: w, height: h, channels: 1 } }).blur(1.1).extractChannel(0).raw().toBuffer();
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).joinChannel(soft, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

/** 透明な余白を切り詰めて(少し余白を残し)、長辺 maxSize に縮めて WebP へ */
async function finish(png, maxSize) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('透明になりすぎた(背景除去に失敗)');
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  const width = Math.min(info.width, x1 + pad + 1) - left, height = Math.min(info.height, y1 + pad + 1) - top;
  return sharp(png).extract({ left, top, width, height })
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88, alphaQuality: 92, effort: 5 }).toBuffer();
}

let done = 0, skipped = 0;
for (const file of files) {
  const name = path.basename(file);
  const out = path.join(outDir, name.replace(/\.(png|jpe?g|webp)$/i, '.webp'));
  if (!all && fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(file).mtimeMs) { skipped++; continue; }
  const cfg = config[name] ?? {};
  const t = Date.now();
  const png = cfg.mode === 'vignette' ? await vignette(file) : cfg.mode === 'key' ? await key(file, cfg.tol) : await ml(file);
  const webp = await finish(png, cfg.maxSize ?? 640);
  fs.writeFileSync(out, webp);
  done++;
  console.log(`${name.padEnd(24)} ${(cfg.mode ?? 'ml').padEnd(8)} → ${path.basename(out)} ${(webp.length / 1024).toFixed(0)}KB (${Date.now() - t}ms)`);
}
console.log(`処理 ${done} 件 / 変更なし ${skipped} 件`);
