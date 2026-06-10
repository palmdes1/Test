// Planar (3-DOF body + drivetrain) dynamic model of a 4WD belt-drive touring car.
//
// Body frame: x forward, y left, yaw CCW positive.
// Wheels: 0=FL, 1=FR, 2=RL, 3=RR.
//
// Modeled effects:
//  - Pacejka tires with load sensitivity and combined slip (friction ellipse)
//  - quasi-static longitudinal + lateral load transfer with suspension lag,
//    roll-stiffness distribution front/rear
//  - brushless DC motor (Kv/R/current limit) with ESC drive & proportional brake
//  - belt 4WD with front spool (front wheels locked to the drive shaft) and
//    rear gear differential (left/right speed difference is a state)
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
    this.axF = 0; this.ayF = 0;                  // filtered specific force (load transfer)
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
    const steerAng = [dFL, dFR, 0, 0];

    // --- Wheel positions in body frame ---
    const wx = [p.a, p.a, -p.b, -p.b];
    const wy = [t2, -t2, t2, -t2];

    // --- Vertical loads: static + filtered transfer + downforce ---
    const v = this.speed;
    const down = p.CdownV2 * v * v;
    const statF = m * G * p.b / (2 * L), statR = m * G * p.a / (2 * L);
    const longT = m * this.axF * p.hCG / (2 * L);           // per wheel, front loses under accel
    const latT = m * this.ayF * p.hCG / p.track;            // per axle side-to-side
    const latF = latT * p.rollStiffnessFront;
    const latR = latT * (1 - p.rollStiffnessFront);
    const Fz = [
      Math.max(0, statF - longT - latF + down / 4),
      Math.max(0, statF - longT + latF + down / 4),
      Math.max(0, statR + longT - latR + down / 4),
      Math.max(0, statR + longT + latR + down / 4)
    ];

    // --- Wheel rotational speeds (front spool + rear diff) ---
    const wOmega = [
      this.omegaDrive, this.omegaDrive,
      this.omegaDrive + this.deltaRear / 2,
      this.omegaDrive - this.deltaRear / 2
    ];

    // --- Per-wheel slip and forces ---
    let Fx = 0, Fy = 0, Mz = 0, driveReact = 0;
    const FxwArr = [0, 0, 0, 0], satArr = [0, 0, 0, 0];
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

      const tf = tireForces(Fz[i], kappa, alpha, p.tire);
      // rolling resistance acts on the body, smooth around zero speed
      const Frr = -p.rollResist * Fz[i] * Math.tanh(vXw / 0.3);

      const fxw = tf.Fx, fyw = tf.Fy;
      // back to body frame
      const fbx = c * fxw - s * fyw + Frr * c;
      const fby = s * fxw + c * fyw + Frr * s;
      Fx += fbx; Fy += fby;
      Mz += wx[i] * fby - wy[i] * fbx;
      FxwArr[i] = fxw; satArr[i] = tf.sat;
      driveReact += fxw * rw;
    }

    // --- Aero drag opposing velocity ---
    if (v > 1e-3) {
      const Fd = p.CdragV2 * v;
      Fx -= Fd * this.vx;
      Fy -= Fd * this.vy;
    }

    // --- Motor / ESC ---
    const mo = p.motor;
    const Kt = 1 / mo.Kv;
    const omegaM = this.omegaDrive * p.gearRatio;
    let Tm = 0, Iout = 0;
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

    // --- Drivetrain dynamics ---
    const Idrive = 4 * p.wheelInertia + p.motorRotorInertia * p.gearRatio * p.gearRatio;
    const Twheels = Tm * p.gearRatio;
    this.omegaDrive += dt * (Twheels - driveReact) / Idrive;
    if (this.omegaDrive < 0) this.omegaDrive = 0; // no reverse in racing
    // rear diff: left/right speed difference driven by tire torque imbalance
    this.deltaRear += dt * (-(FxwArr[2] - FxwArr[3]) * rw - p.rearDiffDamping * this.deltaRear)
      / p.wheelInertia;

    // --- Body dynamics (body frame), then world integration ---
    const axRaw = Fx / m, ayRaw = Fy / m;
    this.vx += dt * (axRaw + this.r * this.vy);
    this.vy += dt * (ayRaw - this.r * this.vx);
    this.r += dt * Mz / p.Izz;

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.x += dt * (this.vx * cy - this.vy * sy);
    this.y += dt * (this.vx * sy + this.vy * cy);
    this.yaw += dt * this.r;

    // --- Suspension lag for load transfer ---
    const k = dt / (p.suspTau + dt);
    this.axF += k * (axRaw - this.axF);
    this.ayF += k * (ayRaw - this.ayF);

    this.tel.Fz = Fz; this.tel.sat = satArr; this.tel.motorI = Iout;
    this.tel.ax = axRaw; this.tel.ay = ayRaw;
  }
}
