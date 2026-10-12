// Oráculo de referencia de los presets de corrida simple S-01…S-08 (ficha docs/scientific-protocols/PRESETS.md).
// Define el comportamiento que deben reproducir los vectores; no es código de producción.
export const BOHR_A = 0.529177210903;
export const COULOMB_EV_A = 14.399645478; // e²/(4πε0) en eV·Å
export const MADELUNG_SC = 2.8372974794806; // constante de Madelung de la red cúbica simple (celda de lado a)

const num = s => Number(s);
const lines = text => text.split(/\r?\n/);

// P-2, P-3, P-4, P-6: hechos de una salida de SIESTA 5.4.2 que usan los gates de los presets.
export function parseRun(text) {
  const L = lines(text);
  const first = (re, f = m => m[1]) => { for (const l of L) { const m = l.match(re); if (m) return f(m); } return null; };
  const last = (re, f = m => m[1]) => { let v = null; for (const l of L) { const m = l.match(re); if (m) v = f(m); } return v; };

  const meshes = [];
  for (const l of L) {
    const m = l.match(/^InitMesh: MESH =\s*(\d+) x\s*(\d+) x\s*(\d+)/);
    if (m) {
      const mesh = [num(m[1]), num(m[2]), num(m[3])];
      if (!meshes.length || meshes.at(-1).join() !== mesh.join()) meshes.push(mesh);
    }
  }
  let required = null, usedMin = null;
  for (const l of L) {
    const m = l.match(/^InitMesh: Mesh cutoff \(required, used\) =\s*(\S+)\s+(\S+) Ry/);
    if (m) { required = num(m[1]); usedMin = usedMin === null ? num(m[2]) : Math.min(usedMin, num(m[2])); }
  }

  // Bloques de resumen de fuerzas: cabecera, Tot, Max (sin restricción) y Max con restricción.
  const forces = [];
  L.forEach((l, i) => {
    if (!/^siesta: Atomic forces \(eV\/Ang\):\s*$/.test(l)) return;
    let tot = null, max = null, maxConstrained = null;
    for (const s of L.slice(i + 1, i + 9)) {
      let m;
      if (tot === null && (m = s.match(/^\s+Tot\s+(\S+)\s+(\S+)\s+(\S+)\s*$/))) tot = [num(m[1]), num(m[2]), num(m[3])];
      else if (max === null && (m = s.match(/^\s+Max\s+(\S+)\s*$/))) max = num(m[1]);
      else if (maxConstrained === null && (m = s.match(/^\s+Max\s+(\S+)\s+constrained\s*$/))) maxConstrained = num(m[1]);
    }
    if (tot && max !== null) forces.push({ tot, max, max_constrained: maxConstrained });
  });

  let madelung = first(/^madelung: Charged system with (SC|FCC|BCC) cell/);
  if (L.some(l => /^madelung: WARNING: Energy correction terms can not be applied/.test(l))) madelung = 'NOT_APPLIED';

  return {
    completed: L.some(l => /^Job completed/.test(l)),
    scf_converged: L.filter(l => /^SCF cycle converged/.test(l)).length,
    gamma_only: L.some(l => /^siesta: k-point is Gamma-only/.test(l)),
    folding: L.some(l => /^Folding of H and S implicitly performed/.test(l)),
    electrons: first(/^Total number of electrons:\s+(\S+)/, m => num(m[1])),
    spin: first(/^redata: Spin configuration\s+=\s+(\S+)/),
    net_charge: first(/^redata: Net charge of the system\s+=\s+(\S+) \|e\|/, m => num(m[1])),
    madelung,
    emadel_eV: last(/^siesta: Emadel\s+=\s+(\S+)/, m => num(m[1])),
    meshes,
    mesh_cutoff_Ry: required === null ? null : { required, used_min: usedMin },
    forces,
    relaxed: L.some(l => /^outcoor: Relaxed/.test(l)) ? true : (L.some(l => /^outcoor: Final \(unrelaxed\)/.test(l)) ? false : null),
  };
}

// P-2: energía de Madelung que SIESTA suma en una caja cúbica simple de lado a (Å) con carga neta q.
export const madelungSC = (q, a) => COULOMB_EV_A * q * q * MADELUNG_SC / (2 * a);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.sqrt(dot(a, a));

