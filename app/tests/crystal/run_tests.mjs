#!/usr/bin/env node
// Node test harness for the DFT Lab crystal modules (symmetry.js, kpath.js, bz.js, formats.js).
// Compares the JavaScript results with spglib + seekpath references produced by make_reference.py.
//
//   python3 make_reference.py     # (re)build reference.json + fixtures/
//   node run_tests.mjs [--verbose] [--filter text]
//
// Exit code 0 when every case passes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '../../dftlab/static/js/crystal');
const sym = await import(pathToFileURL(path.join(LIB, 'symmetry.js')).href);
const kp = await import(pathToFileURL(path.join(LIB, 'kpath.js')).href);
const bzm = await import(pathToFileURL(path.join(LIB, 'bz.js')).href);
const fm = await import(pathToFileURL(path.join(LIB, 'formats.js')).href);

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const filter = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : null;

await sym.initMoyo();

const ref = JSON.parse(fs.readFileSync(path.join(HERE, 'reference.json'), 'utf8'));

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const maxAbs = (a, b) => {
  const fa = a.flat(Infinity), fb = b.flat(Infinity);
  if (fa.length !== fb.length) return Infinity;
  let m = 0;
  for (let i = 0; i < fa.length; i++) m = Math.max(m, Math.abs(fa[i] - fb[i]));
  return m;
};
const wrapd = (x) => x - Math.round(x);
const eqArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function partition(rep) {
  const g = new Map();
  rep.forEach((r, i) => { if (!g.has(r)) g.set(r, []); g.get(r).push(i); });
  return [...g.values()].map((x) => x.join(',')).sort();
}

const autCache = new Map();
/**
 * Integer matrices W with W^T g W = g (g = L L^T): lattice automorphisms acting on fractional
 * coordinate columns (x -> W x) and, equivalently, on reciprocal fractional rows (k -> k W).
 * Enumerated with entries -1..1 in the Niggli-reduced basis, then converted back.
 */
function latticeAutomorphisms(lattice) {
  const key = JSON.stringify(lattice.flat().map((x) => x.toFixed(5)));
  if (autCache.has(key)) return autCache.get(key);
  const { lattice: red, transformation: T } = sym.niggliReduce(lattice, 1e-8);
  const g = sym.matmul(red, sym.transpose(red));
  const s = Math.max(...g.flat().map(Math.abs));
  const out = [];
  const v = [-1, 0, 1];
  const idx = new Array(9).fill(0);
  const Tt = sym.transpose(T), Tit = sym.inv3(Tt);
  for (let n = 0; n < 19683; n++) {
    let k = n;
    for (let i = 0; i < 9; i++) { idx[i] = v[k % 3]; k = Math.floor(k / 3); }
    const W = [idx.slice(0, 3), idx.slice(3, 6), idx.slice(6, 9)];
    const d = Math.round(sym.det3(W));
    if (Math.abs(d) !== 1) continue;
    const gw = sym.matmul(sym.transpose(W), sym.matmul(g, W));
    if (maxAbs(gw, g) < 1e-5 * s) out.push(sym.matmul(sym.matmul(Tt, W), Tit).map((r) => r.map((x) => Math.round(x))));
  }
  autCache.set(key, out);
  return out;
}

/** 'exact' if same set (up to lattice translations), 'translation', 'equivalent' (lattice automorphism + shift) or false */
function compareAtomSets(lattice, pa, ta, pb, tb, tol = 1e-5) {
  if (pa.length !== pb.length) return false;
  const ca = [...ta].sort().join(), cb = [...tb].sort().join();
  if (ca !== cb) return false;
  const match = (W, t) => pa.every((p, i) => {
    const q = W ? sym.matvec(W, p) : p;
    return pb.some((r, j) => tb[j] === ta[i] && [0, 1, 2].every((k) => Math.abs(wrapd(q[k] + t[k] - r[k])) < tol));
  });
  if (match(null, [0, 0, 0])) return 'exact';
  for (let j = 0; j < pb.length; j++) {
    if (tb[j] !== ta[0]) continue;
    const t = [0, 1, 2].map((k) => pb[j][k] - pa[0][k]);
    if (match(null, t)) return 'translation';
  }
  for (const W of latticeAutomorphisms(lattice)) {
    const q0 = sym.matvec(W, pa[0]);
    for (let j = 0; j < pb.length; j++) {
      if (tb[j] !== ta[0]) continue;
      const t = [0, 1, 2].map((k) => pb[j][k] - q0[k]);
      if (match(W, t)) return 'equivalent';
    }
  }
  return false;
}

