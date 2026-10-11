// Genera app/dftlab/static/js/data/rho.json a partir de las corridas de esta carpeta (SIESTA 5.4.2).
//   node gen_rho_json.mjs <carpeta_corridas> <salida.json>
// Usa los mismos lectores que la app (siesta/rho.js, parseOut, parseXV): lo que se ve es lo que lee la app.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const APP = process.env.DFTLAB_JS || '/mnt/project-files/DFT_App/app/dftlab/static/js';
const S = await import(pathToFileURL(path.join(APP, 'siesta/index.js')).href);
const [dir = '.', outFile = 'rho.json'] = process.argv.slice(2);
const R = (f) => path.join(dir, f);
const BOHR = 0.529177210903, TO_A3 = 1 / BOHR ** 3;               // e/Bohr³ → e/Å³
const r = (x, d) => Number(x.toFixed(d));
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mul = (a, k) => a.map((x) => x * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => mul(a, 1 / Math.hypot(...a));

const SYS = {
  si: {
    name: 'Silicio (diamante)', formula: 'Si', label: 'si',
    plane: { desc: 'plano (1̄10) que contiene los enlaces Si–Si', origin: 'atom0', shift: [-1.4, -1.4], e1: [1, 1, 0], e2: [0, 0, 1], len1: 7.7, len2: 5.8, n: 80 },
    line: { desc: 'a lo largo del enlace Si–Si', from: 0, to: 1, pad: 0.9 },
  },
  mgo: {
    name: 'Óxido de magnesio (sal de roca)', formula: 'MgO', label: 'mgo',
    plane: { desc: 'plano (001) con Mg y O', origin: 'atom0', shift: [-1.5, -1.5], e1: [1, 0, 0], e2: [0, 1, 0], len1: 7.2, len2: 7.2, n: 80 },
    line: { desc: 'a lo largo de Mg–O', from: 0, to: 1, pad: 1.0 },
  },
  h2o: {
    name: 'Agua (molécula aislada)', formula: 'H₂O', label: 'h2o',
    plane: { desc: 'plano de la molécula', origin: 'atom0', shift: [-3.0, -2.6], e1: [1, 0, 0], e2: [0, 1, 0], len1: 6.0, len2: 5.4, n: 100 },
    line: { desc: 'a lo largo de O–H', from: 0, to: 1, pad: 1.0 },
  },
};
const ELEM = { 1: 'H', 8: 'O', 12: 'Mg', 14: 'Si' };

function readFdf(f) {
  const t = fs.readFileSync(R(f), 'utf8');
  const g = (k) => (new RegExp('^' + k + '\\s+(.+)$', 'mi').exec(t) || [])[1];
  const kg = /%block kgrid_Monkhorst_Pack\s+(\d+)/i.exec(t);
  return { basis: g('PAO.BasisSize'), meshCutoffRy: parseFloat(g('MeshCutoff')), kgrid: kg ? +kg[1] : 1 };
}
const pops = (out) => {
  const P = out.populations, atoms = (k) => (P[k] ? P[k].atoms.map((a) => r(a.charge, 4)) : null);
  return { mulliken: atoms('mulliken'), hirshfeld: atoms('hirshfeld'), voronoi: atoms('voronoi') };
};

// Dipole of an isolated molecule in a cubic box: μ = Σ Z_val·R − ∫ r ρ(r) dV (origin-independent for a neutral system;
// valid while ρ ≈ 0 at the box faces, which is checked and stored as boundaryRho).
const ZVAL = { H: 1, O: 6, Mg: 10, Si: 4 }, E_ANG_TO_DEBYE = 4.80320471;
function dipoleFromGrid(g, atoms) {
  const [nx, ny, nz] = g.mesh, d = g.data[0], dV = Math.abs(g.volume) / d.length;
  let mu = [0, 0, 0], bnd = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const rho = d[i + nx * (j + ny * k)] * TO_A3, rv = [g.cell[0][0] * i / nx, g.cell[1][1] * j / ny, g.cell[2][2] * k / nz];
    for (let c = 0; c < 3; c++) mu[c] -= rho * rv[c] * dV;
    if (i === 0 || j === 0 || k === 0) bnd = Math.max(bnd, rho);
  }
  for (const a of atoms) for (let c = 0; c < 3; c++) mu[c] += ZVAL[a.el] * a.pos[c];
  return { eAng: mu.map((x) => r(x, 4)), debye: r(Math.hypot(...mu) * E_ANG_TO_DEBYE, 3), boundaryRho: Number(bnd.toExponential(2)) };
}
const result = { siesta: '5.4.2', xc: 'LDA (Ceperley–Alder)', units: { rho: 'e/Å³', length: 'Å', charge: 'e' }, systems: {}, basis: {} };
for (const [id, s] of Object.entries(SYS)) {
  const out = S.parseOut(fs.readFileSync(R(s.label + '.out'), 'utf8'));
  const xv = S.parseXV(fs.readFileSync(R(s.label + '.XV'), 'utf8'));
  const rho = S.parseGrid(fs.readFileSync(R(s.label + '.RHO')), s.label + '.RHO');
  const drho = S.parseGrid(fs.readFileSync(R(s.label + '.DRHO')), s.label + '.DRHO');
  const pos = xv.positions, Z = xv.Z, cell = xv.cell;
  const fdf = readFdf(s.label + '.fdf');
  // plane
  const p = s.plane, u = unit(p.e1), v = unit(p.e2), nrm = unit([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
  const origin = add(add(pos[0], mul(u, p.shift[0])), mul(v, p.shift[1]));
  const n1 = p.n, n2 = Math.round(p.n * p.len2 / p.len1);
  const pl = { origin, e1: u, e2: v, len1: p.len1, len2: p.len2, n1, n2 };
  const sr = S.planeSlice(rho, { ...pl, scale: TO_A3 }), sd = S.planeSlice(drho, { ...pl, scale: TO_A3 });
  // atoms in the window (periodic images within 0.15 Å of the plane)
  const atoms = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let k = -3; k <= 3; k++) {
    const sh = [0, 1, 2].map((c) => i * cell[0][c] + j * cell[1][c] + k * cell[2][c]);
    pos.forEach((q, ia) => {
      const d = sub(add(q, sh), origin), off = dot(d, nrm), a = dot(d, u), b = dot(d, v);
      if (Math.abs(off) < 0.15 && a > -0.3 && a < p.len1 + 0.3 && b > -0.3 && b < p.len2 + 0.3) atoms.push({ el: ELEM[Z[ia]], i: ia, s: r(a, 3), t: r(b, 3) });
    });
  }
  // line profile
  const L = s.line, a0 = pos[L.from], a1 = pos[L.to];
  let a1u = a1;
  if (id === 'si') a1u = a1;                                  // already the nearest neighbour in the cell
  if (id === 'mgo') a1u = add(a0, [cell[0][1], 0, 0]);       // Mg → O along +x (a/2)
  const dirv = unit(sub(a1u, a0)), bondLen = Math.hypot(...sub(a1u, a0));
  const p0 = sub(a0, mul(dirv, L.pad)), p1 = add(a1u, mul(dirv, L.pad)), npts = 160;
  const lr = S.lineProfile(rho, p0, p1, npts, 0, TO_A3), ld = S.lineProfile(drho, p0, p1, npts, 0, TO_A3);
  const x0 = L.pad;
  const stat = (arr) => { let mn = Infinity, mx = -Infinity; for (const x of arr) { if (x < mn) mn = x; if (x > mx) mx = x; } return [mn, mx]; };
  const [dmn, dmx] = stat(sd.values), [rmn, rmx] = stat(sr.values);
  result.systems[id] = {
    name: s.name, formula: s.formula, cell: cell.map((x) => x.map((y) => r(y, 5))),
    atoms: pos.map((q, i) => ({ el: ELEM[Z[i]], Z: Z[i], pos: q.map((y) => r(y, 5)) })),
    fdf, fdfText: fs.readFileSync(R(s.label + '.fdf'), 'utf8'), meshGrid: rho.mesh, meshCutoffUsedRy: out.mesh.cutoffUsed, nElectrons: out.nElectrons, etotEV: out.finalEnergy.etot, scfConverged: out.finalEnergy.scfConverged,
    check: { intRho: r(S.gridIntegral(rho), 5), intDrho: r(S.gridIntegral(drho), 6) },
    plane: { desc: p.desc, ref: [-p.shift[0], -p.shift[1]], n1, n2, len1: p.len1, len2: p.len2, atoms,
      rhoMax: r(rmx, 4), rhoMin: r(rmn, 4), drhoMin: r(dmn, 5), drhoMax: r(dmx, 5),
      rho: Array.from(sr.values, (x) => r(x, 4)), drho: Array.from(sd.values, (x) => r(x, 5)) },
    line: { desc: L.desc, bond: r(bondLen, 4), x0: r(x0, 3), x1: r(x0 + bondLen, 3),
      atoms: [{ el: ELEM[Z[L.from]], x: r(x0, 3) }, { el: ELEM[Z[L.to]], x: r(x0 + bondLen, 3) }],
      rho: lr.map(([x, y]) => [r(x, 4), r(y, 4)]), drho: ld.map(([x, y]) => [r(x, 4), r(y, 5)]) },
    charges: pops(out),
    dipole: id === 'h2o' ? dipoleFromGrid(rho, pos.map((q, i) => ({ el: ELEM[Z[i]], pos: q }))) : null,
    mullikenOrbitals: id === 'mgo' || id === 'h2o' ? out.populations.mullikenOrbital.map((b) => ({ species: b.species, orbitals: b.orbitals, q: b.atoms[0].qorb.map((x) => r(x, 3)) })) : null,
  };
}
// basis-set dependence of the three schemes
for (const [id, list] of Object.entries({ mgo: [['SZ', 'mgo_sz'], ['DZ', 'mgo_dz'], ['DZP', 'mgo'], ['TZP', 'mgo_tzp']], h2o: [['SZ', 'h2o_sz'], ['DZ', 'h2o_dz'], ['DZP', 'h2o'], ['TZP', 'h2o_tzp']] })) {
  result.basis[id] = list.map(([b, l]) => {
    const o = S.parseOut(fs.readFileSync(R(l + '.out'), 'utf8')), row = { basis: b, label: l, etotEV: o.finalEnergy.etot, ...pops(o) };
    if (id === 'h2o') {
      const xv = S.parseXV(fs.readFileSync(R(l + '.XV'), 'utf8')), g = S.parseGrid(fs.readFileSync(R(l + '.RHO')), l + '.RHO');
      row.dipole = dipoleFromGrid(g, xv.positions.map((q, i) => ({ el: ELEM[xv.Z[i]], pos: q }))).debye;
    }
    return row;
  });
}
fs.writeFileSync(outFile, JSON.stringify(result));
console.log(outFile, (fs.statSync(outFile).size / 1e3).toFixed(0), 'kB');
for (const [k, v] of Object.entries(result.systems)) console.log(k, v.check, v.plane.atoms.length, 'atoms in plane', v.plane.drhoMin, v.plane.drhoMax, v.line.bond, JSON.stringify(v.charges));
