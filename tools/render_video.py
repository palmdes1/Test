#!/usr/bin/env python3
"""Offline renderer: telemetry JSON -> MP4, viewed from the driver's stand.

Software-projected painter's-algorithm 3D with PIL polygon fills, plus a HUD
(lap timer, speed, pedals, minimap). Mirrors the browser game's camera model.
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import imageio.v2 as imageio

W, H = 1280, 720
SKY_TOP = (96, 148, 210)
SKY_BOT = (190, 215, 238)
GROUND = (96, 122, 78)
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


class Camera:
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
        fov_t = min(max(2 * math.atan(2.4 / max(dist, 1.0)), math.radians(14)), math.radians(52))
        kf = dt / (0.35 + dt)
        self.fov += kf * (fov_t - self.fov)

    def matrices(self):
        fwd = self.look - self.eye
        fwd = fwd / np.linalg.norm(fwd)
        up0 = np.array([0.0, 0.0, 1.0])
        right = np.cross(fwd, up0)
        right /= np.linalg.norm(right)
        up = np.cross(right, fwd)
        f = (H / 2) / math.tan(self.fov / 2)
        return right, up, fwd, f

    def project(self, pts, right, up, fwd, f):
        """pts: (n,3) world. Returns (n,2) screen + (n,) depth."""
        rel = pts - self.eye
        d = rel @ fwd
        x = rel @ right
        y = rel @ up
        eps = np.maximum(d, 1e-3)
        sx = W / 2 + f * x / eps
        sy = H / 2 - f * y / eps
        return np.stack([sx, sy], axis=1), d


def shade(color, normal):
    lam = abs(float(np.dot(normal, LIGHT)))
    b = 0.55 + 0.45 * lam
    return tuple(min(255, int(c * b)) for c in color)


def poly_normal(p):
    v1 = p[1] - p[0]
    v2 = p[2] - p[0]
    n = np.cross(v1, v2)
    ln = np.linalg.norm(n)
    return n / ln if ln > 1e-12 else np.array([0, 0, 1.0])


def make_sky():
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / H
        c = tuple(int(SKY_TOP[i] + (SKY_BOT[i] - SKY_TOP[i]) * t) for i in range(3))
        for x in range(0, W, 1):
            px[x, y] = c
    return img


def build_car_polys(cardef, x, y, yaw, steer):
    """Return list of (pts(n,3), color) for the car at pose, in world coords."""
    hl, hw = cardef["halfLength"], cardef["halfWidth"]
    rw = cardef["wheelRadius"]
    a = cardef["a"]
    tw = cardef["track"] / 2
    cy, sy = math.cos(yaw), math.sin(yaw)

    def tr(pts):
        out = []
        for px_, py_, pz in pts:
            out.append((x + px_ * cy - py_ * sy, y + px_ * sy + py_ * cy, pz))
        return np.array(out)

    polys = []

    def box(x0, x1, y0, y1, z0, z1, color):
        c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
        for fc in faces:
            polys.append((tr([c[i] for i in fc]), color))

    body = (235, 90, 30)      # orange shell
    dark = (30, 32, 38)
    glass = (40, 60, 85)
    # lower shell
    box(-hl, hl, -hw, hw, 0.012, 0.052, body)
    # cabin / greenhouse
    box(-hl * 0.55, hl * 0.45, -hw * 0.78, hw * 0.78, 0.052, 0.105, glass)
    # roof stripe
    box(-hl * 0.5, hl * 0.4, -hw * 0.25, hw * 0.25, 0.105, 0.108, (250, 250, 250))
    # rear wing
    box(-hl - 0.005, -hl + 0.035, -hw * 0.85, hw * 0.85, 0.085, 0.095, body)

    # wheels: hexagonal prisms
    for wx, wy_, st in ((a, tw, steer), (a, -tw, steer), (-a + (a - cardef["a"]), tw, 0.0), (-a, -tw, 0.0)):
        cs, sn = math.cos(st), math.sin(st)
        ww = 0.013
        ring = []
        for i in range(6):
            th = math.pi / 3 * i
            ring.append((rw * math.cos(th), rw * math.sin(th)))
        # two side faces + treads
        for side in (-1, 1):
            pts = []
            for cx_, cz in ring:
                lx, ly, lz = cx_, side * ww, cz + rw
                # steer rotation about z
                rx = lx * cs - ly * sn
                ry = lx * sn + ly * cs
                pts.append((wx + rx, wy_ + ry, lz))
            polys.append((tr(pts), dark))
        for i in range(6):
            c0 = ring[i]
            c1 = ring[(i + 1) % 6]
            quad = []
            for (cx_, cz), side in ((c0, -1), (c1, -1), (c1, 1), (c0, 1)):
                lx, ly, lz = cx_, side * ww, cz + rw
                rx = lx * cs - ly * sn
                ry = lx * sn + ly * cs
                quad.append((wx + rx, wy_ + ry, lz))
            polys.append((tr(quad), (15, 15, 17)))
    return polys


def build_car_shadow(cardef, x, y, yaw):
    hl, hw = cardef["halfLength"] * 1.05, cardef["halfWidth"] * 1.15
    cy, sy = math.cos(yaw), math.sin(yaw)
    pts = []
    for lx, ly in ((-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)):
        pts.append((x + lx * cy - ly * sy, y + lx * sy + ly * cy, 0.0099))
    return np.array(pts)


def groove_polys(racing_line, half=0.28):
    """Darker rubbered-in groove along the racing line."""
    pts = racing_line
    n = len(pts)
    polys = []
    for i in range(0, n - 2, 2):
        p0 = np.array(pts[i]); p1 = np.array(pts[(i + 2) % n])
        t = p1 - p0
        ln = np.linalg.norm(t)
        if ln < 1e-6:
            continue
        nx, ny = -t[1] / ln, t[0] / ln
        quad = np.array([
            [p0[0] + nx * half, p0[1] + ny * half, 0.001],
            [p1[0] + nx * half, p1[1] + ny * half, 0.001],
            [p1[0] - nx * half, p1[1] - ny * half, 0.001],
            [p0[0] - nx * half, p0[1] - ny * half, 0.001],
        ])
        polys.append({"pts": quad.tolist(), "color": [52, 52, 57], "kind": "ground"})
    return polys


def draw_horizon_ground(draw, cam, right, up, fwd, f):
    """Fill everything below the horizon line with the ground color.

    A pixel (sx, sy) sees ray fwd + a*right + b*up with a=(sx-W/2)/f,
    b=(H/2-sy)/f; the horizon is where the ray's z-component is zero.
    """
    if abs(up[2]) < 1e-6:
        return
    ys = []
    for sx in (0.0, W):
        a = (sx - W / 2) / f
        b = -(fwd[2] + a * right[2]) / up[2]
        ys.append(H / 2 - f * b)
    draw.polygon([(0, ys[0]), (W, ys[1]), (W, H + 10), (0, H + 10)], fill=GROUND)


def render(telemetry_path, out_path, fps_out=60, end_pad=0.5):
    data = json.load(open(telemetry_path))
    frames = data["frames"]
    geom = data["geometry"] + groove_polys(data["racingLine"])
    # groove under markings: sort so asphalt first, then groove, by z
    statics = []
    for g in geom:
        pts = np.array(g["pts"], dtype=float)
        statics.append((pts, tuple(g["color"]), g["kind"], pts.mean(axis=0)))

    cam = Camera(data["track"]["stand"])
    sky = make_sky()
    fps_in = data["fps"]

    # minimap precompute
    center = np.array(data["track"]["center"])
    mm_w, mm_h = 240, 170
    cmin = center.min(axis=0); cmax = center.max(axis=0)
    span = (cmax - cmin).max()
    scale = (min(mm_w, mm_h) - 30) / span
    mid = (cmin + cmax) / 2

    def mm_pt(p):
        return (W - mm_w + mm_w / 2 + (p[0] - mid[0]) * scale,
                30 + mm_h / 2 - (p[1] - mid[1]) * scale)

    writer = imageio.get_writer(out_path, fps=fps_out, codec="libx264",
                                quality=8, pixelformat="yuv420p", macro_block_size=8)
    best = None
    n_frames = len(frames)
    for fi, fr in enumerate(frames):
        cam.update((fr["x"], fr["y"]), 1.0 / fps_in)
        right, up, fwd, f = cam.matrices()

        img = sky.copy()
        draw = ImageDraw.Draw(img)
        draw_horizon_ground(draw, cam, right, up, fwd, f)

        # collect polys: statics + car
        carpolys = build_car_polys(data["car"], fr["x"], fr["y"], fr["yaw"], fr["steer"])
        ground_items = []   # coplanar decals: layer by height, no depth sort needed
        solid_items = []    # walls, stand, car: painter by depth
        for pts, color, kind, cen in statics:
            rel = cen - cam.eye
            d = float(rel @ fwd)
            if d < 0.15 or d > 120:
                continue
            if kind == "ground":
                ground_items.append((float(pts[0][2]), d, pts, color))
            else:
                solid_items.append((d, pts, color))
        # car contact shadow as topmost ground decal
        shadow = build_car_shadow(data["car"], fr["x"], fr["y"], fr["yaw"])
        ground_items.append((0.0099, 1.0, shadow, (40, 40, 45)))
        for pts, color in carpolys:
            cen = pts.mean(axis=0)
            d = float((cen - cam.eye) @ fwd)
            if d < 0.15:
                continue
            solid_items.append((d - 0.01, pts, color))

        def visible(scr):
            return not ((scr[:, 0] < -200).all() or (scr[:, 0] > W + 200).all()
                        or (scr[:, 1] < -200).all() or (scr[:, 1] > H + 200).all())

        ground_items.sort(key=lambda it: it[0])
        for z, d, pts, color in ground_items:
            scr, dep = cam.project(pts, right, up, fwd, f)
            if (dep < 0.05).any() or not visible(scr):
                continue
            draw.polygon([tuple(p) for p in scr], fill=color)

        solid_items.sort(key=lambda it: -it[0])
        for d, pts, color in solid_items:
            scr, dep = cam.project(pts, right, up, fwd, f)
            if (dep < 0.05).any() or not visible(scr):
                continue
            draw.polygon([tuple(p) for p in scr], fill=shade(color, poly_normal(pts)))

        # ---------------- HUD ----------------
        lap = fr["lap"]
        lap_times = data["lapTimes"]
        if lap >= 2 and len(lap_times) >= lap - 1:
            best = min(lap_times[: lap - 1])
        # timing panel
        draw.rectangle([20, 20, 320, 132], fill=(12, 14, 20, 200))
        lap_label = "OUT LAP" if lap == 0 else f"LAP {lap}"
        draw.text((34, 28), lap_label, font=F_MED, fill=(255, 255, 255))
        draw.text((34, 56), f"{fr['lapT']:6.2f}", font=F_BIG, fill=(120, 255, 140))
        if best:
            draw.text((34, 100), f"BEST {best:5.2f}", font=F_SML, fill=(255, 215, 120))
        last = lap_times[lap - 2] if lap >= 2 and len(lap_times) >= lap - 1 else None
        if last:
            draw.text((170, 100), f"LAST {last:5.2f}", font=F_SML, fill=(180, 200, 255))

        # speed panel
        kmh = fr["v"] * 3.6
        draw.rectangle([20, H - 120, 320, H - 20], fill=(12, 14, 20))
        draw.text((34, H - 112), f"{kmh:5.1f} km/h", font=F_BIG, fill=(255, 255, 255))
        draw.text((34, H - 70), f"scale speed {kmh*10:4.0f} km/h", font=F_SML, fill=(160, 170, 185))
        # throttle / brake bars
        bx = 34
        draw.rectangle([bx, H - 44, bx + 200, H - 34], outline=(90, 95, 105))
        draw.rectangle([bx, H - 44, bx + int(200 * fr["thr"]), H - 34], fill=(70, 220, 90))
        draw.rectangle([bx + 210, H - 44, bx + 270, H - 34], outline=(90, 95, 105))
        draw.rectangle([bx + 210, H - 44, bx + 210 + int(60 * fr["brk"]), H - 34], fill=(230, 70, 60))
        # steering indicator
        sx = bx + 100
        draw.line([sx - 60, H - 26, sx + 60, H - 26], fill=(90, 95, 105), width=2)
        sp = sx + int(-fr["steer"] / 0.49 * 60)
        draw.ellipse([sp - 5, H - 31, sp + 5, H - 21], fill=(255, 255, 255))

        # minimap
        mm0 = (W - mm_w - 16, 16)
        draw.rectangle([mm0[0], mm0[1], W - 16, 16 + mm_h], fill=(12, 14, 20))
        path = [mm_pt(p) for p in center[::2]]
        path = [(x - 16 + 0, y) for x, y in path]
        draw.line(path + [path[0]], fill=(120, 128, 140), width=3)
        cp = mm_pt((fr["x"], fr["y"]))
        cp = (cp[0] - 16, cp[1])
        draw.ellipse([cp[0] - 5, cp[1] - 5, cp[0] + 5, cp[1] + 5], fill=(255, 120, 40))
        draw.text((mm0[0] + 10, mm0[1] + mm_h - 24), data["track"]["name"].upper(),
                  font=F_SML, fill=(200, 205, 215))

        title = "1/10 EP Touring Car 13.5T - driver's stand view"
        draw.text((W / 2 - 200, H - 32), title, font=F_SML, fill=(225, 228, 235))

        writer.append_data(np.asarray(img))
        if fi % 120 == 0:
            print(f"  frame {fi}/{n_frames}")
    writer.close()
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    tel = sys.argv[1] if len(sys.argv) > 1 else "out/oval_telemetry.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "out/oval_lap.mp4"
    render(tel, out)
