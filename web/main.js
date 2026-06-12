// Browser game: keyboard-driven 1/10 TC on oval / figure-8, driver's stand view.

import { Car } from '../sim/car.js';
import { TC_PARAMS, TC_PARAMS_MOD } from '../sim/params.js';
import { buildTrack, trackGeometry } from '../sim/track.js';
import { Driver, computeRacingLine } from '../sim/driver.js';
import { World } from '../sim/world.js';
import { makeSurface } from '../sim/surface.js';
import { StandCamera, drawScene, prepareGeometry, buildCarPolys, centroid } from './render.js';
import { CarSound } from './sound.js';
import { RadioInput } from './input.js';
import { buildPanel, loadSetup, applySetup } from './setup.js';

const sound = new CarSound();
const radio = new RadioInput();
let setupVals = loadSetup();

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

let trackName = 'oval';
let motorClass = 'stock';
let track, world, car, camera, scenery, driver, params, aiMode = false;

function grooveDecals(track) {
  const line = computeRacingLine(track);
  const out = [];
  const half = 0.28, n = line.n;
  for (let i = 0; i < n; i += 4) {
    const j = (i + 4) % n;
    const tx = line.px[j] - line.px[i], ty = line.py[j] - line.py[i];
    const l = Math.hypot(tx, ty) || 1;
    const nx = -ty / l, ny = tx / l;
    out.push({
      kind: 'ground', color: [52, 52, 57],
      pts: [
        [line.px[i] + nx * half, line.py[i] + ny * half, 0.001],
        [line.px[j] + nx * half, line.py[j] + ny * half, 0.001],
        [line.px[j] - nx * half, line.py[j] - ny * half, 0.001],
        [line.px[i] - nx * half, line.py[i] - ny * half, 0.001]
      ]
    });
  }
  return out;
}

function setTrack(name) {
  trackName = name;
  track = buildTrack(name);
  params = applySetup(motorClass === 'mod' ? TC_PARAMS_MOD : TC_PARAMS, setupVals);
  car = new Car(params);
  const opts = motorClass === 'mod'
    ? { speed: { ayMax: 24.6, axBrake: 20.5, axAccel: 18, vTop: 35 }, kp: 1.2,
        line: { margin: 0.24, iterations: 2000 } }
    : { speed: { ayMax: 21, axBrake: 15, axAccel: 12, vTop: 19 }, kp: 1.2,
        line: { margin: 0.24, iterations: 2000 } };
  // scale AI limits to the chosen setup (compound grip, weight)
  const aiScale = Math.pow(setupVals.compound / 100, 2)
    * Math.pow(1380 / setupVals.massG, 0.25)
    * (setupVals.frontDiff === 'gear' ? 0.92 : 1);  // gear diff is a handful
  opts.speed.ayMax *= aiScale;
  opts.speed.axBrake *= aiScale;
  opts.speed.axAccel *= aiScale;
  world = new World(track, car);
  driver = new Driver(track, car, opts);
  car.surfaceFn = makeSurface(track, driver.line);
  world.placeAtStart(1.0);
  camera = new StandCamera(track.stand);
  scenery = prepareGeometry([...trackGeometry(track), ...grooveDecals(track)]);
  document.getElementById('trackname').textContent =
    `${name.toUpperCase()} — ${params.name}`;
}

