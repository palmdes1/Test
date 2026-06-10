import * as THREE from 'three';
import { makeWheel, makePinion, makeEscapeWheel, makeRatchetWheel } from './gears.js';
import { anglesAt, TEETH, BALANCE_AMP } from './kinematics.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Layout. Mesh distances are exact: dist = module*(zWheel+zPinion)/2.
// Modules: barrel/center 0.3, center/third 0.35, third/fourth 0.32,
// fourth/escape 0.26, motion works 0.5.
// ---------------------------------------------------------------------------
export const L = {
  plateR: 27.5,
  center: new THREE.Vector2(0, 0),
  barrel: new THREE.Vector2(-7.2, 12.47),     // 14.4 @ 120deg
  third: new THREE.Vector2(10.91, -6.30),     // 12.6 @ -30deg
  fourth: new THREE.Vector2(1.05, -10.90),    // third + 10.88 @ 205deg
  escape: new THREE.Vector2(-8.81, -9.16),    // fourth + 10.01 @ 170deg
  palletPivot: new THREE.Vector2(-10.73, -14.42),
  balance: new THREE.Vector2(-11.55, -16.68),
  minuteWheel: new THREE.Vector2(5.66, 5.66), // 8.0 @ 45deg
  // z planes
  zBarrelTeeth: 2.4, zCenterWheel: 3.45, zThirdWheel: 1.3, zFourthWheel: 2.0,
  zEscapeWheel: 2.85, zFork: 3.6, zBalanceRim: 5.65, zHairspring: 6.05,
  zTrainBridge: [4.15, 4.7], zBarrelBridge: [3.3, 3.9], zCock: [6.9, 7.5],
  zMotion: 4.6, zHourWheel: 5.45,
  balanceRimR: 6.2,
  escapeTipR: 4.2,
};

const MOD = { m1: 0.3, m2: 0.35, m3: 0.32, m4: 0.26, m5: 0.4 };

// --- gear mesh phase alignment ----------------------------------------------
// Wheel A (zA teeth, extra phase pA) meshes wheel B at world direction phi
// (angle of vector A->B). Kinematics guarantee thetaB = -(zA/zB)*thetaA;
// this returns pB so that a tooth of A meets a gap of B on the center line.
function alignDriven(zA, pA, zB, phi) {
  return phi + Math.PI - Math.PI / zB + (zA / zB) * (phi - pA);
}
function alignDriver(zB, pB, zA, phi) {
  return phi - (zB / zA) * (pB - phi - Math.PI + Math.PI / zB);
}
const dirTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

// --- small part helpers ------------------------------------------------------
function cyl(rTop, rBot, h, mat, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.rotation.x = Math.PI / 2; // axis along z
  return m;
}

function jewel(M, r = 0.55) {
  const g = new THREE.Group();
  g.userData.tag = 'bridge';
  const chaton = cyl(r * 1.75, r * 1.75, 0.16, M.gold);
  const stone = cyl(r, r * 0.8, 0.22, M.ruby);
  stone.position.z = 0.08;
  g.add(chaton, stone);
  return g;
}

function screw(M, r = 0.45) {
  const g = new THREE.Group();
  g.userData.tag = 'bridge';
  const head = cyl(r, r, 0.18, M.bluedSteel);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(r * 1.7, r * 0.28, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x0a0c12, metalness: 0.8, roughness: 0.5 }));
  slot.position.z = 0.09;
  slot.rotation.z = Math.random() * Math.PI;
  g.add(head, slot);
  return g;
}

// Smooth closed blob from control points -> THREE.Shape
function blobShape(pts2) {
  const v3 = pts2.map((p) => new THREE.Vector3(p[0], p[1], 0));
  const curve = new THREE.CatmullRomCurve3(v3, true, 'catmullrom', 0.6);
  const samples = curve.getPoints(96);
  const shape = new THREE.Shape();
  shape.setFromPoints(samples.map((p) => new THREE.Vector2(p.x, p.y)));
  shape.closePath();
  return shape;
}

function bridge(M, outline, z0, z1, mat, arbors = []) {
  const shape = blobShape(outline);
  for (const a of arbors) {
    const h = new THREE.Path();
    h.absarc(a.x, a.y, 0.42, 0, TAU, true);
    shape.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: z1 - z0, bevelEnabled: true,
    bevelThickness: 0.22, bevelSize: 0.3, bevelSegments: 3,
  });
  const mesh = new THREE.Mesh(geo, mat ?? M.bridge);
  mesh.position.z = z0;
  mesh.userData.tag = 'bridge';
  return mesh;
}

