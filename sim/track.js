// Track construction: dense closed centerline polylines with width, plus
// 3D scenery geometry (asphalt, edge lines, boards, checker strip, driver stand)
// shared by the browser renderer and the offline video renderer.

const STEP = 0.15; // centerline sample spacing, m

function arcPoints(cx, cy, r, a0, a1, ccw) {
  // sample arc from a0 to a1 (radians), direction given by ccw
  let sweep = ccw ? a1 - a0 : a0 - a1;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(2, Math.ceil((sweep * r) / STEP));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = ccw ? a0 + (sweep * i) / n : a0 - (sweep * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function linePoints(x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.ceil(len / STEP));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
  }
  return pts;
}

function finalize(name, rawPts, width, standPos, startNearest) {
  // rotate point array so index 0 is the start/finish location
  let best = 0, bd = Infinity;
  for (let i = 0; i < rawPts.length; i++) {
    const d = Math.hypot(rawPts[i][0] - startNearest[0], rawPts[i][1] - startNearest[1]);
    if (d < bd) { bd = d; best = i; }
  }
  const pts = rawPts.slice(best).concat(rawPts.slice(0, best));

  const n = pts.length;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    s[i] = s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const length = s[n - 1] + Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]);

  // outward normals (left of travel direction)
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + 1) % n], b = pts[(i - 1 + n) % n];
    const tx = a[0] - b[0], ty = a[1] - b[1];
    const tl = Math.hypot(tx, ty) || 1;
    normals.push([-ty / tl, tx / tl]);
  }

  return { name, pts, normals, s, length, width, halfWidth: width / 2, stand: standPos };
}

export function buildOval() {
  // Stadium oval: 22 m straights, 5 m radius turns, 3.5 m lane. ~75 m lap.
  const R = 5, X = 11;
  const pts = [
    ...linePoints(-X, -R, X, -R),          // front straight (south side), heading +x
    ...arcPoints(X, 0, R, -Math.PI / 2, Math.PI / 2, true),  // turn 1-2 (east)
    ...linePoints(X, R, -X, R),            // back straight
    ...arcPoints(-X, 0, R, Math.PI / 2, -Math.PI / 2, true)  // turn 3-4 (west)
  ];
  return finalize('oval', pts, 3.5, { x: 0, y: -9.5, z: 2.3 }, [-4, -5]);
}

export function buildFigure8() {
  // Two 6 m radius circles 16 m apart joined by crossing straights, 3 m lane.
  const r = 6, d = 8; // circle centers at (+-d, 0)
  const beta = Math.asin(r / d); // tangent line angle through origin
  const c = Math.cos(beta), si = Math.sin(beta);

  // tangent feet (see geometry: line dir u=(cos b, sin b), foot = (center . u) u)
  const footA_plus = [-d * c * c, -d * c * si];   // on circle A, line +beta
  const footB_plus = [d * c * c, d * c * si];     // on circle B, line +beta
  const footA_minus = [-d * c * c, d * c * si];   // on circle A, line -beta
  const footB_minus = [d * c * c, -d * c * si];   // on circle B, line -beta

  const angA_in = Math.atan2(footA_minus[1], footA_minus[0] + d);   // entry on A
  const angA_out = Math.atan2(footA_plus[1], footA_plus[0] + d);    // exit from A
  const angB_in = Math.atan2(footB_plus[1], footB_plus[0] - d);     // entry on B
  const angB_out = Math.atan2(footB_minus[1], footB_minus[0] - d);  // exit from B

  const pts = [
    ...arcPoints(-d, 0, r, angA_in, angA_out, true),                 // around A, CCW
    ...linePoints(footA_plus[0], footA_plus[1], footB_plus[0], footB_plus[1]),
    ...arcPoints(d, 0, r, angB_in, angB_out, false),                 // around B, CW
    ...linePoints(footB_minus[0], footB_minus[1], footA_minus[0], footA_minus[1])
  ];
  return finalize('figure8', pts, 3.0, { x: 0, y: -10.5, z: 2.3 }, [-14, 0]);
}

export function buildTrack(name) {
  return name === 'figure8' ? buildFigure8() : buildOval();
}

// ---------------------------------------------------------------------------
// Scenery geometry: list of 3D polygons { pts: [[x,y,z],...], color, dark }
// ---------------------------------------------------------------------------