function comparePointCoords(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (!eqArr(ka, kb)) return Infinity;
  return Math.max(0, ...ka.map((k) => maxAbs(a[k], b[k])));
}


/**
 * seekpath's get_path_orig_cell coordinates depend on which of the equivalent standardizations
 * is picked. 'exact', or 'equivalent by a crystal operation' (k' = +-W^T k mod G for one group
 * operation W of the input cell, same W for all labels), or 'related by a lattice automorphism'.
 */
function compareOrigCell(a, b, ds, lattice) {
  if (comparePointCoords(a, b) < 1e-6) return 'exact';
  const labels = Object.keys(b);
  if (!eqArr(Object.keys(a).sort(), [...labels].sort())) return false;
  const near = (u, v) => [0, 1, 2].every((k) => Math.abs(wrapd(u[k] - v[k])) < 1e-6);
  const test = (Ws) => Ws.some((W) => [1, -1].some((s) => labels.every((l) => near(a[l], sym.vecmat(b[l], W).map((x) => s * x)))));
  if (test(ds.operations.map((o) => o.rotation))) return 'equivalent by a crystal symmetry operation';
  if (test(latticeAutomorphisms(lattice))) return 'related by a lattice automorphism (alternative standardization)';
  return false;
}

// ---------------------------------------------------------------------------
// structure cases
// ---------------------------------------------------------------------------
const results = [];

