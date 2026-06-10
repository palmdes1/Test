// Pure kinematics for an 18,000 bph Swiss lever movement.
// All angles in radians. Viewed from +z (the display side), clockwise = negative.
//
// Gear train (driver wheel teeth / driven pinion leaves):
//   barrel 84  -> center pinion 12   (7:1,   barrel: 1 rev / 7 h)
//   center 64  -> third pinion 8     (8:1,   center: 1 rev / h, minute hand)
//   third  60  -> fourth pinion 8    (7.5:1, fourth: 1 rev / min, seconds hand)
//   fourth 70  -> escape pinion 7    (10:1,  escape: 1 rev / 6 s)
//   escape wheel 15 teeth, 2 beats per tooth -> 30 beats/rev
//     10 rev/min * 30 = 300 beats/min = 18,000 beats/hour, balance at 2.5 Hz
// Motion works (12:1 between minute and hour hand):
//   cannon pinion 10 -> minute wheel 30 (3:1)
//   minute pinion  8 -> hour wheel   32 (4:1)

export const TEETH = {
  barrel: 84,
  centerPinion: 12,
  center: 64,
  thirdPinion: 8,
  third: 60,
  fourthPinion: 8,
  fourth: 70,
  escapePinion: 7,
  escape: 15,
  cannon: 10,
  minuteWheel: 30,
  minutePinion: 8,
  hourWheel: 32,
};

export const BEATS_PER_SEC = 5;          // 18,000 bph
export const BEAT = 1 / BEATS_PER_SEC;   // 0.2 s
export const ESCAPE_STEP = (2 * Math.PI) / (TEETH.escape * 2); // 12 deg per beat

// Fraction of the beat during which the escape wheel actually moves (drop+impulse)
const IMPULSE_WINDOW = 0.22;
// Balance amplitude (one-sided), ~240 degrees like a healthy movement
export const BALANCE_AMP = (240 * Math.PI) / 180;
// Pallet fork total swing between banking pins
export const FORK_AMP = (11 * Math.PI) / 180;

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

// Escape wheel advance as a function of time: locked, then a quick eased
// 12-degree step at the start of every beat.
export function escapeSteps(t) {
  const beats = t * BEATS_PER_SEC;
  const k = Math.floor(beats);
  const frac = beats - k;
  const s = Math.min(frac / IMPULSE_WINDOW, 1);
  return k + easeOutCubic(s);
}

// All component angles at watch-time t (seconds since 12:00:00).
export function anglesAt(t) {
  const steps = escapeSteps(t);

  // Escape wheel turns counter-clockwise viewed from +z.
  const escape = steps * ESCAPE_STEP;

  // Each external mesh reverses direction and scales by wheel/pinion ratio.
  const fourth = -escape * (TEETH.escapePinion / TEETH.fourth);   // -escape/10
  const third = -fourth * (TEETH.fourthPinion / TEETH.third);     // -fourth/7.5
  const center = -third * (TEETH.thirdPinion / TEETH.center);     // -third/8
  const barrel = -center * (TEETH.centerPinion / TEETH.barrel);   // -center/7

  // Motion works, driven off the cannon pinion (= center arbor).
  const cannon = center;
  const minuteWheel = -cannon * (TEETH.cannon / TEETH.minuteWheel);
  const hourWheel = -minuteWheel * (TEETH.minutePinion / TEETH.hourWheel);

  // Balance: sinusoidal, zero-crossing (impulse) at each beat boundary.
  const balance = BALANCE_AMP * Math.sin(Math.PI * BEATS_PER_SEC * t);

  // Pallet fork: flips between bankings each beat, moving during the impulse.
  const k = Math.floor(t * BEATS_PER_SEC);
  const frac = t * BEATS_PER_SEC - k;
  const from = (k % 2 === 0 ? 1 : -1) * FORK_AMP;
  const to = -from;
  const s = easeOutCubic(Math.min(frac / IMPULSE_WINDOW, 1));
  const fork = from + (to - from) * s;

  return {
    escape, fourth, third, center, barrel,
    cannon, minuteWheel, hourWheel,
    balance, fork,
    // Hand angles (smooth ideal values; hands ride their arbors):
    secondHand: fourth,        // fourth wheel arbor, ticks 5x per second
    minuteHand: cannon,        // cannon pinion
    hourHand: hourWheel,       // hour wheel pipe
  };
}

// Convenience: watch-time seconds for a given dial reading.
export function dialTime(h, m, s) {
  return ((h % 12) * 3600) + m * 60 + s;
}

// Expected smooth hand angles for verification (radians, clockwise negative,
// zero = 12 o'clock).
export function expectedHands(t) {
  return {
    second: -2 * Math.PI * ((t % 60) / 60),
    minute: -2 * Math.PI * ((t % 3600) / 3600),
    hour: -2 * Math.PI * ((t % 43200) / 43200),
  };
}
