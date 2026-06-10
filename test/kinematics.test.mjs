import { anglesAt, expectedHands, dialTime, ESCAPE_STEP, TEETH } from '../src/kinematics.js';

const TAU = 2 * Math.PI;
let failures = 0;

function approx(name, actual, expected, tol = 1e-9) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}: got ${actual}, expected ${expected}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// After exactly 60 s the fourth wheel (seconds hand) must make -1 full turn.
{
  const a0 = anglesAt(0);
  const a60 = anglesAt(60);
  approx('fourth wheel: 1 rev/min (clockwise)', a60.fourth - a0.fourth, -TAU, 1e-6);
}

// After 3600 s the center wheel / minute hand must make -1 full turn.
{
  const a = anglesAt(3600);
  approx('center wheel: 1 rev/hour', a.center - anglesAt(0).center, -TAU, 1e-6);
}

// After 12 h the hour wheel must make -1 full turn.
{
  const a = anglesAt(43200);
  approx('hour wheel: 1 rev/12h', a.hourWheel - anglesAt(0).hourWheel, -TAU, 1e-4);
}

// Escape wheel: 30 beats per rev, 5 beats per second -> 1 rev / 6 s, CCW.
{
  const a = anglesAt(6);
  approx('escape wheel: 1 rev/6s (CCW)', a.escape - anglesAt(0).escape, TAU, 1e-6);
}

// Barrel: 1 rev / 7 h, counter-rotating its driven center pinion (CCW).
{
  const a = anglesAt(7 * 3600);
  approx('barrel: 1 rev/7h (CCW)', a.barrel - anglesAt(0).barrel, TAU, 1e-4);
}

// Escapement steps exactly once per beat.
{
  const before = anglesAt(0.199).escape;
  const after = anglesAt(0.399).escape;
  approx('escape advances 12deg per beat', after - before, ESCAPE_STEP, 1e-6);
}

// Hands agree with ideal time display at a few sample times.
for (const [h, m, s] of [[10, 9, 30], [3, 0, 0], [7, 45, 15]]) {
  const t = dialTime(h, m, s);
  const a = anglesAt(t);
  const e = expectedHands(t);
  const norm = (x) => ((x % TAU) + TAU) % TAU;
  approx(`minute hand @ ${h}:${m}:${s}`, norm(a.minuteHand), norm(e.minute), 1e-6);
  approx(`hour hand   @ ${h}:${m}:${s}`, norm(a.hourHand), norm(e.hour), 1e-6);
  // Seconds hand is stepped (5 ticks/s) so allow up to one step of lag.
  const stepTol = TAU / 60 / 5 + 1e-6;
  const diff = Math.abs(norm(a.secondHand) - norm(e.second));
  const wrapped = Math.min(diff, TAU - diff);
  if (wrapped > stepTol) {
    failures++;
    console.error(`FAIL second hand @ ${h}:${m}:${s}: off by ${wrapped} rad`);
  } else {
    console.log(`ok   second hand @ ${h}:${m}:${s} (within one tick)`);
  }
}

// Motion works ratio: minute hand must turn exactly 12x faster than hour hand.
{
  const a1 = anglesAt(0);
  const a2 = anglesAt(43200);
  const minuteTurns = (a2.minuteHand - a1.minuteHand) / TAU;
  const hourTurns = (a2.hourWheel - a1.hourWheel) / TAU;
  approx('motion works 12:1', minuteTurns / hourTurns, 12, 1e-9);
}

// Beat rate: 18,000 escape-wheel tooth-flank events per hour.
{
  const revsPerHour = (anglesAt(3600).escape - anglesAt(0).escape) / TAU;
  approx('18000 bph', revsPerHour * TEETH.escape * 2, 18000, 1e-3);
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll kinematics tests passed.');
