// Red Clay Ridge — a 3D showcase of the world's best offroad RC track.
// Procedural heightfield built from a spline centerline with stamped
// jumps, berms and whoops; two AI buggies lap it with ballistic airtime.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

// ---------------------------------------------------------------- utilities
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

let seed = 1337;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

// cheap smooth 2D value noise (deterministic, no textures needed)
function vnoise(x, z) {
  return 0.5 + 0.25 * (Math.sin(x * 1.07 + Math.sin(z * 0.73) * 2.3) +
                       Math.sin(z * 0.91 + Math.sin(x * 0.57) * 1.9));
}
function fnoise(x, z) { // 3 octaves
  return vnoise(x, z) * 0.55 + vnoise(x * 2.7 + 11, z * 2.9 + 7) * 0.3 +
         vnoise(x * 7.1 + 31, z * 6.7 + 17) * 0.15;
}

function makeTextTexture(text, { w = 512, h = 128, bg = '#152238', fg = '#ffffff', font = 'bold 64px system-ui, sans-serif', stroke = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); }
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const tw = g.measureText(text).width, maxW = w - 40;
  if (tw > maxW) { // shrink to fit
    const px = parseInt(font.match(/(\d+)px/)[1], 10);
    g.font = font.replace(/\d+px/, Math.floor(px * maxW / tw) + 'px');
  }
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- centerline
// Control points of the lap (x, z) in meters, in direction of travel.
const CP = [
  [-26, 17], [-14, 17.4], [-2, 17], [12, 17], [22, 16.2],            // start straight + triple
  [27.5, 13.8], [29.2, 11.5], [27.5, 9.2],                           // turn 1
  [22, 7.6], [10, 7.2], [-4, 7.8], [-16, 7.4], [-24, 6.2],           // lane 2, tabletop
  [-28.8, 4], [-30.2, 1.4], [-28.6, -1],                             // turn 2
  [-23, -2.2], [-12, -2.6], [2, -2.2], [14, -2.8], [23, -4],         // lane 3, rhythm
  [27.6, -5.8], [29.2, -8], [27.6, -10.2],                           // turn 3
  [22, -11.6], [10, -12], [-2, -12.4], [-14, -12], [-22, -13],       // lane 4, step-up ridge
  [-27.6, -15], [-29.6, -17.5], [-27.6, -19.8],                      // turn 4
  [-22, -21], [-10, -21.4], [2, -21], [13, -21.4], [21, -20.6],      // lane 5, whoops
  [28, -18], [34.5, -12], [38, -4], [39, 4], [37.5, 12],             // bowl sweeper (climbing)
  [33.5, 19.5], [27, 24.5],
  [18, 26.5], [6, 26.8], [-8, 26.4], [-18, 26],                      // top lane (elevated)
  [-26, 24.6], [-30.4, 21.5], [-30.6, 18.6],                         // final hairpin
];

const curve = new THREE.CatmullRomCurve3(
  CP.map(p => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
curve.arcLengthDivisions = 2400;

const N = 2400;
const L = curve.getLength();
const ds = L / N;
const P = curve.getSpacedPoints(N);          // N+1 points, last === first
const TX = new Float32Array(N), TZ = new Float32Array(N);
const PX = new Float32Array(N), PZ = new Float32Array(N);
for (let i = 0; i < N; i++) {
  PX[i] = P[i].x; PZ[i] = P[i].z;
  const a = P[(i + 1) % N], b = P[(i - 1 + N) % N];
  const dx = a.x - b.x, dz = a.z - b.z, m = Math.hypot(dx, dz) || 1;
  TX[i] = dx / m; TZ[i] = dz / m;
}
// signed curvature (>0 = left turn), lightly smoothed
const KAPPA = new Float32Array(N);
{
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + 3) % N, b = (i - 3 + N) % N;
    let dphi = Math.atan2(-TZ[a], TX[a]) - Math.atan2(-TZ[b], TX[b]);
    if (dphi > Math.PI) dphi -= 2 * Math.PI;
    if (dphi < -Math.PI) dphi += 2 * Math.PI;
    raw[i] = dphi / (6 * ds);
  }
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -8; k <= 8; k++) s += raw[(i + k + N) % N];
    KAPPA[i] = s / 17;
  }
}

