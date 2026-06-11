#!/usr/bin/env python3
"""Engineering telemetry sheet from a lap-runner JSON: best-lap channel traces
plus whole-session tire temps and the g-g diagram. For model validation.

Usage: python3 tools/telemetry_sheet.py [telemetry.json] [out.png]
"""
import json
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

tel = sys.argv[1] if len(sys.argv) > 1 else "out/luxembourg_telemetry.json"
out = sys.argv[2] if len(sys.argv) > 2 else "out/telemetry_sheet.png"

data = json.load(open(tel))
frames = data["frames"]
laps = data["lapTimes"]
best_i = int(np.argmin(laps))
best_lap = best_i + 1
bf = [f for f in frames if f["lap"] == best_lap]
t = np.array([f["lapT"] for f in bf])

plt.style.use("dark_background")
fig, axs = plt.subplots(3, 2, figsize=(16, 10), dpi=110)
fig.suptitle(
    f"{data.get('carName','')} — {data['track']['name']} — "
    f"best lap {laps[best_i]:.3f} s (ideal {data.get('idealLap','?')} s, "
    f"laps: {', '.join(f'{x:.2f}' for x in laps)})",
    fontsize=13)

# 1. speed + pedals
ax = axs[0][0]
ax.plot(t, [f["v"] * 3.6 for f in bf], color="w", lw=1.6, label="speed km/h")
ax.set_ylabel("km/h")
ax2 = ax.twinx()
ax2.fill_between(t, [f["thr"] for f in bf], color="#3ec85a", alpha=0.35, label="throttle")
ax2.fill_between(t, [-f["brk"] for f in bf], color="#e64636", alpha=0.45, label="brake")
ax2.set_ylim(-1.1, 1.1)
ax.set_title("Speed / throttle / brake")
ax.grid(alpha=0.25)

# 2. steering + yaw rate
ax = axs[0][1]
ax.plot(t, [f["steer"] * 57.3 for f in bf], color="#78b4ff", lw=1.4, label="steer deg")
ax.set_ylabel("steer deg", color="#78b4ff")
ax2 = ax.twinx()
ax2.plot(t, [f.get("yawRate", 0) for f in bf], color="#82eb8c", lw=1.2, label="yaw rate")
ax2.set_ylabel("yaw rate rad/s", color="#82eb8c")
ax.set_title("Steering / yaw rate")
ax.grid(alpha=0.25)

# 3. roll & pitch
ax = axs[1][0]
ax.plot(t, [f.get("roll", 0) * 57.3 for f in bf], color="#78b4ff", lw=1.4, label="roll")
ax.plot(t, [f.get("pitch", 0) * 57.3 for f in bf], color="#ffaa5a", lw=1.4, label="pitch")
ax.set_ylabel("deg")
ax.legend(loc="upper right", fontsize=9)
ax.set_title("Chassis roll / pitch")
ax.grid(alpha=0.25)

# 4. shock travel
ax = axs[1][1]
cols = ["#ebebeb", "#fadc5a", "#6edceb", "#eb82c8"]
for i, lab in enumerate(["FL", "FR", "RL", "RR"]):
    ax.plot(t, [f.get("shock", [0] * 4)[i] for f in bf], color=cols[i], lw=1.0, label=lab)
ax.set_ylabel("compression mm")
ax.legend(loc="upper right", fontsize=9, ncols=4)
ax.set_title("Shock travel (roughness + load transfer)")
ax.grid(alpha=0.25)

# 5. tire temps over the whole run
ax = axs[2][0]
tt = np.array([f["t"] for f in frames])
for i, lab in enumerate(["FL", "FR", "RL", "RR"]):
    ax.plot(tt, [f.get("tT", [0] * 4)[i] for f in frames], color=cols[i], lw=1.1, label=lab)
ax.axhline(52, color="#82eb8c", ls="--", lw=0.8, alpha=0.7)
ax.text(tt[-1] * 0.99, 52.5, "optimum", color="#82eb8c", fontsize=8, ha="right")
for li in range(len(laps) + 1):
    pass
ax.set_xlabel("session time s")
ax.set_ylabel("tread °C")
ax.legend(loc="lower right", fontsize=9, ncols=4)
ax.set_title("Tire temperatures (full session: warm-up visible)")
ax.grid(alpha=0.25)

# 6. g-g diagram
ax = axs[2][1]
ax.scatter([f.get("ay", 0) / 9.81 for f in bf], [f.get("ax", 0) / 9.81 for f in bf],
           s=6, c=np.array([f["v"] for f in bf]), cmap="plasma")
th = np.linspace(0, 2 * np.pi, 100)
ax.plot(2.3 * np.cos(th), 2.3 * np.sin(th), color="#888", ls="--", lw=0.8)
ax.text(1.55, 1.7, "2.3 g", color="#888", fontsize=8)
ax.set_xlabel("lateral g")
ax.set_ylabel("longitudinal g")
ax.set_aspect("equal")
ax.set_title("g-g diagram, best lap (color = speed)")
ax.grid(alpha=0.25)

fig.tight_layout(rect=(0, 0, 1, 0.96))
fig.savefig(out)
print(f"Wrote {out}")
