// symmetry.js -- crystal symmetry analysis (moyo/WebAssembly) and cell utilities for DFT Lab.
//
// Cell convention used by every module in this folder:
//   {
//     lattice:   [[ax,ay,az],[bx,by,bz],[cx,cy,cz]]   // rows = lattice vectors, Angstrom
//     positions: [[x,y,z], ...]                       // FRACTIONAL coordinates
//     numbers:   [Z, ...]                             // atomic numbers
//     // optional: labels: [...], types: [...] (symmetry-distinguishing integers),
//     //           pbc: [true,true,true], info: {...}
//   }
// Matrices are arrays of rows. moyo stores matrices column-major; they are converted here.

import { initMoyo, getMoyo, isMoyoReady } from '../../vendor/moyo/loader.js';
import { atomicNumber, covalentRadius, symbolOf } from './elements.js';

export { initMoyo, isMoyoReady };

// ---------------------------------------------------------------------------
// Small 3x3 linear algebra
// ---------------------------------------------------------------------------
export const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
export const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
export const norm = (u) => Math.sqrt(dot(u, u));
export const add = (u, v) => [u[0] + v[0], u[1] + v[1], u[2] + v[2]];
export const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
export const scale = (u, s) => [u[0] * s, u[1] * s, u[2] * s];
export const det3 = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
export const transpose = (m) => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);
export function matmul(a, b) {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}
/** m * v (v column vector) */
export const matvec = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
/** v * m (v row vector) */
export const vecmat = (v, m) => [
  v[0] * m[0][0] + v[1] * m[1][0] + v[2] * m[2][0],
  v[0] * m[0][1] + v[1] * m[1][1] + v[2] * m[2][1],
  v[0] * m[0][2] + v[1] * m[1][2] + v[2] * m[2][2],
];
export function inv3(m) {
  const d = det3(m);
  if (Math.abs(d) < 1e-300) throw new Error('singular matrix');
  const c = [
    [m[1][1] * m[2][2] - m[1][2] * m[2][1], m[0][2] * m[2][1] - m[0][1] * m[2][2], m[0][1] * m[1][2] - m[0][2] * m[1][1]],
    [m[1][2] * m[2][0] - m[1][0] * m[2][2], m[0][0] * m[2][2] - m[0][2] * m[2][0], m[0][2] * m[1][0] - m[0][0] * m[1][2]],
    [m[1][0] * m[2][1] - m[1][1] * m[2][0], m[0][1] * m[2][0] - m[0][0] * m[2][1], m[0][0] * m[1][1] - m[0][1] * m[1][0]],
  ];
  return c.map((row) => row.map((x) => x / d));
}
export const identity3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** moyo column-major flat [9] -> rows */
export const fromColumnMajor = (f) => [[f[0], f[3], f[6]], [f[1], f[4], f[7]], [f[2], f[5], f[8]]];
/** moyo basis (concatenated vectors) -> lattice rows */
export const basisToLattice = (b) => [[b[0], b[1], b[2]], [b[3], b[4], b[5]], [b[6], b[7], b[8]]];
export const latticeToBasis = (L) => [...L[0], ...L[1], ...L[2]];
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

/** Normalise a cell-like object: accepts numbers, symbols or species arrays. Returns a new cell. */
export function normalizeCell(cell) {
  if (!cell || !cell.lattice || !cell.positions) throw new Error('cell must have lattice and positions');
  let numbers = cell.numbers;
  if (!numbers) {
    const sy = cell.symbols || cell.species || cell.labels;
    if (!sy) throw new Error('cell must have numbers or symbols');
    numbers = sy.map((s) => atomicNumber(s));
  }
  const out = {
    lattice: cell.lattice.map((v) => v.map(Number)),
    positions: cell.positions.map((p) => p.map(Number)),
    numbers: numbers.map((z) => (typeof z === 'number' ? z : atomicNumber(z))),
  };
  if (cell.labels) out.labels = cell.labels.slice();
  if (cell.types) out.types = cell.types.slice();
  if (cell.pbc) out.pbc = cell.pbc.slice();
  if (cell.info) out.info = clone(cell.info);
  return out;
}

