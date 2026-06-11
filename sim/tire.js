// Pacejka "magic formula" tire with load sensitivity and combined slip
// (similarity / friction-ellipse method).

function magic(x, B, C, E) {
  const Bx = B * x;
  return Math.sin(C * Math.atan(Bx - E * (Bx - Math.atan(Bx))));
}

/**
 * Compute tire contact forces in the wheel frame.
 * @param {number} Fz     vertical load, N (>= 0)
 * @param {number} kappa  longitudinal slip ratio (+ = driving/wheelspin)
 * @param {number} alpha  slip angle, rad (+ = contact patch sliding to +y)
 * @param {object} p      tire parameter block (see params.js)
 * @returns {{Fx:number, Fy:number, sat:number}} forces, and slip saturation (0..1+)
 */
export function tireForces(Fz, kappa, alpha, p, gripScale = 1) {
  if (Fz <= 0) return { Fx: 0, Fy: 0, sat: 0 };

  // Load-sensitive peak friction: mu falls off as load rises above nominal.
  const mu = p.mu0 * (1 - p.loadSens * (Fz - p.Fz0) / p.Fz0) * gripScale;
  const D = Math.max(mu, 0.3) * Fz;

  // Normalize slips by their respective peak-slip values and combine.
  const sx = kappa / p.kappaPeak;
  const sy = alpha / p.alphaPeak;
  const s = Math.hypot(sx, sy);
  if (s < 1e-9) return { Fx: 0, Fy: 0, sat: 0 };

  // Evaluate each pure-slip curve at the combined slip magnitude, then project.
  const fx = magic(s * p.kappaPeak, p.Bx, p.Cx, p.Ex);
  const fy = magic(s * p.alphaPeak, p.By, p.Cy, p.Ey);

  return {
    Fx: D * fx * (sx / s),
    Fy: -D * fy * (sy / s), // lateral force opposes slip angle
    sat: s
  };
}
