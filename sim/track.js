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
  if (name === 'figure8') return buildFigure8();
  if (name === 'luxembourg') return buildLuxembourg();
  return buildOval();
}

/** Turtle-style path builder: segments are ['S', len] or ['L'|'R', radius, degrees]. */
function buildPath(segments, x0 = 0, y0 = 0, h0 = 0) {
  let x = x0, y = y0, h = h0;
  const pts = [];
  for (const seg of segments) {
    if (seg[0] === 'S') {
      const x1 = x + Math.cos(h) * seg[1], y1 = y + Math.sin(h) * seg[1];
      pts.push(...linePoints(x, y, x1, y1));
      x = x1; y = y1;
    } else {
      const dir = seg[0] === 'L' ? 1 : -1;
      const r = seg[1], ang = (seg[2] * Math.PI) / 180;
      // arc center sits to the turning side of the current heading
      const ccx = x + dir * -Math.sin(h) * r, ccy = y + dir * Math.cos(h) * r;
      const a0 = Math.atan2(y - ccy, x - ccx);
      const a1 = a0 + dir * ang;
      pts.push(...arcPoints(ccx, ccy, r, a0, a1, dir === 1));
      x = ccx + r * Math.cos(a1); y = ccy + r * Math.sin(a1);
      h += dir * ang;
    }
  }
  // distribute closure gap along the path (design should nearly close)
  const gx = x0 - x, gy = y0 - y;
  let total = 0;
  const ds = [0];
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    ds.push(total);
  }
  for (let i = 0; i < pts.length; i++) {
    const f = ds[i] / total;
    pts[i][0] += gx * f;
    pts[i][1] += gy * f;
  }
  return pts;
}

export function buildLuxembourg() {
  // Reconstruction of the VRC Pro "Luxembourg" 1:10 electric on-road track
  // (from replay footage): divided main straight with a center rail, a big
  // 180 carousel at the right end, a kerbed esses complex through the
  // infield, two 180 loops around grass islands upper-left, a long return
  // straight and a tight final hairpin onto the main straight. CCW.
  const pts = buildPath([
    ['S', 40],            // main straight (start/finish)
    ['L', 7, 180],        // T1: big carousel around the grass island
    ['S', 6],
    ['R', 4, 90],         // T2: right into the esses
    ['S', 4],
    ['L', 3, 90],         // T3
    ['S', 9],             // upper straight
    ['L', 3, 90],         // T4
    ['S', 3],
    ['R', 3, 90],         // T5: right
    ['S', 4],
    ['R', 3, 90],         // T6: right
    ['S', 2],
    ['L', 3.2, 180],      // T7: carousel around the upper-left island
    ['S', 8.8],
    ['L', 3.2, 90],       // T8: onto the return straight
    ['S', 28],            // return straight
    ['R', 2.5, 180],      // T9: right hairpin (double-back)
    ['S', 29.8],          // lower return lane (beside the main straight)
    ['L', 2.0, 180]       // T10: tight final hairpin onto the main straight
  ]);
  const t = finalize('luxembourg', pts, 3.6, { x: 20, y: -6.5, z: 2.6 }, [8, 0]);
  // low red/white divider rail between the main straight and the return lane
  t.extras = [{ kind: 'rail', from: [4.5, 2.0], to: [27.0, 2.0] }];
  return t;
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
  // boards (low side walls), alternating sponsor-orange / white (VRC style)
  const bh = 0.14, boff = hw + 0.22;
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i += skip) {
      const i2 = i + skip;
      const a = edge(i, side * boff), b = edge(i2, side * boff);
      const col = (Math.floor(i / skip) % 2 === 0) ? [232, 122, 26] : [240, 240, 240];
      polys.push({
        pts: [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], bh], [a[0], a[1], bh]],
        color: col, kind: 'wall'
      });
    }
  }
  // extra decorations (e.g. divider rails between parallel lanes)
  for (const ex of track.extras || []) {
    if (ex.kind !== 'rail') continue;
    const [x0, y0] = ex.from, [x1, y1] = ex.to;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    const nxr = -uy, nyr = ux, w2 = 0.05, rh = 0.10, seg = 0.8;
    for (let s0 = 0; s0 < len; s0 += seg) {
      const s1 = Math.min(s0 + seg, len);
      const ax = x0 + ux * s0, ay = y0 + uy * s0;
      const bx = x0 + ux * s1, by = y0 + uy * s1;
      const col = (Math.round(s0 / seg) % 2 === 0) ? [212, 58, 48] : [238, 238, 238];
      for (const sd of [1, -1]) {
        polys.push({
          pts: [[ax + nxr * w2 * sd, ay + nyr * w2 * sd, 0], [bx + nxr * w2 * sd, by + nyr * w2 * sd, 0],
                [bx + nxr * w2 * sd, by + nyr * w2 * sd, rh], [ax + nxr * w2 * sd, ay + nyr * w2 * sd, rh]],
          color: col, kind: 'wall'
        });
      }
      polys.push({
        pts: [[ax - nxr * w2, ay - nyr * w2, rh], [bx - nxr * w2, by - nyr * w2, rh],
              [bx + nxr * w2, by + nyr * w2, rh], [ax + nxr * w2, ay + nyr * w2, rh]],
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
