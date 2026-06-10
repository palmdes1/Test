// Headless screenshot tool.
// Usage: node tools/capture.js --label iter-001 [--time 36570] [--views a,b,c]
//        [--seq view:t0:dt:n]  (animation sequence frames)
//        [--out iterations]    [--size 1200]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { startServer } from './server.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}

const label = args.label ?? 'shot';
const outDir = args.out ?? 'iterations';
const size = parseInt(args.size ?? '1200', 10);
const t = parseFloat(args.time ?? `${10 * 3600 + 9 * 60 + 30}`); // 10:09:30
const views = (args.views ?? 'overview,topdown,escapement,balance,train,barrel,motion,side,hands').split(',');

fs.mkdirSync(outDir, { recursive: true });

const { server, port } = await startServer(0);
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/index.html?headless=1&t=${t}`, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__READY === true', { timeout: 60000 });

const hideBridges = args.hide === '1';
for (const view of views) {
  // hud on the "hands" verification shot so the displayed time is provable
  const wantHud = view === 'hands';
  await page.evaluate((v, tt, hud, hb) => window.app.shoot({ view: v, t: tt, hud, hideBridges: hb }),
    view, t, wantHud, hideBridges);
  const file = `${outDir}/${label}-${view}.png`;
  await page.screenshot({ path: file });
  console.log('saved', file);
}

// optional custom shots: --custom "name:tx:ty:tz:az:el:dist[;name2:...]"
if (args.custom) {
  for (const spec of args.custom.split(';')) {
    const [name, tx, ty, tz, az, el, dist] = spec.split(':');
    await page.evaluate((o) => window.app.shoot(o), {
      target: [parseFloat(tx), parseFloat(ty), parseFloat(tz)],
      az: parseFloat(az), el: parseFloat(el), dist: parseFloat(dist),
      t, hideBridges,
    });
    const file = `${outDir}/${label}-${name}.png`;
    await page.screenshot({ path: file });
    console.log('saved', file);
  }
}

// optional animation sequence: --seq escapement:36570:0.04:10
if (args.seq) {
  const [view, t0, dt, n] = args.seq.split(':');
  for (let i = 0; i < parseInt(n, 10); i++) {
    const tt = parseFloat(t0) + i * parseFloat(dt);
    await page.evaluate((v, x, hb) => window.app.shoot({ view: v, t: x, hideBridges: hb }), view, tt, hideBridges);
    const file = `${outDir}/${label}-seq-${view}-${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: file });
    console.log('saved', file);
  }
}

await browser.close();
server.close();