function sAt(x, z) { // arc length of nearest centerline sample to a world point
  let best = 0, bd = 1e18;
  for (let i = 0; i < N; i++) {
    const d = (PX[i] - x) ** 2 + (PZ[i] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best * ds;
}
const circ = (s, s0) => { let d = Math.abs(s - s0); return Math.min(d, L - d); };

// ---------------------------------------------------------------- height model
const HALF_W = 2.3;      // track half width
const SHOULDER = 2.6;    // blend distance from track edge to raw ground

// mound: smooth rise over `up`, flat `top`, fall over `down`, height `h`
const mounds = [];
function addMound(s0, up, top, down, h) { mounds.push({ s0, up, top, down, h }); }
function bumps(s) {
  let h = 0;
  for (const m of mounds) {
    const d = s - m.s0;
    if (d < -1 || d > m.up + m.top + m.down + 1) continue;
    h += m.h * smooth01(d / m.up) * (1 - smooth01((d - m.up - m.top) / m.down));
  }
  return h + whoopsH(s);
}

let whoops = { s0: 0, len: 0 };
function whoopsH(s) {
  const d = s - whoops.s0;
  if (d < 0 || d > whoops.len) return 0;
  const env = smooth01(d / 2.2) * smooth01((whoops.len - d) / 2.2);
  return 0.28 * env * (0.5 - 0.5 * Math.cos(2 * Math.PI * d / 2.4));
}

// elevation profile (plateaus) and banked berms are anchored on world points
const S = {}; // anchor arc lengths, filled below
function elev(s) {
  return 1.35 * (smooth01((s - S.stepUp) / 3.2) - smooth01((s - S.stepDn) / 2.6)) +
         1.6 * (smooth01((s - S.climb) / 20) - smooth01((s - S.descend) / 15));
}

const berms = [];  // { s0, half, H, side } — side: +1 banks the t>0 (left) edge
function bermH(s, t) {
  let h = 0;
  for (const b of berms) {
    const d = circ(s, b.s0);
    if (d > b.half) continue;
    const env = smooth01((b.half - d) / (b.half * 0.5));
    h += b.H * env * Math.pow(clamp((t * b.side + 1.0) / (HALF_W + 1.0), 0, 1), 1.7);
  }
  return h;
}

function trackH(s, t) { return elev(s) + bumps(s) + bermH(s, t); }

// ------- feature placement (order of travel)
{
  const sTriple = sAt(-8, 17.2);
  addMound(sTriple, 3.4, 0.5, 1.6, 1.3);          // triple takeoff
  addMound(sTriple + 9.5, 1.6, 0.4, 1.6, 0.85);   // hump 1
  addMound(sTriple + 14.5, 1.6, 0.4, 1.6, 0.85);  // hump 2
  addMound(sTriple + 19.5, 1.4, 0.6, 5.0, 1.05);  // landing ramp

  const sTable = sAt(13, 7.1);
  addMound(sTable, 3.0, 6.0, 3.4, 1.15);          // tabletop

  const sR = sAt(-18, -2.4);                      // double-double rhythm
  addMound(sR, 2.6, 0.4, 1.4, 1.0);
  addMound(sR + 7.2, 1.6, 0.4, 1.6, 0.9);
  addMound(sR + 14.4, 1.6, 0.4, 1.8, 0.92);
  addMound(sR + 21.5, 1.4, 0.5, 4.2, 0.8);
  addMound(sR + 30, 1.9, 0.3, 2.6, 0.55);         // on-power single

  S.stepUp = sAt(16, -11.8);                      // ridge plateau (lane 4)
  S.stepDn = sAt(-11, -12.1);
  addMound(S.stepUp + 1.5, 2.2, 0.3, 1.0, 0.5);   // step-up face kicker
  addMound(S.stepDn - 3.4, 2.0, 0.4, 1.2, 0.5);   // sky-drop launch
  addMound(S.stepDn + 5.0, 1.0, 1.0, 7.0, 0.75);  // drop landing ramp

  whoops = { s0: sAt(-14, -21.3), len: 15 };

  S.climb = sAt(24, -20);                         // bowl sweeper climbs…
  S.descend = sAt(-6, 26.5);                      // …top lane descends to hairpin

  berms.push({ s0: sAt(29.2, 11.5), half: 6.5, H: 0.95, side: -1 });  // T1
  berms.push({ s0: sAt(-30.2, 1.4), half: 6.0, H: 0.9, side: 1 });    // T2
  berms.push({ s0: sAt(29.2, -8), half: 6.5, H: 0.95, side: -1 });    // T3
  berms.push({ s0: sAt(-29.6, -17.5), half: 6.0, H: 0.9, side: 1 });  // T4
  berms.push({ s0: sAt(39, 4), half: 20, H: 0.65, side: 1 });         // bowl
  berms.push({ s0: sAt(-30.4, 21.3), half: 5.5, H: 1.0, side: 1 });   // hairpin
}

const groundH = (x, z) => (fnoise(x * 0.055, z * 0.055) - 0.5) * 1.1 +
                          (fnoise(x * 0.014 + 5, z * 0.014) - 0.5) * 1.6;

// ---------------------------------------------------------------- scene setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe6ddc6, 0.0024);

// gradient sky dome
{
  const skyGeo = new THREE.SphereGeometry(420, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x6099d2) }, hor: { value: new THREE.Color(0xf3e7cf) } },
    vertexShader: 'varying vec3 vp; void main(){ vp=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top,hor; varying vec3 vp; void main(){ float h=normalize(vp).y; gl_FragColor=vec4(mix(hor,top,smoothstep(0.0,0.28,h)),1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

const sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
sun.position.set(65, 58, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xa8c8ee, 0x8a7a58, 0.85));

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
camera.position.set(-55, 42, 62);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(3, 0, 3);
orbit.maxPolarAngle = 1.52;
orbit.maxDistance = 190;
orbit.enableDamping = true;
orbit.autoRotate = true;
orbit.autoRotateSpeed = 0.5;
renderer.domElement.addEventListener('pointerdown', () => orbit.autoRotate = false, { once: true });

