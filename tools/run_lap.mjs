// Headless lap runner: AI drives the chosen track, dumps telemetry + scene JSON
// for the offline video renderer.
//
// Usage: node tools/run_lap.mjs [oval|figure8] [laps] [out.json]

import { writeFileSync } from 'node:fs';
import { Car } from '../sim/car.js';
import { TC_PARAMS, TC_PARAMS_MOD } from '../sim/params.js';
import { buildTrack, trackGeometry } from '../sim/track.js';
import { Driver } from '../sim/driver.js';
import { World } from '../sim/world.js';
import { makeSurface } from '../sim/surface.js';

const trackName = process.argv[2] || 'oval';
const lapsWanted = parseInt(process.argv[3] || '2', 10);
const motorClass = process.argv[5] || (trackName === 'luxembourg' ? 'mod' : 'stock');
const outFile = process.argv[4] || `out/${trackName}_telemetry.json`;

const PARAMS = motorClass === 'mod' ? TC_PARAMS_MOD : TC_PARAMS;
const driverOpts = motorClass === 'mod'
  ? { speed: { ayMax: 22.8, axBrake: 17.5, axAccel: 15.5, vTop: 32 }, kp: 1.2,
      line: { margin: 0.24, iterations: 2000 } }
  : { speed: { ayMax: 21, axBrake: 15, axAccel: 12, vTop: 19 }, kp: 1.2,
      line: { margin: 0.24, iterations: 2000 } };

const track = buildTrack(trackName);
const car = new Car(PARAMS);
const world = new World(track, car);
const driver = new Driver(track, car, driverOpts);
car.surfaceFn = makeSurface(track, driver.line);
world.placeAtStart(1.0);
console.log(`Car: ${PARAMS.name}`);
console.log(`Ideal lap (quasi-steady-state optimum): ${driver.idealLap.toFixed(3)} s`);

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
    roll: +car.phi.toFixed(4), pitch: +car.theta.toFixed(4),
    yawRate: +car.r.toFixed(3),
    shock: car.tel.shock.map(s => +s.toFixed(2)),
    tT: car.tireT.map(t => +t.toFixed(1)),
    slip: +Math.max(...car.tel.sat).toFixed(2),
    rpm: Math.round(car.omegaDrive * PARAMS.gearRatio * 60 / (2 * Math.PI)),
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
    halfLength: PARAMS.halfLength, halfWidth: PARAMS.halfWidth,
    wheelRadius: PARAMS.wheelRadius, wheelbase: PARAMS.wheelbase,
    a: PARAMS.a, track: PARAMS.track
  },
  fps: FPS,
  carName: PARAMS.name,
  idealLap: +driver.idealLap.toFixed(3),
  lapTimes: world.lapTimes,
  frames
}));
console.log(`Wrote ${outFile}`);
