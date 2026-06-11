# Vehicle Dynamics Model — 1/10 EP Touring Car

The goal is VRC-Pro-class realism for a 1/10 electric touring car (sedan),
13.5T "blinky" stock spec. The model is a planar multi-DOF dynamic simulation,
not an arcade kinematic model: every force on the chassis comes from the four
tire contact patches, the motor, and aerodynamics.

## Degrees of freedom & states

| State | Description |
|---|---|
| `x, y, yaw` | chassis pose in the world plane |
| `vx, vy, r` | body-frame velocities and yaw rate |
| `zH, phi, theta` (+rates) | sprung-chassis heave, roll and pitch |
| `omegaDrive` | drivetrain speed (front axle / rear diff carrier) |
| `deltaRear`, `deltaFront` | left/right wheel speed differences (gear diffs) |
| `steer` | actual front wheel angle (servo slew-limited) |

Physics runs at **5 kHz** (semi-implicit Euler) so the stiff wheel-spin
dynamics (tiny wheel inertia vs. high tire slip stiffness) stay stable.

## Tires — Pacejka magic formula with combined slip

Each wheel computes slip angle and slip ratio from its own contact-patch
velocity (including yaw-rate contribution) and its own rotational speed:

- Pure-slip lateral and longitudinal magic-formula curves
  (lateral peak at ~8° slip angle, longitudinal at ~12% slip ratio).
- **Combined slip** via the normalized-slip similarity method (friction
  ellipse): cornering hard reduces available drive/brake force and vice versa.
- **Load sensitivity**: peak μ falls ~7% per +100% load, the key effect that
  makes load transfer change handling balance (this is what tuning is about).
- μ₀ = 2.45 at static corner load — RC rubber on high-grip asphalt/carpet.
  RC touring cars corner far above 1 g due to scale effects (reported 2–3 g+).
- Low-speed slip regularization so the model is stable down to standstill.

## Suspension — sprung chassis with heave/pitch/roll DOF

The chassis is a rigid body on four spring/damper corners:

- Per-corner wheel rate 340 N/m (~5 Hz ride frequency) with ~0.7-critical
  damping, plus **bump stops** beyond 4 mm of travel.
- **Anti-roll bars** front and rear couple left/right deflections — the
  front/rear roll-stiffness split (~54% front) is the balance tuning knob,
  exactly as on a real TC.
- Roll/pitch moments come from the tire forces acting below the CG; the
  **roll-center height** (6 mm) splits transfer into an elastic path through
  the springs (lagged, transient) and an instantaneous geometric path, with a
  small anti-dive/anti-squat fraction in pitch.
- Wheel vertical loads are read directly off the suspension forces, so
  corner-entry/exit balance shifts emerge from the spring/damper dynamics
  instead of being prescribed.
- Body **roll-induced camber** (with a camber-gain compensation factor) plus
  static negative camber feed a camber-thrust term in the tire model.

Steady-state checks: 1.7–2.0° roll at ~2.2 g lateral, ~1° pitch under
braking — matching the stiff, low-roll stance of a real touring car.

## Drivetrain — belt 4WD, front spool (or gear diff) + rear gear diff

Like a modern TC (Xray T4 / Awesomatix style high-grip config):

- Front axle defaults to a **spool**: both front wheels locked to the drive
  shaft — the characteristic on-power entry push and strong exit drive.
  A front **gear diff** is selectable (`frontDrive: 'gear'`); as in reality
  it frees up corner entry but is measurably harder to keep consistent.
- Rear axle is an **open gear diff**: `deltaRear` integrates the left/right
  tire torque imbalance with viscous grease damping, letting the rear axle
  roll freely through corners.
- Belts rigidly couple front axle and rear diff carrier (no center diff).
- Reflected motor-rotor inertia (`I·G²`) is included in drivetrain inertia.

## Motor & ESC — 13.5T sensored brushless, zero timing

DC machine model: `I = (throttle·V − ω/Kv)/R`, torque `Kt·I`, with the ESC
current limit being the real constraint on launch (60 A). Braking is the
ESC proportional brake (shorted windings, current-limited) acting through
the drivetrain on **all four wheels** — RC cars have no friction brakes.
No drag brake (blinky coast is free).

## Steering

Servo slew-rate limit (~0.06 s/60°) and geometric **Ackermann** — inner
wheel steers more, computed per wheel from the turn-center geometry.

## Aerodynamics

Small but included: `F = C·v²` drag and downforce for a 190 mm TC shell
(~1.8 N of downforce at 15 m/s — about 13% of car weight, measurable in
high-speed corner grip).

## Validation against real-world data

`node tools/validate.mjs`:

| Benchmark | Model | Real-world target | Source |
|---|---|---|---|
| Top speed | 19.5 m/s (70 km/h) | 60–70 km/h for 13.5T stock on big tracks | [R/C Tech forums](https://www.rctech.net/forum/electric-road/750078-modern-4wd-touring-car-top-speeds-mod-vs-stock-w-turbo.html) |
| Launch accel | 1.33 g (current-limited) | ~1.3–1.8 g | gearing/current-limit calc |
| Braking 15→0 m/s | 6.9 m, 1.80 g peak | 1.5–2.2 g, 4-wheel ESC brake | drivetrain brake physics |
| Skidpad steady lateral | 2.0–2.4 g | 2–3 g on high-grip surface | scale-grip reports, [The RC Racer](https://www.thercracer.com/2013/07/blinky-timing-gearing.html) gearing context |
| Steady-state roll | 1.7–2.0° at max lateral | 1–4° (stiff TC suspension) | spring-rate / CG calc |
| Step-steer | stable, 1.3× yaw overshoot | stable with mild overshoot | typical TC transient |
| Oval lap (75 m) | 5.6 s ≈ 13.4 m/s avg | club TC averages ~8–13 m/s | typical lap-length/time ratios |

The AI's lap shape matches what you see in real TC racing and VRC Pro: hard
ESC braking into the turn with slight rotation as load transfers forward,
apex speed pinned by the lateral-g limit, and progressive throttle from apex
so the combined-slip budget isn't exceeded.

## Known simplifications (next steps)

- No unsprung-mass DOF (wheels follow the ground; no kerb/bump excitation yet).
- No tire temperature/additive model, no carpet fiber directionality.
- Single surface μ; no dust/groove evolution (the groove is cosmetic).
- No one-way front diff or adjustable diff preload yet.
- Setup (springs, ARBs, camber, diff) is parameter-file only — no in-game UI.