// ---------------------------------------------------------------- terrain
const MINX = -57, MAXX = 64, MINZ = -47, MAXZ = 53, STEP = 0.4;
const NX = Math.round((MAXX - MINX) / STEP) + 1;
const NZ = Math.round((MAXZ - MINZ) / STEP) + 1;

// two nearest centerline hits per vertex (separated in s), so parallel lanes
// blend additively into the ground instead of fighting over one sample
function nearestTwo(x, z, out) {
  let b1 = 0, d1 = 1e18;
  for (let i = 0; i < N; i += 6) {
    const d = (PX[i] - x) ** 2 + (PZ[i] - z) ** 2;
    if (d < d1) { d1 = d; b1 = i; }
  }
  for (let k = b1 - 7; k <= b1 + 7; k++) {
    const i2 = (k + N) % N;
    const d = (PX[i2] - x) ** 2 + (PZ[i2] - z) ** 2;
    if (d < d1) { d1 = d; b1 = i2; }
  }
  const sepIdx = Math.round(11 / ds);
  let b2 = -1, d2 = 1e18;
  for (let i = 0; i < N; i += 6) {
    let di = Math.abs(i - b1); di = Math.min(di, N - di);
    if (di < sepIdx) continue;
    const d = (PX[i] - x) ** 2 + (PZ[i] - z) ** 2;
    if (d < d2) { d2 = d; b2 = i; }
  }
  if (b2 >= 0) for (let k = b2 - 7; k <= b2 + 7; k++) {
    const i2 = (k + N) % N;
    let di = Math.abs(i2 - b1); di = Math.min(di, N - di);
    if (di < sepIdx) continue;
    const d = (PX[i2] - x) ** 2 + (PZ[i2] - z) ** 2;
    if (d < d2) { d2 = d; b2 = i2; }
  }
  out.i1 = b1; out.i2 = b2;
}

function laneInfluence(i, x, z) { // lateral offset + blend weight for one lane hit
  const dx = x - PX[i], dz = z - PZ[i];
  const t = dx * TZ[i] - dz * TX[i];           // dot(delta, left) with left=(tz,0,-tx)
  // weight by true distance, not lateral offset: a second-nearest hit far along
  // the same lane is longitudinally distant and must not contribute
  const a = Math.hypot(dx, dz);
  const w = a <= HALF_W ? 1 : 1 - smooth01((a - HALF_W) / SHOULDER);
  return { t, w, s: i * ds };
}

const clay = new THREE.Color(0x8f5c33), clayDark = new THREE.Color(0x6e4525);
const paint = new THREE.Color(0xd8c294);
const grass = new THREE.Color(0x4d6b2a), grassDry = new THREE.Color(0x8a854a);
const dirtOut = new THREE.Color(0x7a5a38);

function buildTerrain() {
  const pos = new Float32Array(NX * NZ * 3);
  const col = new Float32Array(NX * NZ * 3);
  const hit = {};
  const c = new THREE.Color(), c2 = new THREE.Color();
  let vi = 0;
  for (let iz = 0; iz < NZ; iz++) {
    const z = MINZ + iz * STEP;
    for (let ix = 0; ix < NX; ix++, vi++) {
      const x = MINX + ix * STEP;
      nearestTwo(x, z, hit);
      const A = laneInfluence(hit.i1, x, z);
      const B = hit.i2 >= 0 ? laneInfluence(hit.i2, x, z) : { t: 0, w: 0, s: 0 };
      const g = groundH(x, z);
      let h = g;
      if (A.w > 0) h += (trackH(A.s, clamp(A.t, -HALF_W, HALF_W)) - g) * A.w;
      if (B.w > 0) h += (trackH(B.s, clamp(B.t, -HALF_W, HALF_W)) - g) * B.w;

      // color
      const n = fnoise(x * 0.6, z * 0.6);
      const gp = fnoise(x * 0.13 + 40, z * 0.13);
      c.copy(grass).lerp(grassDry, smooth01((gp - 0.42) * 3)).offsetHSL(0, 0, (n - 0.5) * 0.06);
      const w = clamp(A.w + B.w, 0, 1);
      if (w > 0.001) {
        const D = A.w >= B.w ? A : B;
        c2.copy(clay).lerp(clayDark, 0.5 * smooth01((fnoise(x * 0.45 + 9, z * 0.45) - 0.35) * 2));
        if (Math.abs(D.t) < 1.15) c2.lerp(clayDark, 0.28 * smooth01(1 - Math.abs(D.t) / 1.15)); // racing groove
        const slope = (bumps(D.s + 0.5) - bumps(D.s - 0.5));
        if (slope > 0.28 && D.w > 0.6) c2.lerp(paint, clamp((slope - 0.28) * 1.1, 0, 0.35));    // painted faces
        c.lerp(dirtOut, clamp(w * 1.6, 0, 1) * 0.85).lerp(c2, w);
      }
      pos[vi * 3] = x; pos[vi * 3 + 1] = h; pos[vi * 3 + 2] = z;
      col[vi * 3] = c.r; col[vi * 3 + 1] = c.g; col[vi * 3 + 2] = c.b;
    }
  }
  const idx = [];
  for (let iz = 0; iz < NZ - 1; iz++)
    for (let ix = 0; ix < NX - 1; ix++) {
      const a = iz * NX + ix, b = a + 1, cc = a + NX, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}
scene.add(buildTerrain());

// ---------------------------------------------------------------- helpers on the lap
function posAt(s, t = 0, out = new THREE.Vector3()) {
  s = ((s % L) + L) % L;
  const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N, u = f - Math.floor(f);
  const x = lerp(PX[i], PX[j], u), z = lerp(PZ[i], PZ[j], u);
  const lx = lerp(TZ[i], TZ[j], u), lz = -lerp(TX[i], TX[j], u); // left normal
  out.set(x + lx * t, 0, z + lz * t);
  return out;
}
function tanAt(s) {
  s = ((s % L) + L) % L;
  const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N, u = f - Math.floor(f);
  return [lerp(TX[i], TX[j], u), lerp(TZ[i], TZ[j], u)];
}
function kappaAt(s) {
  s = ((s % L) + L) % L;
  const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N, u = f - Math.floor(f);
  return lerp(KAPPA[i], KAPPA[j], u);
}
const surfH = (s, t) => trackH(((s % L) + L) % L, t);

// ---------------------------------------------------------------- trackside
const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7 });

