// Oráculo de referencia de WF-SURFACE: función de trabajo por cara a partir del promedio planar del potencial
// (ficha docs/scientific-protocols/WF-SURFACE.md). Define el comportamiento que deben reproducir los vectores;
// no es código de producción. Unidades: Å, eV, meV donde el nombre lo dice.

import { normalizeLabel } from './fdf-oracle.mjs';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.sqrt(dot(a, a));

// S-1: a3 perpendicular al plano (a1, a2), dentro de una tolerancia angular.
export function a3Perpendicular(cell, tolDeg) {
  const ang = (u, v) => Math.acos(dot(u, v) / (norm(u) * norm(v))) * 180 / Math.PI;
  const alpha = ang(cell[1], cell[2]), beta = ang(cell[0], cell[2]);
  return { alpha_deg: alpha, beta_deg: beta, perpendicular: Math.abs(alpha - 90) <= tolDeg && Math.abs(beta - 90) <= tolDeg };
}

// Interpolante lineal periódico del perfil en la malla uniforme z_i = i·c/n.
function sampler(v, c) {
  const n = v.length, h = c / n;
  return z => {
    const t = ((z / h) % n + n) % n, i = Math.floor(t), f = t - i;
    return v[i] * (1 - f) + v[(i + 1) % n] * f;
  };
}

// Media exacta del interpolante lineal periódico en [a, b] (b > a): integral trapezoidal entre nodos.
function meanOver(v, c, a, b) {
  const n = v.length, h = c / n, at = sampler(v, c);
  const first = Math.floor(a / h) + 1, last = Math.ceil(b / h) - 1;
  const xs = [a];
  for (let k = first; k <= last; k++) xs.push(k * h);
  xs.push(b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) area += 0.5 * (at(xs[i]) + at(xs[i + 1])) * (xs[i + 1] - xs[i]);
  return area / (b - a);
}

// S-6: promedio macroscópico = media móvil con ventana igual al periodo (distancia interplanar), centrada en cada punto.
export function macroscopicAverage(v, c, period, centers) {
  return centers.map(x => meanOver(v, c, x - period / 2, x + period / 2));
}

// Huecos entre átomos en z (periódico); el mayor es el vacío. Devuelve el intervalo (top, next) con next > top.
export function vacuumInterval(atomsZ, c) {
  const z = atomsZ.map(x => ((x % c) + c) % c).sort((p, q) => p - q);
  let best = -1, top = 0, next = 0;
  for (let i = 0; i < z.length; i++) {
    const nxt = i + 1 < z.length ? z[i + 1] : z[0] + c, gap = nxt - z[i];
    if (gap > best) { best = gap; top = z[i]; next = nxt; }
  }
  return { top, next };
}

// Busca la meseta de la cara +: ventanas de `window_A` desde top + margin_A hacia el vacío, con 9 muestras por ventana.
// Devuelve { found, ... } o { found: false, reason }.
function plateauPlus(v, c, top, next, policy) {
  const at = sampler(v, c), end = next - policy.margin_A, w = policy.window_A;
  const windows = [];
  for (let k = 0; ; k++) {
    const s = top + policy.margin_A + k * policy.step_A;
    if (s + w > end + 1e-9) break;
    const ys = Array.from({ length: 9 }, (_, j) => at(s + j * w / 8));
    const xs = Array.from({ length: 9 }, (_, j) => j * w / 8);
    const xm = xs.reduce((p, q) => p + q, 0) / 9, ym = ys.reduce((p, q) => p + q, 0) / 9;
    const slope = xs.reduce((p, x, j) => p + (x - xm) * (ys[j] - ym), 0) / xs.reduce((p, x) => p + (x - xm) ** 2, 0);
    const range = (Math.max(...ys) - Math.min(...ys)) * 1000;
    windows.push({ s, ok: Math.abs(slope) <= policy.slope_max_eV_per_A && range <= policy.range_max_meV, mean: meanOver(v, c, s, s + w) });
  }
  if (!windows.length) return { found: false, reason: 'VACUUM_TOO_SMALL' };
  let anyOk = false;
  for (let i = 0; i < windows.length; i++) {
    if (!windows[i].ok) continue;
    anyOk = true;
    let j = i;
    while (j + 1 < windows.length && windows[j + 1].ok) j++;
    const from = windows[i].s, to = windows[j].s + w;
    if (to - from >= policy.width_min_A - 1e-9) {
      const means = windows.slice(i, j + 1).map(x => x.mean);
      if ((Math.max(...means) - Math.min(...means)) * 1000 > policy.stability_meV) return { found: false, reason: 'PLATEAU_UNSTABLE' };
      return { found: true, from, to, mean: meanOver(v, c, from, to) };
    }
    i = j;
  }
  return { found: false, reason: anyOk ? 'PLATEAU_TOO_NARROW' : 'PLATEAU_NOT_FOUND' };
}

