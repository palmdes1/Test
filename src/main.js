import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMaterials } from './materials.js';
import { buildMovement } from './movement.js';
import { dialTime } from './kinematics.js';

const params = new URLSearchParams(location.search);
const HEADLESS = params.get('headless') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(HEADLESS ? 1 : Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1014);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 500);

// environment reflections
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
}

// lights
{
  const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
  key.position.set(14, -18, 42);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -40;
  key.shadow.camera.right = key.shadow.camera.top = 40;
  key.shadow.camera.far = 120;
  key.shadow.bias = -0.0006;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.7);
  fill.position.set(-26, 20, 24);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.45);
  rim.position.set(0, 30, -10);
  scene.add(rim);
}

// pedestal for shadow catch
{
  const ped = new THREE.Mesh(
    new THREE.CylinderGeometry(44, 48, 3, 96),
    new THREE.MeshStandardMaterial({ color: 0x16181e, metalness: 0.2, roughness: 0.85 }));
  ped.rotation.x = Math.PI / 2;
  ped.position.z = -5.6;
  ped.receiveShadow = true;
  scene.add(ped);
}

const M = createMaterials();
const movement = buildMovement(M);
movement.root.traverse((o) => {
  if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
});
scene.add(movement.root);

// --- camera system ----------------------------------------------------------
export const VIEWS = {
  overview:   { target: [0, 0, 2.5], dist: 72, az: -32, el: 40 },
  topdown:    { target: [0, 0, 2.5], dist: 70, az: 0, el: 89 },
  escapement: { target: [-8.8, -10.6, 3.0], dist: 13, az: 10, el: 78 },
  balance:    { target: [-11.5, -16.7, 5.4], dist: 16, az: -38, el: 55 },
  train:      { target: [1.5, -8.5, 2.5], dist: 28, az: -12, el: 68 },
  barrel:     { target: [-7, 12, 2.6], dist: 30, az: 22, el: 60 },
  motion:     { target: [1.5, 3, 4.8], dist: 19, az: 8, el: 66 },
  side:       { target: [0, 0, 3], dist: 60, az: -55, el: 16 },
  hands:      { target: [0, -2, 4.5], dist: 46, az: 0, el: 72 },
};

function applyView(v) {
  const az = (v.az * Math.PI) / 180, el = (v.el * Math.PI) / 180;
  const t = new THREE.Vector3(...v.target);
  camera.position.set(
    t.x + v.dist * Math.cos(el) * Math.sin(az),
    t.y - v.dist * Math.cos(el) * Math.cos(az),
    t.z + v.dist * Math.sin(el));
  camera.lookAt(t);
  if (controls) { controls.target.copy(t); controls.update(); }
}

let controls = null;
if (!HEADLESS) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
}

// --- HUD ---------------------------------------------------------------------
const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;left:12px;top:12px;color:#cfd6e4;font:14px/1.5 monospace;' +
  'background:rgba(10,12,16,.72);padding:10px 14px;border-radius:8px;white-space:pre;display:none';
document.body.appendChild(hud);

function fmtTime(t) {
  const s = Math.floor(t % 60), m = Math.floor((t / 60) % 60), h = Math.floor((t / 3600) % 12) || 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- time & render -----------------------------------------------------------
const now = new Date();
let baseTime = params.has('t')
  ? parseFloat(params.get('t'))
  : dialTime(now.getHours(), now.getMinutes(), now.getSeconds()) + now.getMilliseconds() / 1000;
const clock = new THREE.Clock();

function renderAt(t) {
  movement.update(t);
  hud.textContent = `watch time  ${fmtTime(t)}\nbeat        ${(t * 5).toFixed(1)}\n18,000 bph · 2.5 Hz balance`;
  renderer.render(scene, camera);
}

// headless control API
window.app = {
  shoot({ view, az, el, dist, target, t, hud: showHud, hideBridges }) {
    const v = { ...(VIEWS[view] ?? VIEWS.overview) };
    if (az !== undefined) v.az = az;
    if (el !== undefined) v.el = el;
    if (dist !== undefined) v.dist = dist;
    if (target !== undefined) v.target = target;
    applyView(v);
    movement.root.traverse((o) => {
      if (o.userData.tag === 'bridge') o.visible = !hideBridges;
    });
    hud.style.display = showHud ? 'block' : 'none';
    renderAt(t ?? baseTime);
    return true;
  },
  views: Object.keys(VIEWS),
};

applyView(VIEWS[params.get('view')] ?? VIEWS.overview);

if (!HEADLESS) {
  hud.style.display = 'block';
  let viewIdx = 0;
  addEventListener('keydown', (e) => {
    const names = Object.keys(VIEWS);
    if (e.key === 'v') { viewIdx = (viewIdx + 1) % names.length; applyView(VIEWS[names[viewIdx]]); }
    if (e.key === 'h') hud.style.display = hud.style.display === 'none' ? 'block' : 'none';
  });
  renderer.setAnimationLoop(() => {
    controls.update();
    renderAt(baseTime + clock.getElapsedTime());
  });
} else {
  renderAt(baseTime);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

window.__READY = true;