{ // edge pipes along both lane edges
  const pipeGeo = new THREE.CylinderGeometry(0.055, 0.055, 1.35, 6);
  const count = 2 * Math.floor(L / 1.7);
  const inst = new THREE.InstancedMesh(pipeGeo, white, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3(), dir = new THREE.Vector3();
  let k = 0;
  for (let side = -1; side <= 1; side += 2)
    for (let s = 0; s < L - 1 && k < count; s += 1.7) {
      if (kappaAt(s) * side > 0.2) continue; // inside of a tight corner: edge collapses
      const t = side * (HALF_W + 0.28);
      posAt(s, t, p); p.y = surfH(s, side * HALF_W) + 0.07;
      const [tx, tz] = tanAt(s);
      dir.set(tx, (surfH(s + 0.6, side * HALF_W) - surfH(s - 0.6, side * HALF_W)) / 1.2, tz).normalize();
      q.setFromUnitVectors(up, dir);
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(k++, m);
    }
  inst.count = k; inst.castShadow = true;
  scene.add(inst);
}

function addSign(text, x, z, ry, opts = {}) {
  const g = new THREE.Group();
  const tex = makeTextTexture(text, { w: 384, h: 96, bg: opts.bg || '#20304a', stroke: '#ffffff', font: 'bold 46px system-ui, sans-serif' });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
  board.position.y = 1.05; board.castShadow = true;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6), white);
  post.position.y = 0.5;
  g.add(board, post);
  g.position.set(x, groundH(x, z) + trackNudge(x, z), z);
  g.rotation.y = ry;
  scene.add(g);
}
// signs sit just off the shoulders where ground height may be lifted by a lane
function trackNudge(x, z) {
  const hit = {}; nearestTwo(x, z, hit);
  const A = laneInfluence(hit.i1, x, z);
  const g = groundH(x, z);
  return A.w > 0 ? (trackH(A.s, clamp(A.t, -HALF_W, HALF_W)) - g) * A.w : 0;
}

addSign('BIG TRIPLE', 2, 12.4, 0, { bg: '#7a2020' });
addSign('TABLETOP', 8, 11.6, Math.PI, {});
addSign('DOUBLE-DOUBLE', -8, 2.5, 0, { bg: '#7a2020' });
addSign('STEP-UP', 16, -7.4, Math.PI, {});
addSign('SKY DROP', -14, -7.6, Math.PI, { bg: '#7a2020' });
addSign('WHOOPS', -6, -16.6, 0, {});
addSign('THE BOWL', 33, -2, Math.PI / 2, { bg: '#1f4a28' });

{ // start / finish arch
  const g = new THREE.Group();
  const postGeo = new THREE.BoxGeometry(0.22, 2.7, 0.22);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a3346, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, mat);
    p.position.set(0, 1.35, side * 3.6); p.castShadow = true;
    g.add(p);
  }
  const tex = makeTextTexture('RED CLAY RIDGE  RC  RACEWAY', { w: 1024, h: 110, bg: '#b8352a', font: 'bold 58px system-ui, sans-serif' });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 0.8),
    new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  banner.position.y = 2.55; banner.rotation.y = Math.PI / 2; banner.castShadow = true;
  g.add(banner);
  const sp = posAt(1.2, 0); g.position.set(sp.x, surfH(1.2, 0), sp.z);
  const [tx, tz] = tanAt(1.2); g.rotation.y = Math.atan2(-tz, tx);
  scene.add(g);
}

{ // painted start line
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, HALF_W * 2),
    new THREE.MeshStandardMaterial({ color: 0xeeeee8, roughness: 0.85 }));
  const p = posAt(0.6, 0);
  line.position.set(p.x, surfH(0.6, 0) + 0.012, p.z);
  const [tx, tz] = tanAt(0.6);
  line.rotation.y = Math.atan2(-tz, tx);
  scene.add(line);
}

