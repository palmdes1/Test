// Canvas software 3D renderer: driver's-stand camera with auto-zoom,
// painter's algorithm. Same camera model as tools/render_video.py.

export class StandCamera {
  constructor(stand) {
    this.eye = [stand.x, stand.y, stand.z];
    this.look = null;
    this.fov = Math.PI / 6;
    this.mode = 'stand'; // 'stand' | 'chase' | 'top'
  }

  update(car, dt) {
    if (this.mode === 'stand') {
      const t = [car.x, car.y, 0.05];
      if (!this.look) this.look = t.slice();
      const k = dt / (0.13 + dt);
      for (let i = 0; i < 3; i++) this.look[i] += k * (t[i] - this.look[i]);
      const dist = Math.hypot(this.look[0] - this.eye[0], this.look[1] - this.eye[1], this.look[2] - this.eye[2]);
      const fovT = Math.min(Math.max(2 * Math.atan(2.4 / Math.max(dist, 1)), 0.24), 0.91);
      const kf = dt / (0.35 + dt);
      this.fov += kf * (fovT - this.fov);
      this._eye = this.eye;
    } else if (this.mode === 'chase') {
      const back = 1.4, ht = 0.55;
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
      const tgt = [car.x - back * cy, car.y - back * sy, ht];
      if (!this._chase) this._chase = tgt.slice();
      const k = dt / (0.18 + dt);
      for (let i = 0; i < 3; i++) this._chase[i] += k * (tgt[i] - this._chase[i]);
      this._eye = this._chase;
      this.look = [car.x, car.y, 0.1];
      this.fov = 1.0;
    } else {
      this._eye = [car.x, car.y + 0.01, 22];
      this.look = [car.x, car.y, 0];
      this.fov = 0.9;
    }
  }

  basis(w, h) {
    const eye = this._eye || this.eye;
    let f0 = this.look[0] - eye[0], f1 = this.look[1] - eye[1], f2 = this.look[2] - eye[2];
    const fl = Math.hypot(f0, f1, f2); f0 /= fl; f1 /= fl; f2 /= fl;
    let r0, r1, r2;
    if (Math.abs(f2) > 0.999) { r0 = 1; r1 = 0; r2 = 0; }
    else {
      r0 = f1; r1 = -f0; r2 = 0; // fwd x up(z)
      const rl = Math.hypot(r0, r1); r0 /= rl; r1 /= rl;
    }
    const u0 = r1 * f2 - r2 * f1, u1 = r2 * f0 - r0 * f2, u2 = r0 * f1 - r1 * f0;
    const f = (h / 2) / Math.tan(this.fov / 2);
    return { eye, fwd: [f0, f1, f2], right: [r0, r1, r2], up: [u0, u1, u2], f, w, h };
  }
}

function project(p, B) {
  const dx = p[0] - B.eye[0], dy = p[1] - B.eye[1], dz = p[2] - B.eye[2];
  const d = dx * B.fwd[0] + dy * B.fwd[1] + dz * B.fwd[2];
  const x = dx * B.right[0] + dy * B.right[1] + dz * B.right[2];
  const y = dx * B.up[0] + dy * B.up[1] + dz * B.up[2];
  const e = Math.max(d, 1e-3);
  return [B.w / 2 + B.f * x / e, B.h / 2 - B.f * y / e, d];
}

const LIGHT = (() => {
  const v = [0.45, 0.25, 0.86];
  const l = Math.hypot(...v);
  return v.map(x => x / l);
})();

function shade(color, pts) {
  const v1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
  const v2 = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
  let n = [v1[1] * v2[2] - v1[2] * v2[1], v1[2] * v2[0] - v1[0] * v2[2], v1[0] * v2[1] - v1[1] * v2[0]];
  const ln = Math.hypot(...n) || 1;
  const lam = Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / ln);
  const b = 0.55 + 0.45 * lam;
  return `rgb(${color.map(c => Math.min(255, c * b) | 0).join(',')})`;
}

