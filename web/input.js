// RC radio input via the browser Gamepad API. The VRC-Pro USB adapter (and
// similar transmitter dongles, e.g. for a Sanwa M17/9 Turbo setup) shows up
// as a standard HID gamepad: steering and throttle are two analog axes.
//
// Calibration wizard (press G): captures neutral, full left, full throttle
// and full brake, auto-detecting which axis moved. Stored in localStorage.

const LS_KEY = 'rcRadioCal';

export class RadioInput {
  constructor() {
    this.cal = null;
    try {
      this.cal = JSON.parse(localStorage.getItem(LS_KEY)) || null;
    } catch (e) { /* no saved calibration */ }
    this.wizard = null; // { step, neutral }
    this.connected = false;
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Start / advance the calibration wizard. Returns prompt text. */
  startCalibration() {
    this.wizard = { step: 0 };
  }

  /** Advance wizard on key press. Returns true when finished. */
  advanceCalibration() {
    const p = this.pad();
    if (!p) return false;
    const axes = p.axes.slice();
    const w = this.wizard;
    if (w.step === 0) {
      w.neutral = axes;
      w.step = 1;
    } else if (w.step === 1) {
      w.steer = this.biggestDelta(axes, w.neutral);
      w.step = 2;
    } else if (w.step === 2) {
      w.thr = this.biggestDelta(axes, w.neutral);
      w.step = 3;
    } else if (w.step === 3) {
      const b = this.biggestDelta(axes, w.neutral);
      this.cal = {
        steerAxis: w.steer.axis,
        steerCenter: w.neutral[w.steer.axis],
        steerFullLeft: w.steer.value,
        thrAxis: w.thr.axis,
        thrCenter: w.neutral[w.thr.axis],
        thrFull: w.thr.value,
        brkFull: b.axis === w.thr.axis ? b.value
          : w.neutral[w.thr.axis] - (w.thr.value - w.neutral[w.thr.axis])
      };
      localStorage.setItem(LS_KEY, JSON.stringify(this.cal));
      this.wizard = null;
      return true;
    }
    return false;
  }

  biggestDelta(axes, neutral) {
    let best = { axis: 0, value: axes[0], d: 0 };
    for (let i = 0; i < axes.length; i++) {
      const d = Math.abs(axes[i] - neutral[i]);
      if (d > best.d) best = { axis: i, value: axes[i], d };
    }
    return best;
  }

  wizardPrompt() {
    if (!this.wizard) return null;
    if (!this.pad()) return 'CALIBRATION: no radio detected - plug in the adapter and squeeze the trigger once';
    return [
      'CALIBRATION 1/4: leave wheel + trigger at NEUTRAL, press G',
      'CALIBRATION 2/4: hold FULL LEFT steering, press G',
      'CALIBRATION 3/4: hold FULL THROTTLE, press G',
      'CALIBRATION 4/4: hold FULL BRAKE, press G'
    ][this.wizard.step];
  }

  /** Read calibrated controls. Returns null if no pad / not calibrated. */
  read() {
    const p = this.pad();
    this.connected = !!p;
    if (!p || !this.cal || this.wizard) return null;
    const c = this.cal;
    const norm = (v, center, full) =>
      Math.abs(full - center) < 1e-3 ? 0 : Math.max(-1.2, Math.min(1.2, (v - center) / (full - center)));
    let steer = norm(p.axes[c.steerAxis], c.steerCenter, c.steerFullLeft);
    const fwd = norm(p.axes[c.thrAxis], c.thrCenter, c.thrFull);
    const rev = norm(p.axes[c.thrAxis], c.thrCenter, c.brkFull);
    const dead = x => Math.abs(x) < 0.05 ? 0 : x;
    steer = dead(Math.max(-1, Math.min(1, steer)));
    return {
      steer,
      throttle: Math.max(0, Math.min(1, dead(fwd))),
      brake: Math.max(0, Math.min(1, dead(rev)))
    };
  }
}