// P-1: ¿algún orbital interactúa con una imagen periódica? Radios en Bohr (rc máximo de orbital y de proyector KB por especie).
// Hay interacción si |ri − rj − T| < rc_i + rc_j (solapamiento) o si un proyector k alcanza a i y a una imagen de j.
export function imageInteraction(geometry, radii) {
  const cell = geometry.cell; // filas = vectores de red en Å
  const atoms = geometry.atoms.map(a => ({ ...a, pos: a.cart.map(v => v / BOHR_A) }));
  const cellB = cell.map(r => r.map(v => v / BOHR_A));
  const vol = Math.abs(dot(cellB[0], cross(cellB[1], cellB[2])));
  const heights = [0, 1, 2].map(i => vol / norm(cross(cellB[(i + 1) % 3], cellB[(i + 2) % 3])));
  const orb = s => radii[s].orb, kb = s => radii[s].kb;
  const maxOrb = Math.max(...atoms.map(a => orb(a.species))), maxKb = Math.max(...atoms.map(a => kb(a.species)));
  const reach = 2 * maxOrb + 2 * maxKb;
  let extent = 0;
  for (const a of atoms) for (const b of atoms) extent = Math.max(extent, norm(sub(a.pos, b.pos)));
  const n = heights.map(h => Math.ceil((reach + extent) / h));
  const shifts = [];
  for (let i = -n[0]; i <= n[0]; i++) for (let j = -n[1]; j <= n[1]; j++) for (let k = -n[2]; k <= n[2]; k++)
    shifts.push([i, j, k]);
  const at = (a, s) => [0, 1, 2].map(x => a.pos[x] + s[0] * cellB[0][x] + s[1] * cellB[1][x] + s[2] * cellB[2][x]);

  let clearance = Infinity, pair = null, viaProjector = null;
  for (const s of shifts) {
    if (s[0] === 0 && s[1] === 0 && s[2] === 0) continue;
    for (const [i, a] of atoms.entries()) for (const [j, b] of atoms.entries()) {
      const rjT = at(b, s);
      const c = norm(sub(a.pos, rjT)) - orb(a.species) - orb(b.species);
      if (c < clearance) { clearance = c; pair = [i + 1, j + 1, s]; }
      if (viaProjector) continue;
      // Proyector de un átomo k en cualquier celda que alcanza a ambos.
      for (const t of shifts) for (const [k, p] of atoms.entries()) {
        const rk = at(p, t);
        if (norm(sub(a.pos, rk)) < orb(a.species) + kb(p.species) && norm(sub(rjT, rk)) < orb(b.species) + kb(p.species)) {
          viaProjector = [i + 1, j + 1, s, k + 1, t];
          break;
        }
      }
    }
  }
  return { interacts: clearance < 0 || viaProjector !== null, min_clearance_bohr: clearance, closest_pair: pair, via_projector: viaProjector !== null };
}

const norm3 = v => Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
const result = reasons => ({ status: reasons.some(r => r.severity === 'REJECTED') ? 'REJECTED' : (reasons.length ? 'REVIEW' : 'ACCEPTED'), reasons: reasons.map(r => r.code) });

// S-01: molécula aislada. Orden de razones fijo. La fuerza neta se informa; no es un gate en S-01.
export function evaluateMolecule(run, intent) {
  const r = [];
  if (!run.completed || run.scf_converged < 1) r.push({ code: 'SCF_NOT_PROVEN', severity: 'REJECTED' });
  if (!run.gamma_only) r.push({ code: 'KGRID_NOT_GAMMA', severity: 'REJECTED' });
  if (run.folding) r.push({ code: 'BASIS_OVERLAPS_IMAGES', severity: 'REJECTED' });
  if (intent.net_charge !== 0 && (run.madelung === 'NOT_APPLIED' || run.madelung === null))
    r.push({ code: 'CHARGED_CELL_NO_MADELUNG', severity: 'REJECTED' });
  if (run.electrons !== null && Math.round(run.electrons) % 2 === 1 && run.spin === 'none')
    r.push({ code: 'ODD_ELECTRONS_UNPOLARIZED', severity: 'REJECTED' });
  const f = run.forces.at(-1);
  return { ...result(r), net_force_eV_A: f ? norm3(f.tot) : null };
}

