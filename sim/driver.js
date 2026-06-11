// AI driver: corridor-constrained racing line, curvature-limited speed profile,
// pure-pursuit steering and proportional throttle/brake.

function wrap(i, n) { return ((i % n) + n) % n; }

/**
 * Compute a racing line by iteratively smoothing the centerline while keeping
 * each point within the lane corridor (elastic-band method). Points stay pinned
 * to the centerline normals so spacing is preserved.
 */
export function computeRacingLine(track, { margin = 0.32, iterations = 1400, lambda = 0.22 } = {}) {
  const n = track.pts.length;
  const maxOff = Math.max(0.1, track.halfWidth - margin);
  const off = new Float64Array(n); // lateral offset along normal

  const px = new Float64Array(n), py = new Float64Array(n);
  const update = () => {
    for (let i = 0; i < n; i++) {
      px[i] = track.pts[i][0] + track.normals[i][0] * off[i];
      py[i] = track.pts[i][1] + track.normals[i][1] * off[i];
    }
  };
  update();

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const ip = wrap(i - 1, n), inx = wrap(i + 1, n);
      const mx = (px[ip] + px[inx]) / 2, my = (py[ip] + py[inx]) / 2;
      // move toward midpoint, projected on this point's normal
      const dx = mx - track.pts[i][0], dy = my - track.pts[i][1];
      const e = dx * track.normals[i][0] + dy * track.normals[i][1];
      off[i] += lambda * (Math.max(-maxOff, Math.min(maxOff, e)) - off[i]);
    }
    update();
  }

  // curvature along the line
  const curv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ip = wrap(i - 2, n), inx = wrap(i + 2, n);
    const ax = px[i] - px[ip], ay = py[i] - py[ip];
    const bx = px[inx] - px[i], by = py[inx] - py[i];
    const cross = ax * by - ay * bx;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const lc = Math.hypot(px[inx] - px[ip], py[inx] - py[ip]);
    curv[i] = (la * lb * lc) > 1e-9 ? (2 * cross) / (la * lb * lc) : 0;
  }
  // light smoothing of curvature
  for (let pass = 0; pass < 3; pass++) {
    const tmp = Float64Array.from(curv);
    for (let i = 0; i < n; i++) {
      curv[i] = (tmp[wrap(i - 1, n)] + 2 * tmp[i] + tmp[wrap(i + 1, n)]) / 4;
    }
  }

  return { px, py, curv, n };
}

/**
 * Curvature-limited speed profile with braking/acceleration passes.
 */
export function computeSpeedProfile(line, { ayMax = 19.5, axBrake = 13.5, axAccel = 11, vTop = 18.5 } = {}) {
  const n = line.n;
  const ds = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = wrap(i + 1, n);
    ds[i] = Math.hypot(line.px[j] - line.px[i], line.py[j] - line.py[i]);
  }
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(line.curv[i]);
    v[i] = Math.min(vTop, k > 1e-6 ? Math.sqrt(ayMax / k) : vTop);
  }
  // backward pass (braking) and forward pass (acceleration), run twice to wrap the loop
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = wrap(i + 1, n);
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * axBrake * ds[i]));
    }
    for (let i = 0; i < n; i++) {
      const j = wrap(i + 1, n);
      v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * axAccel * ds[i]));
    }
  }
  return v;
}

/** Quasi-steady-state optimal lap time for a speed profile (the "ideal lap"). */
export function profileLapTime(line, v) {
  let t = 0;
  for (let i = 0; i < line.n; i++) {
    const j = wrap(i + 1, line.n);
    const ds = Math.hypot(line.px[j] - line.px[i], line.py[j] - line.py[i]);
    t += ds / Math.max(v[i], 0.5);
  }
  return t;
}

export class Driver {
  constructor(track, car, opts = {}) {
    this.track = track;
    this.car = car;
    this.line = computeRacingLine(track, opts.line);
    this.speedOpts = opts.speed || {};
    this.vProfile = computeSpeedProfile(this.line, this.speedOpts);
    this.idealLap = profileLapTime(this.line, this.vProfile);
    this.vTop = this.speedOpts.vTop ?? 18.5;
    this.corrGain = opts.corrGain ?? 0;
    this.laBase = opts.laBase ?? 0.45;
    this.laGain = opts.laGain ?? 0.28;
    this.kp = opts.kp ?? 0.7;
    this.idx = 0;
    this.wheelbase = car.p.wheelbase;
    this.maxSteer = car.p.maxSteer;
  }

