// Basic setup configurator: builds a params-override object from a form
// panel. Persisted in localStorage. Applied by rebuilding the car.

const LS_KEY = 'rcSetup';

export const SETUP_FIELDS = [
  { group: 'Weight', key: 'massG', label: 'Total weight (g)', min: 1250, max: 1700, step: 10, def: 1380 },
  { group: 'Weight', key: 'frontPct', label: 'Front weight (%)', min: 44, max: 56, step: 0.5, def: 50 },
  { group: 'Suspension', key: 'spring', label: 'Spring rate (N/m)', min: 180, max: 450, step: 10, def: 270 },
  { group: 'Suspension', key: 'arbF', label: 'Front ARB (N/m)', min: 0, max: 300, step: 10, def: 150 },
  { group: 'Suspension', key: 'arbR', label: 'Rear ARB (N/m)', min: 0, max: 300, step: 10, def: 105 },
  { group: 'Suspension', key: 'camber', label: 'Camber (deg)', min: 0, max: 3, step: 0.25, def: 1.5 },
  { group: 'Drivetrain', key: 'fdr', label: 'Final drive ratio', min: 3.2, max: 5.0, step: 0.05, def: 3.8 },
  { group: 'Drivetrain', key: 'frontDiff', label: 'Front diff', options: ['spool', 'gear'], def: 'spool' },
  { group: 'Tires', key: 'compound', label: 'Compound grip (%)', min: 90, max: 105, step: 1, def: 100 }
];

export function loadSetup() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { /* defaults */ }
  for (const f of SETUP_FIELDS) if (s[f.key] === undefined) s[f.key] = f.def;
  return s;
}

export function saveSetup(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

/** Convert form values into a physics params override. */
export function applySetup(base, s) {
  const p = { ...base, tire: { ...base.tire }, motor: { ...base.motor } };
  const mass = s.massG / 1000;
  const L = p.wheelbase;
  p.mass = mass;
  p.Izz = base.Izz * (mass / base.mass);            // inertia scales with mass
  p.Ixx = base.Ixx * (mass / base.mass);
  p.Iyy = base.Iyy * (mass / base.mass);
  p.a = L * (1 - s.frontPct / 100);                  // CG toward the heavy end
  p.b = L - p.a;
  p.springRate = s.spring;
  p.arbFront = s.arbF;
  p.arbRear = s.arbR;
  p.staticCamber = s.camber * Math.PI / 180;
  p.gearRatio = s.fdr;
  p.frontDrive = s.frontDiff;
  p.tire.mu0 = base.tire.mu0 * (s.compound / 100);
  p.tire.Fz0 = mass * 9.81 / 4;                      // keep load sensitivity centered
  p.name = `${base.name} (custom)`;
  return p;
}

/** Build the panel DOM. onApply(setup) called on Apply. */
export function buildPanel(container, onApply) {
  const s = loadSetup();
  let html = '<h3>Car setup</h3>';
  let lastGroup = '';
  for (const f of SETUP_FIELDS) {
    if (f.group !== lastGroup) {
      html += `<div class="grp">${f.group}</div>`;
      lastGroup = f.group;
    }
    if (f.options) {
      const opts = f.options.map(o =>
        `<option value="${o}"${s[f.key] === o ? ' selected' : ''}>${o}</option>`).join('');
      html += `<label>${f.label} <select data-key="${f.key}">${opts}</select></label>`;
    } else {
      html += `<label>${f.label}
        <input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}"
               step="${f.step}" value="${s[f.key]}">
        <span class="val" id="val_${f.key}">${s[f.key]}</span></label>`;
    }
  }
  html += '<button id="setupApply">Apply &amp; reset car</button>'
    + '<button id="setupDefaults">Defaults</button>';
  container.innerHTML = html;

  container.querySelectorAll('input[type=range]').forEach(inp => {
    inp.addEventListener('input', () => {
      document.getElementById(`val_${inp.dataset.key}`).textContent = inp.value;
    });
  });
  container.querySelector('#setupApply').addEventListener('click', () => {
    const out = {};
    container.querySelectorAll('[data-key]').forEach(el => {
      out[el.dataset.key] = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
    });
    saveSetup(out);
    onApply(out);
  });
  container.querySelector('#setupDefaults').addEventListener('click', () => {
    localStorage.removeItem(LS_KEY);
    buildPanel(container, onApply);
    onApply(loadSetup());
  });
}
