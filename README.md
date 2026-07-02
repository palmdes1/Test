# RC Racing Sim — 1/10 EP Touring Car

A physics-realistic radio-controlled car racing simulator (VRC Pro inspired).
A 1/10 electric touring car — 13.5T blinky stock or **5.5T modified** — on an
**oval**, a **figure-8**, and a reconstruction of the **VRC Pro Luxembourg**
outdoor asphalt circuit (211 m, rebuilt from replay footage: divided main
straight with center rail, big carousel, kerbed esses, island loops, final
hairpin). The view is a true **driver's-stand camera** — fixed elevated stand
with auto-zoom, exactly like standing on the rostrum — and the offline
renderer adds a parallel **in-car cockpit** picture-in-picture plus
synthesized **motor and tire audio**.

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

## Results (pro AI laps vs ideal)

| Track | Car | Ideal (QSS optimum) | Best AI lap | Gap |
|---|---|---|---|---|
| Oval 75.4 m | 13.5T | 5.30 s | 5.61 s | 0.31 s |
| Luxembourg 210.9 m | 5.5T mod | 14.77 s | 15.10 s | 0.33 s |
| Dirt 327 m (jumps) | 1/8 nitro buggy | 34.78 s | 37.98 s | 3.2 s |

Luxembourg: 91 km/h on the straight, ~2.2 g in the carousel, lap times build
16.65 → 16.06 s as tire temps climb from 34 °C into the upper 40s. The speed
profile uses friction-circle coupled passes (trail braking, progressive exit
throttle). `tools/telemetry_sheet.py` renders an engineering sheet
(speed/pedals, steering/yaw rate, roll/pitch, shock travel, tire temps, g-g
diagram); `tools/make_audio.py` synthesizes motor whine + tire scrub from
telemetry and muxes it into the video.

## Offroad (key 4)

1/8 nitro buggy on a 327 m dirt track: double jump, kicker, tabletop and
whoops. The .21 two-stroke has a torque curve, centrifugal clutch and disc
brake; off a ramp the chassis flies ballistically and the drivetrain's gyro
reaction gives real mid-air attitude control - brake drops the nose,
throttle lifts it. A track marshal puts you back on line if you get stuck.

## RC radio (VRC USB adapter)

Plug your transmitter's USB adapter in (VRC-Pro adapter or similar — it
appears as a HID gamepad), open the game, squeeze the trigger once so the
browser detects it, then press **G** and follow the 4 prompts: neutral →
full left → full throttle → full brake. Calibration is saved in the browser;
the radio then overrides the keyboard whenever it's connected (a green
RADIO tag shows in the HUD). Re-run **G** anytime to recalibrate.

## Setup configurator

Press **T** in the game: total weight and front/rear weight distribution,
spring rate, front/rear anti-roll bars, camber, final drive ratio, front
diff (spool/gear) and tire compound. Apply rebuilds the car on the spot;
settings persist in the browser.
