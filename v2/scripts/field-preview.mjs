/* ============================================================
 * フィールドの絵のスクリーンショット
 *   Vite の開発サーバで scripts/field-preview.html を開き、組み立てた地図を
 *   test-results/field-*.png に保存する。renderGround の時間も表示する。
 *   実行: npm run art:field   (PW_CHROMIUM で Chromium の場所を変えられる)
 * ============================================================ */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS || path.join(root, 'test-results');
fs.mkdirSync(shots, { recursive: true });

const server = await createServer({ root, logLevel: 'warn', server: { host: '127.0.0.1', port: 5174 } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: (process.env.PW_ARGS || '').split(' ').filter(Boolean) });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[prof]')) console.log('[page]', m.text()); });
  page.on('pageerror', (e) => { failed = true; console.log('[pageerror]', e.message); });
  // BENCH=trail: renderGround だけを測る。PROFILE=1 で CPU プロファイルの上位も出す
  const benchId = process.env.BENCH;
  const cdp = process.env.PROFILE ? await page.context().newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  await page.goto(base + 'scripts/field-preview.html' + (benchId ? `?bench=${benchId}` : ''));
  await page.waitForFunction(() => window.__field?.done, null, { timeout: 300000 });
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const dt = (profile.endTime - profile.startTime) / profile.samples.length / 1000;
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const cnt = new Map();
    for (const sid of profile.samples) cnt.set(sid, (cnt.get(sid) || 0) + 1);
    for (const [sid, c] of cnt) {
      const n = byId.get(sid);
      const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + c * dt);
    }
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${v.toFixed(0).padStart(6)} ms  ${k}`);
  }
  const err = await page.evaluate(() => window.__field.error);
  if (err) { failed = true; console.log(err); }
  const names = await page.evaluate(() => window.__field.outputs.map((o) => o.name));
  for (const name of names) {
    const url = await page.evaluate((n) => window.__field.outputs.find((o) => o.name === n).url, name);
    fs.writeFileSync(path.join(shots, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('saved', path.join(path.relative(root, shots), name));
  }
  for (const line of await page.evaluate(() => window.__field.report)) console.log(line);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
