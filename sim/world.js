// World: ties car + track together. Substepped physics, board (wall) collision,
// lap timing via progress along the centerline.

const PHYS_DT = 1 / 5000;

function wrap(i, n) { return ((i % n) + n) % n; }

export class World {
  constructor(track, car) {
    this.track = track;
    this.car = car;
    this.time = 0;
    this.nearIdx = 0;
    this.lap = 0;             // completed laps (0 = out lap)
    this.lapStartTime = 0;
    this.lapTimes = [];
    this.currentLapTime = 0;
    this.prevS = 0;
    this.acc = 0;
  }

  /** Place the car on the start line facing along the track. */
  placeAtStart(backOff = 0) {
    const t = this.track, n = t.pts.length;
    const i = wrap(Math.round(-backOff / 0.15), n);
    const j = wrap(i + 1, n);
    const yaw = Math.atan2(t.pts[j][1] - t.pts[i][1], t.pts[j][0] - t.pts[i][0]);
    this.car.reset(t.pts[i][0], t.pts[i][1], yaw);
    this.nearIdx = i;
    this.prevS = t.s[i];
  }

  nearestCenter() {
    const t = this.track, n = t.pts.length;
    let best = this.nearIdx, bd = Infinity;
    for (let k = -25; k <= 80; k++) {
      const i = wrap(this.nearIdx + k, n);
      const d = (t.pts[i][0] - this.car.x) ** 2 + (t.pts[i][1] - this.car.y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    this.nearIdx = best;
    return best;
  }

  collideWalls() {
    const t = this.track, car = this.car;
    const i = this.nearestCenter();
    const nx = t.normals[i][0], ny = t.normals[i][1];
    const lat = (car.x - t.pts[i][0]) * nx + (car.y - t.pts[i][1]) * ny;
    const limit = t.halfWidth + 0.10 - car.p.halfWidth; // boards sit just past the line
    if (Math.abs(lat) > limit) {
      const over = Math.abs(lat) - limit;
      const sgn = Math.sign(lat);
      // push back inside and kill outward velocity (inelastic board hit)
      car.x -= sgn * over * nx;
      car.y -= sgn * over * ny;
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
      const vwx = car.vx * cy - car.vy * sy, vwy = car.vx * sy + car.vy * cy;
      const vn = vwx * nx + vwy * ny;
      if (vn * sgn > 0) {
        const nvx = vwx - vn * nx, nvy = vwy - vn * ny;
        const scrub = 0.7; // hitting boards costs speed
        car.vx = (nvx * cy + nvy * sy) * scrub;
        car.vy = (-nvx * sy + nvy * cy) * scrub;
        car.r *= 0.5;
        return true;
      }
    }
    return false;
  }

  updateLapTiming(dt) {
    const t = this.track;
    const s = t.s[this.nearIdx];
    this.currentLapTime = this.time - this.lapStartTime;
    // crossing start/finish: s wraps from near track.length to near 0
    if (this.prevS - s > t.length / 2) {
      const remain = t.length - this.prevS;
      const step = remain + s;
      const frac = step > 1e-6 ? remain / step : 0;
      const crossT = this.time - dt * (1 - frac);
      if (this.lap > 0) this.lapTimes.push(crossT - this.lapStartTime);
      this.lap++;
      this.lapStartTime = crossT;
    }
    this.prevS = s;
  }

  /** Advance by frame dt (substepped). Optional controller called per frame. */
  step(dt, controller) {
    if (controller) controller();
    this.acc += dt;
    while (this.acc > PHYS_DT / 2) {
      this.car.step(PHYS_DT);
      this.acc -= PHYS_DT;
      this.time += PHYS_DT;
    }
    this.collideWalls();
    this.updateLapTiming(dt);
  }
}
