import * as THREE from 'three';

// Procedural Geneva stripes (Côtes de Genève) texture for rhodium bridges.
function genevaTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#cdd2da';
  g.fillRect(0, 0, 512, 512);
  const stripe = 46;
  for (let x = -512; x < 1024; x += stripe) {
    const grad = g.createLinearGradient(x, 0, x + stripe, 0);
    grad.addColorStop(0.0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.45, 'rgba(70,78,92,0.20)');
    grad.addColorStop(0.55, 'rgba(50,56,70,0.34)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0.5)');
    g.fillStyle = grad;
    g.save();
    g.translate(256, 256); g.rotate(-0.35); g.translate(-256, -256);
    g.fillRect(x, -300, stripe, 1100);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Perlage (overlapping circular graining) for the main plate.
function perlageTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#c39b4a';
  g.fillRect(0, 0, 1024, 1024);
  const step = 56;
  for (let row = 0; row < 1024 / step + 2; row++) {
    for (let col = 0; col < 1024 / step + 2; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0);
      const y = row * step;
      const grad = g.createRadialGradient(x, y, 4, x, y, step * 0.78);
      grad.addColorStop(0, 'rgba(255,240,200,0.50)');
      grad.addColorStop(0.7, 'rgba(150,110,40,0.25)');
      grad.addColorStop(1, 'rgba(70,50,15,0.32)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, step * 0.78, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Fine circular sunburst graining for wheels.
function sunburstTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#d8b05c';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1400; i++) {
    const a = Math.random() * Math.PI * 2;
    g.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,240,200' : '110,80,25'},${0.05 + Math.random() * 0.1})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(256 + 20 * Math.cos(a), 256 + 20 * Math.sin(a));
    g.lineTo(256 + 280 * Math.cos(a), 256 + 280 * Math.sin(a));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Printed chapter-ring artwork: ivory band, minute track, Roman numerals.
// Drawn in plan view; mapped planar onto the ring geometry.
// geomR = outer radius of the ring geometry in world units.
export function chapterTexture(geomR, rIn, rOut) {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const u = S / 2 / geomR; // world unit -> px
  const cx = S / 2, cy = S / 2;
  // ivory band
  g.fillStyle = '#ece7da';
  g.beginPath();
  g.arc(cx, cy, rOut * u, 0, Math.PI * 2);
  g.arc(cx, cy, rIn * u, 0, Math.PI * 2, true);
  g.fill();
  // minute track
  g.strokeStyle = '#23262e';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    g.lineWidth = big ? 5 : 2.5;
    const r0 = (big ? rOut - 0.85 : rOut - 0.6) * u;
    const r1 = (rOut - 0.18) * u;
    g.beginPath();
    g.moveTo(cx + r0 * Math.sin(a), cy - r0 * Math.cos(a));
    g.lineTo(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a));
    g.stroke();
  }
  // Roman numerals, upright-radial orientation
  const numerals = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  g.fillStyle = '#16181d';
  g.font = `bold ${Math.round(0.95 * u)}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rN = (rIn + 0.78) * u;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save();
    g.translate(cx + rN * Math.sin(a), cy - rN * Math.cos(a));
    g.rotate(a);
    g.fillText(numerals[i], 0, 0);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createMaterials() {
  const geneva = genevaTexture();
  const perlage = perlageTexture();
  const sunburst = sunburstTexture();

  // ExtrudeGeometry UVs are in world units; scale textures to physical size.
  // One geneva stripe ~= 2 world units, perlage cell ~= 3, sunburst spans wheels.
  geneva.repeat.set(1 / 22, 1 / 22);
  perlage.repeat.set(1 / 56, 1 / 56);
  perlage.offset.set(0.5, 0.5);
  sunburst.repeat.set(1 / 26, 1 / 26);
  sunburst.offset.set(0.5, 0.5);
  sunburst.wrapS = sunburst.wrapT = THREE.RepeatWrapping;

  return {
    plate: new THREE.MeshStandardMaterial({
      map: perlage, color: 0xd9b569, metalness: 0.85, roughness: 0.46,
    }),
    bridge: new THREE.MeshStandardMaterial({
      map: geneva, color: 0xdfe4ec, metalness: 0.92, roughness: 0.3,
    }),
    brassWheel: new THREE.MeshStandardMaterial({
      map: sunburst, color: 0xe6c178, metalness: 0.95, roughness: 0.3,
    }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xdcb45e, metalness: 1.0, roughness: 0.34,
    }),
    steel: new THREE.MeshStandardMaterial({
      color: 0xc9cdd4, metalness: 1.0, roughness: 0.3,
    }),
    polishedSteel: new THREE.MeshStandardMaterial({
      color: 0xe9ecf2, metalness: 1.0, roughness: 0.12,
    }),
    bluedSteel: new THREE.MeshStandardMaterial({
      color: 0x2a4fd0, metalness: 1.0, roughness: 0.22,
    }),
    darkSteel: new THREE.MeshStandardMaterial({
      color: 0x6a6f78, metalness: 1.0, roughness: 0.42,
    }),
    ruby: new THREE.MeshPhysicalMaterial({
      color: 0xc4103c, metalness: 0.1, roughness: 0.08,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      transparent: true, opacity: 0.92,
      emissive: 0x550014, emissiveIntensity: 0.5,
    }),
    silverDial: new THREE.MeshStandardMaterial({
      color: 0xe8e4da, metalness: 0.35, roughness: 0.55,
    }),
  };
}