{ // drivers' stand + shade roof + drivers
  const g = new THREE.Group();
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.5, metalness: 0.4 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 0.18, 2.6), deckMat);
  deck.position.y = 3.0; deck.castShadow = deck.receiveShadow = true;
  g.add(deck);
  for (const lx of [-6.6, -2.2, 2.2, 6.6]) for (const lz of [-1.1, 1.1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.0, 0.14), steel);
    leg.position.set(lx, 1.5, lz); leg.castShadow = true;
    g.add(leg);
  }
  for (const ry of [0.95, 3.05]) { // railings front/back
    const rail = new THREE.Mesh(new THREE.BoxGeometry(14, 0.06, 0.06), steel);
    rail.position.set(0, 3.0 + ry, -1.28); g.add(rail);
    const railB = rail.clone(); railB.position.z = 1.28; g.add(railB);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(14.6, 0.08, 3.4),
    new THREE.MeshStandardMaterial({ color: 0xb8352a, roughness: 0.8 }));
  roof.position.y = 5.6; roof.castShadow = true;
  g.add(roof);
  for (const lx of [-7, 7]) for (const lz of [-1.5, 1.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), steel);
    post.position.set(lx, 4.35, lz); g.add(post);
  }
  const shirt = [0xd84b3a, 0x3a6bd8, 0xf0c040, 0x40a860, 0xcccccc];
  for (let i = 0; i < 5; i++) { // drivers on the rostrum
    const d = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.55, 3, 8),
      new THREE.MeshStandardMaterial({ color: shirt[i], roughness: 0.9 }));
    body.position.y = 0.62; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8a882, roughness: 0.9 }));
    head.position.y = 1.14;
    const tx8 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x222630 }));
    tx8.position.set(0, 0.88, -0.24);
    d.add(body, head, tx8);
    d.position.set(-5.2 + i * 2.6, 3.09, -0.4);
    g.add(d);
  }
  const stairs = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.0, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x4a5266, roughness: 0.7 }));
  stairs.position.set(7.9, 1.5, 0); stairs.castShadow = true;
  g.add(stairs);
  g.position.set(2, 0.1, 33.8);
  scene.add(g);
}

{ // pit lane: EZ-up canopies + tables behind the stand
  const cols = [0x3a6bd8, 0xd84b3a, 0x40a860, 0xf0c040, 0x8858c8];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 0.9, 4),
      new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.85 }));
    roof.position.y = 2.55; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    g.add(roof);
    const steel = new THREE.MeshStandardMaterial({ color: 0x555c6c, metalness: 0.4, roughness: 0.5 });
    for (const lx of [-1.4, 1.4]) for (const lz of [-1.4, 1.4]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), steel);
      leg.position.set(lx, 1.1, lz);
      g.add(leg);
    }
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.7 }));
    table.position.y = 0.85; table.castShadow = true;
    g.add(table);
    const cx = -12 + i * 6.5;
    g.position.set(cx, groundH(cx, 38.6) + 0.12, 38.6);
    scene.add(g);
  }
}

{ // sponsor boards along the bowl and back straight
  const ads = [['PRO-TRAX TIRES', '#20304a'], ['CLAYWORX', '#7a2020'], ['VOLT RC', '#1f4a28'],
               ['GRIPMAX FOAMS', '#20304a'], ['AIRTIME ENERGY', '#7a2020'], ['1/8 WORLDS 2026', '#1f4a28']];
  const spots = [[45, -8, -Math.PI / 2], [46, 4, -Math.PI / 2], [44, 16, -Math.PI / 2],
                 [-6, -28.5, 0], [8, -28.5, 0], [-20, -28.5, 0]];
  ads.forEach(([txt, bg], i) => {
    const [x, z, ry] = spots[i];
    const tex = makeTextTexture(txt, { w: 768, h: 128, bg, stroke: '#ffffff' });
    const b = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.95),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }));
    b.position.set(x, groundH(x, z) + 0.75, z); b.rotation.y = ry; b.castShadow = true;
    scene.add(b);
  });
}

{ // perimeter fence
  const fx0 = -42, fx1 = 49, fz0 = -32, fz1 = 41.5;
  const post = new THREE.CylinderGeometry(0.045, 0.045, 1.25, 5);
  const steel = new THREE.MeshStandardMaterial({ color: 0x7a8290, roughness: 0.6, metalness: 0.3 });
  const pts = [];
  for (let x = fx0; x <= fx1; x += 4.5) { pts.push([x, fz0]); pts.push([x, fz1]); }
  for (let z = fz0; z <= fz1; z += 4.5) { pts.push([fx0, z]); pts.push([fx1, z]); }
  const inst = new THREE.InstancedMesh(post, steel, pts.length);
  const m = new THREE.Matrix4();
  pts.forEach(([x, z], i) => {
    m.makeTranslation(x, groundH(x, z) + 0.62, z);
    inst.setMatrixAt(i, m);
  });
  scene.add(inst);
  const meshMat = new THREE.MeshStandardMaterial({ color: 0x30363f, transparent: true, opacity: 0.35, side: THREE.DoubleSide, roughness: 0.9 });
  const mkPanel = (w, x, z, ry) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.15), meshMat);
    p.position.set(x, 0.75, z); p.rotation.y = ry;
    scene.add(p);
  };
  mkPanel(fx1 - fx0, (fx0 + fx1) / 2, fz0, 0);
  mkPanel(fx1 - fx0, (fx0 + fx1) / 2, fz1, 0);
  mkPanel(fz1 - fz0, fx0, (fz0 + fz1) / 2, Math.PI / 2);
  mkPanel(fz1 - fz0, fx1, (fz0 + fz1) / 2, Math.PI / 2);
}

