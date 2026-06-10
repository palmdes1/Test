import * as THREE from 'three';

// --- Involute spur gear outline ---------------------------------------------
// Standard metric gear: pitch r = m*z/2, addendum = m, dedendum = 1.25m.
// Returns a THREE.Shape of the full gear silhouette (no holes).
export function involuteGearShape({ module: m, teeth: z, pressureAngleDeg = 20 }) {
  const alpha = (pressureAngleDeg * Math.PI) / 180;
  const r = (m * z) / 2;            // pitch radius
  const rb = r * Math.cos(alpha);   // base radius
  const ra = r + m;                 // addendum (tip) radius
  let rd = r - 1.25 * m;            // dedendum (root) radius
  rd = Math.max(rd, 0.25 * r);

  const inv = (u) => u - Math.atan(u);
  const uAt = (R) => Math.sqrt(Math.max((R / rb) ** 2 - 1, 0));
  const uP = Math.tan(alpha);
  const psiP = inv(uP);
  const halfTooth = Math.PI / (2 * z) * 0.94; // slight backlash so meshes read cleanly

  const u0 = uAt(Math.max(rd, rb));
  const uA = uAt(ra);
  const FLANK_STEPS = 5;

  // Polar angle of a flank point (relative to tooth centerline) at parameter u.
  const phi = (u) => halfTooth + psiP - inv(u);

  const pts = [];
  const push = (ang, rad) => pts.push(new THREE.Vector2(rad * Math.cos(ang), rad * Math.sin(ang)));

  for (let j = 0; j < z; j++) {
    const c = (j * 2 * Math.PI) / z;
    // root arc from gap middle to start of rising flank
    const gapStart = c - Math.PI / z;
    const flankRoot = c - phi(u0);
    for (let i = 0; i <= 3; i++) push(gapStart + ((flankRoot - gapStart) * i) / 3, rd);
    // radial bit from root circle up to base circle (if rd < rb)
    if (rd < rb) push(flankRoot, rb);
    // rising involute flank
    for (let i = 1; i <= FLANK_STEPS; i++) {
      const u = u0 + ((uA - u0) * i) / FLANK_STEPS;
      push(c - phi(u), Math.min(rb * Math.sqrt(1 + u * u), ra));
    }
    // tip arc
    push(c + phi(uA), ra);
    // falling involute flank
    for (let i = FLANK_STEPS - 1; i >= 0; i--) {
      const u = u0 + ((uA - u0) * i) / FLANK_STEPS;
      push(c + phi(u), Math.max(rb * Math.sqrt(1 + u * u), rd < rb ? rb : rd));
    }
    if (rd < rb) push(c + phi(u0), rd);
  }

  const shape = new THREE.Shape();
  shape.setFromPoints(pts);
  shape.closePath();
  return { shape, tipRadius: ra, rootRadius: rd, pitchRadius: r };
}

// Annular-sector hole path (for spoked "crossings" in wheels), CCW winding.
function sectorHole(rIn, rOut, a0, a1, cornerR = 0.25) {
  const p = new THREE.Path();
  const n = 8;
  // shrink angles a touch for rounded look
  const da = Math.min(cornerR / rIn, (a1 - a0) * 0.2);
  const b0 = a0 + da, b1 = a1 - da;
  p.moveTo(rIn * Math.cos(b0), rIn * Math.sin(b0));
  for (let i = 1; i <= n; i++) {
    const a = b0 + ((b1 - b0) * i) / n;
    p.lineTo(rIn * Math.cos(a), rIn * Math.sin(a));
  }
  for (let i = 0; i <= n; i++) {
    const a = b1 - ((b1 - b0) * i) / n;
    p.lineTo(rOut * Math.cos(a), rOut * Math.sin(a));
  }
  p.closePath();
  return p;
}

