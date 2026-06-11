// Vehicle parameters for a 1/10 electric touring car (sedan), "stock" 13.5T blinky spec.
// Sources for targets: ROAR/ETS Touring Car rules (min mass ~1320-1400 g, 190 mm max
// width, 257-262 mm wheelbase, 64 mm rubber tires), measured 13.5T blinky straight-line
// speeds of ~60-70 km/h on large tracks, and reported RC touring car cornering in the
// 2-3 g range on high-grip asphalt/carpet.

export const TC_PARAMS = {
  name: '1/10 Touring Car 13.5T blinky',

  // --- Chassis / mass ---
  mass: 1.38,            // kg, ready to run with body
  Izz: 0.015,            // kg m^2 yaw inertia (mass concentrated near center line)
  wheelbase: 0.257,      // m
  a: 0.1285,             // m, CG to front axle (50/50 static balance)
  b: 0.1285,             // m, CG to rear axle
  track: 0.162,          // m, track width (190 mm overall - tire width)
  hCG: 0.024,            // m, CG height above ground
  wheelRadius: 0.032,    // m (64 mm spec rubber tire)

  // --- Suspension: sprung chassis with heave/pitch/roll DOF ---
  Ixx: 0.0045,           // kg m^2 roll inertia
  Iyy: 0.015,            // kg m^2 pitch inertia
  springRate: 340,       // N/m wheel rate per corner (~5 Hz ride frequency)
  damping: 15,           // N s/m per corner (~0.7 critical)
  arbFront: 170,         // N/m anti-roll bar differential rate, front
  arbRear: 120,          // N/m anti-roll bar differential rate, rear
  bumpTravel: 0.004,     // m suspension travel to the bump stop
  bumpRate: 4000,        // N/m additional rate past the bump stop
  hRollCenter: 0.006,    // m roll-center height (low, typical TC)
  antiPitch: 0.1,        // fraction of pitch moment reacted by geometry (anti-dive/squat)
  staticCamber: 0.026,   // rad (~1.5 deg negative camber both ends)
  camberComp: 0.5,       // fraction of body roll compensated by camber gain
  camberThrust: 0.8,     // lateral force per rad camber per N load
  suspTau: 0.025,        // s, filter for telemetry accelerations

  // --- Tires (Pacejka magic formula, per wheel) ---
  tire: {
    Fz0: 3.385,          // N, nominal load (mg/4)
    mu0: 2.45,           // peak friction coefficient at nominal load (high-grip asphalt)
    loadSens: 0.07,      // mu drops by this fraction per +100% load
    // Lateral: peak at ~8 deg slip angle
    By: 12.4, Cy: 1.5, Ey: -0.3,
    alphaPeak: 0.14,     // rad, used for combined-slip normalization
    // Longitudinal: peak at ~12% slip ratio
    Bx: 17.3, Cx: 1.4, Ex: -0.5,
    kappaPeak: 0.12,
    relaxLen: 0.03       // m, slip relaxation length (low-speed smoothing)
  },

  // --- Steering ---
  maxSteer: 0.49,        // rad (~28 deg at the wheel)
  steerRate: 9.0,        // rad/s slew at the wheel (low-profile servo, ~0.06 s/60deg)
  ackermann: 1.0,        // 1 = full geometric Ackermann

  // --- Drivetrain: belt 4WD, front spool or gear diff + rear gear diff ---
  frontDrive: 'spool',   // 'spool' | 'gear'
  gearRatio: 4.0,        // final drive ratio (spur/pinion * internal)
  drivetrainEff: 0.85,
  wheelInertia: 2.2e-5,  // kg m^2 per wheel+axle
  motorRotorInertia: 6.0e-7, // kg m^2 (12.3 mm sensored rotor)
  rearDiffDamping: 1.5e-4,   // N m s, viscous (diff grease)

  // --- Motor / ESC: 13.5T sensored brushless, zero timing ("blinky"), 2S LiPo ---
  motor: {
    Kv: 3100 * Math.PI / 30, // rad/s per volt (3100 rpm/V)
    R: 0.025,            // ohm, winding + ESC + leads
    Vbatt: 7.9,          // V under load (8.4 V full charge with sag)
    Imax: 60,            // A, ESC/traction current limit while driving
    IbrakeMax: 62        // A, equivalent braking current limit
  },

  // --- Aero & resistance (190 mm TC body) ---
  CdragV2: 0.011,        // N per (m/s)^2 drag
  CdownV2: 0.009,        // N per (m/s)^2 downforce (TC shell + small wing)
  rollResist: 0.022,     // rolling resistance coefficient (bearings, tire scrub)

  // collision footprint
  halfLength: 0.215,
  halfWidth: 0.095
};