export function buildCarPolys(p, car) {
  const hl = p.halfLength, hw = p.halfWidth, rw = p.wheelRadius, a = p.a, tw = p.track / 2;
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const roll = car.phi || 0, pitch = car.theta || 0;
  let tiltBody = false; // shell tilts with chassis, wheels stay on the ground
  const tr = (lx, ly, lz) => [
    car.x + lx * cy - ly * sy,
    car.y + lx * sy + ly * cy,
    lz + (tiltBody ? ly * roll - lx * pitch : 0)
  ];
  const polys = [];
  const box = (x0, x1, y0, y1, z0, z1, color) => {
    const c = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    for (const fc of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]) {
      polys.push({ pts: fc.map(i => tr(...c[i])), color });
    }
  };
  tiltBody = true;
  box(-hl, hl, -hw, hw, 0.012, 0.052, [235, 90, 30]);
  box(-hl * 0.55, hl * 0.45, -hw * 0.78, hw * 0.78, 0.052, 0.105, [40, 60, 85]);
  box(-hl * 0.5, hl * 0.4, -hw * 0.25, hw * 0.25, 0.105, 0.108, [250, 250, 250]);
  box(-hl - 0.005, -hl + 0.035, -hw * 0.85, hw * 0.85, 0.085, 0.095, [235, 90, 30]);
  tiltBody = false;
  // wheels (hex prisms)
  const wheels = [[a, tw, car.steer], [a, -tw, car.steer], [-a, tw, 0], [-a, -tw, 0]];
  for (const [wxp, wyp, st] of wheels) {
    const cs = Math.cos(st), sn = Math.sin(st);
    const ring = [];
    for (let i = 0; i < 6; i++) ring.push([rw * Math.cos(Math.PI / 3 * i), rw * Math.sin(Math.PI / 3 * i)]);
    for (const side of [-1, 1]) {
      const pts = ring.map(([cx, cz]) => {
        const lx = cx, ly = side * 0.013, lz = cz + rw;
        return tr(wxp + lx * cs - ly * sn, wyp + lx * sn + ly * cs, lz);
      });
      polys.push({ pts, color: [25, 26, 30] });
    }
    for (let i = 0; i < 6; i++) {
      const quad = [[ring[i], -1], [ring[(i + 1) % 6], -1], [ring[(i + 1) % 6], 1], [ring[i], 1]].map(([c, side]) => {
        const lx = c[0], ly = side * 0.013, lz = c[1] + rw;
        return tr(wxp + lx * cs - ly * sn, wyp + lx * sn + ly * cs, lz);
      });
      polys.push({ pts: quad, color: [15, 15, 17] });
    }
  }
  return polys;
}

export function drawScene(ctx, B, groundPolys, solidPolys) {
  const { w, h } = B;
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#6094d2'); g.addColorStop(1, '#bed7ee');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // ground below horizon
  if (Math.abs(B.up[2]) > 1e-6) {
    const ys = [0, w].map(sx => {
      const a = (sx - w / 2) / B.f;
      const b = -(B.fwd[2] + a * B.right[2]) / B.up[2];
      return h / 2 - B.f * b;
    });
    ctx.fillStyle = '#607a4e';
    ctx.beginPath();
    ctx.moveTo(0, ys[0]); ctx.lineTo(w, ys[1]); ctx.lineTo(w, h + 10); ctx.lineTo(0, h + 10);
    ctx.closePath(); ctx.fill();
  }

  const drawPoly = (pts, fill) => {
    let anyVisible = false, behind = false;
    const scr = pts.map(p => {
      const s = project(p, B);
      if (s[2] < 0.05) behind = true;
      if (s[0] > -200 && s[0] < w + 200 && s[1] > -200 && s[1] < h + 200) anyVisible = true;
      return s;
    });
    if (behind || !anyVisible) return;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(scr[0][0], scr[0][1]);
    for (let i = 1; i < scr.length; i++) ctx.lineTo(scr[i][0], scr[i][1]);
    ctx.closePath(); ctx.fill();
  };

  // ground decals: layered by z, cull by distance
  for (const gp of groundPolys) {
    const cen = gp.cen;
    const d = (cen[0] - B.eye[0]) * B.fwd[0] + (cen[1] - B.eye[1]) * B.fwd[1] + (cen[2] - B.eye[2]) * B.fwd[2];
    if (d < 0.15 || d > 140) continue;
    drawPoly(gp.pts, `rgb(${gp.color.join(',')})`);
  }
  // solids: painter by depth
  const items = [];
  for (const sp of solidPolys) {
    const cen = sp.cen || centroid(sp.pts);
    const d = (cen[0] - B.eye[0]) * B.fwd[0] + (cen[1] - B.eye[1]) * B.fwd[1] + (cen[2] - B.eye[2]) * B.fwd[2];
    if (d < 0.15 || d > 140) continue;
    items.push({ d, sp });
  }
  items.sort((p, q) => q.d - p.d);
  for (const { sp } of items) drawPoly(sp.pts, shade(sp.color, sp.pts));
}

export function centroid(pts) {
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  const n = pts.length;
  return [x / n, y / n, z / n];
}

/** Split track geometry into pre-sorted ground decals and solid polys. */
export function prepareGeometry(geom) {
  const ground = [], solid = [];
  for (const g of geom) {
    const item = { pts: g.pts, color: g.color, cen: centroid(g.pts) };
    if (g.kind === 'ground') ground.push(item); else solid.push(item);
  }
  ground.sort((a, b) => a.pts[0][2] - b.pts[0][2]);
  return { ground, solid };
}
