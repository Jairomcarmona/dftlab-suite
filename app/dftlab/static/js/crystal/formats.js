// formats.js -- structure file readers/writers for DFT Lab (plain ES module).
//
// Readers return a DFT Lab cell:
//   { lattice: rows (Angstrom), positions: fractional, numbers: Z, labels?: [...],
//     pbc?: [bool,bool,bool], info: {format, title, warnings: [...], ...} }
// Supported: CIF (P1 and symmetry-expanded), XYZ / extended XYZ, POSCAR/CONTCAR,
// SIESTA .XV, .STRUCT_OUT/.STRUCT_IN and .fdf geometry blocks.
// Writers: CIF (P1 or symmetrized), XYZ, extended XYZ, POSCAR, SIESTA fdf geometry,
// SIESTA %block BandLines (from a kpath.js result) and %block kgrid_Monkhorst_Pack.

import { atomicNumber, symbolOf, massOf } from './elements.js';
import {
  latticeFromParameters, cellParameters, cartToFrac, fracToCart, reciprocalLattice, norm, vecmat,
  det3, sub, isMoyoReady, normalizeCell, analyze, operationsFromNumber, fromColumnMajor,
} from './symmetry.js';
import { getMoyo } from '../../vendor/moyo/loader.js';

/** Bohr radius in Angstrom as used by SIESTA (units.f90: Ang = 1/0.529177 Bohr). */
export const BOHR_SIESTA = 0.529177;
/** CODATA 2018 Bohr radius (Angstrom). */
export const BOHR = 0.529177210903;

const fmt = (x, d = 10) => {
  const v = Math.abs(x) < 0.5 * 10 ** -d ? 0 : x;
  return (v >= 0 ? ' ' : '') + v.toFixed(d);
};
const wrap01 = (x, eps = 1e-10) => { let y = x - Math.floor(x); if (y > 1 - eps) y = 0; return y; };

// ===========================================================================
// CIF
// ===========================================================================

/** Strip the standard uncertainty: "5.4310(2)" -> 5.431 ; "?" / "." -> null. */
export function cifNumber(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === '?' || t === '.' || t === '') return null;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?:\(\d+\))?$/.exec(t);
  if (m) return parseFloat(m[1]);
  const f = /^([+-]?\d+)\/(\d+)$/.exec(t);
  if (f) return parseInt(f[1], 10) / parseInt(f[2], 10);
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

function tokenizeCIF(text) {
  const tokens = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.startsWith(';')) {
      // semicolon text field
      const buf = [line.slice(1)];
      li++;
      while (li < lines.length && !lines[li].startsWith(';')) { buf.push(lines[li]); li++; }
      tokens.push({ v: buf.join('\n').trim(), q: true });
      continue;
    }
    let i = 0;
    const n = line.length;
    while (i < n) {
      const ch = line[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '#') break;
      if (ch === "'" || ch === '"') {
        // quoted: closes at matching quote followed by whitespace/EOL
        let j = i + 1;
        while (j < n && !(line[j] === ch && (j + 1 === n || /\s/.test(line[j + 1])))) j++;
        tokens.push({ v: line.slice(i + 1, j), q: true });
        i = j + 1;
        continue;
      }
      let j = i;
      while (j < n && !/\s/.test(line[j])) j++;
      tokens.push({ v: line.slice(i, j), q: false });
      i = j;
    }
  }
  return tokens;
}

const normTag = (t) => t.toLowerCase().replace(/\./g, '_');

/** Parse CIF text into data blocks: [{name, items: {tag: value}, loops: [{tags, rows}]}]. */
export function parseCIFBlocks(text) {
  const toks = tokenizeCIF(text);
  const blocks = [];
  let cur = null;
  const ensure = () => { if (!cur) { cur = { name: '', items: {}, loops: [] }; blocks.push(cur); } return cur; };
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    const lv = t.v.toLowerCase();
    if (!t.q && lv.startsWith('data_')) {
      cur = { name: t.v.slice(5), items: {}, loops: [] };
      blocks.push(cur);
      i++;
      continue;
    }
    if (!t.q && lv === 'loop_') {
      const b = ensure();
      i++;
      const tags = [];
      while (i < toks.length && !toks[i].q && toks[i].v.startsWith('_')) { tags.push(normTag(toks[i].v)); i++; }
      const vals = [];
      while (i < toks.length) {
        const u = toks[i];
        const ul = u.v.toLowerCase();
        if (!u.q && (u.v.startsWith('_') || ul === 'loop_' || ul.startsWith('data_') || ul.startsWith('save_') || ul === 'global_' || ul === 'stop_')) break;
        vals.push(u.v);
        i++;
      }
      const rows = [];
      for (let k = 0; k + tags.length <= vals.length; k += tags.length) rows.push(vals.slice(k, k + tags.length));
      b.loops.push({ tags, rows });
      continue;
    }
    if (!t.q && t.v.startsWith('_')) {
      const b = ensure();
      const tag = normTag(t.v);
      const nx = toks[i + 1];
      if (nx && (nx.q || !(nx.v.startsWith('_') || /^(loop_|data_)/i.test(nx.v)))) { b.items[tag] = nx.v; i += 2; } else { b.items[tag] = null; i++; }
      continue;
    }
    i++; // save_, global_, stray values
  }
  return blocks;
}

function cifGet(block, ...tags) {
  for (const t of tags) {
    const k = normTag(t);
    if (k in block.items) return block.items[k];
  }
  return undefined;
}
function cifLoop(block, tag) {
  const k = normTag(tag);
  return block.loops.find((l) => l.tags.includes(k));
}
function loopColumn(loop, ...tags) {
  for (const t of tags) {
    const i = loop.tags.indexOf(normTag(t));
    if (i >= 0) return loop.rows.map((r) => r[i]);
  }
  return null;
}

/**
 * Parse a symmetry operation string like "-x+1/2, y, z+0.25" or "1/2+X,-Y,Z".
 * Returns {rotation: 3x3 rows, translation: [3]} acting on fractional coordinates.
 */
