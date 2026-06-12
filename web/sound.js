// WebAudio car sound: brushless motor whine (pitch follows RPM) + tire scrub
// noise gated by slip saturation + speed wind. Starts on first user gesture.

export class CarSound {
  constructor() {
    this.ctx = null;
  }

  ensure() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // motor: two detuned saws through a lowpass
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2.type = 'sawtooth';
    this.osc2.detune.value = 8;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    this.osc1.connect(this.motorGain);
    this.osc2.connect(this.motorGain);
    this.motorGain.connect(lp);
    lp.connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // tire scrub: looped noise buffer through a bandpass-ish lowpass
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    let acc = 0;
    for (let i = 0; i < len; i++) {
      acc += 0.2 * ((Math.random() * 2 - 1) - acc);
      ch[i] = acc * 2.5;
    }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.slipGain = ctx.createGain();
    this.slipGain.gain.value = 0;
    this.noise.connect(this.slipGain);
    this.slipGain.connect(this.master);
    this.noise.start();

    // wind: same buffer, separate slow gain
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = buf;
    this.windSrc.loop = true;
    this.windSrc.playbackRate.value = 0.45;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windGain);
    this.windGain.connect(this.master);
    this.windSrc.start();
  }

  update(car) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = car.omegaDrive * car.p.gearRatio * 60 / (2 * Math.PI);
    const f = Math.max(20, rpm / 60 * 3.2);
    this.osc1.frequency.setTargetAtTime(f, t, 0.02);
    this.osc2.frequency.setTargetAtTime(f * 1.006, t, 0.02);
    const spin = Math.min(1, rpm / 4000);
    const amp = (0.05 + 0.4 * car.throttle + 0.25 * car.brake) * spin * 0.16;
    this.motorGain.gain.setTargetAtTime(amp, t, 0.03);
    const slip = Math.max(...car.tel.sat);
    const env = Math.pow(Math.min(1, Math.max(0, (slip - 0.85) / 0.7)), 1.4)
      * Math.min(1, car.speed / 6);
    this.slipGain.gain.setTargetAtTime(env * 0.30, t, 0.05);
    this.windGain.gain.setTargetAtTime(0.18 * Math.pow(car.speed / 30, 2), t, 0.1);
  }
}
