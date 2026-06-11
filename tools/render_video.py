#!/usr/bin/env python3
"""Offline renderer: telemetry JSON -> MP4.

Main view from the driver's stand plus an onboard (roof-cam) picture-in-picture.
The ground (grass, asphalt with noise, rubber groove, painted curbs, lines,
checker) is built once as a top-down texture and perspective-warped into each
camera with a plane homography; 3D solids (boards, stand, car) are drawn on
top with a painter's algorithm.
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import imageio.v2 as imageio

W, H = 1280, 720
PIP_W, PIP_H = 426, 240
SKY_TOP = (96, 148, 210)
SKY_BOT = (193, 216, 237)
LIGHT = np.array([0.45, 0.25, 0.86])
LIGHT /= np.linalg.norm(LIGHT)


def load_font(size):
    for name in ("DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            pass
    return ImageFont.load_default()


F_BIG, F_MED, F_SML = load_font(34), load_font(22), load_font(16)


# ---------------------------------------------------------------------------
# Ground texture
# ---------------------------------------------------------------------------

class GroundTexture:
    def __init__(self, data, ppm=36):
        center = np.array(data["track"]["center"])
        hw = data["track"]["halfWidth"]
        margin = 16.0
        self.minx = center[:, 0].min() - margin
        self.maxx = center[:, 0].max() + margin
        self.miny = center[:, 1].min() - margin
        self.maxy = center[:, 1].max() + margin
        self.ppm = ppm
        tw = int((self.maxx - self.minx) * ppm)
        th = int((self.maxy - self.miny) * ppm)
        self.size = (tw, th)
        rng = np.random.default_rng(7)

        # --- grass base with mottling ---
        grass = np.zeros((th, tw, 3), np.float32)
        grass[:] = (88, 116, 70)
        noise = rng.normal(0, 7, (th, tw, 1))
        blotch = rng.normal(0, 22, (th // 24 + 1, tw // 24 + 1, 1))
        blotch = np.array(Image.fromarray(
            np.clip(blotch[:, :, 0] + 128, 0, 255).astype(np.uint8)
        ).resize((tw, th), Image.BILINEAR), np.float32)[:, :, None] - 128
        grass += noise + blotch * 0.45
        img = Image.fromarray(np.clip(grass, 0, 255).astype(np.uint8))
        draw = ImageDraw.Draw(img)

        def px(p):
            return ((p[0] - self.minx) * ppm, (self.maxy - p[1]) * ppm)

        n = len(center)
        # normals along centerline
        nrm = []
        for i in range(n):
            a = center[(i + 1) % n]
            b = center[(i - 1) % n]
            t = a - b
            l = np.hypot(t[0], t[1]) or 1.0
            nrm.append((-t[1] / l, t[0] / l))
        nrm = np.array(nrm)

        def edge(i, off):
            return center[i % n] + nrm[i % n] * off

        # --- concrete apron around the driver stand ---
        st = data["track"]["stand"]
        a0 = px((st["x"] - 8, st["y"] + 4.4))
        a1 = px((st["x"] + 8, st["y"] - 4))
        draw.rectangle([a0, a1], fill=(148, 148, 146))

        # --- dirt shoulder just outside the track edges ---
        for side in (1, -1):
            for i in range(0, n, 2):
                quad = [edge(i, side * hw), edge(i + 2, side * hw),
                        edge(i + 2, side * (hw + 0.55)), edge(i, side * (hw + 0.55))]
                draw.polygon([px(q) for q in quad], fill=(110, 118, 88))

        # --- asphalt (also build a mask for wear/blotch overlay) ---
        mask = Image.new("L", self.size, 0)
        mdraw = ImageDraw.Draw(mask)
        for i in range(0, n, 2):
            quad = [edge(i, hw + 0.05), edge(i + 2, hw + 0.05),
                    edge(i + 2, -hw - 0.05), edge(i, -hw - 0.05)]
            qq = [px(q) for q in quad]
            draw.polygon(qq, fill=(72, 72, 76))
            mdraw.polygon(qq, fill=255)
        self._track_mask = mask

        # --- repair patches: rectangles of slightly different asphalt ---
        prng = np.random.default_rng(23)
        for _ in range(26):
            i = int(prng.integers(0, n))
            off = float(prng.uniform(-hw * 0.6, hw * 0.6))
            ln = float(prng.uniform(0.8, 3.0))
            wd = float(prng.uniform(0.5, 1.4))
            shade_c = int(prng.integers(-9, 10))
            col = (72 + shade_c, 72 + shade_c, 76 + shade_c)
            j = (i + max(2, int(ln / 0.45))) % n
            quad = [edge(i, off - wd / 2), edge(j, off - wd / 2),
                    edge(j, off + wd / 2), edge(i, off + wd / 2)]
            draw.polygon([px(q) for q in quad], fill=col)

        # --- painted curbs on corner insides ---
        curv = np.zeros(n)
        for i in range(n):
            a, b, c = center[(i - 3) % n], center[i], center[(i + 3) % n]
            v1, v2 = b - a, c - b
            cross = v1[0] * v2[1] - v1[1] * v2[0]
            l1, l2, l3 = np.hypot(*v1), np.hypot(*v2), np.hypot(*(c - a))
            curv[i] = 2 * cross / (l1 * l2 * l3) if l1 * l2 * l3 > 1e-9 else 0
        stripe = 0
        for i in range(0, n, 2):
            k = curv[i]
            if abs(k) > 0.09:
                side = 1 if k > 0 else -1
                quad = [edge(i, side * (hw - 0.02)), edge(i + 2, side * (hw - 0.02)),
                        edge(i + 2, side * (hw + 0.42)), edge(i, side * (hw + 0.42))]
                col = (208, 52, 44) if stripe % 2 == 0 else (235, 235, 232)
                draw.polygon([px(q) for q in quad], fill=col)
                stripe += 1

        # --- white edge lines ---
        for side in (1, -1):
            for i in range(0, n, 2):
                quad = [edge(i, side * (hw - 0.12)), edge(i + 2, side * (hw - 0.12)),
                        edge(i + 2, side * hw), edge(i, side * hw)]
                draw.polygon([px(q) for q in quad], fill=(216, 216, 214))

        # --- rubber groove along the racing line (blurred dark band) ---
        groove = Image.new("L", self.size, 0)
        gd = ImageDraw.Draw(groove)
        rl = data["racingLine"]
        gpts = [px(p) for p in rl] + [px(rl[0])]
        gd.line(gpts, fill=120, width=int(0.6 * ppm))
        gd.line(gpts, fill=70, width=int(1.0 * ppm))
        groove = groove.filter(ImageFilter.GaussianBlur(ppm * 0.18))
        dark = Image.new("RGB", self.size, (38, 38, 42))
        img = Image.composite(dark, img, groove)
        draw = ImageDraw.Draw(img)

        # --- start/finish checker + line ---
        cells = 10
        for kcell in range(cells):
            for mrow in range(2):
                o1 = -hw + (2 * hw) * kcell / cells
                o2 = -hw + (2 * hw) * (kcell + 1) / cells
                iA, iB = (0, 2) if mrow == 0 else (2, 4)
                quad = [edge(iA, o1), edge(iB, o1), edge(iB, o2), edge(iA, o2)]
                col = (235, 235, 235) if (kcell + mrow) % 2 == 0 else (28, 28, 28)
                draw.polygon([px(q) for q in quad], fill=col)

        # --- braking streaks (dark tire marks where the AI brakes hard) ---
        frames = data.get("frames", [])
        for k in range(0, len(frames), 3):
            fr = frames[k]
            if fr.get("lap", 0) >= 1 and fr.get("brk", 0) > 0.55:
                cyaw, syaw = math.cos(fr["yaw"]), math.sin(fr["yaw"])
                for sgn in (-1, 1):
                    ox, oy = -syaw * sgn * 0.078, cyaw * sgn * 0.078
                    p0 = px((fr["x"] + ox, fr["y"] + oy))
                    p1 = px((fr["x"] + ox + cyaw * 0.55, fr["y"] + oy + syaw * 0.55))
                    draw.line([p0, p1], fill=(34, 34, 38), width=max(1, int(0.05 * ppm)))

        # --- wear blotches inside the track mask + global grain ---
        arr = np.asarray(img).astype(np.int16)
        wear = rng.normal(0, 14, (th // 18 + 1, tw // 18 + 1))
        wear = np.array(Image.fromarray(
            np.clip(wear + 128, 0, 255).astype(np.uint8)
        ).resize((tw, th), Image.BILINEAR), np.int16) - 128
        m = (np.asarray(self._track_mask, np.int16) // 255)
        arr += (wear * m)[:, :, None] // 2
        grain = rng.normal(0, 5, (th, tw, 1)).astype(np.int16)
        arr = np.clip(arr + grain, 0, 255).astype(np.uint8)
        self.tex = Image.fromarray(arr)

    def world_to_tex(self, p):
        return ((p[0] - self.minx) * self.ppm, (self.maxy - p[1]) * self.ppm)


# ---------------------------------------------------------------------------
# Cameras
# ---------------------------------------------------------------------------

class CameraBasis:
    def __init__(self, eye, look, fov, w, h, up_roll=0.0):
        self.eye = np.asarray(eye, float)
        fwd = np.asarray(look, float) - self.eye
        fwd /= np.linalg.norm(fwd)
        up0 = np.array([0.0, 0.0, 1.0])
        right = np.cross(fwd, up0)
        right /= np.linalg.norm(right)
        up = np.cross(right, fwd)
        if up_roll:
            cr, sr = math.cos(up_roll), math.sin(up_roll)
            right, up = right * cr + up * sr, up * cr - right * sr
        self.fwd, self.right, self.up = fwd, right, up
        self.w, self.h = w, h
        self.f = (h / 2) / math.tan(fov / 2)

    def project(self, pts):
        rel = np.atleast_2d(pts) - self.eye
        d = rel @ self.fwd
        x = rel @ self.right
        y = rel @ self.up
        eps = np.maximum(d, 1e-3)
        sx = self.w / 2 + self.f * x / eps
        sy = self.h / 2 - self.f * y / eps
        return np.stack([sx, sy], axis=1), d


class StandCamera:
    def __init__(self, stand):
        self.eye = np.array([stand["x"], stand["y"], stand["z"]])
        self.look = None
        self.fov = math.radians(30)

    def update(self, target, dt):
        t = np.array([target[0], target[1], 0.05])
        if self.look is None:
            self.look = t
        k = dt / (0.13 + dt)
        self.look = self.look + k * (t - self.look)
        dist = np.linalg.norm(self.look - self.eye)
        fov_t = min(max(2 * math.atan(2.6 / max(dist, 1.0)), math.radians(13)), math.radians(52))
        kf = dt / (0.35 + dt)
        self.fov += kf * (fov_t - self.fov)

    def basis(self):
        return CameraBasis(self.eye, self.look, self.fov, W, H)


def shade(color, p):
    v1 = p[1] - p[0]
    v2 = p[2] - p[0]
    nv = np.cross(v1, v2)
    ln = np.linalg.norm(nv)
    lam = abs(float(nv @ LIGHT)) / ln if ln > 1e-12 else 1.0
    b = 0.55 + 0.45 * lam
    return tuple(min(255, int(c * b)) for c in color)


# ---------------------------------------------------------------------------
# Car geometry
# ---------------------------------------------------------------------------

def build_car_polys(cardef, fr):
    x, y, yaw, steer = fr["x"], fr["y"], fr["yaw"], fr["steer"]
    roll, pitch = fr.get("roll", 0.0), fr.get("pitch", 0.0)
    hl, hw = cardef["halfLength"], cardef["halfWidth"]
    rw = cardef["wheelRadius"]
    a = cardef["a"]
    tw = cardef["track"] / 2
    cy, sy = math.cos(yaw), math.sin(yaw)
    tilt = [False]

    def tr(pts):
        out = []
        for px_, py_, pz in pts:
            pz2 = pz + (py_ * roll - px_ * pitch if tilt[0] else 0.0)
            out.append((x + px_ * cy - py_ * sy, y + px_ * sy + py_ * cy, pz2))
        return np.array(out)

    polys = []

    def box(x0, x1, y0, y1, z0, z1, color):
        c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        for fc in [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]:
            polys.append((tr([c[i] for i in fc]), color))

    shell = (235, 90, 30)
    tilt[0] = True
    box(-hl, hl, -hw, hw, 0.012, 0.052, shell)
    box(-hl * 0.55, hl * 0.45, -hw * 0.78, hw * 0.78, 0.052, 0.105, (40, 60, 85))
    box(-hl * 0.5, hl * 0.4, -hw * 0.25, hw * 0.25, 0.105, 0.108, (250, 250, 250))
    box(-hl - 0.005, -hl + 0.035, -hw * 0.85, hw * 0.85, 0.085, 0.095, shell)
    tilt[0] = False

    for wx, wy_, st in ((a, tw, steer), (a, -tw, steer), (-a, tw, 0.0), (-a, -tw, 0.0)):
        cs, sn = math.cos(st), math.sin(st)
        ring = [(rw * math.cos(math.pi / 3 * i), rw * math.sin(math.pi / 3 * i)) for i in range(6)]
        for side in (-1, 1):
            pts = []
            for cx_, cz in ring:
                lx, ly, lz = cx_, side * 0.013, cz + rw
                pts.append((wx + lx * cs - ly * sn, wy_ + lx * sn + ly * cs, lz))
            polys.append((tr(pts), (25, 26, 30)))
        for i in range(6):
            c0, c1 = ring[i], ring[(i + 1) % 6]
            quad = []
            for (cx_, cz), side in ((c0, -1), (c1, -1), (c1, 1), (c0, 1)):
                lx, ly, lz = cx_, side * 0.013, cz + rw
                quad.append((wx + lx * cs - ly * sn, wy_ + lx * sn + ly * cs, lz))
            polys.append((tr(quad), (15, 15, 17)))
    return polys


def build_hood_polys(cardef, fr):
    """Front bodywork + front wheels as seen from the cockpit. The hood is
    drawn without roll/pitch: camera and shell share the chassis frame, so
    the hood stays fixed in view while the world tilts."""
    x, y, yaw, steer = fr["x"], fr["y"], fr["yaw"], fr["steer"]
    hl, hw = cardef["halfLength"], cardef["halfWidth"]
    rw = cardef["wheelRadius"]
    a = cardef["a"]
    tw = cardef["track"] / 2
    cy, sy = math.cos(yaw), math.sin(yaw)

    def tr(pts):
        return np.array([(x + px_ * cy - py_ * sy, y + px_ * sy + py_ * cy, pz)
                         for px_, py_, pz in pts])

    polys = []

    def box(x0, x1, y0, y1, z0, z1, color):
        c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        for fc in [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]:
            polys.append((tr([c[i] for i in fc]), color))

    box(0.02, hl, -hw, hw, 0.012, 0.052, (235, 90, 30))      # hood
    box(hl - 0.03, hl, -hw, hw, 0.052, 0.058, (210, 78, 24)) # nose lip
    for wy_ in (tw, -tw):  # front wheels (steered)
        cs, sn = math.cos(steer), math.sin(steer)
        ring = [(rw * math.cos(math.pi / 3 * i), rw * math.sin(math.pi / 3 * i)) for i in range(6)]
        for side in (-1, 1):
            pts = []
            for cx_, cz in ring:
                lx, ly, lz = cx_, side * 0.013, cz + rw
                pts.append((a + lx * cs - ly * sn, wy_ + lx * sn + ly * cs, lz))
            polys.append((tr(pts), (25, 26, 30)))
    return polys


def car_shadow(cardef, fr):
    hl, hw = cardef["halfLength"] * 1.05, cardef["halfWidth"] * 1.2
    cy, sy = math.cos(fr["yaw"]), math.sin(fr["yaw"])
    return np.array([
        (fr["x"] + lx * cy - ly * sy, fr["y"] + lx * sy + ly * cy, 0.004)
        for lx, ly in ((-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw))
    ])


# ---------------------------------------------------------------------------
# View rendering
# ---------------------------------------------------------------------------

def solve_homography(world_pts, tex_pts, scr_pts):
    """coeffs for PIL PERSPECTIVE: maps output (screen) px -> input (texture) px."""
    A = []
    b = []
    for (sx, sy), (u, v) in zip(scr_pts, tex_pts):
        A.append([sx, sy, 1, 0, 0, 0, -u * sx, -u * sy])
        b.append(u)
        A.append([0, 0, 0, sx, sy, 1, -v * sx, -v * sy])
        b.append(v)
    return np.linalg.solve(np.array(A), np.array(b))


def render_view(cam, ground, solids, sky_cache, w, h):
    """cam: CameraBasis. solids: list of (pts, color, shaded)."""
    # ground homography: 4 points in front of the camera on z=0
    az = math.atan2(cam.fwd[1], cam.fwd[0])
    ca, sa = math.cos(az), math.sin(az)
    wpts = []
    for dx, dy in ((2.5, -4), (2.5, 4), (45, -28), (45, 28)):
        wx = cam.eye[0] + dx * ca - dy * sa
        wy = cam.eye[1] + dx * sa + dy * ca
        wpts.append((wx, wy, 0.0))
    scr, _ = cam.project(np.array(wpts))
    tex_pts = [ground.world_to_tex(p) for p in wpts]
    coeffs = solve_homography(wpts, tex_pts, [tuple(s) for s in scr])
    img = ground.tex.transform((w, h), Image.PERSPECTIVE, tuple(coeffs), Image.BILINEAR,
                               fillcolor=(88, 116, 70))

    # sky above the horizon line
    if abs(cam.up[2]) > 1e-6:
        ys = []
        for sx in (0.0, w):
            a = (sx - w / 2) / cam.f
            bb = -(cam.fwd[2] + a * cam.right[2]) / cam.up[2]
            ys.append(h / 2 - cam.f * bb)
        mask = Image.new("L", (w, h), 0)
        md = ImageDraw.Draw(mask)
        md.polygon([(0, 0), (w, 0), (w, ys[1]), (0, ys[0])], fill=255)
        img = Image.composite(sky_cache.resize((w, h)), img, mask)

    draw = ImageDraw.Draw(img, "RGBA")
    items = []
    for pts, color, shaded in solids:
        cen = pts.mean(axis=0)
        d = float((cen - cam.eye) @ cam.fwd)
        if d < 0.12 or d > 150:
            continue
        items.append((d, pts, color, shaded))
    items.sort(key=lambda it: -it[0])
    for d, pts, color, shaded in items:
        scr, dep = cam.project(pts)
        if (dep < 0.05).any():
            continue
        if (scr[:, 0] < -300).all() or (scr[:, 0] > w + 300).all() \
           or (scr[:, 1] < -300).all() or (scr[:, 1] > h + 300).all():
            continue
        col = shade(color, pts) if shaded else tuple(color)
        draw.polygon([tuple(p) for p in scr], fill=col)
    return img


def make_sky(w, h):
    img = Image.new("RGB", (w, h))
    pxl = img.load()
    for y in range(h):
        t = y / h
        c = tuple(int(SKY_TOP[i] + (SKY_BOT[i] - SKY_TOP[i]) * t) for i in range(3))
        for x in range(w):
            pxl[x, y] = c
    return img


# ---------------------------------------------------------------------------
# Main render loop
# ---------------------------------------------------------------------------

def render(telemetry_path, out_path, max_laps=None):
    data = json.load(open(telemetry_path))
    frames = data["frames"]
    if max_laps is not None:
        frames = [f for f in frames if f["lap"] <= max_laps]
    fps_in = data["fps"]

    ground = GroundTexture(data)
    sky = make_sky(W, H // 2 + 60)

    # static solids: boards, stand (skip painted ground polys - texture has them)
    statics = []
    for g in data["geometry"]:
        if g["kind"] == "ground":
            continue
        statics.append((np.array(g["pts"], float), tuple(g["color"]), True))

    cam = StandCamera(data["track"]["stand"])

    # minimap
    center = np.array(data["track"]["center"])
    mm_w, mm_h = 230, 165
    cmin, cmax = center.min(axis=0), center.max(axis=0)
    span = (cmax - cmin).max()
    mscale = (min(mm_w, mm_h) - 28) / span
    mid = (cmin + cmax) / 2
    mm_x0, mm_y0 = W - mm_w - 16, H - mm_h - 16

    def mm_pt(p):
        return (mm_x0 + mm_w / 2 + (p[0] - mid[0]) * mscale,
                mm_y0 + mm_h / 2 - (p[1] - mid[1]) * mscale)

    writer = imageio.get_writer(out_path, fps=fps_in, codec="libx264",
                                quality=8, pixelformat="yuv420p", macro_block_size=8)
    best = None
    lap_times = data["lapTimes"]
    hist = []
    HIST_N = 240  # 4 s of strip-chart history
    for fi, fr in enumerate(frames):
        cam.update((fr["x"], fr["y"]), 1.0 / fps_in)
        B = cam.basis()

        carpolys = [(p, c, True) for p, c in build_car_polys(data["car"], fr)]
        shadow = [(car_shadow(data["car"], fr), (30, 30, 34, 110), False)]
        solids = statics + shadow + carpolys
        img = render_view(B, ground, solids, sky, W, H)

        # ---- in-car PIP (cockpit cam: hood fixed in view, world rolls) ----
        yaw, roll, pitch = fr["yaw"], fr.get("roll", 0.0), fr.get("pitch", 0.0)
        dyaw = (math.cos(yaw), math.sin(yaw))
        eye = (fr["x"] - dyaw[0] * 0.03, fr["y"] - dyaw[1] * 0.03, 0.092)
        look = (eye[0] + dyaw[0] * 5, eye[1] + dyaw[1] * 5,
                0.092 - 0.042 - pitch * 2.5)
        pipB = CameraBasis(eye, look, math.radians(74), PIP_W, PIP_H, up_roll=-roll)
        hood = [(p, c, True) for p, c in build_hood_polys(data["car"], fr)]
        pip = render_view(pipB, ground, statics + hood, sky, PIP_W, PIP_H)
        pd = ImageDraw.Draw(pip)
        pd.rectangle([0, 0, PIP_W - 1, PIP_H - 1], outline=(20, 22, 28), width=3)
        pd.text((10, PIP_H - 26), "IN-CAR", font=F_SML, fill=(255, 255, 255))
        img.paste(pip, (W - PIP_W - 16, 16))

        draw = ImageDraw.Draw(img, "RGBA")

        # ---- live telemetry strip charts (chassis + shocks) ----
        hist.append((fr.get("roll", 0) * 57.3, fr.get("pitch", 0) * 57.3,
                     fr.get("yawRate", 0), fr.get("shock", [0, 0, 0, 0])))
        if len(hist) > HIST_N:
            hist.pop(0)
        cw, chh = PIP_W, 92
        cx0, cy0_ = W - cw - 16, 16 + PIP_H + 10
        draw.rectangle([cx0, cy0_, cx0 + cw, cy0_ + chh], fill=(10, 12, 17, 245))
        draw.rectangle([cx0, cy0_ + chh + 8, cx0 + cw, cy0_ + 2 * chh + 8], fill=(10, 12, 17, 245))

        def plot(panel_y, series, scales, colors, labels):
            mid = panel_y + chh / 2
            draw.line([cx0 + 4, mid, cx0 + cw - 4, mid], fill=(60, 64, 74))
            npts = len(hist)
            for si, (sel, sc, col) in enumerate(zip(series, scales, colors)):
                pts = []
                for k in range(npts):
                    val = sel(hist[k])
                    xx = cx0 + 4 + (cw - 8) * k / (HIST_N - 1)
                    yy = mid - max(-1, min(1, val / sc)) * (chh / 2 - 8)
                    pts.append((xx, yy))
                if len(pts) > 1:
                    draw.line(pts, fill=col, width=1)
            for si, (lab, col) in enumerate(zip(labels, colors)):
                draw.text((cx0 + 8 + si * 78, panel_y + 3), lab, font=F_SML, fill=col)

        plot(cy0_,
             [lambda h: h[0], lambda h: h[1], lambda h: h[2]],
             [4.0, 2.5, 6.0],
             [(120, 180, 255), (255, 170, 90), (130, 235, 140)],
             ["roll", "pitch", "yaw rate"])
        plot(cy0_ + chh + 8,
             [lambda h: h[3][0], lambda h: h[3][1], lambda h: h[3][2], lambda h: h[3][3]],
             [6, 6, 6, 6],
             [(235, 235, 235), (250, 220, 90), (110, 220, 235), (235, 130, 200)],
             ["FL", "FR", "RL", "RR"])
        draw.text((cx0 + cw - 88, cy0_ + chh + 11), "shocks mm", font=F_SML, fill=(150, 158, 170))

        # ---- HUD ----
        lap = fr["lap"]
        if lap >= 2 and len(lap_times) >= lap - 1:
            best = min(lap_times[: lap - 1])
        draw.rectangle([20, 20, 372, 132], fill=(12, 14, 20, 215))
        draw.text((34, 28), "OUT LAP" if lap == 0 else f"LAP {lap}", font=F_MED, fill=(255, 255, 255))
        draw.text((34, 56), f"{fr['lapT']:6.2f}", font=F_BIG, fill=(120, 255, 140))
        if best:
            draw.text((34, 100), f"BEST {best:5.2f}", font=F_SML, fill=(255, 215, 120))
        last = lap_times[lap - 2] if lap >= 2 and len(lap_times) >= lap - 1 else None
        if last:
            draw.text((140, 100), f"LAST {last:5.2f}", font=F_SML, fill=(180, 200, 255))
        ideal = data.get("idealLap")
        if ideal:
            draw.text((240, 100), f"IDEAL {ideal:5.2f}", font=F_SML, fill=(160, 255, 230))

        kmh = fr["v"] * 3.6
        draw.rectangle([20, H - 120, 320, H - 20], fill=(12, 14, 20, 215))
        draw.text((34, H - 112), f"{kmh:5.1f} km/h", font=F_BIG, fill=(255, 255, 255))
        gtxt = f"lat {fr.get('ay', 0)/9.81:+.1f}g  lon {fr.get('ax', 0)/9.81:+.1f}g"
        draw.text((34, H - 70), gtxt, font=F_SML, fill=(160, 170, 185))
        tT = fr.get("tT")
        if tT:
            for ti, tv in enumerate(tT):
                col = (110, 170, 255) if tv < 42 else (120, 230, 130) if tv < 58 else (240, 110, 90)
                draw.text((175 + ti * 36, H - 70), f"{tv:.0f}°", font=F_SML, fill=col)
            draw.text((175, H - 88), "tires FL FR RL RR", font=F_SML, fill=(120, 128, 140))
        bx = 34
        draw.rectangle([bx, H - 44, bx + 200, H - 34], outline=(90, 95, 105))
        draw.rectangle([bx, H - 44, bx + int(200 * fr["thr"]), H - 34], fill=(70, 220, 90))
        draw.rectangle([bx + 210, H - 44, bx + 270, H - 34], outline=(90, 95, 105))
        draw.rectangle([bx + 210, H - 44, bx + 210 + int(60 * fr["brk"]), H - 34], fill=(230, 70, 60))
        sx = bx + 100
        draw.line([sx - 60, H - 26, sx + 60, H - 26], fill=(90, 95, 105), width=2)
        sp = sx + int(-fr["steer"] / 0.49 * 60)
        draw.ellipse([sp - 5, H - 31, sp + 5, H - 21], fill=(255, 255, 255))

        # minimap
        draw.rectangle([mm_x0, mm_y0, mm_x0 + mm_w, mm_y0 + mm_h], fill=(12, 14, 20, 215))
        path = [mm_pt(p) for p in center[::2]]
        draw.line(path + [path[0]], fill=(120, 128, 140), width=3)
        cp = mm_pt((fr["x"], fr["y"]))
        draw.ellipse([cp[0] - 5, cp[1] - 5, cp[0] + 5, cp[1] + 5], fill=(255, 120, 40))
        draw.text((mm_x0 + 10, mm_y0 + mm_h - 24), data["track"]["name"].upper(),
                  font=F_SML, fill=(200, 205, 215))

        title = f"{data.get('carName', '1/10 EP Touring Car')} — driver's stand + onboard"
        draw.text((W / 2 - 230, H - 32), title, font=F_SML, fill=(228, 230, 236))

        writer.append_data(np.asarray(img))
        if fi % 180 == 0:
            print(f"  frame {fi}/{len(frames)}")
    writer.close()
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    tel = sys.argv[1] if len(sys.argv) > 1 else "out/luxembourg_telemetry.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "out/luxembourg_lap.mp4"
    laps = int(sys.argv[3]) if len(sys.argv) > 3 else None
    render(tel, out, laps)
