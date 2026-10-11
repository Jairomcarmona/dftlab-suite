// SIESTA projected density of states.
//  * SystemLabel.PDOS      (XML, one value per line, padded attributes; SIESTA 3.x-5.x)
//  * SystemLabel.PDOS.xml  (XML, 4 values per line; SIESTA 5.x)
//  * plain-text PDOS tables (fmpdos / pdosxml / sisl output): "# E  col1 col2 ..." columns
//  * SystemLabel.PDOS.KP   (k-points used for the PDOS, same layout as .KP -> see eig.parseKP)
//
// The <data> block of every <orbital> holds ne*nspin values in energy-major order
// (E1:s1 s2 .., E2:s1 s2 ..). nspin = 1 (total), 2 (up, down) or 4 (non-collinear / SOC:
// uu, dd, and two off-diagonal components; total = uu + dd, mz = uu - dd).
import { parseXML, xchild, xchildren, xtext, attrStr, ffloat, floatBlock, lines as splitLines, trapz, BOHR_ANG } from './util.js';
import { parseKP } from './eig.js';

const LSYM = ['s', 'p', 'd', 'f', 'g', 'h'];

export function parsePDOS(text) {
  const doc = parseXML(text);
  const root = doc.children.find((c) => c.name === 'pdos');
  if (!root) throw new Error('Not a SIESTA PDOS XML file (no <pdos> root)');
  const nspin = parseInt(xtext(xchild(root, 'nspin')), 10);
  const fermiNode = xchild(root, 'fermi_energy');
  const fermi = fermiNode ? ffloat(xtext(fermiNode)) : NaN;
  const eNode = xchild(root, 'energy_values');
  const energy = floatBlock(xtext(eNode));
  const ne = energy.length;
  const orbitals = xchildren(root, 'orbital').map((o) => {
    const a = (k) => attrStr(o, k);
    const ai = (k) => (a(k) == null ? null : parseInt(a(k), 10));
    const raw = floatBlock(xtext(xchild(o, 'data')));
    const data = Array.from({ length: nspin }, () => new Float64Array(ne));
    for (let i = 0; i < ne; i++) for (let s = 0; s < nspin; s++) data[s][i] = raw[i * nspin + s];
    const posB = a('position') ? a('position').split(/\s+/).map(ffloat) : null;
    const l = ai('l');
    return {
      index: ai('index'),
      atom: ai('atom_index'),
      species: a('species'),
      Z: ai('Z'),
      positionBohr: posB,
      position: posB ? posB.map((v) => v * BOHR_ANG) : null,
      n: ai('n'), l, m: ai('m'),
      z: ai('z'),                                  // zeta index (absent in very old files -> null)
      P: a('P') == null ? null : /^t/i.test(a('P')), // polarization orbital flag
      lsym: l != null ? LSYM[l] ?? `l${l}` : null,
      data,
    };
  });
  // nspin=1: the stored curve is per spin channel (integrates to N/2); helpers return 2x for 'total'.
  const components = nspin === 1 ? ['perSpin'] : nspin === 2 ? ['up', 'down'] : ['uu', 'dd', 'c3', 'c4'];
  return {
    format: 'xml',
    nspin,
    noncollinear: nspin === 4,
    nOrbitals: orbitals.length,
    fermi,
    energy,
    orbitals,
    components,
    units: { energy: 'eV', pdos: 'states/eV (per spin component)', position: 'Ang', positionBohr: 'Bohr (original)' },
  };
}