export function symbolsOf(cell) {
  return cell.numbers.map((z) => symbolOf(z));
}

/** Lattice parameters (Angstrom, degrees) and volume of a lattice (rows). */
export function cellParameters(lattice) {
  const [a, b, c] = lattice;
  const la = norm(a), lb = norm(b), lc = norm(c);
  const deg = 180 / Math.PI;
  return {
    a: la, b: lb, c: lc,
    alpha: Math.acos(Math.max(-1, Math.min(1, dot(b, c) / lb / lc))) * deg,
    beta: Math.acos(Math.max(-1, Math.min(1, dot(a, c) / la / lc))) * deg,
    gamma: Math.acos(Math.max(-1, Math.min(1, dot(a, b) / la / lb))) * deg,
    volume: det3(lattice),
  };
}

/** Lattice (rows) from parameters; a along x, b in the xy plane (CIF/SIESTA/ASE convention). */
export function latticeFromParameters(a, b, c, alpha, beta, gamma) {
  if (typeof a === 'object') ({ a, b, c, alpha, beta, gamma } = a);
  const r = Math.PI / 180;
  const cosA = cosDeg(alpha), cosB = cosDeg(beta), cosG = cosDeg(gamma);
  const sinG = Math.sin(gamma * r);
  const cx = c * cosB;
  const cy = (c * (cosA - cosB * cosG)) / sinG;
  const cz = Math.sqrt(Math.max(0, c * c - cx * cx - cy * cy));
  return [[a, 0, 0], [b * cosG, b * sinG, 0], [cx, cy, cz]];
}
function cosDeg(x) {
  // exact values for the common angles (avoid 6e-17 noise)
  if (Math.abs(x - 90) < 1e-12) return 0;
  if (Math.abs(x - 120) < 1e-12) return -0.5;
  if (Math.abs(x - 60) < 1e-12) return 0.5;
  return Math.cos((x * Math.PI) / 180);
}

/** Reciprocal lattice (rows). twoPi=true gives b_i . a_j = 2 pi delta_ij (seekpath convention). */
export function reciprocalLattice(lattice, twoPi = true) {
  const f = twoPi ? 2 * Math.PI : 1;
  return transpose(inv3(lattice)).map((r) => scale(r, f));
}

export function volume(lattice) {
  return Math.abs(det3(lattice));
}

/** Fractional -> Cartesian. Accepts a single vector or an array of vectors. */
export function fracToCart(latticeOrCell, frac) {
  const L = latticeOrCell.lattice || latticeOrCell;
  if (typeof frac[0] === 'number') return vecmat(frac, L);
  return frac.map((f) => vecmat(f, L));
}

/** Cartesian -> fractional. Accepts a single vector or an array of vectors. */
export function cartToFrac(latticeOrCell, cart) {
  const L = latticeOrCell.lattice || latticeOrCell;
  const Li = inv3(L);
  if (typeof cart[0] === 'number') return vecmat(cart, Li);
  return cart.map((c) => vecmat(c, Li));
}

export function cartesianPositions(cell) {
  return fracToCart(cell.lattice, cell.positions);
}

/** Wrap fractional coordinates into [0,1). */
export function wrapPositions(cell, eps = 1e-10) {
  const out = normalizeCell(cell);
  out.positions = out.positions.map((p) => p.map((x) => {
    let y = x - Math.floor(x);
    if (y > 1 - eps) y = 0;
    return y;
  }));
  return out;
}

/** Chemical formula: {formula: 'Si2O4', reduced: 'SiO2', counts: {Si:2,O:4}}. Hill-like order (C, H first if C present). */
export function formula(cell) {
  const counts = {};
  for (const z of cell.numbers) { const s = symbolOf(z); counts[s] = (counts[s] || 0) + 1; }
  let keys = Object.keys(counts);
  if (counts.C) keys = ['C', ...(counts.H ? ['H'] : []), ...keys.filter((k) => k !== 'C' && k !== 'H').sort()];
  else keys.sort();
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = Object.values(counts).reduce(gcd, 0) || 1;
  const fmt = (div) => keys.map((k) => k + (counts[k] / div === 1 ? '' : counts[k] / div)).join('');
  return { formula: fmt(1), reduced: fmt(g), counts, z: g };
}