export function trackGeometry(track) {
  const polys = [];
  const { pts, normals, halfWidth: hw } = track;
  const n = pts.length;
  const skip = 4; // coarser quads for rendering

  const edge = (i, off) => {
    const j = i % n;
    return [pts[j][0] + normals[j][0] * off, pts[j][1] + normals[j][1] * off];
  };

  // asphalt
  for (let i = 0; i < n; i += skip) {
    const i2 = (i + skip);
    const a = edge(i, hw), b = edge(i2, hw), cgd = edge(i2, -hw), dd = edge(i, -hw);
    polys.push({
      pts: [[a[0], a[1], 0], [b[0], b[1], 0], [cgd[0], cgd[1], 0], [dd[0], dd[1], 0]],
      color: [62, 62, 68], kind: 'ground'
    });
  }
  // white edge lines
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i += skip) {
      const i2 = i + skip;
      const o1 = side * (hw - 0.06), o2 = side * hw;
      const a = edge(i, o1), b = edge(i2, o1), cc = edge(i2, o2), dd = edge(i, o2);
      polys.push({
        pts: [[a[0], a[1], 0.002], [b[0], b[1], 0.002], [cc[0], cc[1], 0.002], [dd[0], dd[1], 0.002]],
        color: [225, 225, 225], kind: 'ground'
      });
    }
  }
  // boards (low side walls), alternating red/white
  const bh = 0.12, boff = hw + 0.18;
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i += skip) {
      const i2 = i + skip;
      const a = edge(i, side * boff), b = edge(i2, side * boff);
      const col = (Math.floor(i / skip) % 2 === 0) ? [210, 60, 50] : [235, 235, 235];
      polys.push({
        pts: [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], bh], [a[0], a[1], bh]],
        color: col, kind: 'wall'
      });
    }
  }
  // start/finish checker strip across the lane at s=0
  {
    const cells = 8, w = 0.5;
    for (let k = 0; k < cells; k++) {
      for (let m = 0; m < 2; m++) {
        const o1 = -hw + (2 * hw) * (k / cells);
        const o2 = -hw + (2 * hw) * ((k + 1) / cells);
        const iA = m === 0 ? 0 : 2, iB = m === 0 ? 2 : 4;
        const a = edge(iA, o1), b = edge(iB, o1), cc = edge(iB, o2), dd = edge(iA, o2);
        const col = ((k + m) % 2 === 0) ? [240, 240, 240] : [25, 25, 25];
        polys.push({
          pts: [[a[0], a[1], 0.004], [b[0], b[1], 0.004], [cc[0], cc[1], 0.004], [dd[0], dd[1], 0.004]],
          color: col, kind: 'ground'
        });
      }
    }
  }
  // driver stand: platform box + legs
  {
    const st = track.stand;
    const w = 3.2, dep = 1.2, hTop = st.z - 0.85, hRail = st.z - 0.35;
    const box = (x0, x1, y0, y1, z0, z1, color) => {
      const corners = [
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
      ];
      const faces = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]];
      for (const f of faces) {
        polys.push({ pts: f.map(i => corners[i]), color, kind: 'wall' });
      }
    };
    box(st.x - w / 2, st.x + w / 2, st.y - dep / 2, st.y + dep / 2, hTop - 0.1, hTop, [120, 130, 140]);
    box(st.x - w / 2, st.x - w / 2 + 0.12, st.y - dep / 2, st.y - dep / 2 + 0.12, 0, hTop, [90, 95, 105]);
    box(st.x + w / 2 - 0.12, st.x + w / 2, st.y - dep / 2, st.y - dep / 2 + 0.12, 0, hTop, [90, 95, 105]);
    box(st.x - w / 2, st.x - w / 2 + 0.12, st.y + dep / 2 - 0.12, st.y + dep / 2, 0, hTop, [90, 95, 105]);
    box(st.x + w / 2 - 0.12, st.x + w / 2, st.y + dep / 2 - 0.12, st.y + dep / 2, 0, hTop, [90, 95, 105]);
    // rail
    box(st.x - w / 2, st.x + w / 2, st.y - dep / 2, st.y - dep / 2 + 0.06, hTop, hRail, [160, 168, 178]);
  }
  return polys;
}