function runCase(cs) {
  const r = ref && cs.ref;
  const checks = {};
  const notes = [];
  let cell = { lattice: cs.lattice, positions: cs.positions, numbers: cs.numbers };
  let orderIndependent = false;
  if (cs.cif_file) {
    const text = fs.readFileSync(path.join(HERE, 'fixtures', cs.cif_file), 'utf8');
    const c = fm.readCIF(text);
    orderIndependent = true;
    const pj = sym.cellParameters(c.lattice), pr = sym.cellParameters(cs.lattice);
    const dp = Math.max(...['a', 'b', 'c', 'alpha', 'beta', 'gamma'].map((k) => Math.abs(pj[k] - pr[k])));
    const same = c.positions.length === cs.cif_natoms && dp < 1e-6 &&
      compareAtomSets(cs.lattice, c.positions, c.numbers, cs.positions, cs.numbers, 1e-4) === 'exact';
    checks.cif_read = same;
    if (c.info.warnings.length) notes.push(...c.info.warnings);
    cell = c;
  }
  if (cs.supercell_matrix) {
    const sc = sym.supercell({ lattice: cs.supercell_of, positions: cs.supercell_of_positions, numbers: cs.supercell_of_numbers }, cs.supercell_matrix);
    checks.supercell = maxAbs(sc.lattice, cs.lattice) < 1e-9 && compareAtomSets(cs.lattice, sc.positions, sc.numbers, cs.positions, cs.numbers) === 'exact';
  }
  const ds = sym.analyze(cell, { symprec: cs.symprec });
  checks.spacegroup = ds.number === r.number;
  checks.symbol = ds.international === r.international;
  checks.n_ops = ds.nOps === r.n_operations;
  if (orderIndependent) {
    checks.wyckoff = eqArr([...ds.wyckoffs].sort(), [...r.wyckoffs].sort());
    checks.orbits = eqArr(partition(ds.equivalent_atoms).map((x) => x.split(',').length).sort(), partition(r.equivalent_atoms).map((x) => x.split(',').length).sort());
  } else {
    checks.orbits = eqArr(partition(ds.equivalent_atoms), partition(r.equivalent_atoms));
    checks.wyckoff = eqArr(ds.wyckoffs, r.wyckoffs);
    if (!checks.wyckoff && r.site_symmetry_symbols && checks.orbits && eqArr(ds.site_symmetry_symbols, r.site_symmetry_symbols) &&
      ds.wyckoffs.every((w, i) => ds.orbits.find((o) => o.indices.includes(i)).indices.every((j) => ds.wyckoffs[j] === w))) {
      // same orbits and site symmetries, letters relabelled by a different (equivalent) origin choice
      checks.wyckoff = true;
      notes.push(`Wyckoff letters ${[...new Set(ds.wyckoffs)].join('')} vs spglib ${[...new Set(r.wyckoffs)].join('')} (same site symmetries; alternative origin)`);
    }
  }
  // rotation / transformation consistency: L_std^T = R L_in^T P^-1 (spglib convention)
  {
    const lhs = sym.transpose(ds.conventional.lattice);
    const rhs = sym.matmul(sym.matmul(ds.std_rotation_matrix, sym.transpose(cell.lattice)), sym.inv3(ds.transformation_matrix));
    checks.rotation = maxAbs(lhs, rhs) < 10 * cs.symprec + 1e-8;
    const dR = sym.det3(ds.std_rotation_matrix);
    checks.rotation = checks.rotation && Math.abs(dR - 1) < 1e-6;
  }
  const scale = Math.max(...r.std_lattice.flat().map(Math.abs));
  checks.conv_cell = maxAbs(ds.conventional.lattice, r.std_lattice) < 1e-6 * scale;
  const convPos = compareAtomSets(r.std_lattice, ds.conventional.positions, ds.conventional.numbers, r.std_positions, r.std_types);
  if (convPos !== 'exact') notes.push(`conv. positions: ${convPos}`);

  let res;
  try {
    res = kp.getExplicitKPath(cell, { symprec: cs.symprec, dataset: ds });
  } catch (e) {
    checks.kpath = false;
    notes.push(`kpath error: ${e.message}`);
    return { cs, checks, notes, ds };
  }
  const sp = r.seekpath;
  checks.ext_bravais = res.bravais_lattice_extended === sp.bravais_lattice_extended;
  checks.prim_lattice = maxAbs(res.primitive_lattice, sp.primitive_lattice) < 1e-6 * scale &&
    maxAbs(res.primitive_transformation_matrix, sp.primitive_transformation_matrix) < 1e-12;
  const pp = compareAtomSets(sp.primitive_lattice, res.primitive_positions, res.primitive_types, sp.primitive_positions, sp.primitive_types);
  checks.prim_atoms = !!pp;
  if (pp && pp !== 'exact') notes.push(`primitive atoms ${pp === 'translation' ? 'differ by an origin shift' : 'related by a lattice automorphism + shift (equivalent description)'}`);
  checks.path = eqArr(res.path, sp.path);
  checks.k_coords = comparePointCoords(res.point_coords, sp.point_coords) < 1e-6;
  checks.explicit = res.explicit_kpoints_rel.length === sp.explicit_kpoints_rel.length &&
    maxAbs(res.explicit_kpoints_rel, sp.explicit_kpoints_rel) < 1e-6 &&
    maxAbs(res.explicit_kpoints_linearcoord, sp.explicit_kpoints_linearcoord) < 1e-6 &&
    eqArr(res.explicit_kpoints_labels, sp.explicit_kpoints_labels) && eqArr(res.explicit_segments, sp.explicit_segments);
  checks.volumes = Math.abs(res.volume_original_wrt_prim - sp.volume_original_wrt_prim) < 1e-6 &&
    Math.abs(res.volume_original_wrt_conv - sp.volume_original_wrt_conv) < 1e-6;
  // path in the original cell (uses the rotation matrix)
  if (!orderIndependent) {
    const ro = kp.getPathOrigCell(cell, { symprec: cs.symprec, dataset: ds });
    const how = compareOrigCell(ro.point_coords, r.seekpath_orig.point_coords, ds, cell.lattice);
    checks.orig_cell = !!how && ro.is_supercell === r.seekpath_orig.is_supercell;
    if (how && how !== 'exact') notes.push(`orig-cell k-points ${how}`);
  }
  if (r.seekpath_no_tr) {
    const rn = kp.getPath(cell, { symprec: cs.symprec, withTimeReversal: false, dataset: ds });
    checks.no_time_rev = eqArr(rn.path, r.seekpath_no_tr.path) && comparePointCoords(rn.point_coords, r.seekpath_no_tr.point_coords) < 1e-6;
  }
  // pure port check: feed spglib's standardized cell directly
  const port = kp.getPathFromStandardized({
    conv_lattice: r.std_lattice, conv_positions: r.std_positions, conv_types: r.std_types,
    spacegroup_number: r.number, transformation_matrix: r.transformation_matrix,
  });
  checks.port_exact = port.bravais_lattice_extended === sp.bravais_lattice_extended &&
    maxAbs(port.conv_lattice, sp.conv_lattice) < 1e-9 * scale && maxAbs(port.conv_positions, sp.conv_positions) < 1e-9 &&
    maxAbs(port.primitive_lattice, sp.primitive_lattice) < 1e-9 * scale && maxAbs(port.primitive_positions, sp.primitive_positions) < 1e-9 &&
    eqArr(port.primitive_types, sp.primitive_types) && comparePointCoords(port.point_coords, sp.point_coords) < 1e-9 &&
    eqArr(port.path, sp.path) && Math.abs(port.volume_original_wrt_prim - sp.volume_original_wrt_prim) < 1e-9;
  // Brillouin zone
  const bz = bzm.brillouinZone(res.reciprocal_primitive_lattice);
  let bzOk = Math.abs(bz.volume / bz.reciprocalVolume - 1) < 1e-8 && bz.vertices.length - bz.edges.length + bz.faces.length === 2;
  if (r.bz && r.bz.vertices) {
    const ks = Math.max(...res.reciprocal_primitive_lattice.flat().map(Math.abs));
    const vmatch = r.bz.vertices.length === bz.vertices.length &&
      r.bz.vertices.every((v) => bz.vertices.some((w) => maxAbs([v], [w]) < 1e-6 * ks));
    if (!vmatch) notes.push(`BZ vertices: js ${bz.vertices.length} vs seekpath/scipy ${r.bz.vertices.length}`);
    bzOk = bzOk && vmatch;
  }
  checks.bz = bzOk;
  // k-path special points lie in (or on) the BZ
  const cart = bzm.kpathCartesian(res);
  checks.points_in_bz = Object.values(cart.points).every((k) => bzm.isInBZ(bz, k, 1e-6));
  return { cs, checks, notes, ds, res, bz };
}