  /** Find nearest racing-line index near previous one (windowed). */
  nearest() {
    const { px, py, n } = this.line;
    const cx = this.car.x, cy = this.car.y;
    let best = this.idx, bd = Infinity;
    for (let k = -10; k <= 60; k++) {
      const i = wrap(this.idx + k, n);
      const d = (px[i] - cx) ** 2 + (py[i] - cy) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    this.idx = best;
    return best;
  }

  update() {
    const car = this.car;
    const { px, py, n } = this.line;
    const i0 = this.nearest();
    const v = car.speed;

    // --- pure pursuit steering ---
    const Ld = this.laBase + this.laGain * v;
    let li = i0, acc = 0;
    while (acc < Ld) {
      const j = wrap(li + 1, n);
      acc += Math.hypot(px[j] - px[li], py[j] - py[li]);
      li = j;
      if (li === i0) break;
    }
    const dx = px[li] - car.x, dy = py[li] - car.y;
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const lx = cy * dx + sy * dy;       // lookahead point in body frame
    const ly = -sy * dx + cy * dy;
    const dist = Math.hypot(lx, ly);
    const kappaPP = (2 * ly) / Math.max(dist * dist, 0.01);
    // cross-track error correction (pro drivers hold the line tightly)
    const ip = wrap(i0 - 1, n), inx = wrap(i0 + 1, n);
    let tx = px[inx] - px[ip], ty = py[inx] - py[ip];
    const tl = Math.hypot(tx, ty) || 1;
    const eLat = ((car.x - px[i0]) * -ty + (car.y - py[i0]) * tx) / tl;
    // correction as curvature (speed-invariant), not steering angle
    const kCorr = Math.max(-0.05, Math.min(0.05, -this.corrGain * eLat));
    const steerAngle = Math.atan((kappaPP + kCorr) * this.wheelbase) * 1.12;
    const steerCmd = steerAngle / this.maxSteer;

    // --- speed control: target a bit ahead of current position ---
    // scale targets by current tire temperature (build pace as tires come in)
    const tp = car.p.tire;
    const Tm = (car.tireT[0] + car.tireT[1] + car.tireT[2] + car.tireT[3]) / 4;
    const dTt = Tm - tp.Topt;
    const tempF = Math.max(0.72, 1 - tp.tempSens * dTt * dTt);
    const gScale = Math.sqrt(tempF) * 0.995;
    const ahead = wrap(i0 + Math.max(2, Math.round(v * 0.08 / 0.15)), n);
    const vT = Math.min(this.vProfile[ahead] * gScale, this.speedOpts.vTop ?? 18.5);
    const e = vT - v;

    // anticipatory braking: scan ahead and find the decel needed to make
    // every upcoming profile speed (pro braking points, not reactive)
    const axB = this.speedOpts.axBrake ?? 13.5;
    let needBrake = 0, s = 0, li2 = i0;
    const horizon = Math.max(10, v * v / (2 * axB * 0.7));
    while (s < horizon) {
      const j = wrap(li2 + 1, n);
      s += Math.hypot(px[j] - px[li2], py[j] - py[li2]);
      li2 = j;
      const vk = this.vProfile[li2] * gScale;
      if (vk < v && s > 0.3) {
        needBrake = Math.max(needBrake, (v * v - vk * vk) / (2 * s));
      }
      if (li2 === i0) break;
    }

    let throttle = 0, brake = 0;
    if (needBrake > 0.88 * axB) {
      brake = Math.min(1, 0.25 + (needBrake - 0.88 * axB) / (0.30 * axB));
    } else if (e >= -0.4) {
      // feedforward holds speed against drag, P-term tracks the profile
      throttle = Math.min(1, Math.max(0, this.kp * e + vT / (this.vTop * 1.06)));
    } else {
      brake = Math.min(1, -0.55 * (e + 0.4));
    }

    car.setControls(steerCmd, throttle, brake);
    return { vT, lookahead: [px[li], py[li]] };
  }
}
