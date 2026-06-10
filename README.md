# RC Racing Sim — 1/10 EP Touring Car

A physics-realistic radio-controlled car racing simulator (VRC Pro inspired).
Step 1: a 1/10 electric touring car (13.5T blinky spec) on an **oval** and a
**figure-8** track, with a true **driver's-stand camera** — you watch your car
from a fixed elevated stand and the view auto-zooms, exactly like standing on
the rostrum.

The vehicle model is a real dynamic simulation — Pacejka combined-slip tires
with load sensitivity, four-wheel load transfer, belt 4WD with front spool and
rear gear diff, brushless motor/ESC model, Ackermann + servo-rate steering —
running at 5 kHz. See [PHYSICS.md](PHYSICS.md) for the full model and its
validation against real-world RC racing data.

## Play it

```bash
npm run serve          # python3 -m http.server 8000
# open http://localhost:8000
```

| Key | Action |
|---|---|
| ↑ / W | throttle |
| ↓ / S / Space | brake |
| ← → | steer |
| A | toggle AI driver |
| C | camera: stand → chase → top |
| R | reset to start line |
| 1 / 2 | oval / figure-8 |

## Headless tools

```bash
node tools/validate.mjs              # physics benchmarks vs real-world targets
node tools/run_lap.mjs oval 3        # AI drives 3 laps, writes telemetry JSON
node tools/run_lap.mjs figure8 3
pip install pillow numpy imageio imageio-ffmpeg
python3 tools/render_video.py out/oval_telemetry.json out/oval_lap.mp4
```

The video renderer reproduces the in-game driver's-stand camera and HUD
(lap timer, speed, throttle/brake/steering, minimap).

## Layout

```
sim/      physics core (shared by game and headless tools)
  params.js   1/10 TC parameters (mass, tires, motor, gearing…)
  tire.js     Pacejka magic formula, combined slip, load sensitivity
  car.js      chassis + drivetrain + motor + steering dynamics
  track.js    oval & figure-8 construction + 3D scenery geometry
  driver.js   racing line, speed profile, pure-pursuit AI
  world.js    substepped loop, lap timing, board collisions
web/      canvas software-3D renderer + game loop
tools/    validation, headless lap runner, MP4 renderer
```

## Results (AI laps)

- Oval (75.4 m, 3.5 m lane): best lap **5.61 s**, top speed 67 km/h
- Figure-8 (79.2 m, 3 m lane): best lap **6.58 s**, top speed 62 km/h