/**
 * Supercell. `n` is [n1,n2,n3] or an integer 3x3 matrix M whose ROWS give the new lattice
 * vectors in terms of the old ones (new_lattice = M * lattice).
 */
export function supercell(cell, n) {
  const c = normalizeCell(cell);
  const M = typeof n === 'number' ? [[n, 0, 0], [0, n, 0], [0, 0, n]]
    : typeof n[0] === 'number' ? [[n[0], 0, 0], [0, n[1], 0], [0, 0, n[2]]] : n;
  const detM = Math.round(det3(M));
  if (detM === 0) throw new Error('supercell matrix is singular');
  const Mi = inv3(M);
  const newLattice = matmul(M, c.lattice);
  // range of lattice translations: corners of the supercell expressed in old fractional units
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const corner = [(i & 1) ? 1 : 0, (i & 2) ? 1 : 0, (i & 4) ? 1 : 0];
    const o = vecmat(corner, M);
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], Math.floor(o[k])); hi[k] = Math.max(hi[k], Math.ceil(o[k])); }
  }
  const eps = 1e-8;
  const out = { lattice: newLattice, positions: [], numbers: [] };
  const extra = { labels: c.labels ? [] : null, types: c.types ? [] : null };
  const wrap = (x) => { let y = x - Math.floor(x); if (y > 1 - eps) y = 0; return y; };
  for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
    c.positions.forEach((p, a) => {
      const f = vecmat([p[0] + i, p[1] + j, p[2] + k], Mi);
      if (f.every((x) => x >= -eps && x < 1 - eps)) {
        out.positions.push(f.map(wrap));
        out.numbers.push(c.numbers[a]);
        if (extra.labels) extra.labels.push(c.labels[a]);
        if (extra.types) extra.types.push(c.types[a]);
      }
    });
  }
  if (out.positions.length !== Math.abs(detM) * c.positions.length) {
    throw new Error(`supercell: expected ${Math.abs(detM) * c.positions.length} atoms, got ${out.positions.length}`);
  }
  if (extra.labels) out.labels = extra.labels;
  if (extra.types) out.types = extra.types;
  if (c.pbc) out.pbc = c.pbc;
  return out;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random Cartesian displacement of every atom (uniform direction, length uniform in [0, amplitude] Angstrom).
 * Deterministic for a given seed. options: {seed=1, atoms: indices to move, strain: 3x3 symmetric strain}
 */
export function perturb(cell, amplitude = 0.01, { seed = 1, atoms = null, strain = null } = {}) {
  const c = normalizeCell(cell);
  const rnd = mulberry32(seed);
  const cart = cartesianPositions(c);
  const sel = atoms ? new Set(atoms) : null;
  const moved = cart.map((r, i) => {
    if (sel && !sel.has(i)) return r;
    let v;
    do { v = [2 * rnd() - 1, 2 * rnd() - 1, 2 * rnd() - 1]; } while (dot(v, v) > 1 || dot(v, v) < 1e-6);
    return add(r, scale(v, (amplitude * rnd()) / norm(v)));
  });
  let lattice = c.lattice;
  if (strain) {
    const F = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + strain[i][j]));
    lattice = lattice.map((v) => matvec(F, v));
    c.positions = cartToFrac(c.lattice, moved);
    c.lattice = lattice;
    return c;
  }
  c.positions = cartToFrac(c.lattice, moved);
  return c;
}

/**
 * Substitute atoms. `selector`: index, array of indices, element symbol / Z (all atoms of that element),
 * or predicate (i, cell) => boolean. `newElement`: symbol or Z.
 */
export function substitute(cell, selector, newElement) {
  const c = normalizeCell(cell);
  const z = atomicNumber(newElement);
  if (!z) throw new Error(`unknown element ${newElement}`);
  let pick;
  if (typeof selector === 'function') pick = (i) => selector(i, c);
  else if (Array.isArray(selector)) { const s = new Set(selector); pick = (i) => s.has(i); }
  else if (typeof selector === 'string') { const zz = atomicNumber(selector); pick = (i) => c.numbers[i] === zz; }
  else pick = (i) => i === selector;
  c.numbers = c.numbers.map((zi, i) => (pick(i) ? z : zi));
  if (c.labels) c.labels = c.labels.map((l, i) => (pick(i) ? symbolOf(z) : l));
  if (c.types) delete c.types;
  return c;
}