// Archimedean flat hairspring ribbon as an extruded 2D shape.
function hairspringMesh(M, { rIn = 0.7, rOut = 4.3, turns = 9, w = 0.075, h = 0.28, a0 = 0 }) {
  const N = turns * 40;
  const outer = [], inner = [];
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * turns * TAU;
    const r = rIn + ((rOut - rIn) * th) / (turns * TAU);
    const a = a0 + th;
    outer.push(new THREE.Vector2((r + w) * Math.cos(a), (r + w) * Math.sin(a)));
    inner.push(new THREE.Vector2((r - w) * Math.cos(a), (r - w) * Math.sin(a)));
  }
  const shape = new THREE.Shape();
  shape.setFromPoints(outer.concat(inner.reverse()));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  return new THREE.Mesh(geo, M.bluedSteel);
}

// ---------------------------------------------------------------------------
export function buildMovement(M) {
  const root = new THREE.Group();
  const rot = {}; // name -> {obj, phase} updated each frame

  const place = (obj, p, z) => { obj.position.set(p.x, p.y, z); root.add(obj); return obj; };

  // === Main plate ===========================================================
  {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, L.plateR, 0, TAU, false);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 2.0, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.4, bevelSegments: 3,
    });
    const plate = new THREE.Mesh(geo, M.plate);
    plate.position.z = -2.0;
    root.add(plate);
    // lower pivot jewels visible in the plate top
    for (const p of [L.third, L.fourth, L.escape, L.palletPivot, L.balance]) {
      const j = jewel(M, 0.5);
      j.position.set(p.x, p.y, 0.06);
      root.add(j);
    }
  }

  // === Barrel (drum + visible mainspring + teeth) ===========================
  {
    const g = new THREE.Group();
    const drumR = 11.9;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(drumR, drumR, 2.2, 64, 1, true), M.gold);
    wall.rotation.x = Math.PI / 2;
    wall.position.z = 1.5;
    const bottom = cyl(drumR, drumR, 0.25, M.gold);
    bottom.position.z = 0.5;
    // top cover: ring with 3 window cutouts
    const cover = (() => {
      const s = new THREE.Shape();
      s.absarc(0, 0, drumR, 0, TAU, false);
      const hub = new THREE.Path();
      hub.absarc(0, 0, 1.6, 0, TAU, true);
      s.holes.push(hub);
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * TAU + 0.45, a1 = ((i + 1) / 3) * TAU - 0.45;
        const hole = new THREE.Path();
        const rA = 3.6, rB = 9.8, n = 10, pts = [];
        for (let k = 0; k <= n; k++) pts.push(new THREE.Vector2(rA * Math.cos(a0 + ((a1 - a0) * k) / n), rA * Math.sin(a0 + ((a1 - a0) * k) / n)));
        for (let k = n; k >= 0; k--) pts.push(new THREE.Vector2(rB * Math.cos(a0 + ((a1 - a0) * k) / n), rB * Math.sin(a0 + ((a1 - a0) * k) / n)));
        hole.setFromPoints(pts);
        hole.closePath();
        s.holes.push(hole);
      }
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: false }), M.gold);
      m.position.z = 2.58;
      return m;
    })();
    g.add(wall, bottom, cover);
    // mainspring: flat spiral visible through the cover windows
    const ms = hairspringMesh(M, { rIn: 2.1, rOut: 10.6, turns: 5.5, w: 0.16, h: 1.5, a0: 0.8 });
    ms.material = M.steel;
    ms.position.z = 0.85;
    g.add(ms);
    // gear teeth ring
    const teethRing = makeWheel({ module: MOD.m1, teeth: TEETH.barrel, thickness: 0.55, holeR: 10.9, material: M.gold });
    teethRing.position.z = L.zBarrelTeeth;
    g.add(teethRing);
    const arbor = cyl(0.9, 0.9, 4.4, M.steel);
    arbor.position.z = 2.0;
    g.add(arbor);
    place(g, L.barrel, 0);
    rot.barrel = { obj: g, phase: 0 };
  }

  // === Train wheel assemblies ==============================================
  function wheelAssembly(name, pos, parts) {
    const g = new THREE.Group();
    for (const p of parts) g.add(p);
    place(g, pos, 0);
    rot[name] = { obj: g, phase: 0 };
    return g;
  }

  // center wheel + pinion + tall arbor (cannon rides it visually)
  {
    const wheel = makeWheel({ module: MOD.m2, teeth: TEETH.center, thickness: 0.5, holeR: 0.6, spokes: 5, material: M.brassWheel });
    wheel.position.z = L.zCenterWheel;
    const pinion = makePinion({ module: MOD.m1, teeth: TEETH.centerPinion, thickness: 0.8, material: M.steel });
    pinion.position.z = L.zBarrelTeeth;
    const arbor = cyl(0.42, 0.42, 6.6, M.steel);
    arbor.position.z = 3.3;
    wheelAssembly('center', L.center, [wheel, pinion, arbor]);
  }

  // third wheel
  {
    const wheel = makeWheel({ module: MOD.m3, teeth: TEETH.third, thickness: 0.45, holeR: 0.45, spokes: 5, material: M.brassWheel });
    wheel.position.z = L.zThirdWheel;
    const pinion = makePinion({ module: MOD.m2, teeth: TEETH.thirdPinion, thickness: 0.8, material: M.steel });
    pinion.position.z = L.zCenterWheel;
    const arbor = cyl(0.3, 0.3, 3.6, M.steel);
    arbor.position.z = 2.4;
    wheelAssembly('third', L.third, [wheel, pinion, arbor]);
  }

  // fourth wheel (seconds)
  {
    const wheel = makeWheel({ module: MOD.m4, teeth: TEETH.fourth, thickness: 0.4, holeR: 0.4, spokes: 5, material: M.brassWheel });
    wheel.position.z = L.zFourthWheel;
    const pinion = makePinion({ module: MOD.m3, teeth: TEETH.fourthPinion, thickness: 0.7, material: M.steel });
    pinion.position.z = L.zThirdWheel;
    const arbor = cyl(0.26, 0.26, 4.1, M.steel);
    arbor.position.z = 2.9;
    wheelAssembly('fourth', L.fourth, [wheel, pinion, arbor]);
  }

  // escape wheel
  {
    const wheel = makeEscapeWheel({ tipR: L.escapeTipR, thickness: 0.32, material: M.polishedSteel });
    wheel.position.z = L.zEscapeWheel;
    const pinion = makePinion({ module: MOD.m4, teeth: TEETH.escapePinion, thickness: 0.6, material: M.steel });
    pinion.position.z = L.zFourthWheel;
    const arbor = cyl(0.22, 0.22, 2.8, M.steel);
    arbor.position.z = 2.9;
    wheelAssembly('escape', L.escape, [wheel, pinion, arbor]);
  }

  // === Motion works =========================================================
  {
    // cannon pinion on center arbor
    const cannon = makePinion({ module: MOD.m5, teeth: TEETH.cannon, thickness: 0.5, holeR: 0.45, material: M.steel });
    cannon.position.z = L.zMotion;
    const pipe = cyl(0.72, 0.72, 1.7, M.steel);
    pipe.position.z = L.zMotion + 0.95;
    const g1 = new THREE.Group();
    g1.add(cannon, pipe);
    place(g1, L.center, 0);
    rot.cannon = { obj: g1, phase: 0 };

    // minute wheel + pinion on a stud post
    const mw = makeWheel({ module: MOD.m5, teeth: TEETH.minuteWheel, thickness: 0.4, holeR: 0.35, spokes: 4, material: M.gold });
    mw.position.z = L.zMotion;
    const mp = makePinion({ module: MOD.m5, teeth: TEETH.minutePinion, thickness: 0.5, material: M.steel });
    mp.position.z = L.zHourWheel;
    const g2 = new THREE.Group();
    g2.add(mw, mp);
    place(g2, L.minuteWheel, 0);
    rot.minuteWheel = { obj: g2, phase: 0 };
    const post = cyl(0.3, 0.3, 5.6, M.gold);
    post.position.set(L.minuteWheel.x, L.minuteWheel.y, 2.8);
    root.add(post);

    // hour wheel on the cannon pipe
    const hw = makeWheel({ module: MOD.m5, teeth: TEETH.hourWheel, thickness: 0.4, holeR: 1.25, spokes: 4, material: M.gold });
    hw.position.z = L.zHourWheel;
    const hpipe = cyl(1.18, 1.18, 0.5, M.gold);
    hpipe.position.z = L.zHourWheel + 0.25;
    const g3 = new THREE.Group();
    g3.add(hw, hpipe);
    place(g3, L.center, 0);
    rot.hourWheel = { obj: g3, phase: 0 };
  }

  // === Pallet fork ==========================================================
  let forkGroup;
  {
    forkGroup = new THREE.Group();
    const mat = M.polishedSteel;
    const t = 0.5; // body thickness, plane z handled by group position
    // local frame: +y points to escape wheel center
    const stoneL = new THREE.Vector2(-2.16, 2.0);
    const stoneR = new THREE.Vector2(2.16, 2.0);
    const armTo = (p, w) => {
      const len = p.length();
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, len, t), mat);
      b.position.set(p.x / 2, p.y / 2, 0);
      b.rotation.z = Math.atan2(p.y, p.x) - Math.PI / 2;
      return b;
    };
    forkGroup.add(armTo(stoneL, 0.7), armTo(stoneR, 0.7));
    // tail toward balance with fork head
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.45, t), mat);
    tail.position.set(0, -0.72, 0);
    forkGroup.add(tail);
    // fork head: two horns leaving a slot for the impulse pin
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, t), mat);
      horn.position.set(s * 0.32, -1.65, 0);
      forkGroup.add(horn);
    }
    // guard pin
    const guard = cyl(0.05, 0.05, 0.5, M.steel);
    guard.position.set(0, -1.9, -0.18);
    forkGroup.add(guard);
    // pallet stones (ruby), seated at the arm ends with their long axis
    // pointing at the escape wheel, dipping into its plane
    const escLocal = new THREE.Vector2(0, 5.6);
    for (const [p, tweak] of [[stoneL, 0.21], [stoneR, -0.21]]) {
      const d = p.clone().sub(escLocal); // radial dir from escape center
      const ang = Math.atan2(d.y, d.x) - Math.PI / 2;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.25, 1.35), M.ruby);
      const out = d.clone().normalize().multiplyScalar(0.25);
      stone.position.set(p.x + out.x, p.y + out.y, -0.42);
      stone.rotation.z = ang + tweak;
      forkGroup.add(stone);
    }
    // staff
    const staff = cyl(0.26, 0.26, 1.6, M.steel);
    forkGroup.add(staff);
    forkGroup.position.set(L.palletPivot.x, L.palletPivot.y, L.zFork);
    const base = dirTo(L.palletPivot, L.escape) - Math.PI / 2;
    forkGroup.userData.baseRot = base;
    root.add(forkGroup);
  }

  // === Balance assembly =====================================================
  let balanceGroup, hairspring;
  {
    balanceGroup = new THREE.Group();
    const rimR = L.balanceRimR;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.45, 16, 72), M.gold);
    rim.scale.z = 0.62;
    rim.position.z = L.zBalanceRim;
    balanceGroup.add(rim);
    // timing screws around the rim
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 12), M.polishedSteel);
      s.rotation.z = Math.PI / 2;
      s.position.set((rimR + 0.55) * Math.cos(a), (rimR + 0.55) * Math.sin(a), L.zBalanceRim);
      s.rotation.z = a + Math.PI / 2;
      balanceGroup.add(s);
    }
    // arms
    for (const a of [0, Math.PI]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(rimR * 2 - 0.6, 0.62, 0.3), M.gold);
      arm.rotation.z = a + Math.PI / 4;
      arm.position.z = L.zBalanceRim;
      balanceGroup.add(arm);
    }
    // staff
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 7.0, 20), M.polishedSteel);
    staff.rotation.x = Math.PI / 2;
    staff.position.z = 3.6;
    balanceGroup.add(staff);
    const hub = cyl(0.55, 0.55, 0.8, M.polishedSteel);
    hub.position.z = L.zBalanceRim;
    balanceGroup.add(hub);
    // roller table + impulse pin (ruby) that engages the fork slot
    const roller = cyl(1.25, 1.05, 0.45, M.darkSteel);
    roller.position.z = 3.06;
    balanceGroup.add(roller);
    const pinDir = dirTo(L.balance, L.palletPivot);
    const pin = cyl(0.17, 0.17, 0.85, M.ruby);
    pin.position.set(0.95 * Math.cos(pinDir), 0.95 * Math.sin(pinDir), 3.6);
    balanceGroup.add(pin);
    // collet
    const collet = cyl(0.42, 0.42, 0.35, M.bluedSteel);
    collet.position.z = L.zHairspring + 0.14;
    balanceGroup.add(collet);
    balanceGroup.position.set(L.balance.x, L.balance.y, 0);
    root.add(balanceGroup);

    // hairspring (world-fixed outer end; breathes via scale)
    const studDir = dirTo(L.balance, new THREE.Vector2(-23, -8.4));
    hairspring = hairspringMesh(M, { rIn: 0.8, rOut: 4.25, turns: 7, w: 0.06, h: 0.26, a0: studDir });
    hairspring.material = new THREE.MeshStandardMaterial({ color: 0x16307f, metalness: 1.0, roughness: 0.35 });
    hairspring.position.set(L.balance.x, L.balance.y, L.zHairspring);
    root.add(hairspring);
    // stud pin from cock down to outer coil
    const stud = cyl(0.22, 0.22, 0.75, M.steel);
    stud.position.set(L.balance.x + 4.45 * Math.cos(studDir), L.balance.y + 4.45 * Math.sin(studDir), L.zCock[0] - 0.35);
    root.add(stud);
  }

  // === Bridges ==============================================================
  // barrel bridge (upper left), covers barrel, carries ratchet wheel
  {
    const br = bridge(M, [
      [10.9, 22.4], [4.3, 24.6], [-4.3, 24.6], [-12.5, 21.6], [-19.1, 16.0],
      [-23.4, 8.5], [-24.7, 3.5], [-19.0, 3.8], [-13.5, 6.3], [-8.5, 9.0],
      [-3.3, 12.0], [2.2, 13.7], [6.8, 16.5],
    ], L.zBarrelBridge[0], L.zBarrelBridge[1], M.bridge, [L.barrel]);
    root.add(br);
    // feet screws
    for (const p of [[8.5, 21.5], [-21.5, 7.5], [-13, 21]]) {
      const s = screw(M, 0.5);
      s.position.set(p[0], p[1], L.zBarrelBridge[1] + 0.22);
      root.add(s);
    }
    // ratchet wheel on barrel arbor above the bridge
    const rw = makeRatchetWheel({ r: 5.8, teeth: 48, thickness: 0.42, holeR: 0.95, material: M.gold });
    rw.userData.tag = 'bridge';
    rw.position.set(L.barrel.x, L.barrel.y, L.zBarrelBridge[1] + 0.3);
    root.add(rw);
    const rs = screw(M, 0.85);
    rs.position.set(L.barrel.x, L.barrel.y, L.zBarrelBridge[1] + 0.56);
    root.add(rs);
    // crown wheel beside it
    const cw = makeRatchetWheel({ r: 3.6, teeth: 36, thickness: 0.4, holeR: 0.55, material: M.gold });
    cw.userData.tag = 'bridge';
    cw.position.set(-15.2, 17.4, L.zBarrelBridge[1] + 0.28);
    root.add(cw);
    const cs = screw(M, 0.6);
    cs.position.set(-15.2, 17.4, L.zBarrelBridge[1] + 0.52);
    root.add(cs);
  }

  // train bridge (lower right), jewels for third/fourth/escape
  {
    // slim finger hugging the third -> fourth -> escape arbor line,
    // with a foot pad out to the plate edge at the south-east
    const br = bridge(M, [
      [14.6, -4.2], [19.8, -6.0], [21.0, -10.2], [17.6, -13.2], [13.0, -12.6],
      [7.6, -13.4], [3.2, -13.8], [-1.8, -12.8], [-5.8, -11.9],
      [-8.2, -10.9], [-10.6, -10.4], [-11.0, -8.6], [-9.4, -7.8], [-7.0, -8.3],
      [-2.4, -8.6], [2.4, -8.4], [6.6, -7.6], [9.4, -4.6], [12.0, -3.2],
    ], L.zTrainBridge[0], L.zTrainBridge[1], M.bridge, [L.third, L.fourth, L.escape]);
    root.add(br);
    for (const p of [L.third, L.fourth, L.escape]) {
      const j = jewel(M, 0.55);
      j.position.set(p.x, p.y, L.zTrainBridge[1] + 0.1);
      root.add(j);
    }
    for (const p of [[18.4, -9.4], [-10.2, -9.3]]) {
      const s = screw(M, 0.5);
      s.position.set(p[0], p[1], L.zTrainBridge[1] + 0.22);
      root.add(s);
    }
    // feet down to the plate
    for (const p of [[18.4, -7.6], [-10.4, -10.6]]) {
      const f = cyl(1.1, 1.3, L.zTrainBridge[0], M.bridge);
      f.position.set(p[0], p[1], L.zTrainBridge[0] / 2);
      root.add(f);
    }
  }

  // pallet cock: small sliver over the lever pivot
  {
    const br = bridge(M, [
      [-14.6, -17.2], [-12.2, -16.1], [-10.2, -14.9], [-9.8, -13.7],
      [-11.4, -13.0], [-13.2, -14.7], [-15.2, -16.2],
    ], 4.2, 4.7, M.bridge, [L.palletPivot]);
    root.add(br);
    const j = jewel(M, 0.45);
    j.position.set(L.palletPivot.x, L.palletPivot.y, 4.8);
    root.add(j);
    const s = screw(M, 0.45);
    s.position.set(-13.9, -15.9, 4.92);
    root.add(s);
  }

  // balance cock: slim arm from the west edge over the balance axis
  {
    const br = bridge(M, [
      [-26.0, -5.4], [-23.6, -4.4], [-20.6, -6.8], [-17.0, -10.6], [-13.8, -13.3],
      [-11.0, -13.6], [-9.4, -14.5], [-8.5, -16.7], [-9.4, -18.9], [-11.6, -19.8],
      [-13.7, -18.9], [-14.7, -16.7], [-16.8, -14.6], [-20.0, -11.0],
      [-23.2, -7.6], [-25.8, -6.2],
    ], L.zCock[0], L.zCock[1], M.bridge, [L.balance]);
    root.add(br);
    // jewel + polished cap over the balance staff
    const boss = cyl(1.7, 1.9, 0.5, M.gold);
    boss.position.set(L.balance.x, L.balance.y, L.zCock[1] + 0.2);
    root.add(boss);
    const j = jewel(M, 0.5);
    j.position.set(L.balance.x, L.balance.y, L.zCock[1] + 0.5);
    root.add(j);
    const s = screw(M, 0.55);
    s.position.set(-23.6, -5.9, L.zCock[1] + 0.22);
    root.add(s);
    // regulator index lever
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.0, 0.16), M.polishedSteel);
    lever.position.set(L.balance.x - 1.2, L.balance.y - 2.2, L.zCock[0] - 0.12);
    lever.rotation.z = 0.5;
    root.add(lever);
  }

  // === Seconds subdial + chapter ring + hands ===============================
  const hands = {};
  {
    // small-seconds ring on the train bridge
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.05, 4.85, 64), M.silverDial);
    ring.userData.tag = 'bridge';
    ring.position.set(L.fourth.x, L.fourth.y, L.zTrainBridge[1] + 0.06);
    root.add(ring);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.6 }));
      tick.userData.tag = 'bridge';
      tick.position.set(L.fourth.x + 4.42 * Math.sin(a), L.fourth.y + 4.42 * Math.cos(a), L.zTrainBridge[1] + 0.1);
      tick.rotation.z = -a;
      root.add(tick);
    }

    // chapter ring with applied markers and a printed minute track
    const chap = new THREE.Mesh(new THREE.RingGeometry(22.0, 23.6, 128), M.silverDial);
    chap.position.z = 5.0;
    root.add(chap);
    const tickMat = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.6 });
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU;
      if (i % 5 === 0) continue;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.06), tickMat);
      tick.position.set(23.0 * Math.sin(a), 23.0 * Math.cos(a), 5.04);
      tick.rotation.z = -a;
      root.add(tick);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const len = i % 3 === 0 ? 1.6 : 1.1;
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.5, len, 0.22), M.gold);
      marker.position.set(22.8 * Math.sin(a), 22.8 * Math.cos(a), 5.12);
      marker.rotation.z = -a;
      root.add(marker);
    }
    for (const a of [Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 0.262]) {
      const foot = cyl(0.55, 0.7, 5.0, M.gold);
      foot.position.set(22.6 * Math.cos(a), 22.6 * Math.sin(a), 2.5);
      root.add(foot);
    }

    // hands: blued steel, lance style
    function hand(len, w, hub) {
      const g = new THREE.Group();
      const s = new THREE.Shape();
      s.moveTo(-w, 0);
      s.lineTo(-w * 0.32, len * 0.78);
      s.lineTo(0, len);
      s.lineTo(w * 0.32, len * 0.78);
      s.lineTo(w, 0);
      s.lineTo(w * 0.55, -len * 0.16);
      s.lineTo(-w * 0.55, -len * 0.16);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false });
      const m = new THREE.Mesh(geo, M.bluedSteel);
      g.add(m);
      const boss = cyl(hub, hub, 0.22, M.bluedSteel);
      g.add(boss);
      return g;
    }
    hands.hour = hand(11.5, 0.85, 1.45);
    hands.hour.position.set(0, 0, 6.08);
    hands.minute = hand(20.5, 0.62, 1.0);
    hands.minute.position.set(0, 0, 6.5);
    hands.second = hand(4.4, 0.2, 0.45);
    hands.second.position.set(L.fourth.x, L.fourth.y, L.zTrainBridge[1] + 0.22);
    root.add(hands.hour, hands.minute, hands.second);
  }

  // === Crown & stem =========================================================
  {
    const stem = cyl(0.5, 0.5, 3.4, M.steel);
    stem.rotation.set(0, Math.PI / 2, 0);
    stem.position.set(L.plateR + 0.8, 0, 1.2);
    root.add(stem);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.7, 24), M.gold);
    crown.rotation.z = Math.PI / 2;
    crown.position.set(L.plateR + 3.3, 0, 1.2);
    root.add(crown);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const flute = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 0.35), M.gold);
      flute.position.set(L.plateR + 3.3, 2.2 * Math.cos(a), 1.2 + 2.2 * Math.sin(a));
      flute.rotation.x = -a;
      root.add(flute);
    }
  }

  // === Tooth-phase alignment so meshes visibly engage ======================
  {
    // escape assembly phase 0; propagate backwards through the train
    rot.escape.phase = 0;
    rot.fourth.phase = alignDriven(TEETH.escapePinion, rot.escape.phase, TEETH.fourth, dirTo(L.escape, L.fourth));
    rot.third.phase = alignDriver(TEETH.fourthPinion, rot.fourth.phase, TEETH.third, dirTo(L.third, L.fourth));
    rot.center.phase = alignDriver(TEETH.thirdPinion, rot.third.phase, TEETH.center, dirTo(L.center, L.third));
    rot.barrel.phase = alignDriver(TEETH.centerPinion, rot.center.phase, TEETH.barrel, dirTo(L.barrel, L.center));
    rot.cannon.phase = rot.center.phase;
    rot.minuteWheel.phase = alignDriven(TEETH.cannon, rot.cannon.phase, TEETH.minuteWheel, dirTo(L.center, L.minuteWheel));
    rot.hourWheel.phase = alignDriven(TEETH.minutePinion, rot.minuteWheel.phase, TEETH.hourWheel, dirTo(L.minuteWheel, L.center));
  }

  // === per-frame update =====================================================
  function update(t) {
    const a = anglesAt(t);
    rot.barrel.obj.rotation.z = a.barrel + rot.barrel.phase;
    rot.center.obj.rotation.z = a.center + rot.center.phase;
    rot.third.obj.rotation.z = a.third + rot.third.phase;
    rot.fourth.obj.rotation.z = a.fourth + rot.fourth.phase;
    rot.escape.obj.rotation.z = a.escape + rot.escape.phase;
    rot.cannon.obj.rotation.z = a.cannon + rot.cannon.phase;
    rot.minuteWheel.obj.rotation.z = a.minuteWheel + rot.minuteWheel.phase;
    rot.hourWheel.obj.rotation.z = a.hourWheel + rot.hourWheel.phase;

    forkGroup.rotation.z = forkGroup.userData.baseRot + a.fork;
    balanceGroup.rotation.z = a.balance;
    const breathe = 1 + 0.045 * Math.sin(a.balance / BALANCE_AMP * Math.PI * 0.5);
    hairspring.scale.set(breathe, breathe, 1);

    hands.hour.rotation.z = a.hourHand;
    hands.minute.rotation.z = a.minuteHand;
    hands.second.rotation.z = a.secondHand;
  }

  return { root, update };
}
