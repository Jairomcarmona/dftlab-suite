// Reader for SIESTA real-space grid files written with Fortran unformatted records:
//   *.RHO (total density, e/Bohr³), *.DRHO (ρ − Σρ_atomic), *.RHOXC, *.BADER, *.TOTAL_CHARGE,
//   *.VH, *.VT, *.VNA, *.VXC (potentials, Ry), *.LDOS, *.IORHO (SaveRho/SaveDeltaRho/SaveElectrostaticPotential…).
// Layout (iorho.F): rec1 cell(3,3) double [Bohr]; rec2 mesh(3), nspin int32; then for each spin,
// for each iz, for each iy: one record of nx single-precision values. Both endiannesses are handled.
import { BOHR_ANG } from './util.js';

const GRID_EXT = /\.(rho|drho|rhoxc|bader|total_charge|vh|vt|vna|vxc|ldos|iorho)$/i;
export const isGridName = (name) => GRID_EXT.test(name || '');

/** Units of each grid file kind, keyed by lower-case extension. */
export const GRID_UNITS = {
  rho: 'e/Bohr³', drho: 'e/Bohr³', rhoxc: 'e/Bohr³', bader: 'e/Bohr³', total_charge: 'e/Bohr³', ldos: 'e/Bohr³', iorho: 'e/Bohr³',
  vh: 'Ry', vt: 'Ry', vna: 'Ry', vxc: 'Ry',
};

/** @param {ArrayBuffer|Uint8Array} input  @param {string} [name] file name (only for the unit label) */
export function parseGrid(input, name = '') {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input.buffer ?? input, input.byteOffset ?? 0, input.byteLength);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 100) throw new Error('archivo de malla demasiado corto');
  let le = true;
  if (dv.getInt32(0, true) !== 72) { if (dv.getInt32(0, false) === 72) le = false; else throw new Error('no es un archivo de malla de SIESTA (primer registro ≠ 72 bytes)'); }
  let o = 0;
  const rec = () => {           // returns [start, length] of the next record and advances
    const n = dv.getInt32(o, le); const s = o + 4; o = s + n + 4;
    if (dv.getInt32(s + n, le) !== n) throw new Error('marcadores de registro Fortran inconsistentes');
    return [s, n];
  };
  let [s, n] = rec();
  const cellBohr = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cellBohr[i][j] = dv.getFloat64(s + 8 * (3 * i + j), le);
  [s, n] = rec();
  const mesh = [dv.getInt32(s, le), dv.getInt32(s + 4, le), dv.getInt32(s + 8, le)];
  const nspin = dv.getInt32(s + 12, le);
  const [nx, ny, nz] = mesh;
  const data = [];
  for (let is = 0; is < nspin; is++) {
    const g = new Float32Array(nx * ny * nz);
    for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) {
      [s, n] = rec();
      if (n !== 4 * nx) throw new Error(`registro de ${n} bytes, se esperaban ${4 * nx}`);
      const base = nx * (iy + ny * iz);
      for (let ix = 0; ix < nx; ix++) g[base + ix] = dv.getFloat32(s + 4 * ix, le);
    }
    data.push(g);
  }
  const ext = (/\.([^.]+)$/.exec(name) || [, ''])[1].toLowerCase();
  const units = GRID_UNITS[ext] || 'e/Bohr³';
  const cell = cellBohr.map((v) => v.map((x) => x * BOHR_ANG));
  return { cell, cellBohr, mesh, nspin, data, units, volume: det3(cell), volumeBohr: det3(cellBohr) };
}

function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

/** Σ grid · dV (electrons for a density in e/Bohr³). */
export function gridIntegral(g, spin = 0) {
  const d = g.data[spin]; let t = 0;
  for (let i = 0; i < d.length; i++) t += d[i];
  return t * Math.abs(g.volumeBohr) / d.length;
}

/** Cartesian (Å) → fractional coordinates of the cell. */
export function toFrac(cell, r) {
  const [a, b, c] = cell, V = det3(cell);
  const cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return [dot(r, cr(b, c)) / V, dot(r, cr(c, a)) / V, dot(r, cr(a, b)) / V];
}

/** Periodic trilinear interpolation at fractional coordinates f. */
export function sampleFrac(g, f, spin = 0) {
  const [nx, ny, nz] = g.mesh, d = g.data[spin];
  const w = (x, n) => { const t = (x - Math.floor(x)) * n; const i = Math.floor(t); return [i % n, (i + 1) % n, t - i]; };
  const [i0, i1, tx] = w(f[0], nx), [j0, j1, ty] = w(f[1], ny), [k0, k1, tz] = w(f[2], nz);
  const at = (i, j, k) => d[i + nx * (j + ny * k)];
  const x00 = at(i0, j0, k0) * (1 - tx) + at(i1, j0, k0) * tx, x10 = at(i0, j1, k0) * (1 - tx) + at(i1, j1, k0) * tx;
  const x01 = at(i0, j0, k1) * (1 - tx) + at(i1, j0, k1) * tx, x11 = at(i0, j1, k1) * (1 - tx) + at(i1, j1, k1) * tx;
  return (x00 * (1 - ty) + x10 * ty) * (1 - tz) + (x01 * (1 - ty) + x11 * ty) * tz;
}

/**
 * Values on a plane r = origin + s·e1 + t·e2 (all Cartesian Å), s∈[0,len1], t∈[0,len2], n1×n2 points.
 * Returns {n1, n2, values: Float32Array (t-major: values[j*n1+i])}.
 * The result is multiplied by `scale` (e.g. 1/BOHR_ANG³ to turn e/Bohr³ into e/Å³).
 */
export function planeSlice(g, { origin, e1, e2, len1, len2, n1, n2, spin = 0, scale = 1 }) {
  const out = new Float32Array(n1 * n2);
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const u = norm(e1), v = norm(e2);
  for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) {
    const s = len1 * i / (n1 - 1), t = len2 * j / (n2 - 1);
    const r = [0, 1, 2].map((k) => origin[k] + s * u[k] + t * v[k]);
    out[j * n1 + i] = sampleFrac(g, toFrac(g.cell, r), spin) * scale;
  }
  return { n1, n2, values: out };
}

/** Line profile r = p0 + s·(p1−p0), n points. */
export function lineProfile(g, p0, p1, n, spin = 0, scale = 1) {
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = [0, 1, 2].map((k) => p0[k] + t * (p1[k] - p0[k]));
    pts.push([t * L, sampleFrac(g, toFrac(g.cell, r), spin) * scale]);
  }
  return pts;
}

/** Planar average along lattice direction `axis` (0,1,2): n points [position along axis in Å, mean over the other two]. */
export function planarAverage(g, axis = 2, spin = 0, scale = 1) {
  const [nx, ny, nz] = g.mesh, d = g.data[spin], n = g.mesh[axis];
  const sums = new Float64Array(n), cnt = nx * ny * nz / n;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    sums[axis === 0 ? i : axis === 1 ? j : k] += d[i + nx * (j + ny * k)];
  }
  const len = Math.hypot(...g.cell[axis]);
  return Array.from(sums, (s, i) => [len * i / n, s / cnt * scale]);
}