// Evalúa una corrida: S-1, S-2, S-3, S-4, S-5. La primera regla de rechazo que aplica decide el motivo común.
export function evaluate(run, policy) {
  const sides = ['+z', '-z'];
  const fail = reason => ({ verdict: 'NOT_ESTABLISHED', reasons: [reason], faces: sides.map(side => ({ side, status: 'NOT_ESTABLISHED', reason, phi_eV: null, plateau: null })) });
  if (!a3Perpendicular(run.cell, policy.perpendicular_tol_deg).perpendicular) return fail('A3_NOT_PERPENDICULAR');
  if (run.scf_converged !== true) return fail('SCF_NOT_CONVERGED');
  if (run.fermi_eV === null) return fail('FERMI_MISSING');
  if (run.potential !== policy.potential && !(run.potential === 'VT' && policy.allow_vt)) return fail('POTENTIAL_NOT_PERMITTED');
  if ((run.dipole_correction === 'false' || run.dipole_correction === 'none') && !run.faces_equivalent) return fail('DIPOLE_UNCOMPENSATED_ASYMMETRIC');
  const c = run.cell[2][2], { top, next } = vacuumInterval(run.atoms_z_A, c);
  if (next - top - 2 * policy.margin_A < policy.width_min_A) return fail('VACUUM_TOO_SMALL');
  const plus = plateauPlus(run.profile_eV, c, top, next, policy);
  // Cara −z: la misma búsqueda sobre el perfil reflejado (z → −z), con el intervalo (−next, −top).
  const n = run.profile_eV.length;
  const mirrored = Array.from({ length: n }, (_, i) => run.profile_eV[(n - i) % n]);
  const minus = plateauPlus(mirrored, c, -next + c, -top + c, policy);
  const face = (side, p) => p.found
    ? { side, status: 'ESTABLISHED', reason: null, phi_eV: p.mean - run.fermi_eV, plateau: side === '+z'
      ? { from_A: p.from, to_A: p.to, mean_eV: p.mean, width_A: p.to - p.from }
      : { from_A: c - p.to, to_A: c - p.from, mean_eV: p.mean, width_A: p.to - p.from } }
    : { side, status: 'NOT_ESTABLISHED', reason: p.reason, phi_eV: null, plateau: null };
  const faces = [face('+z', plus), face('-z', minus)];
  const reasons = [...new Set(faces.filter(f => f.reason).map(f => f.reason))].sort();
  return { verdict: faces.every(f => f.status === 'ESTABLISHED') ? 'ESTABLISHED' : 'NOT_ESTABLISHED', reasons, faces };
}

// S-8: Φ frente al parámetro de una etapa. Hacen falta tres puntos; converge si las dos últimas diferencias caben en la tolerancia.
export function phiConvergence(points, tolMeV) {
  if (points.length < 3) return { verdict: 'INSUFFICIENT_POINTS', deltas_meV: [], last_delta_meV: null };
  const deltas = points.slice(1).map((p, i) => (p.phi_eV - points[i].phi_eV) * 1000);
  const last = deltas.slice(-2);
  return { verdict: last.every(d => Math.abs(d) <= tolMeV) ? 'CONVERGED' : 'NOT_CONVERGED', deltas_meV: deltas, last_delta_meV: deltas[deltas.length - 1] };
}

// S-7: E_F de dos corridas solo se compara si las celdas coinciden (mismos vectores, tolerancia en Å); si no, no es comparable.
export function fermiComparable(cellA, cellB, tolA) {
  const same = cellA.every((row, i) => row.every((x, j) => Math.abs(x - cellB[i][j]) <= tolA));
  return { comparable: same, reason: same ? null : 'CELLS_DIFFER' };
}

// S-2: `Slab.DipoleCorrection` es un enum. SIESTA 5.4.2 acepta true, false, charge, vacuum y none (verificado con corridas
// reales: true ≡ charge y none ≡ false dan la misma E_F y la misma energía); cualquier otro valor aborta con
// «Could not determine the dipole option». Se conserva el valor escrito y se informa el efecto.
export function dipoleCorrection(fdfText) {
  const rows = fdfText.split('\n').map(l => l.split('#')[0].trim().split(/\s+/)).filter(t => t[0] && normalizeLabel(t[0]) === 'slabdipolecorrection');
  if (rows.length === 0) return { accepted: true, value: null, effective: 'NONE', error: null };
  if (rows.length > 1) return { accepted: false, value: null, effective: null, error: 'LABEL_DUPLICATED' };
  const value = (rows[0][1] ?? '').toLowerCase();
  const effective = { true: 'CHARGE', charge: 'CHARGE', vacuum: 'VACUUM', false: 'NONE', none: 'NONE' }[value];
  return effective ? { accepted: true, value, effective, error: null } : { accepted: false, value: null, effective: null, error: 'KEYWORD_VALUE_INVALID' };
}