export function parseSymop(str) {
  const parts = str.replace(/['"]/g, '').split(',').map((s) => s.replace(/\s+/g, '').toLowerCase());
  if (parts.length !== 3) throw new Error(`invalid symmetry operation '${str}'`);
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], t = [0, 0, 0];
  parts.forEach((p, row) => {
    const re = /([+-]?)(\d*\.?\d*(?:\/\d*\.?\d+)?)\*?([xyz]?)/g;
    let m;
    let consumed = 0;
    while ((m = re.exec(p)) !== null) {
      if (m[0] === '') { re.lastIndex++; if (re.lastIndex > p.length) break; continue; }
      consumed += m[0].length;
      const sign = m[1] === '-' ? -1 : 1;
      let coef = 1;
      if (m[2]) {
        if (m[2].includes('/')) { const [a, b] = m[2].split('/'); coef = parseFloat(a) / parseFloat(b); } else coef = parseFloat(m[2]);
      }
      if (m[3]) R[row]['xyz'.indexOf(m[3])] += sign * coef;
      else t[row] += sign * coef;
    }
    if (consumed !== p.length) throw new Error(`could not parse symmetry operation '${str}'`);
  });
  return { rotation: R, translation: t };
}

/** Format a symmetry operation as "x,-y,z+1/2". */
export function formatSymop({ rotation, translation }) {
  const frac = (x) => {
    const y = wrap01(x);
    if (Math.abs(y) < 1e-8) return '';
    for (const d of [2, 3, 4, 6, 8, 12]) { const n = Math.round(y * d); if (Math.abs(n / d - y) < 1e-6) return `+${n}/${d}`; }
    return `+${y.toFixed(6)}`;
  };
  return rotation.map((r, i) => {
    let s = '';
    r.forEach((c, j) => {
      if (Math.abs(c) < 1e-8) return;
      const v = 'xyz'[j];
      s += (c < 0 ? '-' : (s ? '+' : '')) + (Math.abs(Math.abs(c) - 1) < 1e-8 ? '' : `${Math.abs(c)}*`) + v;
    });
    return (s || '0') + frac(translation[i]);
  }).join(',');
}

const normHM = (s) => String(s).toLowerCase().replace(/[\s_]/g, '').replace(/[()]/g, '');

function siteElement(typeSymbol, label) {
  let z = typeSymbol ? atomicNumber(typeSymbol) : 0;
  if (!z && label) z = atomicNumber(label);
  return z;
}

/**
 * Read a CIF. options: {block: index|name, tolerance: merge distance in Angstrom (0.05),
 *   occupancy: 'max' (default, keep the majority species on disordered sites) | 'all'}
 * Symmetry operations are read from _symmetry_equiv_pos_as_xyz / _space_group_symop_operation_xyz
 * (also the dotted mmCIF/CIF2 forms). If none are listed and moyo is initialised, operations are
 * generated from the Hall/H-M symbol or IT number (a warning is recorded).
 */
export function readCIF(text, options = {}) {
  const all = readCIFAll(text, options);
  if (!all.length) throw new Error('CIF: no data block with atoms found');
  if (options.block != null) {
    const b = typeof options.block === 'number' ? all[options.block] : all.find((c) => c.info.blockName === options.block);
    if (!b) throw new Error(`CIF: block ${options.block} not found`);
    return b;
  }
  return all[0];
}

/** All structures in a CIF file (one per data block that has a cell and atoms). */
export function readCIFAll(text, { tolerance = 0.05, occupancy = 'max' } = {}) {
  const out = [];
  for (const block of parseCIFBlocks(text)) {
    const a = cifNumber(cifGet(block, '_cell_length_a'));
    const atomLoop = cifLoop(block, '_atom_site_fract_x') || cifLoop(block, '_atom_site_cartn_x');
    if (a == null || !atomLoop) continue;
    out.push(cifBlockToCell(block, atomLoop, { tolerance, occupancy }));
  }
  return out;
}

function cifBlockToCell(block, atomLoop, { tolerance, occupancy }) {
  const warnings = [];
  const par = ['a', 'b', 'c'].map((x) => cifNumber(cifGet(block, `_cell_length_${x}`)));
  const ang = ['alpha', 'beta', 'gamma'].map((x) => cifNumber(cifGet(block, `_cell_angle_${x}`)) ?? 90);
  const lattice = latticeFromParameters(par[0], par[1], par[2], ang[0], ang[1], ang[2]);

  // --- symmetry operations
  let ops = null;
  const opTags = ['_symmetry_equiv_pos_as_xyz', '_space_group_symop_operation_xyz', '_space_group_symop.operation_xyz', '_symmetry_equiv.pos_as_xyz'];
  for (const tag of opTags) {
    const loop = cifLoop(block, tag);
    if (loop) { ops = loopColumn(loop, tag).map(parseSymop); break; }
    const single = cifGet(block, tag);
    if (single) { ops = [parseSymop(single)]; break; }
  }
  const hm = cifGet(block, '_symmetry_space_group_name_h-m', '_space_group_name_h-m_alt', '_space_group.name_h-m_alt', '_space_group_name_h-m');
  const hall = cifGet(block, '_symmetry_space_group_name_hall', '_space_group_name_hall');
  const itn = cifNumber(cifGet(block, '_symmetry_int_tables_number', '_space_group_it_number', '_space_group.it_number'));
  if (!ops) {
    ops = opsFromSymbol(hm, hall, itn, warnings);
  }
  if (!ops) {
    ops = [{ rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] }];
    if ((hm && normHM(hm) !== 'p1') || (itn && itn !== 1)) {
      warnings.push(`no symmetry operations listed for space group ${hm || itn}; initialise moyo to expand them automatically. Treated as P1.`);
    }
  }

  // --- atoms
  const labels = loopColumn(atomLoop, '_atom_site_label') || [];
  const types = loopColumn(atomLoop, '_atom_site_type_symbol');
  let fx = loopColumn(atomLoop, '_atom_site_fract_x');
  let fy = loopColumn(atomLoop, '_atom_site_fract_y');
  let fz = loopColumn(atomLoop, '_atom_site_fract_z');
  const occ = loopColumn(atomLoop, '_atom_site_occupancy');
  const calc = loopColumn(atomLoop, '_atom_site_calc_flag');
  let cartesian = false;
  if (!fx) {
    fx = loopColumn(atomLoop, '_atom_site_cartn_x'); fy = loopColumn(atomLoop, '_atom_site_cartn_y'); fz = loopColumn(atomLoop, '_atom_site_cartn_z');
    cartesian = true;
  }
  const sites = [];
  for (let i = 0; i < fx.length; i++) {
    if (calc && /^dum/i.test(calc[i] || '')) continue;
    const z = siteElement(types && types[i], labels[i]);
    if (!z) { warnings.push(`skipping site '${labels[i] || i}': unknown element`); continue; }
    let p = [cifNumber(fx[i]), cifNumber(fy[i]), cifNumber(fz[i])];
    if (p.some((x) => x == null)) { warnings.push(`skipping site '${labels[i] || i}': missing coordinates`); continue; }
    if (cartesian) p = cartToFrac(lattice, p);
    sites.push({ z, label: labels[i] || symbolOf(z), pos: p, occ: occ ? (cifNumber(occ[i]) ?? 1) : 1 });
  }
  if (sites.some((s) => s.occ < 0.999)) warnings.push('partial occupancies present');

  // --- symmetry expansion
  const atoms = [];
  const tol = tolerance;
  const close = (p, q) => {
    const d = [0, 1, 2].map((k) => { const x = p[k] - q[k]; return x - Math.round(x); });
    return norm(vecmat(d, lattice)) < tol;
  };
  sites.forEach((s, si) => {
    const images = [];
    for (const op of ops) {
      const r = op.rotation.map((row, k) => row[0] * s.pos[0] + row[1] * s.pos[1] + row[2] * s.pos[2] + op.translation[k]).map((x) => wrap01(x));
      if (!images.some((q) => close(q, r))) images.push(r);
    }
    for (const r of images) atoms.push({ ...s, pos: r, site: si });
  });
  // disordered sites (different sites on top of each other)
  const keep = [];
  let overlaps = 0;
  for (const at of atoms) {
    const j = keep.findIndex((k) => k.site !== at.site && close(k.pos, at.pos));
    if (j < 0 || occupancy === 'all') { keep.push(at); if (j >= 0) overlaps++; continue; }
    overlaps++;
    if (at.occ > keep[j].occ) keep[j] = at;
  }
  if (overlaps) warnings.push(`${overlaps} overlapping atoms from different sites (disorder); ${occupancy === 'all' ? 'all kept' : 'kept the species with the largest occupancy'}`);

  const formulaSum = cifGet(block, '_chemical_formula_sum');
  return {
    lattice,
    positions: keep.map((a) => a.pos),
    numbers: keep.map((a) => a.z),
    labels: keep.map((a) => a.label),
    pbc: [true, true, true],
    info: {
      format: 'cif',
      blockName: block.name,
      title: block.name,
      spacegroup: hm || null,
      spacegroupNumber: itn ?? null,
      hall: hall || null,
      nSymops: ops.length,
      formula: formulaSum || null,
      occupancies: keep.map((a) => a.occ),
      warnings,
    },
  };
}

