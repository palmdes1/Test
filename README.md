# RC Racing Sim — 1/10 EP Touring Car

A physics-realistic radio-controlled car racing simulator (VRC Pro inspired).
A 1/10 electric touring car — 13.5T blinky stock or **5.5T modified** — on an
**oval**, a **figure-8**, and a **Luxembourg-inspired** 249 m outdoor asphalt
circuit (modeled after the Mini Circuit "Ville de Luxembourg" style featured
in VRC Pro: long main straight, fast sweepers, tight infield). The view is a
true **driver's-stand camera** — fixed elevated stand with auto-zoom, exactly
like standing on the rostrum — and the offline renderer adds a parallel
**onboard roof-cam** picture-in-picture.

The vehicle model is a real dynamic simulation — Pacejka combined-slip tires
with load sensitivity and camber thrust, a sprung chassis with heave/pitch/roll
DOF on per-corner springs, dampers, anti-roll bars and bump stops, belt 4WD
with front spool (or gear diff) and rear gear diff, brushless motor/ESC model,
Ackermann + servo-rate steering — running at 5 kHz. See
[PHYSICS.md](PHYSICS.md) for the full model and its validation against
real-world RC racing data.

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
| M | motor: 13.5T stock ↔ 5.5T mod |
| 1 / 2 / 3 | oval / figure-8 / luxembourg |

## Headless tools

```bash
node tools/validate.mjs              # physics benchmarks vs real-world targets
node tools/run_lap.mjs oval 3        # AI drives 3 laps, writes telemetry JSON
node tools/run_lap.mjs luxembourg 2  # 5.5T mod class on the big track
pip install pillow numpy imageio imageio-ffmpeg
python3 tools/render_video.py out/luxembourg_telemetry.json out/luxembourg_lap.mp4
```

The video renderer builds a top-down ground texture (asphalt grain, rubber
groove, painted curbs, edge lines, grass, concrete apron) and perspective-warps
it per frame with a plane homography, then draws the 3D solids on top. Views:
driver's stand (main) + onboard roof-cam PIP, with lap timer, speed, lat/lon g,
pedals and minimap.

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

- Oval (75.4 m, 3.5 m lane), 13.5T: best lap **5.68 s**, top speed 67 km/h
- Figure-8 (79.2 m, 3 m lane), 13.5T: best lap **6.60 s**, top speed 62 km/h
- Luxembourg (249.3 m, 4 m lane), 5.5T mod: best lap **16.67 s**,
  102 km/h on the main straight, 2.1 g sustained in the sweepers
