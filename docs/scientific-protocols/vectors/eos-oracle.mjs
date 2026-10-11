// Oráculo de referencia de WF-EOS (ficha docs/scientific-protocols/WF-EOS.md).
// Define el comportamiento que deben reproducir los vectores; no es código de producción.
export const EV_A3_TO_GPA = 160.21766208;

const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
  - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
  + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

function inv3(m) {
  const d = det3(m);
  const c = (r0, c0, r1, c1) => m[r0][c0] * m[r1][c1] - m[r0][c1] * m[r1][c0];
  return [
    [c(1, 1, 2, 2) / d, -c(0, 1, 2, 2) / d, c(0, 1, 1, 2) / d],
    [-c(1, 0, 2, 2) / d, c(0, 0, 2, 2) / d, -c(0, 0, 1, 2) / d],
    [c(1, 0, 2, 1) / d, -c(0, 0, 2, 1) / d, c(0, 0, 1, 1) / d],
  ];
}

// Filas de la celda = vectores de red (Å); cart = frac · celda.
export const volume = cell => Math.abs(det3(cell));
export const fractional = (cell, cart) => {
  const inv = inv3(cell);
  return cart.map(r => [0, 1, 2].map(j => r[0] * inv[0][j] + r[1] * inv[1][j] + r[2] * inv[2][j]));
};

// E-1: geometría de un punto con factor de volumen f = V/Vref.
export function deform(reference, factor) {
  const s = Math.cbrt(factor);
  return {
    cell: reference.cell.map(r => r.map(v => v * s)),
    atoms: reference.atoms.map(a => ({ ...a, cart: a.cart.map(v => v * s) })),
  };
}

// E-1: una geometría candidata es válida si su celda es s·celda_ref y conserva las fraccionarias.
export function checkDeformation(reference, candidate, factor, tol) {
  const s = Math.cbrt(factor);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    if (Math.abs(candidate.cell[i][j] - s * reference.cell[i][j]) > tol.cell_A) return 'CELL_NOT_SCALED';
  if (candidate.atoms.length !== reference.atoms.length) return 'ATOM_MAP_MISMATCH';
  const fr = fractional(reference.cell, reference.atoms.map(a => a.cart));
  const fc = fractional(candidate.cell, candidate.atoms.map(a => a.cart));
  for (let k = 0; k < fr.length; k++) {
    if (candidate.atoms[k].id !== reference.atoms[k].id || candidate.atoms[k].species !== reference.atoms[k].species)
      return 'ATOM_MAP_MISMATCH';
    for (let j = 0; j < 3; j++) if (Math.abs(fc[k][j] - fr[k][j]) > tol.fractional) return 'FRACTIONAL_NOT_PRESERVED';
  }
  return null;
}

// E-4: energía final de una salida de SIESTA 5.4.2 según la cantidad declarada.
const PATTERNS = {
  free_energy: /^siesta: FreeEng =\s*(\S+)\s*$/,
  total_energy: /^siesta:\s+Total =\s*(\S+)\s*$/,
};
export function finalEnergy(text, quantity) {
  const pattern = PATTERNS[quantity];
  if (!pattern) return { error: 'ENERGY_QUANTITY_UNKNOWN' };
  const lines = text.split('\n');
  if (!lines.some(l => /SCF cycle converged/.test(l)) || !lines.some(l => l.trim() === 'Job completed'))
    return { error: 'SCF_NOT_PROVEN' };
  let value = null;
  for (const l of lines) { const m = l.match(pattern); if (m) value = Number(m[1]); }
  if (value === null || !Number.isFinite(value)) return { error: 'ENERGY_MISSING' };
  return { value };
}