function opsFromSymbol(hm, hall, itn, warnings) {
  if (!isMoyoReady()) return null;
  const moyo = getMoyo();
  const want = [hall, hm].filter(Boolean).map(normHM);
  if (want.length) {
    for (let h = 1; h <= 530; h++) {
      const e = moyo.hall_symbol_entry(h);
      const names = [e.hall_symbol, e.hm_short, e.hm_full, `${e.hm_short}:${e.setting}`, `${e.hm_full}:${e.setting}`].map(normHM);
      if (want.some((w) => names.includes(w))) {
        warnings.push(`no symmetry operations listed: generated from Hall setting ${h} (${e.hm_full}${e.setting ? ` :${e.setting}` : ''})`);
        return moyo.operations_from_number(e.number, { type: 'HallNumber', value: h }, false)
          .map((o) => ({ rotation: fromColumnMajor(o.rotation), translation: o.translation.slice() }));
      }
    }
  }
  if (itn) {
    warnings.push(`no symmetry operations listed: generated from IT number ${itn} (ITA standard setting assumed)`);
    return operationsFromNumber(itn, { setting: 'Standard' });
  }
  return null;
}

/**
 * Write a CIF. Default: P1 with all atoms.
 * options: {title, symmetrize: false, symprec: 1e-5}
 * With symmetrize=true (moyo required) the standardized conventional cell is written with its
 * symmetry operations and only the symmetry-independent atoms (one per Wyckoff orbit).
 */
export function writeCIF(cellIn, { title = null, symmetrize = false, symprec = 1e-5 } = {}) {
  let cell = normalizeCell(cellIn);
  const name = (title || cell.info?.title || 'dftlab').replace(/\s+/g, '_');
  let ops = [{ rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] }];
  let hm = 'P 1', number = 1;
  let indices = cell.positions.map((_, i) => i);
  let wyck = null, mult = null;
  if (symmetrize) {
    const d0 = analyze(cell, { symprec });
    cell = d0.conventional;
    const d = analyze(cell, { symprec });
    ops = d.operations;
    hm = d.hm_symbol; number = d.number;
    indices = d.orbits.map((o) => o.representative);
    wyck = d.wyckoffs;
    mult = {};
    d.orbits.forEach((o) => { mult[o.representative] = o.indices.length; });
  }
  const p = cellParameters(cell.lattice);
  const L = [];
  L.push(`# Generated by DFT Lab`);
  L.push(`data_${name}`);
  L.push(`_symmetry_space_group_name_H-M   '${hm}'`);
  L.push(`_symmetry_Int_Tables_number      ${number}`);
  L.push(`_cell_length_a      ${p.a.toFixed(8)}`);
  L.push(`_cell_length_b      ${p.b.toFixed(8)}`);
  L.push(`_cell_length_c      ${p.c.toFixed(8)}`);
  L.push(`_cell_angle_alpha   ${p.alpha.toFixed(8)}`);
  L.push(`_cell_angle_beta    ${p.beta.toFixed(8)}`);
  L.push(`_cell_angle_gamma   ${p.gamma.toFixed(8)}`);
  L.push(`_cell_volume        ${Math.abs(p.volume).toFixed(8)}`);
  const counts = {};
  cell.numbers.forEach((z) => { counts[symbolOf(z)] = (counts[symbolOf(z)] || 0) + 1; });
  L.push(`_chemical_formula_sum   '${Object.entries(counts).map(([s, n]) => `${s}${n}`).join(' ')}'`);
  L.push('');
  L.push('loop_');
  L.push('_symmetry_equiv_pos_site_id');
  L.push('_symmetry_equiv_pos_as_xyz');
  ops.forEach((o, i) => L.push(`  ${i + 1}  '${formatSymop(o)}'`));
  L.push('');
  L.push('loop_');
  L.push('_atom_site_label');
  L.push('_atom_site_type_symbol');
  if (wyck) { L.push('_atom_site_symmetry_multiplicity'); L.push('_atom_site_Wyckoff_symbol'); }
  L.push('_atom_site_fract_x');
  L.push('_atom_site_fract_y');
  L.push('_atom_site_fract_z');
  L.push('_atom_site_occupancy');
  const cnt = {};
  for (const i of indices) {
    const s = symbolOf(cell.numbers[i]);
    cnt[s] = (cnt[s] || 0) + 1;
    const lab = `${s}${cnt[s]}`;
    const extra = wyck ? `  ${String(mult[i]).padStart(3)}  ${wyck[i]}` : '';
    L.push(`  ${lab.padEnd(6)} ${s.padEnd(3)}${extra} ${cell.positions[i].map((x) => fmt(wrap01(x), 8)).join(' ')}  1.0`);
  }
  L.push('');
  return L.join('\n');
}
// ===========================================================================
// XYZ / extended XYZ
// ===========================================================================