// S-02, S-03, S-04: relajación. maxForceTol y maxStressTol son los del FDF (eV/Å, GPa).
export function evaluateRelaxation(run, intent) {
  const r = [];
  if (!run.completed || run.scf_converged < 1) r.push({ code: 'SCF_NOT_PROVEN', severity: 'REJECTED' });
  if (run.relaxed !== true) r.push({ code: 'NOT_RELAXED', severity: 'REJECTED' });
  if (intent.variable_cell) {
    if (run.meshes.length > 1) r.push({ code: 'MESH_CHANGED_DURING_RELAXATION', severity: 'REJECTED' });
    if (run.mesh_cutoff_Ry && run.mesh_cutoff_Ry.used_min < run.mesh_cutoff_Ry.required)
      r.push({ code: 'MESH_CUTOFF_BELOW_REQUEST', severity: 'REJECTED' });
  }
  const f = run.forces.at(-1);
  // P-4: con Geometry.Constraints la fuerza neta no se anula (S-04); entonces solo se informa.
  if (f && !intent.has_constraints && norm3(f.tot) >= intent.max_force_tol_eV_A) r.push({ code: 'NET_FORCE_ABOVE_TOLERANCE', severity: 'REVIEW' });
  return result(r);
}

// S-07: matriz de constantes de fuerza del archivo <SystemLabel>.FC de SIESTA 5.4.2.
// Orden comprobado contra las fuerzas de la salida: átomo desplazado i, dirección a, signo (−, +), átomo j, componente b.
// Cada bloque ya es −ΔF/Δx en eV/Å²; la constante es el promedio de ambos signos (diferencia central).
export function parseFC(text) {
  const L = lines(text).filter(l => l.trim());
  const head = L[0].match(/n_atoms, displacement \[Ang\]:\s+(\d+)\s+(\S+)/);
  if (!head) throw new Error('FC_HEADER_MISSING');
  const n = num(head[1]), m = 3 * n;
  const rows = L.slice(1).map(l => l.trim().split(/\s+/).map(num));
  if (rows.length !== 2 * m * n) throw new Error('FC_SIZE_MISMATCH');
  const K = Array.from({ length: m }, () => new Array(m).fill(0));
  let asr = 0;
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
    const sum = [0, 0, 0];
    for (let s = 0; s < 2; s++) for (let j = 0; j < n; j++) {
      const row = rows[((i * 3 + a) * 2 + s) * n + j];
      for (let b = 0; b < 3; b++) { K[3 * i + a][3 * j + b] += row[b] / 2; }
    }
    for (let j = 0; j < n; j++) for (let b = 0; b < 3; b++) sum[b] += K[3 * i + a][3 * j + b];
    asr = Math.max(asr, ...sum.map(Math.abs));
  }
  let asym = 0;
  for (let p = 0; p < m; p++) for (let q = 0; q < m; q++) asym = Math.max(asym, Math.abs(K[p][q] - K[q][p]));
  return { n_atoms: n, displacement_A: num(head[2]), K, asr_violation_eV_A2: asr, asymmetry_eV_A2: asym };
}

// Valores propios de una matriz simétrica (Jacobi cíclico).
export function symmetricEigenvalues(A0) {
  const n = A0.length, A = A0.map(r => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
    }
  }
  return A.map((r, i) => r[i]).sort((x, y) => x - y);
}

export const CM1_PER_SQRT_EV_A2_AMU = 521.470898;
const toCm1 = w => Math.sign(w) * Math.sqrt(Math.abs(w)) * CM1_PER_SQRT_EV_A2_AMU;

// Gram–Schmidt: añade v a la base si su resto normalizado supera tol.
function addOrthonormal(basis, v, tol) {
  let r = v.slice();
  for (let pass = 0; pass < 2; pass++) for (const b of basis) { const d = b.reduce((s, x, k) => s + x * r[k], 0); r = r.map((x, k) => x - d * b[k]); }
  const nr = Math.sqrt(r.reduce((s, x) => s + x * x, 0));
  if (nr > tol) { basis.push(r.map(x => x / nr)); return true; }
  return false;
}

