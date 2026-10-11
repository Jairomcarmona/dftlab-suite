// Trajectory / geometry side files written by SIESTA:
//   .MDE         per-step energies of MD / relaxations ("# Step T (K) E_KS (eV) E_tot (eV) Vol (A^3) P (kBar)")
//   .ANI         concatenated XYZ frames (Ang)
//   .FA          final atomic forces (eV/Ang)
//   .XV          cell (Bohr) + positions/velocities (Bohr, Bohr/fs)  -> converted to Ang
//   .STRUCT_OUT  cell (Ang) + fractional coordinates
import { lines as splitLines, ffloat, BOHR_ANG } from './util.js';

const KNOWN = [
  [/^step/i, 'step'], [/^T$/i, 'temperature'], [/^E_KS$/i, 'eKS'], [/^E_tot$/i, 'eTot'],
  [/^Vol$/i, 'volume'], [/^P$/i, 'pressure'], [/^Etot\+?/i, 'eTot'], [/^Ekin/i, 'eKin'],
];

export function parseMDE(text) {
  const L = splitLines(text);
  let cols = null;
  const rows = [];
  for (const ln of L) {
    const t = ln.trim();
    if (!t) continue;
    if (t[0] === '#') {
      const h = t.replace(/^#+/, '');
      const toks = [];
      const re = /([A-Za-z_][\w+.-]*)\s*(\(([^)]*)\))?/g;
      let m;
      while ((m = re.exec(h))) toks.push({ name: m[1], unit: m[3] ?? null });
      if (toks.length) cols = toks;
      continue;
    }
    const v = t.split(/\s+/).map(ffloat);
    if (v.some(Number.isNaN)) continue;
    rows.push(v);
  }
  const ncol = rows.length ? rows[0].length : (cols ? cols.length : 0);
  if (!cols || cols.length !== ncol) cols = Array.from({ length: ncol }, (_, i) => ({ name: `col${i + 1}`, unit: null }));
  const columns = {};
  const keys = cols.map((c) => {
    const hit = KNOWN.find(([re]) => re.test(c.name));
    let key = hit ? hit[1] : c.name;
    while (columns[key]) key += '_';
    columns[key] = Float64Array.from(rows, (r) => r[cols.indexOf(c)]);
    return key;
  });
  return {
    nSteps: rows.length,
    columns,                 // {step, temperature, eKS, eTot, volume, pressure, ...}
    columnInfo: cols.map((c, i) => ({ key: keys[i], name: c.name, unit: c.unit })),
    units: { temperature: 'K', eKS: 'eV', eTot: 'eV', volume: 'Ang^3', pressure: 'kbar' },
  };
}

export function parseANI(text) {
  const L = splitLines(text);
  const frames = [];
  let p = 0;
  while (p < L.length) {
    while (p < L.length && !L[p].trim()) p++;
    if (p >= L.length) break;
    const na = parseInt(L[p].trim(), 10);
    if (!Number.isFinite(na)) { p++; continue; }
    const comment = L[p + 1] ?? '';
    const symbols = [], positions = [];
    let q = p + 2;
    for (let i = 0; i < na && q < L.length; i++, q++) {
      const t = L[q].trim().split(/\s+/);
      if (t.length < 4) break;
      symbols.push(t[0]);
      positions.push([ffloat(t[1]), ffloat(t[2]), ffloat(t[3])]);
    }
    if (positions.length === na) frames.push({ comment: comment.trim(), symbols, positions });
    p = q;
  }
  return { nFrames: frames.length, nAtoms: frames[0]?.symbols.length ?? 0, frames, units: { positions: 'Ang' } };
}

export function parseFA(text) {
  const L = splitLines(text).filter((l) => l.trim());
  const na = parseInt(L[0], 10);
  const forces = [];
  const index = [];
  for (let i = 1; i < L.length && forces.length < na; i++) {
    const t = L[i].trim().split(/\s+/).map(ffloat);
    if (t.length < 4) continue;
    index.push(t[0]);
    forces.push([t[1], t[2], t[3]]);
  }
  const norms = forces.map((f) => Math.hypot(...f));
  const tot = forces.reduce((a, f) => [a[0] + f[0], a[1] + f[1], a[2] + f[2]], [0, 0, 0]);
  return {
    nAtoms: forces.length, index, forces, norms,
    maxForce: norms.length ? Math.max(...norms) : 0,
    maxComponent: forces.length ? Math.max(...forces.flat().map(Math.abs)) : 0,
    total: tot,
    units: { forces: 'eV/Ang' },
  };
}

export function parseXV(text) {
  const L = splitLines(text).filter((l) => l.trim());
  if (L.length < 4) throw new Error('XV file too short');
  const cellB = [], cellVel = [];
  for (let i = 0; i < 3; i++) {
    const v = L[i].trim().split(/\s+/).map(ffloat);
    cellB.push(v.slice(0, 3)); cellVel.push(v.slice(3, 6));
  }
  const na = parseInt(L[3], 10);
  const species = [], Z = [], pos = [], vel = [];
  for (let i = 0; i < na && 4 + i < L.length; i++) {
    const v = L[4 + i].trim().split(/\s+/).map(ffloat);
    species.push(v[0]); Z.push(v[1]);
    pos.push([v[2], v[3], v[4]].map((x) => x * BOHR_ANG));
    vel.push([v[5], v[6], v[7]].map((x) => x * BOHR_ANG));
  }
  return {
    cell: cellB.map((r) => r.map((x) => x * BOHR_ANG)), cellBohr: cellB,
    nAtoms: pos.length, species, Z, positions: pos, velocities: vel,
    units: { cell: 'Ang', positions: 'Ang', velocities: 'Ang/fs', cellBohr: 'Bohr (original)' },
  };
}

export function parseStructOut(text) {
  const L = splitLines(text).filter((l) => l.trim());
  if (L.length < 4) throw new Error('STRUCT file too short');
  const cell = [0, 1, 2].map((i) => L[i].trim().split(/\s+/).map(ffloat).slice(0, 3));
  const na = parseInt(L[3], 10);
  const species = [], Z = [], frac = [], cart = [];
  for (let i = 0; i < na && 4 + i < L.length; i++) {
    const v = L[4 + i].trim().split(/\s+/).map(ffloat);
    species.push(v[0]); Z.push(v[1]);
    const f = [v[2], v[3], v[4]];
    frac.push(f);
    cart.push([0, 1, 2].map((c) => f[0] * cell[0][c] + f[1] * cell[1][c] + f[2] * cell[2][c]));
  }
  return { cell, nAtoms: frac.length, species, Z, fractional: frac, positions: cart, units: { cell: 'Ang', positions: 'Ang' } };
}
