// Planar (3-DOF body + drivetrain) dynamic model of a 4WD belt-drive touring car.
//
// Body frame: x forward, y left, yaw CCW positive.
// Wheels: 0=FL, 1=FR, 2=RL, 3=RR.
//
// Modeled effects:
//  - Pacejka tires with load sensitivity, combined slip (friction ellipse)
//    and camber thrust
//  - sprung chassis: heave/pitch/roll DOF on per-corner springs and dampers
//    with anti-roll bars and bump stops; wheel loads come from the suspension
//  - brushless DC motor (Kv/R/current limit) with ESC drive & proportional brake
//  - belt 4WD with front spool (or gear diff) and rear gear differential
//    (left/right speed differences are states)
//  - servo slew-rate-limited steering with geometric Ackermann
//  - aero drag, body downforce, rolling resistance

import { tireForces } from './tire.js';

const G = 9.81;

export class Car {
  constructor(params) {
    this.p = params;
    this.reset(0, 0, 0);
  }

  reset(x, y, yaw) {
    this.x = x; this.y = y; this.yaw = yaw;
    this.vx = 0; this.vy = 0; this.r = 0;       // body-frame velocities, yaw rate
    this.steer = 0;                              // actual mean front wheel angle
    this.omegaDrive = 0;                         // drivetrain speed at wheels, rad/s
    this.deltaRear = 0;                          // omega_RL - omega_RR
    this.deltaFront = 0;                         // omega_FL - omega_FR (gear diff mode)
    // sprung-chassis states (deviations from static equilibrium)
    this.zH = 0; this.vzH = 0;                   // heave
    this.phi = 0; this.dphi = 0;                 // roll  (+ = left side up)
    this.theta = 0; this.dtheta = 0;             // pitch (+ = nose down)
    this.axF = 0; this.ayF = 0;                  // filtered specific force (telemetry)
    this._geo = null;
    this.tireT = [this.p.tire.T0, this.p.tire.T0, this.p.tire.T0, this.p.tire.T0];
    this._lastRoad = [0, 0, 0, 0];
    this.surfaceFn = this.surfaceFn || null;     // (x,y) -> {grip, height}, set by world
    // inputs
    this.steerCmd = 0; this.throttle = 0; this.brake = 0;
    // telemetry
    this.tel = { Fz: [0, 0, 0, 0], sat: [0, 0, 0, 0], motorI: 0, ax: 0, ay: 0 };
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  setControls(steerCmd, throttle, brake) {
    this.steerCmd = Math.max(-1, Math.min(1, steerCmd));
    this.throttle = Math.max(0, Math.min(1, throttle));
    this.brake = Math.max(0, Math.min(1, brake));
  }

  /** Advance the model by dt (call with small dt, e.g. 1/5000 s). */
  step(dt) {
    const p = this.p;
    const m = p.mass, L = p.wheelbase, t2 = p.track / 2, rw = p.wheelRadius;

    // --- Steering servo: slew toward command ---
    const target = this.steerCmd * p.maxSteer;
    const dMax = p.steerRate * dt;
    this.steer += Math.max(-dMax, Math.min(dMax, target - this.steer));

    // Geometric Ackermann: inner wheel steers more.
    let dFL, dFR;
    const d = this.steer;
    if (Math.abs(d) < 1e-4) { dFL = d; dFR = d; }
    else {
      const R = L / Math.tan(d); // turn radius (signed; + = left turn)
      const ack = p.ackermann;
      dFL = Math.atan(L / (R - t2 * ack));
      dFR = Math.atan(L / (R + t2 * ack));
    }
    // rear toe-in: wheels point inward for stability (left toes right, etc.)
    const steerAng = [dFL, dFR, -(p.toeRear || 0), p.toeRear || 0];

    // --- Wheel positions in body frame ---
    const wx = [p.a, p.a, -p.b, -p.b];
    const wy = [t2, -t2, t2, -t2];

    // --- Surface under each wheel: grip multiplier + road height ---
    const cy0 = Math.cos(this.yaw), sy0 = Math.sin(this.yaw);
    const road = [0, 0, 0, 0], roadRate = [0, 0, 0, 0], gripW = [1, 1, 1, 1];
    for (let i = 0; i < 4; i++) {
      if (this.surfaceFn) {
        const s = this.surfaceFn(
          this.x + wx[i] * cy0 - wy[i] * sy0,
          this.y + wx[i] * sy0 + wy[i] * cy0
        );
        road[i] = s.height;
        gripW[i] = s.grip;
      }
      roadRate[i] = Math.max(-1, Math.min(1, (road[i] - this._lastRoad[i]) / dt));
      this._lastRoad[i] = road[i];
    }

    // --- Vertical loads from the sprung chassis (springs/dampers/ARBs) ---
    const v = this.speed;
    const down = p.CdownV2 * v * v;
    const statF = m * G * p.b / (2 * L), statR = m * G * p.a / (2 * L);
    const stat = [statF, statF, statR, statR];

    // corner deflections from heave/pitch/roll (+h = corner moved up)
    const hC = [], hdC = [];
    for (let i = 0; i < 4; i++) {
      hC.push(this.zH - wx[i] * this.theta + wy[i] * this.phi);
      hdC.push(this.vzH - wx[i] * this.dtheta + wy[i] * this.dphi);
    }
    const springF = (h, hd) => {
      let F = -p.springRate * h - p.damping * hd;
      if (h < -p.bumpTravel) F += -p.bumpRate * (h + p.bumpTravel); // bump stop
      return F;
    };
    const S = [];
    // suspension works on travel relative to the local road surface
    for (let i = 0; i < 4; i++) {
      S.push(stat[i] + springF(hC[i] - road[i], hdC[i] - roadRate[i]));
    }
    // anti-roll bars couple left/right corner deflections per axle
    const arbF = p.arbFront * (hC[0] - hC[1]);
    const arbR = p.arbRear * (hC[2] - hC[3]);
    S[0] -= arbF; S[1] += arbF;
    S[2] -= arbR; S[3] += arbR;
    // full droop: shocks push, never pull - all four at zero = airborne
    for (let i = 0; i < 4; i++) S[i] = Math.max(0, S[i]);
    this.airborne = S[0] + S[1] + S[2] + S[3] < 0.01;
    // geometric load transfer (through roll center / anti geometry, bypasses
    // the springs; uses last step's tire forces - negligible lag at 5 kHz)
    const geo = this._geo || { FyF: 0, FyR: 0, Fx: 0 };
    const TgF = geo.FyF * p.hRollCenter / p.track;
    const TgR = geo.FyR * p.hRollCenter / p.track;
    const TgL = geo.Fx * p.hCG * p.antiPitch / (2 * L);
    const Fz = [
      Math.max(0, S[0] - TgF - TgL),
      Math.max(0, S[1] + TgF - TgL),
      Math.max(0, S[2] - TgR + TgL),
      Math.max(0, S[3] + TgR + TgL)
    ];

    // --- Wheel rotational speeds (front spool or diff + rear diff) ---
    const frontGear = p.frontDrive === 'gear';
    const wOmega = [
      this.omegaDrive + (frontGear ? this.deltaFront / 2 : 0),
      this.omegaDrive - (frontGear ? this.deltaFront / 2 : 0),
      this.omegaDrive + this.deltaRear / 2,
      this.omegaDrive - this.deltaRear / 2
    ];

    // --- Per-wheel slip and forces ---
    let Fx = 0, Fy = 0, Mz = 0, driveReact = 0;
    const FxwArr = [0, 0, 0, 0], satArr = [0, 0, 0, 0];
    const geoNext = { FyF: 0, FyR: 0, Fx: 0 };
    for (let i = 0; i < 4; i++) {
      // contact point velocity in body frame
      const vbx = this.vx - this.r * wy[i];
      const vby = this.vy + this.r * wx[i];
      // rotate into wheel frame
      const c = Math.cos(steerAng[i]), s = Math.sin(steerAng[i]);
      const vXw = c * vbx + s * vby;
      const vYw = -s * vbx + c * vby;

      const denom = Math.max(Math.abs(vXw), 0.4); // low-speed regularization
      const kappa = (wOmega[i] * rw - vXw) / denom;
      const alpha = Math.atan(vYw / denom);

      // thermal grip factor: traction compound has an optimum window
      const tp = p.tire;
      const dT = this.tireT[i] - tp.Topt;
      const tempF = Math.max(0.72, 1 - tp.tempSens * dT * dT);
      const tf = tireForces(Fz[i], kappa, alpha, p.tire, gripW[i] * tempF);
      // rolling resistance acts on the body, smooth around zero speed
      const Frr = -p.rollResist * Fz[i] * Math.tanh(vXw / 0.3);
      // tread heating: slip power + rolling hysteresis, convective cooling
      const vsx = -kappa * denom, vsy = vYw;
      const Pslip = Math.abs(tf.Fx * vsx) + Math.abs(tf.Fy * vsy)
        + Math.abs(Frr * vXw);
      this.tireT[i] += dt * (Pslip / tp.heatCap
        - (tp.cool + tp.coolV * v) * (this.tireT[i] - tp.Tamb));

      // camber thrust: static camber (tops lean inward) + roll-induced lean
      const gamma = (wy[i] > 0 ? -1 : 1) * p.staticCamber
        - this.phi * (1 - p.camberComp);
      const fxw = tf.Fx, fyw = tf.Fy + p.camberThrust * gamma * Fz[i];
      // back to body frame
      const fbx = c * fxw - s * fyw + Frr * c;
      const fby = s * fxw + c * fyw + Frr * s;
      Fx += fbx; Fy += fby;
      Mz += wx[i] * fby - wy[i] * fbx;
      FxwArr[i] = fxw; satArr[i] = tf.sat;
      driveReact += fxw * rw;
      if (i < 2) geoNext.FyF += fby; else geoNext.FyR += fby;
      geoNext.Fx += fbx;
    }
    this._geo = geoNext;

    // --- Aero drag opposing velocity ---
    if (v > 1e-3) {
      const Fd = p.CdragV2 * v;
      Fx -= Fd * this.vx;
      Fy -= Fd * this.vy;
    }

    // --- Motor / ESC ---
    const omegaM = this.omegaDrive * p.gearRatio;
    let Tm = 0, Iout = 0;
    if (p.engine) {
      // nitro 2-stroke + centrifugal clutch + drivetrain disc brake
      const en = p.engine;
      const rpmE = omegaM * 60 / (2 * Math.PI);
      if (this.brake > 0.01) {
        Tm = -(en.brakeTorque * this.brake) / p.gearRatio;
      } else if (this.throttle > 0.02) {
        // clutch slips on launch: the engine revs into its powerband
        const rpmEff = Math.max(rpmE, this.throttle * 20000);
        const dR = rpmEff - en.peakRpm;
        const shape = 0.25 + 0.75 * Math.exp(-(dR * dR) / (2 * en.width * en.width));
        Tm = this.throttle * en.Tmax * shape * (rpmE < en.clutchIn ? 0.85 : 1)
          * p.drivetrainEff;
      } else {
        Tm = -en.engineBrake * Math.min(Math.max(rpmE / en.peakRpm, 0), 1.2);
      }
    } else {
    const mo = p.motor;
    const Kt = 1 / mo.Kv;
    if (this.brake > 0.01) {
      // proportional ESC brake: shorts the windings, torque opposes rotation
      const Ib = Math.min((omegaM / mo.Kv) / mo.R, mo.IbrakeMax) * this.brake;
      Tm = -Kt * Ib;
      Iout = -Ib;
    } else {
      const V = this.throttle * mo.Vbatt;
      let I = (V - omegaM / mo.Kv) / mo.R;
      I = Math.max(-mo.Imax, Math.min(mo.Imax, I));
      if (this.throttle < 0.01) I = 0; // blinky: no drag brake, free coast
      Tm = Kt * I * (I > 0 ? p.drivetrainEff : 1);
      Iout = I;
    }
    }

    // --- Drivetrain dynamics ---
    const Idrive = 4 * p.wheelInertia + p.motorRotorInertia * p.gearRatio * p.gearRatio;
    const Twheels = Tm * p.gearRatio;
    const omegaPrev = this.omegaDrive;
    this.omegaDrive += dt * ((Twheels - driveReact) / Idrive);
    if (this.omegaDrive < 0) this.omegaDrive = 0; // no reverse in racing
    const alphaDrive = (this.omegaDrive - omegaPrev) / dt; // realized accel
    // gear diffs: left/right speed difference driven by tire torque imbalance
    this.deltaRear += dt * (-(FxwArr[2] - FxwArr[3]) * rw - p.rearDiffDamping * this.deltaRear)
      / p.wheelInertia;
    if (frontGear) {
      this.deltaFront += dt * (-(FxwArr[0] - FxwArr[1]) * rw - p.rearDiffDamping * this.deltaFront)
        / p.wheelInertia;
    } else {
      this.deltaFront = 0;
    }

    // --- Body dynamics (body frame), then world integration ---
    const axRaw = Fx / m, ayRaw = Fy / m;
    this.vx += dt * (axRaw + this.r * this.vy);
    this.vy += dt * (ayRaw - this.r * this.vx);
    this.r += dt * Mz / p.Izz;

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.x += dt * (this.vx * cy - this.vy * sy);
    this.y += dt * (this.vx * sy + this.vy * cy);
    this.yaw += dt * this.r;

    // --- Sprung-chassis dynamics: heave, roll, pitch ---
    // suspension reaction on the body is -S (springs push body up = +S on wheel)
    const Ssum = S[0] + S[1] + S[2] + S[3];
    this.vzH += dt * (Ssum - m * G - down) / m;
    this.zH += dt * this.vzH;
    // roll: spring moments + lateral force couple about the roll axis
    let tauX = 0, tauY = 0;
    for (let i = 0; i < 4; i++) {
      tauX += wy[i] * S[i];
      tauY -= wx[i] * S[i];
    }
    tauX += Fy * (p.hCG - p.hRollCenter);
    tauY -= Fx * p.hCG * (1 - p.antiPitch);
    // gyroscopic reaction of the spinning drivetrain: braking pitches the
    // nose down, throttle lifts it - the mid-air attitude control every
    // offroad driver uses
    tauY += -Idrive * alphaDrive;
    this.dphi += dt * (tauX - 0.01 * this.dphi) / p.Ixx;
    this.phi += dt * this.dphi;
    this.dtheta += dt * (tauY - 0.01 * this.dtheta) / p.Iyy;
    this.theta += dt * this.dtheta;
    // beyond ~35 deg a real car is crashing; keep it recoverable (step-1
    // simplification: no rollover state)
    const attMax = 0.6;
    if (Math.abs(this.phi) > attMax) { this.phi = Math.sign(this.phi) * attMax; this.dphi = 0; }
    if (Math.abs(this.theta) > attMax) { this.theta = Math.sign(this.theta) * attMax; this.dtheta = 0; }

    // --- Filtered accelerations (telemetry / driver feel) ---
    const k = dt / (p.suspTau + dt);
    this.axF += k * (axRaw - this.axF);
    this.ayF += k * (ayRaw - this.ayF);

    this.tel.Fz = Fz; this.tel.sat = satArr; this.tel.motorI = Iout;
    this.tel.ax = axRaw; this.tel.ay = ayRaw;
    // shock compression (mm, + = compressed) relative to static
    this.tel.shock = [0, 1, 2, 3].map(i => (road[i] - hC[i]) * 1000);
    this.tel.grip = gripW;
    this.tel.groundZ = (road[0] + road[1] + road[2] + road[3]) / 4;
    this.tel.zH = this.zH;
  }
}
