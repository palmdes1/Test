// Headless lap runner: AI drives the chosen track, dumps telemetry + scene JSON
// for the offline video renderer.
//
// Usage: node tools/run_lap.mjs [oval|figure8] [laps] [out.json]

import { writeFileSync } from 'node:fs';
import { Car } from '../sim/car.js';
import { TC_PARAMS } from '../sim/params.js';
import { buildTrack, trackGeometry } from '../sim/track.js';
import { Driver } from '../sim/driver.js';
import { World } from '../sim/world.js';

const trackName = process.argv[2] || 'oval';
const lapsWanted = parseInt(process.argv[3] || '2', 10);
const outFile = process.argv[4] || `out/${trackName}_telemetry.json`;

const track = buildTrack(trackName);
const car = new Car(TC_PARAMS);
const world = new World(track, car);
const driver = new Driver(track, car);
world.placeAtStart(1.0);

const FPS = 60;
const frames = [];
let t = 0;
const tMax = 120;

while (world.lap < lapsWanted + 1 && t < tMax) {
  world.step(1 / FPS, () => driver.update());
  t += 1 / FPS;
  frames.push({
    t: +world.time.toFixed(4),
    x: +car.x.toFixed(4), y: +car.y.toFixed(4), yaw: +car.yaw.toFixed(4),
    steer: +car.steer.toFixed(4),
    v: +car.speed.toFixed(3),
    thr: +car.throttle.toFixed(3), brk: +car.brake.toFixed(3),
    lap: world.lap, lapT: +world.currentLapTime.toFixed(3),
    ay: +car.ayF.toFixed(2), ax: +car.axF.toFixed(2),
    wspd: +(car.omegaDrive * car.p.wheelRadius).toFixed(2)
  });
}

console.log(`Track: ${track.name}  length ${track.length.toFixed(1)} m, lane ${track.width} m`);
if (world.lapTimes.length) {
  world.lapTimes.forEach((lt, i) => console.log(`Lap ${i + 1}: ${lt.toFixed(3)} s  (avg ${(track.length / lt).toFixed(1)} m/s)`));
  console.log(`Best: ${Math.min(...world.lapTimes).toFixed(3)} s`);
} else {
  console.log('No complete laps!');
}
const vMax = Math.max(...frames.map(f => f.v));
console.log(`Max speed: ${vMax.toFixed(1)} m/s (${(vMax * 3.6).toFixed(0)} km/h), frames: ${frames.length}`);

import { mkdirSync } from 'node:fs';
mkdirSync('out', { recursive: true });

const racingLine = [];
for (let i = 0; i < driver.line.n; i += 3) {
  racingLine.push([+driver.line.px[i].toFixed(3), +driver.line.py[i].toFixed(3)]);
}

writeFileSync(outFile, JSON.stringify({
  track: {
    name: track.name, length: track.length, width: track.width,
    stand: track.stand,
    center: track.pts.filter((_, i) => i % 3 === 0).map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]),
    halfWidth: track.halfWidth
  },
  geometry: trackGeometry(track),
  racingLine,
  car: {
    halfLength: TC_PARAMS.halfLength, halfWidth: TC_PARAMS.halfWidth,
    wheelRadius: TC_PARAMS.wheelRadius, wheelbase: TC_PARAMS.wheelbase,
    a: TC_PARAMS.a, track: TC_PARAMS.track
  },
  fps: FPS,
  lapTimes: world.lapTimes,
  frames
}));
console.log(`Wrote ${outFile}`);