{ // tire stacks behind the four 180° berms + hairpin
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.95 });
  const tire = new THREE.CylinderGeometry(0.34, 0.34, 0.55, 10);
  const spots = [];
  for (const b of berms.slice(0, 4).concat([berms[5]])) {
    for (let k = -2; k <= 2; k++) {
      const s = b.s0 + k * 1.6;
      const p = posAt(s, b.side * (HALF_W + 1.9));
      spots.push([p.x, p.z, surfH(s, b.side * HALF_W)]);
    }
  }
  const inst = new THREE.InstancedMesh(tire, tireMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, h], i) => { m.makeTranslation(x, h + 0.28, z); inst.setMatrixAt(i, m); });
  inst.castShadow = true;
  scene.add(inst);
}

{ // trees outside the fence
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x39592b, roughness: 0.95 });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x4c6e2f, roughness: 0.95 });
  let placed = 0;
  while (placed < 46) {
    const x = MINX + 3 + rand() * (MAXX - MINX - 6);
    const z = MINZ + 3 + rand() * (MAXZ - MINZ - 6);
    if (x > -44.5 && x < 51.5 && z > -34.5 && z < 43.5) continue; // stay outside the fence
    placed++;
    const g = new THREE.Group();
    const sc = 0.8 + rand() * 1.1;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6), trunkMat);
    trunk.position.y = 0.8;
    g.add(trunk);
    if (rand() < 0.6) {
      const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.2, 8), leafMat);
      c1.position.y = 2.8; c1.castShadow = true;
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 8), leafMat2);
      c2.position.y = 4.2; c2.castShadow = true;
      g.add(c1, c2);
    } else {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), leafMat2);
      ball.position.y = 3.0; ball.scale.y = 0.85; ball.castShadow = true;
      g.add(ball);
    }
    g.scale.setScalar(sc);
    g.position.set(x, groundH(x, z), z);
    scene.add(g);
  }
}

{ // a few soft clouds
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g2 = c.getContext('2d');
  const grad = g2.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g2.fillStyle = grad; g2.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, opacity: 0.8, fog: false }));
    sp.scale.setScalar(30 + rand() * 40);
    sp.position.set(-120 + rand() * 260, 55 + rand() * 30, -140 + rand() * 260);
    scene.add(sp);
  }
}

// ---------------------------------------------------------------- buggies
function buildBuggy(bodyColor, accColor) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.1 });
  const accMat = new THREE.MeshStandardMaterial({ color: accColor, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.26), dark);
  chassis.position.y = 0.09; chassis.castShadow = true;
  g.add(chassis);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.11, 0.24), bodyMat);
  shell.position.set(-0.01, 0.17, 0); shell.castShadow = true;
  g.add(shell);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.2), bodyMat);
  nose.position.set(0.26, 0.14, 0); nose.rotation.z = -0.25; nose.castShadow = true;
  g.add(nose);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.18), accMat);
  cab.position.set(-0.06, 0.27, 0); cab.castShadow = true;
  g.add(cab);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.015, 0.3), accMat);
  wing.position.set(-0.3, 0.28, 0); wing.rotation.z = 0.14; wing.castShadow = true;
  g.add(wing);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.015), dark);
    post.position.set(-0.28, 0.22, side * 0.09);
    g.add(post);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 4), dark);
  antenna.position.set(-0.12, 0.35, 0.05); antenna.rotation.x = 0.15;
  g.add(antenna);

  const wheelGeo = new THREE.CylinderGeometry(0.083, 0.083, 0.07, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.072, 8);
  hubGeo.rotateX(Math.PI / 2);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xf0c040, roughness: 0.5 });
  const wheels = [], steer = [];
  for (const [wx, wz, front] of [[0.19, 0.18, 1], [0.19, -0.18, 1], [-0.19, 0.19, 0], [-0.19, -0.19, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.083, wz);
    const w = new THREE.Mesh(wheelGeo, dark);
    w.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    pivot.add(w, hub);
    g.add(pivot);
    wheels.push(w); wheels.push(hub);
    if (front) steer.push(pivot);
  }
  g.scale.setScalar(1.7); // slightly larger than true 1/8 so it reads from the stand
  return { group: g, wheels, steer };
}