// A complete watch wheel: involute teeth, hub, rim and spoked crossings.
export function makeWheel({
  module: m, teeth: z, thickness = 0.5, holeR = 0.35,
  spokes = 0, hubR = null, rimW = null, material,
}) {
  const { shape, tipRadius, rootRadius, pitchRadius } = involuteGearShape({ module: m, teeth: z });

  // center hole
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  if (spokes > 0) {
    const hr = hubR ?? Math.max(holeR + 0.6, rootRadius * 0.22);
    const rim = rootRadius - (rimW ?? Math.max(0.8, rootRadius * 0.14));
    if (rim > hr + 0.4) {
      const spokeAng = 0.36 / spokes + 0.10; // angular width of each spoke
      for (let i = 0; i < spokes; i++) {
        const a0 = (i * 2 * Math.PI) / spokes + spokeAng;
        const a1 = ((i + 1) * 2 * Math.PI) / spokes - spokeAng;
        if (a1 > a0) shape.holes.push(sectorHole(hr, rim, a0, a1));
      }
    }
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true,
    bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1,
  });
  geo.translate(0, 0, -thickness / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.pitchRadius = pitchRadius;
  mesh.userData.tipRadius = tipRadius;
  return mesh;
}

// Solid pinion (few leaves). Same involute generator, no crossings.
export function makePinion({ module: m, teeth: z, thickness = 0.7, holeR = 0.18, material }) {
  const { shape, pitchRadius } = involuteGearShape({ module: m, teeth: z, pressureAngleDeg: 25 });
  const hole = new THREE.Path();
  hole.absarc(0, 0, Math.min(holeR, pitchRadius * 0.35), 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.pitchRadius = pitchRadius;
  return mesh;
}

// --- Escape wheel: 15 club-toothed wheel of a Swiss lever escapement --------
// Rotates CCW (viewed from +z). Locking faces lead (face CCW direction).
export function makeEscapeWheel({ tipR = 4.2, thickness = 0.32, material }) {
  const z = 15;
  const rimR = tipR * 0.74;
  const pts = [];
  const push = (angDeg, rad) => {
    const a = (angDeg * Math.PI) / 180;
    pts.push(new THREE.Vector2(rad * Math.cos(a), rad * Math.sin(a)));
  };
  const pitch = 360 / z; // 24 deg
  for (let j = 0; j < z; j++) {
    const c = j * pitch;
    // club tooth, leaning into CCW rotation:
    push(c + 0.0, rimR);          // root, trailing side
    push(c + 7.0, tipR * 0.965);  // back of tooth rises
    push(c + 10.5, tipR);         // heel of impulse plane
    push(c + 13.5, tipR * 0.985); // toe / locking corner (flat impulse plane)
    push(c + 14.2, rimR * 1.04);  // steep locking face drops sharply
    // rim arc to next tooth
    for (let i = 1; i <= 4; i++) push(c + 14.2 + ((pitch - 14.2) * i) / 4, rimR);
  }
  const shape = new THREE.Shape();
  shape.setFromPoints(pts);
  shape.closePath();

  // hub hole + 5 slender crossings (classic escape wheel has 4-5)
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.3, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const spokes = 5;
  for (let i = 0; i < spokes; i++) {
    const a0 = (i * 2 * Math.PI) / spokes + 0.22;
    const a1 = ((i + 1) * 2 * Math.PI) / spokes - 0.22;
    shape.holes.push(sectorHole(0.85, rimR - 0.45, a0, a1));
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.tipRadius = tipR;
  return mesh;
}

// Simple ratchet wheel (radial saw teeth) for the barrel arbor / winding works.
export function makeRatchetWheel({ r = 6.5, teeth = 48, thickness = 0.45, holeR = 0.8, material }) {
  const pts = [];
  for (let j = 0; j < teeth; j++) {
    const a0 = (j * 2 * Math.PI) / teeth;
    const a1 = ((j + 1) * 2 * Math.PI) / teeth;
    pts.push(new THREE.Vector2(r * 0.93 * Math.cos(a0), r * 0.93 * Math.sin(a0)));
    pts.push(new THREE.Vector2(r * Math.cos(a0 + (a1 - a0) * 0.55), r * Math.sin(a0 + (a1 - a0) * 0.55)));
  }
  const shape = new THREE.Shape();
  shape.setFromPoints(pts);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  return new THREE.Mesh(geo, material);
}