/** Remove atoms by index list. */
export function removeAtoms(cell, indices) {
  const c = normalizeCell(cell);
  const s = new Set(indices);
  const keep = (_, i) => !s.has(i);
  c.positions = c.positions.filter(keep);
  c.numbers = c.numbers.filter(keep);
  if (c.labels) c.labels = c.labels.filter(keep);
  if (c.types) c.types = c.types.filter(keep);
  return c;
}

/** Add one atom (fractional coordinates unless {cartesian:true}). */
export function addAtom(cell, element, position, { cartesian = false } = {}) {
  const c = normalizeCell(cell);
  c.positions.push(cartesian ? cartToFrac(c.lattice, position) : position.slice());
  c.numbers.push(atomicNumber(element));
  if (c.labels) c.labels.push(symbolOf(atomicNumber(element)));
  if (c.types) c.types.push(atomicNumber(element));
  return c;
}

/**
 * Bonds from covalent radii with periodic images.
 * A bond i-j(+image) exists when d < scale*(r_i + r_j) + tolerance and d > minDistance.
 * Options: {scale=1.15, tolerance=0, maxLength=Infinity, minDistance=0.1, radii: {Z: r}, pbc,
 *           filter: (Zi, Zj, d, i, j) => boolean (e.g. drop metal-metal contacts)}
 * Returns [{i, j, image:[n1,n2,n3], length, vector}], each bond listed once
 * (vector = r_j + image*L - r_i, Cartesian).
 */
export function bonds(cell, { scale: sc = 1.15, tolerance = 0, maxLength = Infinity, minDistance = 0.1, radii = null, pbc = null, filter = null } = {}) {
  const c = normalizeCell(cell);
  const per = pbc || c.pbc || [true, true, true];
  const r = c.numbers.map((z) => (radii && radii[z] != null ? radii[z] : covalentRadius(z)));
  const rmax = Math.max(...r, 0);
  const cutoffMax = Math.min(maxLength, 2 * rmax * sc + tolerance);
  const cart = cartesianPositions(c);
  const rec = reciprocalLattice(c.lattice, false);
  // number of images: cutoff / interplanar spacing, plus 1 for atoms anywhere in the cell
  const nimg = rec.map((b, k) => (per[k] ? Math.ceil(cutoffMax * norm(b)) + 1 : 0));
  const images = [];
  for (let i = -nimg[0]; i <= nimg[0]; i++) for (let j = -nimg[1]; j <= nimg[1]; j++) for (let k = -nimg[2]; k <= nimg[2]; k++) {
    images.push([[i, j, k], vecmat([i, j, k], c.lattice)]);
  }
  const out = [];
  const n = cart.length;
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      const cut = Math.min(maxLength, sc * (r[a] + r[b]) + tolerance);
      const d0 = sub(cart[b], cart[a]);
      for (const [img, t] of images) {
        if (a === b) {
          // list each self-image bond once: first non-zero component positive
          const f = img.find((x) => x !== 0);
          if (f === undefined || f < 0) continue;
        }
        const v = add(d0, t);
        const d2 = dot(v, v);
        if (d2 > cut * cut || d2 < minDistance * minDistance) continue;
        if (filter && !filter(c.numbers[a], c.numbers[b], Math.sqrt(d2), a, b)) continue;
        out.push({ i: a, j: b, image: img.slice(), length: Math.sqrt(d2), vector: v });
      }
    }
  }
  return out;
}

/** Coordination: neighbour list per atom from bonds(). */
export function neighborList(cell, opts = {}) {
  const bl = bonds(cell, opts);
  const nb = cell.positions.map(() => []);
  for (const b of bl) {
    nb[b.i].push({ j: b.j, image: b.image, length: b.length });
    nb[b.j].push({ j: b.i, image: b.image.map((x) => -x), length: b.length });
  }
  return nb;
}