for (const cs of ref.cases) {
  if (filter && !cs.name.includes(filter)) continue;
  let out;
  try {
    out = runCase(cs);
  } catch (e) {
    out = { cs, checks: { exception: false }, notes: [String(e.stack || e)] };
  }
  out.pass = Object.values(out.checks).every(Boolean);
  results.push(out);
}

// ---------------------------------------------------------------------------
// format cases
// ---------------------------------------------------------------------------
const fmtResults = [];
function sameCell(c, lattice, positions, numbers, tolL = 1e-6) {
  return c.positions.length === positions.length && maxAbs(c.lattice, lattice) < tolL &&
    compareAtomSets(lattice, c.positions, c.numbers, positions, numbers, 1e-6) === 'exact';
}
for (const f of ref.format_cases) {
  let ok = false, note = '';
  try {
    const c = fm.readStructure(f.text, { format: f.format });
    ok = sameCell(c, f.lattice, f.positions, f.numbers);
    if (!ok) note = 'cell mismatch';
  } catch (e) { note = e.message; }
  fmtResults.push({ name: `read ${f.name}`, pass: ok, note });
}

// CIF with a disordered site (Fe 0.7 / Co 0.3) and a P1 MP-style op list with spaces
{
  const txt = `data_disorder
_cell_length_a 2.87
_cell_length_b 2.87
_cell_length_c 2.87
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'I m -3 m'
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1  'x, y, z'
  2  'x+1/2, y+1/2, z+1/2'
loop_
 _atom_site_label
 _atom_site_type_symbol
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Fe1  Fe  0.0 0.0 0.0 0.7
  Co1  Co  0.0 0.0 0.0 0.3
`;
  const c = fm.readCIF(txt);
  const all = fm.readCIF(txt, { occupancy: 'all' });
  fmtResults.push({ name: 'CIF disordered site (majority species kept, warning)', pass: c.numbers.length === 2 && c.numbers.every((z) => z === 26) && all.numbers.length === 4 && c.info.warnings.some((w) => /disorder/.test(w)), note: c.info.warnings.join('; ') });
  const op = fm.parseSymop('1/2+X, -y+1/2 ,-Z+0.25');
  fmtResults.push({ name: 'parseSymop variants', pass: eqArr(op.rotation, [[1, 0, 0], [0, -1, 0], [0, 0, -1]]) && maxAbs(op.translation, [0.5, 0.5, 0.25]) < 1e-12 && fm.formatSymop(op) === 'x+1/2,-y+1/2,-z+1/4', note: fm.formatSymop(op) });
  const det = ['x.cif', 'POSCAR', 'a.xyz', 'siesta.XV', 'siesta.STRUCT_OUT', 'in.fdf'].map((f) => fm.detectFormat('', f));
  fmtResults.push({ name: 'detectFormat by file name', pass: eqArr(det, ['cif', 'poscar', 'xyz', 'xv', 'struct', 'fdf']), note: det.join(',') });
}

