// Track surface model: spatial grip variation and road roughness.
//
// Grip is not uniform on a real track: the rubbered-in groove is grippier,
// offline is dusty, and asphalt quality varies patch to patch. Roughness
// excites the suspension. Both are deterministic functions of world position
// so physics stays reproducible.

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 144305901) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy; // 0..1
}

/**
 * Build a surface query function for a track + racing line.
 * Returns fn(x, y) -> { grip, height } where grip multiplies tire mu and
 * height is the local road elevation in metres.
 */
function featureHeight(sVal, features) {
  let h = 0;
  for (const f of features) {
    if (f.type === 'whoops') {
      if (sVal >= f.s0 && sVal <= f.s1) {
        h += f.amp * 0.5 * (1 - Math.cos(2 * Math.PI * (sVal - f.s0) / f.wl));
      }
    } else if (sVal >= f.s0 && sVal <= f.s3) {
      // trapezoid ramp: up s0-s1, flat s1-s2, down s2-s3
      if (sVal < f.s1) h += f.h * (sVal - f.s0) / (f.s1 - f.s0);
      else if (sVal <= f.s2) h += f.h;
      else h += f.h * (f.s3 - sVal) / (f.s3 - f.s2);
    }
  }
  return h;
}

export function makeSurface(track, line, opts = {}) {
  const gripNoiseAmp = opts.gripNoiseAmp ?? 0.065;  // +-6.5% patchy asphalt
  const grooveBonus = opts.grooveBonus ?? 0.055;    // rubbered-in line
  const dustPenalty = opts.dustPenalty ?? 0.085;    // offline dust/marbles
  const roughFine = opts.roughFine ?? 0.0013;       // m, ~0.7 m wavelength
  const roughCoarse = opts.roughCoarse ?? 0.0026;   // m, ~3 m undulation
  const seed = opts.seed ?? 11;
  const features = opts.features ?? track.features ?? [];
  const tN2 = track.pts.length;

  // grid of distance-to-racing-line over the track bbox (0.5 m cells)
  const cell = 0.5, margin = 6;
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (const p of track.pts) {
    minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]);
    miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]);
  }
  minx -= margin; miny -= margin; maxx += margin; maxy += margin;
  const nx = Math.ceil((maxx - minx) / cell) + 1;
  const ny = Math.ceil((maxy - miny) / cell) + 1;
  const dist = new Float32Array(nx * ny).fill(99);
  const sGrid = new Float32Array(nx * ny);
  const lpx = [], lpy = [];
  for (let i = 0; i < line.n; i += 4) { lpx.push(line.px[i]); lpy.push(line.py[i]); }
  const tN = track.pts.length;
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const x = minx + gx * cell, y = miny + gy * cell;
      let best = 99;
      for (let k = 0; k < lpx.length; k++) {
        const d = (lpx[k] - x) ** 2 + (lpy[k] - y) ** 2;
        if (d < best) best = d;
      }
      dist[gy * nx + gx] = Math.sqrt(best);
      // nearest track point index (refined per query for continuous s)
      let bd2 = 1e9, bi = 0;
      for (let k = 0; k < tN; k += 6) {
        const d2 = (track.pts[k][0] - x) ** 2 + (track.pts[k][1] - y) ** 2;
        if (d2 < bd2) { bd2 = d2; bi = k; }
      }
      sGrid[gy * nx + gx] = bi;
    }
  }
  const lineDist = (x, y) => {
    const fx = Math.min(Math.max((x - minx) / cell, 0), nx - 1.001);
    const fy = Math.min(Math.max((y - miny) / cell, 0), ny - 1.001);
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const d00 = dist[iy * nx + ix], d10 = dist[iy * nx + ix + 1];
    const d01 = dist[(iy + 1) * nx + ix], d11 = dist[(iy + 1) * nx + ix + 1];
    return (d00 + (d10 - d00) * tx) * (1 - ty) + (d01 + (d11 - d01) * tx) * ty;
  };

  return function surface(x, y) {
    const d = lineDist(x, y);
    let grip = 1
      + gripNoiseAmp * 2 * (valueNoise(x / 3.1, y / 3.1, seed) - 0.5)
      + grooveBonus * Math.exp(-(d * d) / (0.45 * 0.45))
      - dustPenalty * Math.min(Math.max((d - 0.9) / 1.3, 0), 1);
    grip = Math.min(Math.max(grip, 0.82), 1.1);
    let height =
      roughFine * 2 * (valueNoise(x / 0.7, y / 0.7, seed + 1) - 0.5) +
      roughCoarse * 2 * (valueNoise(x / 3.0, y / 3.0, seed + 2) - 0.5);
    if (features.length && d < 6) {
      const fx2 = Math.min(Math.max((x - minx) / cell, 0), nx - 1.001);
      const fy2 = Math.min(Math.max((y - miny) / cell, 0), ny - 1.001);
      const coarse = sGrid[Math.round(fy2) * nx + Math.round(fx2)];
      // refine to continuous s: nearest of neighbors, then project on segment
      let bi = coarse, bd = 1e9;
      for (let k = -7; k <= 7; k++) {
        const i = ((coarse + k) % tN2 + tN2) % tN2;
        const d2 = (track.pts[i][0] - x) ** 2 + (track.pts[i][1] - y) ** 2;
        if (d2 < bd) { bd = d2; bi = i; }
      }
      const j = (bi + 1) % tN2;
      const ex = track.pts[j][0] - track.pts[bi][0];
      const ey = track.pts[j][1] - track.pts[bi][1];
      const el2 = ex * ex + ey * ey || 1e-9;
      const tproj = Math.min(Math.max(
        ((x - track.pts[bi][0]) * ex + (y - track.pts[bi][1]) * ey) / el2, 0), 1);
      const sCont = track.s[bi] + tproj * Math.sqrt(el2);
      height += featureHeight(sCont, features);
    }
    return { grip, height };
  };
}