/** Minimum-image distance between atoms i and j (Angstrom). */
export function distance(cell, i, j) {
  const d = sub(cell.positions[j], cell.positions[i]);
  let best = Infinity;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const f = [d[0] - Math.round(d[0]) + a, d[1] - Math.round(d[1]) + b, d[2] - Math.round(d[2]) + c];
    best = Math.min(best, norm(vecmat(f, cell.lattice)));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Niggli reduction -- port of spglib's niggli.c (Grosse-Kunstleve, Sauter, Adams,
// Acta Cryst. A60, 1 (2004)). Lattice as rows; returns {lattice, transformation}
// with reduced = transformation * lattice (rows).
// ---------------------------------------------------------------------------
export function niggliReduce(lattice, eps = 1e-5, maxLoop = 10000) {
  // work with column matrix Lc (columns = vectors)
  let Lc = transpose(lattice);
  let T = identity3();
  let p;
  const setParams = () => {
    const a = [Lc[0][0], Lc[1][0], Lc[2][0]], b = [Lc[0][1], Lc[1][1], Lc[2][1]], c = [Lc[0][2], Lc[1][2], Lc[2][2]];
    p = { A: dot(a, a), B: dot(b, b), C: dot(c, c), xi: 2 * dot(b, c), eta: 2 * dot(a, c), zeta: 2 * dot(a, b) };
    const sgn = (x) => (x < -eps ? -1 : x > eps ? 1 : 0);
    p.l = sgn(p.xi); p.m = sgn(p.eta); p.n = sgn(p.zeta);
  };
  const apply = (M) => { Lc = matmul(Lc, M); T = matmul(T, M); setParams(); };
  const steps = [
    () => {
      if (p.A > p.B + eps || (!(Math.abs(p.A - p.B) > eps) && Math.abs(p.xi) > Math.abs(p.eta) + eps)) {
        apply([[0, -1, 0], [-1, 0, 0], [0, 0, -1]]); return true;
      } return false;
    },
    () => {
      if (p.B > p.C + eps || (!(Math.abs(p.B - p.C) > eps) && Math.abs(p.eta) > Math.abs(p.zeta) + eps)) {
        apply([[-1, 0, 0], [0, 0, -1], [0, -1, 0]]); return true;
      } return false;
    },
    () => {
      if (p.l * p.m * p.n === 1) {
        apply([[p.l === -1 ? -1 : 1, 0, 0], [0, p.m === -1 ? -1 : 1, 0], [0, 0, p.n === -1 ? -1 : 1]]); return true;
      } return false;
    },
    () => {
      if (p.l === -1 && p.m === -1 && p.n === -1) return false;
      const prod = p.l * p.m * p.n;
      if (prod === 0 || prod === -1) {
        const d = [1, 1, 1];
        let r = -1;
        [p.l, p.m, p.n].forEach((s, k) => { if (s === 1) d[k] = -1; else if (s === 0) r = k; });
        if (d[0] * d[1] * d[2] === -1) {
          if (r < 0) return false;
          d[r] = -1;
        }
        apply([[d[0], 0, 0], [0, d[1], 0], [0, 0, d[2]]]); return true;
      } return false;
    },
    () => {
      if (Math.abs(p.xi) > p.B + eps || (!(Math.abs(p.B - p.xi) > eps) && 2 * p.eta < p.zeta - eps) ||
        (!(Math.abs(p.B + p.xi) > eps) && p.zeta < -eps)) {
        apply([[1, 0, 0], [0, 1, p.xi > 0 ? -1 : 1], [0, 0, 1]]); return true;
      } return false;
    },
    () => {
      if (Math.abs(p.eta) > p.A + eps || (!(Math.abs(p.A - p.eta) > eps) && 2 * p.xi < p.zeta - eps) ||
        (!(Math.abs(p.A + p.eta) > eps) && p.zeta < -eps)) {
        apply([[1, 0, p.eta > 0 ? -1 : 1], [0, 1, 0], [0, 0, 1]]); return true;
      } return false;
    },
    () => {
      if (Math.abs(p.zeta) > p.A + eps || (!(Math.abs(p.A - p.zeta) > eps) && 2 * p.xi < p.eta - eps) ||
        (!(Math.abs(p.A + p.zeta) > eps) && p.eta < -eps)) {
        apply([[1, p.zeta > 0 ? -1 : 1, 0], [0, 1, 0], [0, 0, 1]]); return true;
      } return false;
    },
    () => {
      const s = p.xi + p.eta + p.zeta + p.A + p.B;
      if (s < -eps || (!(Math.abs(s) > eps) && 2 * (p.A + p.eta) + p.zeta > eps)) {
        apply([[1, 0, 1], [0, 1, 1], [0, 0, 1]]); return true;
      } return false;
    },
  ];
  setParams();
  let ok = false;
  for (let it = 0; it < maxLoop && !ok; it++) {
    let j;
    for (j = 0; j < 8; j++) {
      // as in spglib: after steps 2 and 5-8 restart from step 1
      if (steps[j]() && !(j === 0 || j === 2 || j === 3)) break;
    }
    if (j === 8) ok = true;
  }
  if (!ok) throw new Error('Niggli reduction did not converge');
  return { lattice: transpose(Lc), transformation: transpose(T) };
}

// ---------------------------------------------------------------------------
// Space-group tables (from seekpath's spg_db, generated with spglib)
// ---------------------------------------------------------------------------
const SPG_CENTERING = 'PPPPCPPCCPPCPPCPPPPCCFIIPPPPPPPPPPCCCAAAAFFIIIPPPPPPPPPPPPPPPPCCCCCCFFIIIIPPPPIIPIPPPPIIPPPPPPPPIIPPPPPPPPIIIIPPPPPPPPIIIIPPPPPPPPPPPPPPPPIIIIPPPRPRPPPPPPRPPPPRRPPPPRRPPPPPPPPPPPPPPPPPPPPPPPPPPPPFIPIPPFFIPIPPFFIPPIPFIPFIPPPPFFFFII';
const SPG_INVERSION = '01000000011111100000000000000000000000000000001111111111111111111111111111000000001111110000000000000000000000000000000000111111111111111111110000110000000000000111111000000011000000000000001111000001111111000000000000001111111111';

export function crystalFamilyLetter(number) {
  if (number <= 2) return 'a';
  if (number <= 15) return 'm';
  if (number <= 74) return 'o';
  if (number <= 142) return 't';
  if (number <= 194) return 'h';
  return 'c';
}
export function crystalSystem(number) {
  if (number <= 2) return 'triclinic';
  if (number <= 15) return 'monoclinic';
  if (number <= 74) return 'orthorhombic';
  if (number <= 142) return 'tetragonal';
  if (number <= 167) return 'trigonal';
  if (number <= 194) return 'hexagonal';
  return 'cubic';
}
export function latticeSystem(number) {
  const cs = crystalSystem(number);
  if (cs === 'trigonal') return SPG_CENTERING[number - 1] === 'R' ? 'rhombohedral' : 'hexagonal';
  return cs;
}
/** Centering letter of the spglib-standard setting (P, A, C, F, I, R). */
export function spacegroupCentering(number) {
  return SPG_CENTERING[number - 1];
}
/** Bravais-lattice symbol as used by HPKOT/seekpath (cP, cF, ..., oA, oC, hR, mC, aP). */
export function bravaisLattice(number) {
  return crystalFamilyLetter(number) + SPG_CENTERING[number - 1];
}
/** True when the point group of space group `number` contains the inversion. */
export function spacegroupHasInversion(number) {
  return SPG_INVERSION[number - 1] === '1';
}

// ---------------------------------------------------------------------------
// Symmetry analysis (moyo)
// ---------------------------------------------------------------------------

function toMoyoCell(cell) {
  const c = normalizeCell(cell);
  return {
    lattice: { basis: latticeToBasis(c.lattice) },
    positions: c.positions,
    numbers: c.types || c.numbers,
  };
}

function fromMoyoCell(mc, numbersMap = null) {
  // wrap to [0,1) like spglib's std_positions
  const w = (x) => { let y = x - Math.floor(x); if (y > 1 - 1e-12) y = 0; return Math.abs(y) < 1e-14 ? 0 : y; };
  return {
    lattice: basisToLattice(mc.lattice.basis),
    positions: mc.positions.map((p) => p.map(w)),
    numbers: numbersMap ? mc.numbers.map(numbersMap) : mc.numbers.slice(),
  };
}

/** Raw moyo dataset (synchronous; moyo must be initialised). */
export function moyoDataset(cell, { symprec = 1e-5, setting = 'Spglib' } = {}) {
  const moyo = getMoyo();
  return moyo.analyze_cell(JSON.stringify(toMoyoCell(cell)), symprec, setting);
}

/**
 * Full symmetry analysis.
 * options: {symprec=1e-5 (Angstrom), setting='Spglib' | 'Standard'}
 * Returns an object with spglib-like fields (see README).
 */
export function analyze(cell, { symprec = 1e-5, setting = 'Spglib', preferInputOrientation = true } = {}) {
  const c = normalizeCell(cell);
  const moyo = getMoyo();
  const ds = moyo.analyze_cell(JSON.stringify(toMoyoCell(c)), symprec, setting);
  const sgt = moyo.space_group_type(ds.number);
  // map symmetry types back to atomic numbers when `types` was used
  let typeToZ = null;
  if (c.types) {
    const m = new Map();
    c.types.forEach((t, i) => m.set(t, c.numbers[i]));
    typeToZ = (t) => m.get(t);
  }
  const conventional = fromMoyoCell(ds.std_cell, typeToZ);
  const primitive = fromMoyoCell(ds.prim_std_cell, typeToZ);
  if (c.types) {
    conventional.types = ds.std_cell.numbers.slice();
    primitive.types = ds.prim_std_cell.numbers.slice();
  }
  let stdLinear = fromColumnMajor(ds.std_linear);
  let primLinear = fromColumnMajor(ds.prim_std_linear);
  let P = inv3(stdLinear); // spglib transformation_matrix: x_std = P x + p
  let origin = scale(matvec(P, ds.std_origin_shift), -1);
  let rotation = fromColumnMajor(ds.std_rotation_matrix);
  let stdShift = ds.std_origin_shift.slice();
  let primShift = ds.prim_std_origin_shift.slice();
  let reoriented = false;
  if (preferInputOrientation) {
    const alt = closestStandardization(ds, P, origin, rotation, primLinear, primShift, conventional.lattice);
    // only when the input already is a standard conventional cell (P becomes the identity): this
    // reproduces spglib's choice most often (tested); otherwise moyo's choice is kept
    const isId = alt && alt.P.flat().every((x, i) => Math.abs(x - (i % 4 === 0 ? 1 : 0)) < 1e-9);
    if (isId) {
      ({ P, origin, rotation, stdLinear, stdShift, primLinear, primShift } = alt);
      reoriented = true;
    }
  }
  // orbits
  const orbitMap = new Map();
  ds.orbits.forEach((rep, i) => {
    if (!orbitMap.has(rep)) orbitMap.set(rep, []);
    orbitMap.get(rep).push(i);
  });
  const orbits = [...orbitMap.entries()].map(([rep, idx]) => ({
    representative: rep,
    indices: idx,
    element: symbolOf(c.numbers[rep]),
    wyckoff: ds.wyckoffs[rep],
    siteSymmetry: ds.site_symmetry_symbols[rep],
  }));
  const number = ds.number;
  return {
    number,
    hall_number: ds.hall_number,
    hm_symbol: ds.hm_symbol,
    international: ds.hm_symbol.replace(/\s+/g, ''),
    hm_full: sgt.hm_full,
    point_group: sgt.geometric_crystal_class,
    arithmetic_symbol: sgt.arithmetic_symbol,
    crystal_system: crystalSystem(number),
    lattice_system: latticeSystem(number),
    bravais: bravaisLattice(number),
    pearson_symbol: ds.pearson_symbol,
    has_inversion: spacegroupHasInversion(number),
    nOps: ds.operations.length,
    operations: ds.operations.map((o) => ({ rotation: fromColumnMajor(o.rotation), translation: o.translation.slice() })),
    wyckoffs: ds.wyckoffs.slice(),
    site_symmetry_symbols: ds.site_symmetry_symbols.slice(),
    equivalent_atoms: ds.orbits.slice(),
    orbits,
    conventional,
    primitive,
    std_linear: stdLinear,
    std_origin_shift: stdShift,
    std_rotation_matrix: rotation,
    prim_std_linear: primLinear,
    prim_std_origin_shift: primShift,
    transformation_matrix: P,
    origin_shift: origin,
    reoriented,
    mapping_std_prim: ds.mapping_std_prim.slice(),
    symprec: ds.symprec,
    input: c,
    raw: ds,
  };
}

/**
 * The standardization of a crystal is unique only up to the proper rotations of its point group
 * (and moyo sometimes returns e.g. a<->b, c->-c for an input that is already standard).
 * Re-express moyo's input->standard relation x_std = P x + p as x_std' = W^-1 (x_std - w) for the
 * proper group operation (W, w) (standard basis) that brings P closest to the identity. The
 * standardized cells themselves (Cartesian lattice and atom set) do not change; only
 * P, p, the rotation matrix and moyo's std_linear/origin shifts are updated consistently.
 * Returns null when moyo's choice is already the closest one.
 */
function closestStandardization(ds, P, p, R, primLinear, primShift, stdLattice) {
  const Pinv = inv3(P);
  const dist = (M) => M.flat().reduce((s, x, i) => s + (x - (i % 4 === 0 ? 1 : 0)) ** 2, 0);
  let best = null, bestScore = dist(P) - 1e-9;
  const seen = new Set();
  for (const op of ds.operations) {
    const Win = fromColumnMajor(op.rotation);
    if (det3(Win) < 0) continue;
    const W = matmul(matmul(P, Win), Pinv).map((r) => r.map((x) => Math.round(x)));
    const key = W.flat().join(',');
    if (seen.has(key) || key === '1,0,0,0,1,0,0,0,1') continue;
    seen.add(key);
    const Wi = inv3(W);
    const P2 = matmul(Wi, P);
    const sc = dist(P2);
    if (sc < bestScore) {
      bestScore = sc;
      // translation of the operation in the standard basis: w = P w_in + p - W p
      const w = sub(add(matvec(P, op.translation), p), matvec(W, p));
      best = { W, Wi, P2, w };
    }
  }
  if (!best) return null;
  const { W, Wi, P2, w } = best;
  const p2 = matvec(Wi, sub(p, w)).map((x) => x - Math.floor(x + 1e-9));
  const A = transpose(stdLattice); // columns
  const Q = matmul(matmul(A, W), inv3(A));
  const R2 = matmul(transpose(Q), R);
  const stdLinear2 = inv3(P2);
  const stdShift2 = scale(matvec(stdLinear2, p2), -1);
  // conventional -> primitive relation x_prim = M x_std + m is kept
  const M = inv3(matmul(P, primLinear));
  const m = scale(matvec(inv3(primLinear), add(matvec(Pinv, p), primShift)), -1);
  const primLinear2 = inv3(matmul(M, P2));
  const primShift2 = scale(matvec(primLinear2, add(matvec(M, p2), m)), -1);
  return { P: P2, origin: p2, rotation: R2, stdLinear: stdLinear2, stdShift: stdShift2, primLinear: primLinear2, primShift: primShift2 };
}

/** Same as analyze() but initialises moyo first (auto-loading the wasm). */
export async function analyzeAsync(cell, opts = {}) {
  await initMoyo(opts.wasm);
  return analyze(cell, opts);
}

/** Standardized conventional (default) or primitive cell. */
export function standardize(cell, { toPrimitive = false, symprec = 1e-5 } = {}) {
  const d = analyze(cell, { symprec });
  return toPrimitive ? d.primitive : d.conventional;
}

/** Symmetry operations of a space-group type (ITA standard or spglib setting), rows/fractional. */
export function operationsFromNumber(number, { setting = 'Spglib', primitive = false } = {}) {
  const moyo = getMoyo();
  return moyo.operations_from_number(number, { type: setting }, primitive)
    .map((o) => ({ rotation: fromColumnMajor(o.rotation), translation: o.translation.slice() }));
}

/** Space-group type info from moyo (hm symbols, crystal system, ...). */
export function spaceGroupType(number) {
  return getMoyo().space_group_type(number);
}