// per-sample speed profile: corner-limited + zone caps, then accel/brake passes
const V = new Float32Array(N);
{
  const VMAX = 15.5, ALAT = 8, ABRK = 6.5, AACC = 5.2;
  const caps = [
    { s0: sAt(-18, -2.4) - 6, s1: sAt(-18, -2.4) + 34, v: 8.2 },    // rhythm
    { s0: whoops.s0 - 4, s1: whoops.s0 + whoops.len + 2, v: 7.5 },  // whoops
    { s0: sAt(13, 7.1) - 5, s1: sAt(13, 7.1) + 13, v: 12 },       // tabletop
    { s0: S.stepUp - 6, s1: S.stepDn + 10, v: 11 },               // ridge
  ];
  for (let i = 0; i < N; i++) {
    let v = Math.min(VMAX, Math.sqrt(ALAT / Math.max(Math.abs(KAPPA[i]), 1e-4)));
    const s = i * ds;
    for (const c of caps) if (s > c.s0 && s < c.s1) v = Math.min(v, c.v);
    V[i] = v;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--)
      V[i] = Math.min(V[i], Math.sqrt(V[(i + 1) % N] ** 2 + 2 * ABRK * ds));
    V[N - 1] = Math.min(V[N - 1], Math.sqrt(V[0] ** 2 + 2 * ABRK * ds));
    for (let i = 0; i < N; i++)
      V[(i + 1) % N] = Math.min(V[(i + 1) % N], Math.sqrt(V[i] ** 2 + 2 * AACC * ds));
  }
}
function vAt(s) {
  s = ((s % L) + L) % L;
  const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N;
  return lerp(V[i], V[j], f - Math.floor(f));
}
// smoothed line offset: ride the outside (berm) in corners
const TCAR = new Float32Array(N);
{
  for (let i = 0; i < N; i++) TCAR[i] = clamp(-KAPPA[i] * 26, -1.4, 1.4);
  for (let pass = 0; pass < 30; pass++)
    for (let i = 0; i < N; i++)
      TCAR[i] = (TCAR[(i - 1 + N) % N] + TCAR[i] * 2 + TCAR[(i + 1) % N]) / 4;
}
function tCarAt(s) {
  s = ((s % L) + L) % L;
  const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N;
  return lerp(TCAR[i], TCAR[j], f - Math.floor(f));
}

class Buggy {
  constructor(color, acc, s0, tBias) {
    const b = buildBuggy(color, acc);
    this.group = b.group; this.wheels = b.wheels; this.steer = b.steer;
    this.s = s0; this.tBias = tBias;
    this.h = surfH(s0, 0); this.vh = 0; this.air = false; this.airT = 0;
    this.pitch = 0; this.roll = 0;
    this.v = 5;
    scene.add(this.group);
  }
  update(dt, isPlayerCam) {
    const vTarget = vAt(this.s);
    this.v += clamp(vTarget - this.v, -6.5 * dt, 5.2 * dt);
    this.s = (this.s + this.v * dt) % L;
    const t = tCarAt(this.s) + this.tBias;
    const g = surfH(this.s, t);

    if (!this.air) {
      const vhG = (g - this.h) / dt; // vertical speed the ground demands
      // launch when the ground curls away faster than gravity can pull the car down
      if (this.vh > 0.5 && (vhG - this.vh) / dt < -9.81 * 1.2) {
        this.air = true; this.airT = 0;
      } else {
        this.h = g; this.vh = vhG;
      }
    }
    if (this.air) {
      this.vh -= 9.81 * dt;
      this.h += this.vh * dt;
      this.airT += dt;
      if (this.h <= g) {
        this.air = false;
        const impact = -this.vh;
        this.h = g; this.vh = 0;
        if (impact > 2 && this.airT > 0.25) {
          spawnDust(this.group.position, 10, impact * 0.1);
          if (isPlayerCam) flashAir(this.airT);
        }
      }
    }

    // pose
    const p = posAt(this.s, t);
    this.group.position.set(p.x, this.h + 0.02, p.z);
    const [tx, tz] = tanAt(this.s);
    let fy;
    if (this.air) {
      this.pitch = lerp(this.pitch, -0.22, 1 - Math.exp(-1.8 * dt));
      this.roll = lerp(this.roll, 0, 1 - Math.exp(-3 * dt));
      fy = this.pitch;
    } else {
      const ahead = surfH(this.s + 0.45, t), behind = surfH(this.s - 0.45, t);
      fy = Math.atan2(ahead - behind, 0.9);
      this.pitch = fy;
      const hl = surfH(this.s, t + 0.26), hr = surfH(this.s, t - 0.26);
      this.roll = lerp(this.roll, Math.atan2(hl - hr, 0.52), 1 - Math.exp(-10 * dt));
      // berm roost
      if (Math.abs(kappaAt(this.s)) * this.v * this.v > 5.5 && Math.random() < dt * 22)
        spawnDust(this.group.position, 1, 0.5);
    }
    // build frame: forward F pitched by fy, then roll about F
    const F = new THREE.Vector3(tx, Math.tan(clamp(fy, -1.2, 1.2)), tz).normalize();
    const right = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, F).normalize();
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const up2 = up.clone().multiplyScalar(cr).addScaledVector(right, sr);
    const right2 = new THREE.Vector3().crossVectors(F, up2).normalize();
    const m = new THREE.Matrix4().makeBasis(F, up2, right2);
    this.group.quaternion.setFromRotationMatrix(m);

    // wheels
    const spin = this.v / 0.14 * dt;
    for (const w of this.wheels) w.rotation.z -= spin;
    const sk = kappaAt(this.s);
    const steerA = clamp(Math.atan(sk * 0.33) * 3, -0.5, 0.5);
    for (const pv of this.steer) pv.rotation.y = lerp(pv.rotation.y, steerA, 1 - Math.exp(-12 * dt));
  }
}