// E-2/E-3/E-4: admisibilidad de la tabla antes del ajuste.
export function admissibility(table, policy) {
  const reasons = [];
  if (table.quantity !== policy.energy_quantity) reasons.push('ENERGY_QUANTITY_MISMATCH');
  const pts = table.points;
  if (pts.length < policy.min_points) reasons.push('TOO_FEW_POINTS');
  if (pts.some(p => p.kgrid.kind !== 'MonkhorstPack')) reasons.push('KGRID_NOT_FIXED');
  else if (new Set(pts.map(p => JSON.stringify(p.kgrid.block))).size > 1) reasons.push('KGRID_INCONSISTENT');
  if (new Set(pts.map(p => p.mesh.join('x'))).size > 1) reasons.push('MESH_INCONSISTENT');
  if (new Set(pts.map(p => p.relaxation_mode)).size > 1 || pts.some(p => p.relaxation_mode !== policy.relaxation_mode))
    reasons.push('RELAXATION_MODE_MISMATCH');
  return reasons;
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// E-7: BM3 por mínimos cuadrados lineales. E es cúbico en x = V^(-2/3);
// se ajusta en t = (x - media)/desviación para que el sistema esté bien condicionado.
export function fitBM3(V, E) {
  const x = V.map(v => v ** (-2 / 3)), n = x.length;
  const xm = x.reduce((a, b) => a + b) / n;
  const xs = Math.sqrt(x.reduce((a, b) => a + (b - xm) ** 2, 0) / n);
  const t = x.map(v => (v - xm) / xs);
  const A = [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => t.reduce((s, ti) => s + ti ** (i + j), 0)));
  const b = [0, 1, 2, 3].map(i => t.reduce((s, ti, k) => s + ti ** i * E[k], 0));
  const c = solve(A, b);                                  // E = c0 + c1 t + c2 t² + c3 t³
  const p = tt => c[0] + c[1] * tt + c[2] * tt ** 2 + c[3] * tt ** 3;
  const d1 = tt => c[1] + 2 * c[2] * tt + 3 * c[3] * tt ** 2;
  const d2 = tt => 2 * c[2] + 6 * c[3] * tt;
  const disc = (2 * c[2]) ** 2 - 4 * 3 * c[3] * c[1];
  if (disc < 0) return null;
  const roots = Math.abs(c[3]) < 1e-300 ? [-c[1] / (2 * c[2])]
    : [(-2 * c[2] + Math.sqrt(disc)) / (6 * c[3]), (-2 * c[2] - Math.sqrt(disc)) / (6 * c[3])];
  const t0 = roots.filter(r => d2(r) > 0 && xm + xs * r > 0)[0];
  if (t0 === undefined) return null;
  const x0 = xm + xs * t0, V0 = x0 ** -1.5;
  // Derivadas respecto de x (dt/dx = 1/xs) y regla de la cadena hacia V.
  const px1 = 0, px2 = d2(t0) / xs ** 2, px3 = 6 * c[3] / xs ** 3;
  const xV1 = -2 / 3 * V0 ** (-5 / 3), xV2 = 10 / 9 * V0 ** (-8 / 3);
  const E2 = px2 * xV1 ** 2 + px1 * xV2;
  const E3 = px3 * xV1 ** 3 + 3 * px2 * xV1 * xV2;
  const rms = Math.sqrt(E.reduce((s, e, k) => s + (e - p(t[k])) ** 2, 0) / n);
  return { E0_eV: p(t0), V0_A3: V0, B0_GPa: V0 * E2 * EV_A3_TO_GPA, B0_prime: -1 - V0 * E3 / E2, rms_meV: rms * 1000 };
}

// E-8: veredicto completo de una tabla.
export function evaluate(table, policy) {
  const reasons = admissibility(table, policy);
  if (reasons.length) return { status: 'REJECTED', reasons };
  const V = table.points.map(p => p.volume_A3), E = table.points.map(p => p.energy_eV);
  const fit = fitBM3(V, E);
  if (!fit) return { status: 'NOT_ESTABLISHED', reasons: ['NO_MINIMUM'] };
  const out = [];
  const below = V.filter(v => v < fit.V0_A3).length, above = V.filter(v => v > fit.V0_A3).length;
  if (fit.V0_A3 <= Math.min(...V) || fit.V0_A3 >= Math.max(...V)) out.push('MINIMUM_OUTSIDE_RANGE');
  else if (below < policy.min_points_each_side || above < policy.min_points_each_side) out.push('MINIMUM_NOT_BRACKETED');
  const n = table.n_atoms;
  if (fit.rms_meV / n > policy.max_rms_meV_per_atom) out.push('RESIDUAL_TOO_LARGE');
  const order = V.map((v, i) => i).sort((a, b) => V[a] - V[b]);
  const drop = idx => { const keep = order.filter(i => i !== idx); return fitBM3(keep.map(i => V[i]), keep.map(i => E[i])); };
  const sens = { drop_lowest: drop(order[0]), drop_highest: drop(order[order.length - 1]) };
  let dV = 0, dB = 0;
  for (const s of Object.values(sens)) {
    if (!s) { out.push('SENSITIVITY_UNDEFINED'); continue; }
    dV = Math.max(dV, Math.abs(s.V0_A3 - fit.V0_A3) / fit.V0_A3);
    dB = Math.max(dB, Math.abs(s.B0_GPa - fit.B0_GPa) / fit.B0_GPa);
  }
  if (dV > policy.max_rel_dV0) out.push('V0_SENSITIVE');
  if (dB > policy.max_rel_dB0) out.push('B0_SENSITIVE');
  const result = {
    status: out.length ? 'NOT_ESTABLISHED' : 'ESTABLISHED', reasons: [...new Set(out)], fit,
    sensitivity: { max_rel_dV0: dV, max_rel_dB0: dB },
    per_atom: { V0_A3: fit.V0_A3 / n, E0_eV: fit.E0_eV / n },
  };
  return result;
}