function parseKeyValues(line) {
  const out = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*("([^"]*)"|'([^']*)'|\{([^}]*)\}|(\S+))|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m[1]) out[m[1]] = m[3] ?? m[4] ?? m[5] ?? m[6];
    else if (m[7]) out[m[7]] = true;
  }
  return out;
}

/** Read all frames of an (extended) XYZ file. */
export function readXYZAll(text, opts = {}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const frames = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const n = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(n)) throw new Error(`XYZ: expected atom count at line ${i + 1}`);
    const comment = lines[i + 1] ?? '';
    const body = lines.slice(i + 2, i + 2 + n);
    if (body.length < n) throw new Error('XYZ: file truncated');
    frames.push(parseXYZFrame(n, comment, body, opts));
    i += 2 + n;
  }
  return frames;
}

/** Read the first (or `frame`-th) structure of an (extended) XYZ file. */
export function readXYZ(text, { frame = 0, ...opts } = {}) {
  const f = readXYZAll(text, opts);
  if (!f.length) throw new Error('XYZ: no frames');
  return f[frame < 0 ? f.length + frame : frame];
}

function parseXYZFrame(n, comment, body, { vacuum = 10.0 } = {}) {
  const kv = parseKeyValues(comment);
  const keyLower = Object.fromEntries(Object.entries(kv).map(([k, v]) => [k.toLowerCase(), v]));
  let speciesCol = 0, posCol = 1;
  const extraProps = {};
  if (keyLower.properties) {
    const pr = keyLower.properties.split(':');
    let col = 0;
    for (let k = 0; k + 2 < pr.length; k += 3) {
      const name = pr[k], type = pr[k + 1], cnt = parseInt(pr[k + 2], 10);
      if (/^(species|element|symbols?)$/i.test(name)) speciesCol = col;
      else if (/^pos(itions)?$/i.test(name)) posCol = col;
      else extraProps[name] = { col, type, cnt };
      col += cnt;
    }
  }
  const numbers = [], cart = [], labels = [];
  const props = Object.fromEntries(Object.keys(extraProps).map((k) => [k, []]));
  for (const ln of body) {
    const t = ln.trim().split(/\s+/);
    const z = /^\d+$/.test(t[speciesCol]) ? parseInt(t[speciesCol], 10) : atomicNumber(t[speciesCol]);
    numbers.push(z);
    labels.push(t[speciesCol]);
    cart.push([parseFloat(t[posCol]), parseFloat(t[posCol + 1]), parseFloat(t[posCol + 2])]);
    for (const [k, p] of Object.entries(extraProps)) {
      const vals = t.slice(p.col, p.col + p.cnt).map((v) => (p.type === 'R' ? parseFloat(v) : p.type === 'I' ? parseInt(v, 10) : p.type === 'L' ? /^t/i.test(v) : v));
      props[k].push(p.cnt === 1 ? vals[0] : vals);
    }
  }
  const info = { format: 'xyz', title: comment.trim(), warnings: [] };
  let lattice, pbc;
  if (keyLower.lattice) {
    const v = keyLower.lattice.trim().split(/[\s,]+/).map(Number);
    lattice = [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)];
    pbc = [true, true, true];
    if (keyLower.pbc != null) {
      const s = String(keyLower.pbc).trim().split(/[\s,]+/);
      pbc = s.length === 3 ? s.map((x) => /^(t|true|1)$/i.test(x)) : [true, true, true];
    }
    info.format = 'extxyz';
    for (const [k, v] of Object.entries(kv)) if (!/^(lattice|properties|pbc)$/i.test(k)) info[k] = v;
    if (Object.keys(props).length) info.arrays = props;
  } else {
    // molecule: box = bounding box + vacuum
    const lo = [0, 1, 2].map((k) => Math.min(...cart.map((r) => r[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...cart.map((r) => r[k])));
    const len = [0, 1, 2].map((k) => hi[k] - lo[k] + vacuum);
    lattice = [[len[0], 0, 0], [0, len[1], 0], [0, 0, len[2]]];
    const shift = [0, 1, 2].map((k) => vacuum / 2 - lo[k]);
    cart.forEach((r) => { for (let k = 0; k < 3; k++) r[k] += shift[k]; });
    pbc = [false, false, false];
    info.molecule = true;
    info.warnings.push(`plain XYZ: atoms placed in an orthorhombic box with ${vacuum} A vacuum`);
  }
  if (numbers.length !== n) throw new Error('XYZ: atom count mismatch');
  return { lattice, positions: cartToFrac(lattice, cart), numbers, labels, pbc, info };
}

/** Plain XYZ (Cartesian Angstrom). */
export function writeXYZ(cellIn, { comment = null } = {}) {
  const cell = normalizeCell(cellIn);
  const cart = fracToCart(cell.lattice, cell.positions);
  const L = [String(cell.numbers.length), comment ?? (cell.info?.title || 'DFT Lab structure')];
  cart.forEach((r, i) => L.push(`${symbolOf(cell.numbers[i]).padEnd(3)} ${r.map((x) => fmt(x, 8)).join(' ')}`));
  return L.join('\n') + '\n';
}

/** Extended XYZ with Lattice, Properties and pbc. */
export function writeExtXYZ(cellIn, { comment = null, info = {} } = {}) {
  const cell = normalizeCell(cellIn);
  const cart = fracToCart(cell.lattice, cell.positions);
  const pbc = (cell.pbc || [true, true, true]).map((b) => (b ? 'T' : 'F')).join(' ');
  const extra = Object.entries(info).map(([k, v]) => (typeof v === 'string' && /\s/.test(v) ? `${k}="${v}"` : `${k}=${v}`)).join(' ');
  const head = `Lattice="${cell.lattice.flat().map((x) => (Math.abs(x) < 1e-14 ? 0 : x).toFixed(10)).join(' ')}" Properties=species:S:1:pos:R:3 pbc="${pbc}"`
    + (extra ? ` ${extra}` : '') + (comment ? ` comment="${comment.replace(/"/g, "'")}"` : '');
  const L = [String(cell.numbers.length), head];
  cart.forEach((r, i) => L.push(`${symbolOf(cell.numbers[i]).padEnd(3)} ${r.map((x) => fmt(x, 10)).join(' ')}`));
  return L.join('\n') + '\n';
}

// ===========================================================================
// POSCAR / CONTCAR
// ===========================================================================

/** Read a VASP POSCAR/CONTCAR (VASP 4 or 5 format). options: {species: ['Si','O']} for VASP 4 files. */
export function readPOSCAR(text, { species = null } = {}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let li = 0;
  const title = lines[li++].trim();
  const scaleTok = lines[li++].trim().split(/\s+/).map(Number);
  let lattice = [0, 1, 2].map(() => lines[li++].trim().split(/\s+/).slice(0, 3).map(Number));
  let tok = lines[li].trim().split(/\s+/);
  let symbols;
  if (!/^\d+$/.test(tok[0])) {
    symbols = tok.map((s) => s.split(/[_/]/)[0]);
    li++;
    tok = lines[li].trim().split(/\s+/);
  }
  const counts = tok.filter((x) => /^\d+$/.test(x)).map(Number);
  li++;
  if (!symbols) {
    if (species) symbols = species;
    else {
      const cand = title.split(/\s+/).filter((s) => atomicNumber(s));
      if (cand.length >= counts.length) symbols = cand.slice(0, counts.length);
      else throw new Error('POSCAR (VASP 4 format): species unknown, pass {species: [...]}');
    }
  }
  let line = lines[li].trim();
  let selective = false;
  if (/^s/i.test(line)) { selective = true; li++; line = lines[li].trim(); }
  const cartesian = /^[ck]/i.test(line);
  li++;
  // scale: one factor, three factors, or a negative target volume
  let sf;
  if (scaleTok.length === 3) sf = scaleTok;
  else if (scaleTok[0] < 0) { const f = Math.cbrt(-scaleTok[0] / Math.abs(det3(lattice))); sf = [f, f, f]; }
  else sf = [scaleTok[0], scaleTok[0], scaleTok[0]];
  lattice = lattice.map((v) => v.map((x, k) => x * sf[k]));
  const numbers = [], positions = [], flags = [];
  const nat = counts.reduce((a, b) => a + b, 0);
  symbols.forEach((sym, k) => { for (let j = 0; j < counts[k]; j++) numbers.push(atomicNumber(sym)); });
  for (let i = 0; i < nat; i++) {
    const t = lines[li++].trim().split(/\s+/);
    let p = t.slice(0, 3).map(Number);
    if (cartesian) p = cartToFrac(lattice, p.map((x, k) => x * sf[k]));
    positions.push(p);
    if (selective) flags.push(t.slice(3, 6).map((f) => /^t/i.test(f)));
  }
  const info = { format: 'poscar', title, warnings: [] };
  if (selective) info.selectiveDynamics = flags;
  return { lattice, positions, numbers, labels: numbers.map(symbolOf), pbc: [true, true, true], info };
}

/**
 * Write a VASP 5 POSCAR. Atoms are grouped by species (order of first appearance).
 * options: {comment, cartesian=false, selectiveDynamics: [[bool,bool,bool],...]}
 */
export function writePOSCAR(cellIn, { comment = null, cartesian = false, selectiveDynamics = null } = {}) {
  const cell = normalizeCell(cellIn);
  const order = [];
  cell.numbers.forEach((z) => { if (!order.includes(z)) order.push(z); });
  const idx = [];
  order.forEach((z) => cell.numbers.forEach((zz, i) => { if (zz === z) idx.push(i); }));
  const L = [];
  L.push(comment ?? (cell.info?.title || order.map((z) => symbolOf(z)).join(' ')));
  L.push('   1.0');
  cell.lattice.forEach((v) => L.push(`  ${v.map((x) => fmt(x, 10)).join('  ')}`));
  L.push(`  ${order.map((z) => symbolOf(z).padStart(4)).join(' ')}`);
  L.push(`  ${order.map((z) => String(cell.numbers.filter((x) => x === z).length).padStart(4)).join(' ')}`);
  if (selectiveDynamics) L.push('Selective dynamics');
  L.push(cartesian ? 'Cartesian' : 'Direct');
  const cart = cartesian ? fracToCart(cell.lattice, cell.positions) : null;
  for (const i of idx) {
    const p = cartesian ? cart[i] : cell.positions[i];
    let s = `  ${p.map((x) => fmt(x, 10)).join('  ')}`;
    if (selectiveDynamics) s += `  ${selectiveDynamics[i].map((b) => (b ? 'T' : 'F')).join(' ')}`;
    s += `   ! ${symbolOf(cell.numbers[i])}`;
    L.push(s);
  }
  return L.join('\n') + '\n';
}

// ===========================================================================
// SIESTA
// ===========================================================================

/** SIESTA .XV (lattice vectors and Cartesian positions in Bohr, with velocities). */
export function readXV(text, { bohr = BOHR_SIESTA } = {}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  const lattice = [0, 1, 2].map((i) => lines[i].trim().split(/\s+/).slice(0, 3).map((x) => parseFloat(x.replace(/[dD]/, 'e')) * bohr));
  const nat = parseInt(lines[3].trim(), 10);
  const numbers = [], cart = [], species = [], velocities = [];
  for (let i = 0; i < nat; i++) {
    const t = lines[4 + i].trim().split(/\s+/).map((x) => x.replace(/[dD]/, 'e'));
    species.push(parseInt(t[0], 10));
    numbers.push(Math.abs(parseInt(t[1], 10)));
    cart.push(t.slice(2, 5).map((x) => parseFloat(x) * bohr));
    if (t.length >= 8) velocities.push(t.slice(5, 8).map((x) => parseFloat(x) * bohr));
  }
  return {
    lattice, positions: cartToFrac(lattice, cart), numbers, labels: numbers.map(symbolOf), pbc: [true, true, true],
    info: { format: 'siesta-xv', speciesIndex: species, velocities, warnings: [] },
  };
}

/** SIESTA .STRUCT_OUT / .STRUCT_IN (lattice in Angstrom, fractional coordinates). */
export function readStructOut(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  const lattice = [0, 1, 2].map((i) => lines[i].trim().split(/\s+/).slice(0, 3).map((x) => parseFloat(x.replace(/[dD]/, 'e'))));
  const nat = parseInt(lines[3].trim(), 10);
  const numbers = [], positions = [], species = [];
  for (let i = 0; i < nat; i++) {
    const t = lines[4 + i].trim().split(/\s+/).map((x) => x.replace(/[dD]/, 'e'));
    species.push(parseInt(t[0], 10));
    numbers.push(Math.abs(parseInt(t[1], 10)));
    positions.push(t.slice(2, 5).map(Number));
  }
  return {
    lattice, positions, numbers, labels: numbers.map(symbolOf), pbc: [true, true, true],
    info: { format: 'siesta-struct', speciesIndex: species, warnings: [] },
  };
}

/** Write SIESTA .STRUCT_IN (same format as STRUCT_OUT). */
export function writeStructIn(cellIn, { speciesOrder = null } = {}) {
  const cell = normalizeCell(cellIn);
  const order = speciesOrder || [...new Set(cell.numbers)];
  const L = cell.lattice.map((v) => v.map((x) => fmt(x, 9).padStart(16)).join(''));
  L.push(String(cell.numbers.length).padStart(13));
  cell.positions.forEach((p, i) => L.push(`${String(order.indexOf(cell.numbers[i]) + 1).padStart(5)}${String(cell.numbers[i]).padStart(6)}${p.map((x) => fmt(x, 9).padStart(16)).join('')}`));
  return L.join('\n') + '\n';
}

const fdfKey = (s) => s.toLowerCase().replace(/[-_.]/g, '');
const LENGTH_UNITS = { ang: 1, angstrom: 1, bohr: BOHR_SIESTA, au: BOHR_SIESTA, nm: 10, m: 1e10, cm: 1e8 };

/** Parse fdf text into {values: {key: string}, blocks: {key: [lines]}} (keys normalised as in fdf). */
export function parseFDF(text, { files = {}, root = 'input.fdf', maxDepth = 16 } = {}) {
  // Preview only: this never replaces the authoritative QRAFT validation report.
  const inputs = { ...files, [root]: text };
  const clean = line => line.replace(/[#!;].*$/, '').trim();
  const read = name => {
    if (!Object.hasOwn(inputs, name)) throw { error: 'INCLUDE_NOT_FOUND', file: name };
    return inputs[name].replace(/\r\n?/g, '\n').split('\n');
  };
  function collect(name, depth, ancestors, result) {
    if (depth > maxDepth || ancestors.includes(name)) throw { error: 'CYCLIC_INCLUDE', file: name };
    const stack = [...ancestors, name], lines = read(name);
    const first = (label, value) => {
      const key = fdfKey(label);
      if (!result.has(key)) result.set(key, value);
    };
    for (let i = 0; i < lines.length; i++) {
      const tokens = clean(lines[i]).split(/\s+/);
      if (!tokens[0]) continue;
      const directive = tokens[0].toLowerCase();
      if (directive === '%include') {
        collect(tokens[1], depth + 1, stack, result);
      } else if (directive === '%block') {
        const rows = [];
        if (tokens[2] === '<') rows.push(...read(tokens[3]).map(clean).filter(Boolean));
        else {
          while (++i < lines.length && !/^\s*%endblock/i.test(lines[i])) {
            const row = clean(lines[i]);
            if (row) rows.push(row);
          }
        }
        first(tokens[1], { kind: 'block', rows });
      } else if (!directive.startsWith('%')) {
        if (tokens[1] === '<') {
          const redirected = new Map();
          collect(tokens[2], depth + 1, stack, redirected);
          const hit = redirected.get(fdfKey(tokens[0]));
          if (!hit || hit.kind !== 'scalar') throw { error: 'REDIRECT_LABEL_NOT_FOUND', file: tokens[2] };
          first(tokens[0], hit);
        } else first(tokens[0], { kind: 'scalar', text: tokens.slice(1).join(' ') });
      }
    }
  }
  const found = new Map(), values = {}, blocks = {}, warnings = [];
  let failure;
  try { collect(root, 0, [], found); } catch (error) {
    if (!error?.error) throw error;
    failure = error;
    warnings.push(error.error);
  }
  for (const [key, value] of found) {
    if (value.kind === 'block') blocks[key] = value.rows;
    else values[key] = value.text;
  }
  return { values, blocks, warnings, ...(failure && {
    status: failure.error === 'INCLUDE_NOT_FOUND' ? 'NOT_CHECKED' : 'FAIL', ...failure,
  }) };
}

function fdfLength(str, def = 'bohr') {
  const t = String(str).trim().split(/\s+/);
  const v = parseFloat(t[0].replace(/[dD]/, 'e'));
  const u = (t[1] || def).toLowerCase();
  const f = LENGTH_UNITS[u];
  if (f == null) throw new Error(`fdf: unknown length unit '${t[1]}'`);
  return v * f;
}

/**
 * Read the geometry of a SIESTA .fdf: LatticeConstant + LatticeVectors | LatticeParameters,
 * ChemicalSpeciesLabel, AtomicCoordinatesFormat (Ang, Bohr, NotScaledCartesian*, ScaledCartesian,
 * Fractional/ScaledByLatticeVectors) and AtomicCoordinatesAndAtomicSpecies (+ numeric AtomicCoordinatesOrigin).
 */
export function readFDF(text, options = {}) {
  const parsed = parseFDF(text, options);
  if (parsed.status) {
    // Do not produce a partial/fallback structure from unresolved effective FDF.
    throw Object.assign(new Error(parsed.status), { code: parsed.status, cause: parsed });
  }
  const { values, blocks, warnings } = parsed;
  if (blocks.zmatrix) throw new Error('fdf: Zmatrix geometry is not supported');
  const species = {};
  for (const l of blocks.chemicalspecieslabel || []) {
    const t = l.split(/\s+/);
    species[parseInt(t[0], 10)] = { z: Math.abs(parseInt(t[1], 10)), label: t[2] || symbolOf(Math.abs(parseInt(t[1], 10))), ghost: parseInt(t[1], 10) < 0 };
  }
  const coordsBlock = blocks.atomiccoordinatesandatomicspecies;
  if (!coordsBlock) throw new Error('fdf: %block AtomicCoordinatesAndAtomicSpecies not found');
  const alat = values.latticeconstant != null ? fdfLength(values.latticeconstant, 'bohr') : null;
  let lattice = null;
  if (blocks.latticevectors) {
    const a = alat ?? 1.0;
    if (alat == null) warnings.push('LatticeConstant missing: LatticeVectors taken in Angstrom');
    lattice = blocks.latticevectors.slice(0, 3).map((l) => l.split(/\s+/).slice(0, 3).map((x) => parseFloat(x.replace(/[dD]/, 'e')) * a));
  } else if (blocks.latticeparameters) {
    const t = blocks.latticeparameters[0].split(/\s+/).map((x) => parseFloat(x.replace(/[dD]/, 'e')));
    const a = alat ?? 1.0;
    lattice = latticeFromParameters(t[0] * a, t[1] * a, t[2] * a, t[3], t[4], t[5]);
  } else if (alat != null) {
    lattice = [[alat, 0, 0], [0, alat, 0], [0, 0, alat]];
  }
  const fmtv = fdfKey(values.atomiccoordinatesformat || 'Bohr');
  const raw = coordsBlock.map((l) => l.split(/\s+/));
  let origin = [0, 0, 0];
  if (blocks.atomiccoordinatesorigin && blocks.atomiccoordinatesorigin[0]) {
    const o = blocks.atomiccoordinatesorigin[0].split(/\s+/).slice(0, 3).map((x) => parseFloat(x.replace(/[dD]/, 'e')));
    if (o.every(Number.isFinite)) origin = o;
  }
  const xyz = raw.map((t) => t.slice(0, 3).map((x, k) => parseFloat(x.replace(/[dD]/, 'e')) + origin[k]));
  const sp = raw.map((t) => parseInt(t[3], 10));
  const numbers = sp.map((s) => {
    if (!species[s]) throw new Error(`fdf: species ${s} not in ChemicalSpeciesLabel`);
    return species[s].z;
  });
  const labels = sp.map((s) => species[s].label);
  let cart = null, positions = null;
  if (fmtv === 'ang' || fmtv === 'notscaledcartesianang') cart = xyz;
  else if (fmtv === 'bohr' || fmtv === 'notscaledcartesianbohr') cart = xyz.map((r) => r.map((x) => x * BOHR_SIESTA));
  else if (fmtv === 'scaledcartesian') {
    if (alat == null) throw new Error('fdf: ScaledCartesian requires LatticeConstant');
    cart = xyz.map((r) => r.map((x) => x * alat));
  } else if (fmtv === 'fractional' || fmtv === 'scaledbylatticevectors') positions = xyz;
  else throw new Error(`fdf: unsupported AtomicCoordinatesFormat '${values.atomiccoordinatesformat}'`);
  if (!lattice) {
    if (positions) throw new Error('fdf: fractional coordinates without lattice');
    const lo = [0, 1, 2].map((k) => Math.min(...cart.map((r) => r[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...cart.map((r) => r[k])));
    const len = [0, 1, 2].map((k) => hi[k] - lo[k] + 10);
    lattice = [[len[0], 0, 0], [0, len[1], 0], [0, 0, len[2]]];
    warnings.push('no lattice given: orthorhombic box with 10 A vacuum used');
  }
  if (!positions) positions = cartToFrac(lattice, cart);
  return {
    lattice, positions, numbers, labels, pbc: [true, true, true],
    info: {
      format: 'fdf', title: values.systemlabel || values.systemname || '', speciesIndex: sp,
      species, warnings,
    },
  };
}

/**
 * SIESTA fdf geometry blocks.
 * options: {systemLabel, coordinates: 'Fractional' | 'Ang', speciesLabels: {Z: 'label'},
 *           speciesOrder: [Z...], latticeConstant: 1.0}
 */
export function writeFDF(cellIn, { systemLabel = null, coordinates = 'Fractional', speciesLabels = {}, speciesOrder = null, latticeConstant = 1.0 } = {}) {
  const cell = normalizeCell(cellIn);
  const order = speciesOrder || [...new Set(cell.numbers)];
  const L = [];
  if (systemLabel) L.push(`SystemLabel          ${systemLabel}`);
  L.push(`NumberOfAtoms        ${cell.numbers.length}`);
  L.push(`NumberOfSpecies      ${order.length}`);
  L.push('');
  L.push('%block ChemicalSpeciesLabel');
  order.forEach((z, i) => L.push(`  ${String(i + 1).padStart(3)} ${String(z).padStart(4)}  ${speciesLabels[z] || symbolOf(z)}`));
  L.push('%endblock ChemicalSpeciesLabel');
  L.push('');
  L.push(`LatticeConstant      ${latticeConstant.toFixed(8)} Ang`);
  L.push('%block LatticeVectors');
  cell.lattice.forEach((v) => L.push(`  ${v.map((x) => fmt(x / latticeConstant, 10)).join('  ')}`));
  L.push('%endblock LatticeVectors');
  L.push('');
  const frac = /^frac|^scaledby/i.test(coordinates);
  L.push(`AtomicCoordinatesFormat  ${frac ? 'Fractional' : 'Ang'}`);
  L.push('%block AtomicCoordinatesAndAtomicSpecies');
  const xyz = frac ? cell.positions : fracToCart(cell.lattice, cell.positions);
  xyz.forEach((p, i) => L.push(`  ${p.map((x) => fmt(x, 10)).join('  ')}  ${String(order.indexOf(cell.numbers[i]) + 1).padStart(3)}   # ${String(i + 1).padStart(4)} ${speciesLabels[cell.numbers[i]] || symbolOf(cell.numbers[i])}`));
  L.push('%endblock AtomicCoordinatesAndAtomicSpecies');
  return L.join('\n') + '\n';
}

/** SIESTA label for a seekpath label: GAMMA -> \Gamma, others unchanged. */
export function siestaLabel(label) {
  return label.replace(/^GAMMA/, '\\Gamma');
}

/**
 * SIESTA %block BandLines from a kpath.js result (getPath / getExplicitKPath output).
 * Coordinates are fractional w.r.t. the reciprocal vectors of `res.primitive_lattice`
 * (BandLinesScale ReciprocalLatticeVectors): use the seekpath primitive cell in the fdf.
 * options: {referenceDistance=0.025 (1/Angstrom, 2*pi included, seekpath convention),
 *           pointsPerSegment: fixed number of points instead, includeScale=true,
 *           reciprocalLattice: override (rows, 2*pi included), includeGeometry=false}
 * Returns the fdf text. The number on each line is the number of points from the previous
 * point (excluded) to this one (included); 1 starts a new, disconnected line.
 */
export function writeBandLines(res, { referenceDistance = 0.025, pointsPerSegment = null, includeScale = true, reciprocalLattice: Bover = null, includeGeometry = false } = {}) {
  const B = Bover || res.reciprocal_primitive_lattice;
  if (!B) throw new Error('writeBandLines: reciprocal lattice unknown');
  const L = [];
  if (includeGeometry) {
    L.push('# Seekpath (HPKOT) standardized primitive cell -- BandLines refer to its reciprocal vectors');
    L.push(writeFDF({ lattice: res.primitive_lattice, positions: res.primitive_positions, numbers: res.primitive_numbers || res.primitive_types }));
  }
  L.push(`# k-path: HPKOT/seekpath, extended Bravais lattice ${res.bravais_lattice_extended}, space group ${res.spacegroup_number}${res.spacegroup_international ? ` (${res.spacegroup_international})` : ''}`);
  if (includeScale) L.push('BandLinesScale  ReciprocalLatticeVectors');
  L.push('%block BandLines');
  let last = null;
  for (const [a, b] of res.path) {
    const ka = res.point_coords[a], kb = res.point_coords[b];
    if (last !== a) {
      L.push(`  ${'1'.padStart(4)}  ${ka.map((x) => fmt(x, 8)).join(' ')}   ${siestaLabel(a)}`);
    }
    const len = norm(sub(vecmat(kb, B), vecmat(ka, B)));
    const npts = pointsPerSegment ?? Math.max(2, Math.trunc(len / referenceDistance));
    L.push(`  ${String(Math.max(1, npts - 1)).padStart(4)}  ${kb.map((x) => fmt(x, 8)).join(' ')}   ${siestaLabel(b)}`);
    last = b;
  }
  L.push('%endblock BandLines');
  return L.join('\n') + '\n';
}

/**
 * Monkhorst-Pack grid from a target k-spacing.
 * n_i = max(1, ceil(|b_i| / kspacing)) with |b_i| including 2*pi (VASP KSPACING convention) when twoPi=true.
 * Non-periodic directions (cell.pbc false) get 1.
 */
export function kgridFromSpacing(cellOrLattice, kspacing = 0.2, { twoPi = true, pbc = null } = {}) {
  const lattice = cellOrLattice.lattice || cellOrLattice;
  const per = pbc || cellOrLattice.pbc || [true, true, true];
  const B = reciprocalLattice(lattice, twoPi);
  return B.map((b, i) => (per[i] ? Math.max(1, Math.ceil(norm(b) / kspacing - 1e-9)) : 1));
}

/**
 * SIESTA %block kgrid_Monkhorst_Pack. Pass {kspacing} (1/Angstrom, default 0.2) or {grid: [n1,n2,n3]};
 * shift: number or [s1,s2,s3] (0 or 0.5).
 */
export function writeKgridMonkhorstPack(cellOrLattice, { kspacing = 0.2, grid = null, shift = 0, twoPi = true, pbc = null } = {}) {
  const n = grid || kgridFromSpacing(cellOrLattice, kspacing, { twoPi, pbc });
  const s = Array.isArray(shift) ? shift : [shift, shift, shift];
  const L = [`# Monkhorst-Pack grid ${n.join('x')}${grid ? '' : ` (k-spacing ${kspacing} 1/Ang${twoPi ? ', 2*pi included' : ''})`}`];
  L.push('%block kgrid_Monkhorst_Pack');
  for (let i = 0; i < 3; i++) {
    const row = [0, 0, 0]; row[i] = n[i];
    L.push(`  ${row.map((x) => String(x).padStart(4)).join(' ')}   ${s[i].toFixed(1)}`);
  }
  L.push('%endblock kgrid_Monkhorst_Pack');
  return L.join('\n') + '\n';
}

// ===========================================================================
// Generic entry points
// ===========================================================================

/** Guess the format from a file name and/or content. */
export function detectFormat(text, filename = '') {
  const f = filename.toLowerCase();
  if (/\.cif$/.test(f)) return 'cif';
  if (/\.extxyz$/.test(f)) return 'xyz';
  if (/\.xyz$/.test(f)) return 'xyz';
  if (/\.xv$/.test(f)) return 'xv';
  if (/struct_(out|in)$/.test(f) || /\.struct_(out|in)$/.test(f)) return 'struct';
  if (/\.fdf$/.test(f)) return 'fdf';
  if (/(poscar|contcar)/.test(f) || /\.vasp$/.test(f)) return 'poscar';
  if (/^\s*data_/m.test(text) && /_cell_length_a/i.test(text)) return 'cif';
  if (/%block\s+atomiccoordinatesandatomicspecies/i.test(text) || /atomiccoordinatesformat/i.test(text)) return 'fdf';
  const lines = text.trim().split(/\r?\n/);
  if (/^\d+\s*$/.test(lines[0])) return 'xyz';
  if (lines.length > 4 && lines.slice(0, 3).every((l) => l.trim().split(/\s+/).length === 6) && /^\s*\d+\s*$/.test(lines[3])) return 'xv';
  if (lines.length > 4 && lines.slice(0, 3).every((l) => l.trim().split(/\s+/).length === 3) && /^\s*\d+\s*$/.test(lines[3])) return 'struct';
  return 'poscar';
}

/** Read any supported format. options.format overrides detection; other options go to the reader. */
export function readStructure(text, { format = null, filename = '', ...opts } = {}) {
  const fm = format || detectFormat(text, filename);
  switch (fm) {
    case 'cif': return readCIF(text, opts);
    case 'xyz': case 'extxyz': return readXYZ(text, opts);
    case 'poscar': case 'vasp': case 'contcar': return readPOSCAR(text, opts);
    case 'xv': return readXV(text, opts);
    case 'struct': case 'struct_out': case 'struct_in': return readStructOut(text);
    case 'fdf': return readFDF(text, opts);
    default: throw new Error(`unknown format ${fm}`);
  }
}

/** Write any supported format: 'cif', 'xyz', 'extxyz', 'poscar', 'fdf', 'struct_in'. */
export function writeStructure(cell, format, opts = {}) {
  switch (format.toLowerCase()) {
    case 'cif': return writeCIF(cell, opts);
    case 'xyz': return writeXYZ(cell, opts);
    case 'extxyz': return writeExtXYZ(cell, opts);
    case 'poscar': case 'vasp': return writePOSCAR(cell, opts);
    case 'fdf': return writeFDF(cell, opts);
    case 'struct_in': case 'struct': return writeStructIn(cell, opts);
    default: throw new Error(`unknown format ${format}`);
  }
}

/** Total mass (amu) and density (g/cm^3) of a cell. */
export function density(cell) {
  const m = cell.numbers.reduce((s, z) => s + massOf(z), 0);
  const v = Math.abs(det3(cell.lattice));
  return { mass: m, density: (m * 1.66053906660) / v };
}
