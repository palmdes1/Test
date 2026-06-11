// Renders an MP4 showcase of the running movement.
// Usage: node tools/video.js [--out watch.mp4] [--fps 30] [--size 1080]
import puppeteer from 'puppeteer';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './server.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const OUT = args.out ?? 'watch.mp4';
const FPS = parseInt(args.fps ?? '30', 10);
const SIZE = parseInt(args.size ?? '1080', 10);
const T0 = 10 * 3600 + 9 * 60; // 10:09:00 — seconds hand starts at 12

// --- camera choreography: keyframes in seconds of video time ---------------
const KEYS = [
  { t: 0,  az: -45, el: 38, dist: 78, target: [0, 0, 2.5] },   // wide overview
  { t: 5,  az: -18, el: 44, dist: 68, target: [0, 0, 2.5] },   // slow orbit
  { t: 9,  az: -10, el: 62, dist: 18, target: [-9.5, -12.5, 3.2] }, // dive to escapement
  { t: 14, az: 18,  el: 64, dist: 16, target: [-9.5, -12.5, 3.2] }, // hold, drift (ticking)
  { t: 17, az: -30, el: 50, dist: 17, target: [-11.5, -16.7, 5.2] }, // balance & hairspring
  { t: 21, az: -45, el: 55, dist: 16, target: [-11.5, -16.7, 5.2] }, // hold, drift
  { t: 25, az: -10, el: 65, dist: 46, target: [0, -3, 4.0] },  // pull back over hands
  { t: 29, az: -35, el: 42, dist: 72, target: [0, 0, 2.5] },   // settle on overview
];
const DUR = KEYS[KEYS.length - 1].t;

const ease = (x) => x * x * (3 - 2 * x); // smoothstep
function camAt(vt) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (vt >= KEYS[i].t && vt <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  const span = b.t - a.t || 1;
  const s = ease(Math.min(Math.max((vt - a.t) / span, 0), 1));
  const lerp = (x, y) => x + (y - x) * s;
  return {
    az: lerp(a.az, b.az), el: lerp(a.el, b.el), dist: lerp(a.dist, b.dist),
    target: [0, 1, 2].map((i) => lerp(a.target[i], b.target[i])),
  };
}

// ---------------------------------------------------------------------------
const FRAMES_DIR = 'tmp/frames';
fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

const { server, port } = await startServer(0);
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/index.html?headless=1&t=${T0}`, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__READY === true', { timeout: 60000 });

const total = DUR * FPS;
const started = Date.now();
for (let i = 0; i < total; i++) {
  const vt = i / FPS;
  const cam = camAt(vt);
  await page.evaluate((o) => window.app.shoot(o), { ...cam, t: T0 + vt });
  await page.screenshot({ path: path.join(FRAMES_DIR, `f${String(i).padStart(4, '0')}.png`) });
  if (i % 60 === 0) {
    const rate = (i + 1) / ((Date.now() - started) / 1000);
    console.log(`frame ${i}/${total} (${rate.toFixed(1)} fps render, eta ${((total - i) / rate / 60).toFixed(1)} min)`);
  }
}
await browser.close();
server.close();

console.log('encoding...');
await new Promise((resolve, reject) => {
  const ff = spawn(ffmpegPath, [
    '-y', '-framerate', String(FPS), '-i', `${FRAMES_DIR}/f%04d.png`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
});
console.log('wrote', OUT);