// writer round trips
const rt = ref.cases.filter((c) => ['TiO2 (rutile)', 'ZnO (wurtzite)', 'Bi2Se3 (R-3m, hexagonal cell)', 'SG 15 (Hall 90)', 'graphite (AB)'].includes(c.name) || /^SG 1[45] /.test(c.name));
for (const cs of rt) {
  const cell = { lattice: cs.lattice, positions: cs.positions.map((p) => p.map((x) => x - Math.floor(x))), numbers: cs.numbers };
  const L = cell.lattice;
  const tries = [
    ['extxyz', () => fm.readXYZ(fm.writeExtXYZ(cell)), (c) => sameCell(c, L, cell.positions, cell.numbers)],
    ['POSCAR direct', () => fm.readPOSCAR(fm.writePOSCAR(cell)), (c) => sameCell(c, L, cell.positions, cell.numbers)],
    ['POSCAR cartesian', () => fm.readPOSCAR(fm.writePOSCAR(cell, { cartesian: true })), (c) => sameCell(c, L, cell.positions, cell.numbers)],
    ['fdf fractional', () => fm.readFDF(fm.writeFDF(cell)), (c) => sameCell(c, L, cell.positions, cell.numbers)],
    ['fdf Ang', () => fm.readFDF(fm.writeFDF(cell, { coordinates: 'Ang' })), (c) => sameCell(c, L, cell.positions, cell.numbers)],
    ['STRUCT_IN', () => fm.readStructOut(fm.writeStructIn(cell)), (c) => sameCell(c, L, cell.positions, cell.numbers, 1e-8)],
    ['CIF P1', () => fm.readCIF(fm.writeCIF(cell)), (c) => {
      const p1 = sym.cellParameters(c.lattice), p2 = sym.cellParameters(L);
      return c.positions.length === cell.positions.length && ['a', 'b', 'c', 'alpha', 'beta', 'gamma'].every((k) => Math.abs(p1[k] - p2[k]) < 1e-6) &&
        sym.analyze(c).number === sym.analyze(cell).number;
    }],
    ['CIF symmetrized', () => fm.readCIF(fm.writeCIF(cell, { symmetrize: true })), (c) => {
      const d = sym.analyze(cell);
      const d2 = sym.analyze(c);
      return d2.number === d.number && c.positions.length === d.conventional.positions.length &&
        compareAtomSets(d.conventional.lattice, c.positions, c.numbers, d.conventional.positions, d.conventional.numbers, 1e-5) !== false;
    }],
    ['XYZ (molecule)', () => fm.readXYZ(fm.writeXYZ(cell)), (c) => {
      const a = sym.fracToCart(c.lattice, c.positions), b = sym.fracToCart(L, cell.positions);
      return a.length === b.length && sym.norm(sym.sub(sym.sub(a[1], a[0]), sym.sub(b[1], b[0]))) < 1e-6 && c.pbc.every((x) => !x);
    }],
  ];
  for (const [nm, fn, check] of tries) {
    let ok = false, note = '';
    try { ok = check(fn()); } catch (e) { note = e.message; }
    fmtResults.push({ name: `round trip ${nm}: ${cs.name}`, pass: ok, note });
  }
}