// dust particles
const dustPool = [];
{
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g2 = c.getContext('2d');
  const grad = g2.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(190,150,105,0.85)'); grad.addColorStop(1, 'rgba(190,150,105,0)');
  g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 140; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    sp.visible = false;
    sp.userData = { life: 0, ttl: 1, vel: new THREE.Vector3() };
    scene.add(sp);
    dustPool.push(sp);
  }
}
let dustIdx = 0;
function spawnDust(pos, n, power) {
  for (let i = 0; i < n; i++) {
    const sp = dustPool[dustIdx = (dustIdx + 1) % dustPool.length];
    sp.visible = true;
    sp.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.05, (Math.random() - 0.5) * 0.5));
    sp.userData.life = 0;
    sp.userData.ttl = 0.6 + Math.random() * 0.6;
    sp.userData.vel.set((Math.random() - 0.5) * 1.4, (0.6 + Math.random()) * (0.8 + power), (Math.random() - 0.5) * 1.4);
    sp.scale.setScalar(0.25 + Math.random() * 0.3);
  }
}
function updateDust(dt) {
  for (const sp of dustPool) {
    if (!sp.visible) continue;
    const u = sp.userData;
    u.life += dt;
    if (u.life > u.ttl) { sp.visible = false; continue; }
    const k = u.life / u.ttl;
    sp.position.addScaledVector(u.vel, dt);
    u.vel.y = Math.max(u.vel.y - 2.2 * dt, 0.15);
    sp.scale.setScalar(sp.scale.x + dt * 1.6);
    sp.material.opacity = 0.55 * (1 - k);
  }
}

const car1 = new Buggy(0xe85420, 0x1a1c20, 4, 0.15);   // orange leader
const car2 = new Buggy(0x2464d8, 0xf0c040, L - 22, -0.2); // blue chaser

// ---------------------------------------------------------------- cameras & HUD
const MODES = ['orbit', 'chase', 'stand', 'onboard'];
let camMode = 0;
const camButtons = MODES.map(mo => document.getElementById('camOrbit'.replace('Orbit', mo[0].toUpperCase() + mo.slice(1))));
function setCam(i) {
  camMode = i;
  camButtons.forEach((b, k) => b.classList.toggle('on', k === i));
  orbit.enabled = i === 0;
  if (i === 0) { camera.fov = 55; camera.updateProjectionMatrix(); }
}
camButtons.forEach((b, i) => b.addEventListener('click', () => setCam(i)));
addEventListener('keydown', e => { if (e.key === 'c' || e.key === 'C') setCam((camMode + 1) % MODES.length); });

const spdEl = document.getElementById('spd');
const lapEl = document.getElementById('lap');
const lastEl = document.getElementById('lastlap');
const airEl = document.getElementById('air');
let lap = 1, lapStart = 0, prevS = car1.s, airTimer = 0;
function flashAir(t) { airEl.textContent = `AIR ${t.toFixed(2)} s`; airTimer = 1.6; }

const STAND_EYE = new THREE.Vector3(2, 5.15, 31.8);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

function updateCamera(dt, now) {
  const car = car1;
  if (camMode === 0) { orbit.update(); return; }
  if (camMode === 1) { // chase
    const q = car.group.quaternion;
    tmpV.set(-1, 0, 0).applyQuaternion(q).setY(0).normalize();
    tmpV2.copy(car.group.position).addScaledVector(tmpV, 3.4); tmpV2.y = car.group.position.y + 1.1;
    camera.position.lerp(tmpV2, 1 - Math.exp(-4.5 * dt));
    tmpV2.copy(car.group.position).addScaledVector(tmpV, -1.4); tmpV2.y += 0.3;
    camera.lookAt(tmpV2);
    camera.fov = 60;
  } else if (camMode === 2) { // drivers' stand, with auto zoom
    camera.position.copy(STAND_EYE);
    tmpV2.copy(car.group.position);
    camera.lookAt(tmpV2);
    const d = camera.position.distanceTo(tmpV2);
    camera.fov = clamp(1600 / d, 14, 45);
  } else { // onboard
    const q = car.group.quaternion;
    tmpV.set(1, 0, 0).applyQuaternion(q);
    camera.position.copy(car.group.position).addScaledVector(tmpV, 0.1);
    camera.position.y += 0.55;
    tmpV2.copy(camera.position).addScaledVector(tmpV, 8); tmpV2.y -= 0.4;
    camera.lookAt(tmpV2);
    camera.fov = 75;
  }
  camera.updateProjectionMatrix();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- main loop
document.getElementById('loading').remove();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  car1.update(dt, true);
  car2.update(dt, false);
  updateDust(dt);
  updateCamera(dt, now);

  if (car1.s < prevS - L * 0.5) { // crossed start/finish
    lap++;
    const t = (now - lapStart) / 1000;
    if (lapStart > 0) lastEl.textContent = `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
    lapStart = now;
    lapEl.textContent = lap;
  }
  prevS = car1.s;
  spdEl.textContent = Math.round(car1.v * 3.6);
  if (airTimer > 0) { airTimer -= dt; if (airTimer <= 0) airEl.textContent = ''; }

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
