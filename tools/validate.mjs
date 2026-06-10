// Physics validation benchmarks for the 1/10 TC model.
// Real-world targets (see PHYSICS.md):
//  - top speed:  ~16-19 m/s (60-70 km/h) for 13.5T blinky with track gearing
//  - 0-10 m:     ~1.3-1.7 s (launch ~1.3-1.8 g, traction limited then power limited)
//  - braking:    1.5-2.2 g peak (drivetrain brake through all four wheels)
//  - skidpad:    2.0-3.0 g steady lateral on high-grip asphalt/carpet

import { Car } from '../sim/car.js';
import { TC_PARAMS } from '../sim/params.js';

const DT = 1 / 5000;

console.log(`Validating: ${TC_PARAMS.name}\n`);

// --- 1. Standing start: 0-10 m, 0-30 m, top speed ---
{
  const car = new Car(TC_PARAMS);
  let t = 0, t10 = null, t30 = null, vmax = 0;
  while (t < 8) {
    car.setControls(0, 1, 0);
    car.step(DT); t += DT;
    if (t10 === null && car.x >= 10) t10 = t;
    if (t30 === null && car.x >= 30) t30 = t;
    vmax = Math.max(vmax, car.vx);
  }
  console.log(`Standing start: 0-10 m = ${t10.toFixed(2)} s, 0-30 m = ${t30.toFixed(2)} s`);
  console.log(`Top speed     : ${vmax.toFixed(1)} m/s (${(vmax * 3.6).toFixed(0)} km/h)  [target 60-70 km/h]`);
}

// --- 2. Launch acceleration (peak ax over first 0.5 s) ---
{
  const car = new Car(TC_PARAMS);
  let t = 0, axMax = 0;
  while (t < 0.5) {
    car.setControls(0, 1, 0);
    car.step(DT); t += DT;
    axMax = Math.max(axMax, car.axF);
  }
  console.log(`Launch accel  : ${(axMax / 9.81).toFixed(2)} g peak (filtered)  [target 1.3-1.8 g]`);
}

// --- 3. Braking from 15 m/s ---
{
  const car = new Car(TC_PARAMS);
  car.vx = 15; car.omegaDrive = 15 / TC_PARAMS.wheelRadius;
  const x0 = car.x;
  let t = 0, axMin = 0;
  while (car.vx > 0.5 && t < 5) {
    car.setControls(0, 0, 1);
    car.step(DT); t += DT;
    axMin = Math.min(axMin, car.axF);
  }
  console.log(`Braking 15->0 : ${(car.x - x0).toFixed(1)} m, peak ${(-axMin / 9.81).toFixed(2)} g (filtered)  [target 1.5-2.2 g]`);
}

// --- 4. Skidpad: ramp steer at constant speed, find max steady lateral g ---
{
  for (const v of [6, 8, 10]) {
    const car = new Car(TC_PARAMS);
    car.vx = v; car.omegaDrive = v / TC_PARAMS.wheelRadius;
    let t = 0, ayMax = 0, spun = false;
    while (t < 6 && !spun) {
      const steer = Math.min(1, t / 5); // slow ramp
      // crude speed hold
      const thr = Math.max(0, Math.min(1, 0.5 * (v - car.vx) + (v / 19)));
      car.setControls(steer, thr, 0);
      car.step(DT); t += DT;
      const beta = Math.atan2(car.vy, Math.max(car.vx, 0.5));
      if (Math.abs(beta) > 0.5) { spun = true; break; }
      ayMax = Math.max(ayMax, Math.abs(car.ayF));
    }
    const Rad = v * v / ayMax;
    console.log(`Skidpad @${v} m/s: max steady ${(ayMax / 9.81).toFixed(2)} g (R=${Rad.toFixed(1)} m)${spun ? ' then spun' : ''}  [target 2.0-3.0 g]`);
  }
}

// --- 5. Step steer response at 10 m/s (yaw stability / transient) ---
{
  const car = new Car(TC_PARAMS);
  car.vx = 10; car.omegaDrive = 10 / TC_PARAMS.wheelRadius;
  let t = 0, rPeak = 0, rEnd = 0;
  while (t < 1.5) {
    car.setControls(t > 0.2 ? 0.4 : 0, 0.5, 0);
    car.step(DT); t += DT;
    rPeak = Math.max(rPeak, car.r); rEnd = car.r;
  }
  const overshoot = rPeak / Math.max(rEnd, 1e-6);
  console.log(`Step steer    : yaw rate peak ${rPeak.toFixed(2)} rad/s, settle ${rEnd.toFixed(2)} rad/s (overshoot x${overshoot.toFixed(2)})`);
}