// --- input: keyboard with analog-feel ramps ---
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  sound.ensure();
  if (e.code === 'KeyR') world.placeAtStart(1.0);
  if (e.code === 'KeyC') camera.mode = camera.mode === 'stand' ? 'chase' : camera.mode === 'chase' ? 'top' : 'stand';
  if (e.code === 'KeyA') aiMode = !aiMode;
  if (e.code === 'Digit1') { motorClass = 'stock'; setTrack('oval'); }
  if (e.code === 'Digit2') { motorClass = 'stock'; setTrack('figure8'); }
  if (e.code === 'Digit3') { motorClass = 'mod'; setTrack('luxembourg'); }
  if (e.code === 'KeyM') {
    motorClass = motorClass === 'mod' ? 'stock' : 'mod';
    setTrack(trackName);
  }
  if (e.code === 'KeyG') {
    if (!radio.wizard) radio.startCalibration();
    else radio.advanceCalibration();
  }
  if (e.code === 'KeyT') {
    const p = document.getElementById('setupPanel');
    p.style.display = p.style.display === 'block' ? 'none' : 'block';
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

let steerIn = 0, thrIn = 0;
function readControls(dt) {
  const r = radio.read();
  if (r) {
    car.setControls(r.steer, r.brake > 0.05 ? 0 : r.throttle, r.brake);
    return;
  }
  const sTgt = (keys.ArrowLeft || keys.KeyJ ? 1 : 0) + (keys.ArrowRight || keys.KeyL ? -1 : 0);
  const sRate = sTgt !== 0 ? 7 : 10; // snap back to center faster
  steerIn += Math.max(-sRate * dt, Math.min(sRate * dt, sTgt - steerIn));
  const tTgt = (keys.ArrowUp || keys.KeyW ? 1 : 0);
  const brk = (keys.ArrowDown || keys.KeyS || keys.Space) ? 1 : 0;
  thrIn += Math.max(-8 * dt, Math.min(4 * dt, tTgt - thrIn));
  car.setControls(steerIn, brk ? 0 : thrIn, brk);
}

// --- HUD ---
function hud() {
  const w = canvas.width, h = canvas.height;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = 'rgba(10,12,18,0.85)';
  ctx.fillRect(16, 16, 250, 96);
  ctx.fillStyle = '#fff';
  ctx.fillText(world.lap === 0 ? 'OUT LAP' : `LAP ${world.lap}`, 30, 46);
  ctx.fillStyle = '#7aff8c';
  ctx.fillText(world.currentLapTime.toFixed(2), 30, 80);
  ctx.font = '14px sans-serif';
  if (world.lapTimes.length) {
    ctx.fillStyle = '#ffd778';
    ctx.fillText(`BEST ${Math.min(...world.lapTimes).toFixed(2)}`, 30, 102);
    ctx.fillStyle = '#b4c8ff';
    ctx.fillText(`LAST ${world.lapTimes[world.lapTimes.length - 1].toFixed(2)}`, 130, 102);
  }
  // speed + pedals
  ctx.fillStyle = 'rgba(10,12,18,0.85)';
  ctx.fillRect(16, h - 96, 250, 80);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(`${(car.speed * 3.6).toFixed(1)} km/h`, 30, h - 64);
  ctx.fillStyle = '#39c853';
  ctx.fillRect(30, h - 48, 150 * car.throttle, 8);
  ctx.fillStyle = '#e64636';
  ctx.fillRect(190, h - 48, 60 * car.brake, 8);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(30, h - 48, 150, 8);
  ctx.strokeRect(190, h - 48, 60, 8);
  // steering dot
  ctx.strokeStyle = '#666';
  ctx.beginPath(); ctx.moveTo(60, h - 28); ctx.lineTo(180, h - 28); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(120 - car.steer / params.maxSteer * 60, h - 28, 5, 0, 7);
  ctx.fill();
  if (aiMode) {
    ctx.fillStyle = '#ffd778';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('AI DRIVING (press A to take over)', w / 2 - 130, 30);
  }
  const prompt = radio.wizardPrompt();
  if (prompt) {
    ctx.fillStyle = '#ffd778';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(prompt, w / 2 - 280, h / 2);
  } else if (radio.connected && radio.cal) {
    ctx.fillStyle = '#7aff8c';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('RADIO', 220, h - 76);
  }
  // minimap
  const mmW = 200, mmH = 140, mx = w - mmW - 16, my = 16;
  ctx.fillStyle = 'rgba(10,12,18,0.85)';
  ctx.fillRect(mx, my, mmW, mmH);
  const pts = track.pts;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of pts) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const sc = (Math.min(mmW, mmH) - 26) / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2, cyy = (minY + maxY) / 2;
  const mp = p => [mx + mmW / 2 + (p[0] - cx) * sc, my + mmH / 2 - (p[1] - cyy) * sc];
  ctx.strokeStyle = '#788090'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 4) {
    const [px, py] = mp(pts[i]);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.stroke();
  const [cpx, cpy] = mp([car.x, car.y]);
  ctx.fillStyle = '#ff7828';
  ctx.beginPath(); ctx.arc(cpx, cpy, 4, 0, 7); ctx.fill();
}

// --- main loop ---
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  world.step(dt, () => {
    if (aiMode) driver.update();
    else readControls(dt);
  });

  camera.update(car, dt);
  sound.update(car);
  const B = camera.basis(canvas.width, canvas.height);
  const carPolys = buildCarPolys(params, car).map(p => ({ ...p, cen: centroid(p.pts) }));
  // contact shadow
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const hl = params.halfLength * 1.05, hw = params.halfWidth * 1.15;
  const shadow = {
    color: [40, 40, 45],
    pts: [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([lx, ly]) =>
      [car.x + lx * cy - ly * sy, car.y + lx * sy + ly * cy, 0.0099])
  };
  shadow.cen = centroid(shadow.pts);
  drawScene(ctx, B, [...scenery.ground, shadow], [...scenery.solid, ...carPolys]);
  hud();
  requestAnimationFrame(frame);
}

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}
addEventListener('resize', resize);
resize();
buildPanel(document.getElementById('setupPanel'), sv => { setupVals = sv; setTrack(trackName); });
setTrack('oval');
requestAnimationFrame(frame);