// BandLines and k-grid
{
  const si = ref.cases.find((c) => c.name === 'Si (diamond, primitive)');
  for (const cs of [si, ref.cases.find((c) => c.name === 'oI3 (SG 44)'), ref.cases.find((c) => c.name === 'graphite (AB)')]) {
    if (!cs) continue;
    const res = kp.getExplicitKPath(cs);
    const txt = fm.writeBandLines(res);
    const body = txt.split('\n').slice(txt.split('\n').findIndex((l) => /^%block BandLines/.test(l)) + 1);
    const rows = body.slice(0, body.findIndex((l) => /^%endblock/.test(l))).map((l) => l.trim().split(/\s+/));
    const total = rows.reduce((s, r) => s + parseInt(r[0], 10), 0);
    const labelsOk = rows.every((r) => {
      const lab = r[4] === '\\Gamma' ? 'GAMMA' : r[4].replace(/^\\Gamma/, 'GAMMA');
      return maxAbs([res.point_coords[lab]], [r.slice(1, 4).map(Number)]) < 1e-8;
    });
    const hasGamma = rows.some((r) => r[4] === '\\Gamma');
    fmtResults.push({ name: `BandLines ${cs.name}`, pass: total === res.explicit_kpoints_rel.length && labelsOk && hasGamma, note: `${rows.length} lines, ${total} k-points (explicit ${res.explicit_kpoints_rel.length})` });
  }
  for (const k of ref.kgrid) {
    const g = fm.kgridFromSpacing(k.lattice, 0.2);
    const txt = fm.writeKgridMonkhorstPack(k.lattice, { kspacing: 0.2 });
    fmtResults.push({ name: `kgrid_Monkhorst_Pack ${k.name}`, pass: eqArr(g, k.grid) && txt.includes('%block kgrid_Monkhorst_Pack'), note: `${g.join('x')} (ref ${k.grid.join('x')})` });
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const CHECK_ORDER = ['cif_read', 'supercell', 'spacegroup', 'symbol', 'n_ops', 'wyckoff', 'orbits', 'rotation', 'conv_cell', 'ext_bravais', 'prim_lattice',
  'prim_atoms', 'path', 'k_coords', 'explicit', 'volumes', 'orig_cell', 'no_time_rev', 'port_exact', 'bz', 'points_in_bz', 'kpath', 'exception'];
const pad = (s, n) => String(s).padEnd(n);
console.log(`DFT Lab crystal tests -- reference: spglib ${ref.generator.spglib}, seekpath ${ref.generator.seekpath}\n`);
console.log(`${pad('case', 46)} ${pad('group', 18)} ${pad('SG js/ref', 10)} ${pad('ext', 5)} result  failed checks / notes`);
console.log('-'.repeat(120));
const groups = {};
for (const o of results) {
  const g = o.cs.group;
  groups[g] = groups[g] || { pass: 0, fail: 0 };
  groups[g][o.pass ? 'pass' : 'fail']++;
  const failed = CHECK_ORDER.filter((k) => k in o.checks && !o.checks[k]);
  const showNotes = verbose || !o.pass ? o.notes : o.notes.filter((n) => !/equivalent description|origin shift|conv\. positions|orig-cell|Wyckoff letters/.test(n));
  const sg = `${o.ds ? o.ds.number : '?'}/${o.cs.ref.number}`;
  console.log(`${pad(o.cs.name.slice(0, 46), 46)} ${pad(g, 18)} ${pad(sg, 10)} ${pad(o.res ? o.res.bravais_lattice_extended : '-', 5)} ${o.pass ? 'PASS' : 'FAIL'}    ${failed.join(',')}${showNotes.length ? ` ${showNotes.join('; ')}` : ''}`);
}
console.log('\nformat readers / writers');
console.log('-'.repeat(120));
for (const f of fmtResults) {
  console.log(`${pad(f.name.slice(0, 80), 80)} ${f.pass ? 'PASS' : 'FAIL'}  ${f.note || ''}`);
}
const nPass = results.filter((o) => o.pass).length;
const fPass = fmtResults.filter((o) => o.pass).length;
const primEquiv = results.filter((o) => o.notes.some((n) => /equivalent description|origin shift/.test(n))).length;
console.log('\nsummary by group:');
for (const [g, v] of Object.entries(groups)) console.log(`  ${pad(g, 20)} ${v.pass}/${v.pass + v.fail} pass`);
console.log(`  ${pad('formats', 20)} ${fPass}/${fmtResults.length} pass`);
console.log(`\nstructures: ${nPass}/${results.length} pass; formats: ${fPass}/${fmtResults.length} pass`);
console.log(`(${primEquiv} structures have primitive atoms equal to seekpath's only up to an origin shift / lattice automorphism)`);
process.exit(nPass === results.length && fPass === fmtResults.length ? 0 : 1);