/** Plain-text PDOS table: first column energy, remaining columns curves. */
export function parsePDOSText(text) {
  const L = splitLines(text);
  let names = null;
  const rows = [];
  const comments = [];
  for (const ln of L) {
    const t = ln.trim();
    if (!t) continue;
    if (/^[#!@]/.test(t)) {
      comments.push(t);
      const toks = t.replace(/^[#!@]+/, '').trim().split(/\s{2,}|\t|,/).filter(Boolean);
      if (toks.length > 1) names = toks;
      continue;
    }
    const v = t.split(/\s+/).map(ffloat);
    if (v.some(Number.isNaN)) continue;
    rows.push(v);
  }
  const ncol = rows.length ? rows[0].length : 0;
  const energy = Float64Array.from(rows, (r) => r[0]);
  const columns = [];
  for (let c = 1; c < ncol; c++) columns.push(Float64Array.from(rows, (r) => r[c]));
  let colNames = names && names.length === ncol ? names.slice(1) : columns.map((_, i) => `col${i + 1}`);
  return { format: 'text', energy, columns, columnNames: colNames, comments, units: { energy: 'eV (assumed)' } };
}

export { parseKP as parsePDOSKP };

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

/** Data of one orbital for a spin selector:
 *  'total' (both spins; 2x the stored curve for nspin=1) | 'up' | 'down' | 'mz' | 0..3 (raw component index). */
export function orbitalSpin(pdos, orb, spin = 'total') {
  const d = orb.data;
  if (typeof spin === 'number') return d[spin];
  const ns = pdos.nspin;
  if (spin === 'total') {
    // nspin=1 files hold the DOS of ONE spin channel: total = 2 x value
    if (ns === 1) return d[0].map((v) => 2 * v);
    const out = new Float64Array(d[0].length);
    for (let i = 0; i < out.length; i++) out[i] = d[0][i] + d[1][i];
    return out;
  }
  if (spin === 'up') return d[0];
  if (spin === 'down') return ns === 1 ? d[0] : d[1];
  if (spin === 'mz') {
    if (ns === 1) return new Float64Array(d[0].length);
    return d[0].map((v, i) => v - d[1][i]);
  }
  throw new Error(`unknown spin selector ${spin}`);
}

function matches(orb, f) {
  for (const [k, v] of Object.entries(f || {})) {
    if (v == null) continue;
    const ov = k === 'atom' ? orb.atom : orb[k];
    if (Array.isArray(v) ? !v.includes(ov) : ov !== v) return false;
  }
  return true;
}

/** Sum PDOS over the orbitals matching a filter {species, atom, n, l, m, z, P}. */
export function sumPDOS(pdos, filter = {}, spin = 'total') {
  const out = new Float64Array(pdos.energy.length);
  for (const o of pdos.orbitals) {
    if (!matches(o, filter)) continue;
    const d = orbitalSpin(pdos, o, spin);
    for (let i = 0; i < out.length; i++) out[i] += d[i];
  }
  return out;
}

export function totalPDOS(pdos, spin = 'total') { return sumPDOS(pdos, {}, spin); }

/** Group by keys, e.g. groupPDOS(p, ['species','l']) -> [{key:{species,l}, label:'Si-p', data}] */
export function groupPDOS(pdos, keys = ['species'], spin = 'total') {
  const groups = new Map();
  for (const o of pdos.orbitals) {
    const key = {};
    for (const k of keys) key[k] = o[k];
    const id = JSON.stringify(key);
    if (!groups.has(id)) groups.set(id, { key, label: groupLabel(key), data: new Float64Array(pdos.energy.length), nOrbitals: 0 });
    const g = groups.get(id);
    const d = orbitalSpin(pdos, o, spin);
    for (let i = 0; i < d.length; i++) g.data[i] += d[i];
    g.nOrbitals++;
  }
  return [...groups.values()];
}

function groupLabel(key) {
  const parts = [];
  if (key.species != null) parts.push(key.species);
  if (key.atom != null) parts.push(`#${key.atom}`);
  if (key.n != null && key.l != null) parts.push(`${key.n}${LSYM[key.l] ?? key.l}`);
  else if (key.l != null) parts.push(LSYM[key.l] ?? `l${key.l}`);
  if (key.m != null) parts.push(`m=${key.m}`);
  if (key.z != null) parts.push(`ζ${key.z}`);
  if (key.P != null) parts.push(key.P ? 'pol' : '');
  return parts.filter(Boolean).join('-');
}

/** Integrate a curve (or the total PDOS) up to E (default E_F): number of electrons. */
export function integratePDOS(pdos, curve = null, upto = pdos.fermi) {
  const y = curve ?? totalPDOS(pdos, 'total');
  return trapz(pdos.energy, y, upto);
}

export function listSpecies(pdos) { return [...new Set(pdos.orbitals.map((o) => o.species))]; }
export function listAtoms(pdos) {
  const m = new Map();
  for (const o of pdos.orbitals) if (!m.has(o.atom)) m.set(o.atom, { atom: o.atom, species: o.species, position: o.position });
  return [...m.values()];
}