// S-07: frecuencias armónicas (cm⁻¹, negativas = imaginarias) con los modos rígidos proyectados (Eckart).
// cart en Å, masses en uma. Devuelve las frecuencias crudas y las 3N − r vibracionales, r = número de modos rígidos.
export function harmonicModes(fc, cart, masses) {
  const n = fc.n_atoms, m = 3 * n;
  const K = fc.K.map((r, p) => r.map((x, q) => (x + fc.K[q][p]) / 2));
  const sm = Array.from({ length: m }, (_, p) => Math.sqrt(masses[Math.floor(p / 3)]));
  const D = K.map((r, p) => r.map((x, q) => x / (sm[p] * sm[q])));
  const raw = symmetricEigenvalues(D).map(toCm1);
  const M = masses.reduce((s, x) => s + x, 0);
  const com = [0, 1, 2].map(a => cart.reduce((s, r, i) => s + masses[i] * r[a], 0) / M);
  const rel = cart.map(r => r.map((x, a) => x - com[a]));
  const basis = [];
  const scale = Math.sqrt(M) * Math.max(1, ...rel.flat().map(Math.abs));
  for (let a = 0; a < 3; a++) addOrthonormal(basis, Array.from({ length: m }, (_, p) => (p % 3 === a ? sm[p] : 0)), 1e-8 * scale);
  for (let a = 0; a < 3; a++) {
    const v = new Array(m).fill(0);
    rel.forEach((r, i) => {
      const e = [0, 0, 0]; e[a] = 1;
      const c = [e[1] * r[2] - e[2] * r[1], e[2] * r[0] - e[0] * r[2], e[0] * r[1] - e[1] * r[0]];
      for (let b = 0; b < 3; b++) v[3 * i + b] = sm[3 * i + b] * c[b];
    });
    addOrthonormal(basis, v, 1e-8 * scale);
  }
  const rigid = basis.length;
  const comp = basis.slice();
  for (let p = 0; p < m && comp.length < m; p++) addOrthonormal(comp, Array.from({ length: m }, (_, q) => (q === p ? 1 : 0)), 1e-8);
  const B = comp.slice(rigid);
  const Dv = B.map(u => B.map(w => u.reduce((s, x, p) => s + x * D[p].reduce((t, y, q) => t + y * w[q], 0), 0)));
  const vib = symmetricEigenvalues(Dv).map(toCm1);
  const rawRigid = raw.map(Math.abs).sort((x, y) => x - y).slice(0, rigid);
  return { rigid_modes: rigid, raw_cm1: raw, raw_rigid_max_cm1: Math.max(...rawRigid), vibrational_cm1: vib };
}

// S-07: veredicto. fcRun es parseRun de la salida FC (su primer bloque de fuerzas es la geometría sin desplazar).
export function evaluateVibrations(fcRun, fc, cart, masses, policy) {
  const r = [];
  if (!fcRun.completed) r.push({ code: 'SCF_NOT_PROVEN', severity: 'REJECTED' });
  if (fc.n_atoms !== cart.length || masses.length !== cart.length) r.push({ code: 'ATOM_MAP_MISMATCH', severity: 'REJECTED' });
  const reference = fcRun.forces[0];
  if (!reference || reference.max > policy.max_reference_force_eV_A) r.push({ code: 'GEOMETRY_NOT_RELAXED', severity: 'REJECTED' });
  if (r.some(x => x.code === 'ATOM_MAP_MISMATCH')) return result(r);
  const modes = harmonicModes(fc, cart, masses);
  if (modes.vibrational_cm1.some(w => w < -policy.imaginary_tol_cm1)) r.push({ code: 'IMAGINARY_VIBRATION', severity: 'REVIEW' });
  return { ...result(r), rigid_modes: modes.rigid_modes, raw_rigid_max_cm1: modes.raw_rigid_max_cm1,
    asr_violation_eV_A2: fc.asr_violation_eV_A2, vibrational_cm1: modes.vibrational_cm1 };
}
